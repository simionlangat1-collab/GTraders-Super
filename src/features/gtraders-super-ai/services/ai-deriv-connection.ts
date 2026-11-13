import { isProduction } from '@/components/shared';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import brandConfig from '../../../../brand.config.json';

export type AIConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface AIAccountSnapshot {
    loginid: string;
    balance: number;
    currency: string;
    account_type: 'demo' | 'real' | 'unknown';
}

interface DerivAPIError {
    code?: string;
    message?: string;
}

interface DerivMessage {
    req_id?: number;
    error?: DerivAPIError;
    balance?: AIAccountSnapshot;
    [key: string]: unknown;
}

interface PendingRequest {
    resolve: (message: DerivMessage) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

/**
 * Owns the AI module's private WebSocket.
 *
 * It reuses the current OAuth identity and account selection, but never imports,
 * closes, resets, or subscribes through the shared bot API connection.
 */
export class AIDerivConnection {
    private socket: WebSocket | null = null;
    private connectPromise: Promise<AIAccountSnapshot> | null = null;
    private requestId = 0;
    private pendingRequests = new Map<number, PendingRequest>();
    private status: AIConnectionStatus = 'disconnected';
    private account: AIAccountSnapshot | null = null;
    private statusListeners = new Set<(status: AIConnectionStatus) => void>();
    private messageListeners = new Set<(message: DerivMessage) => void>();
    private intentionalClose = false;
    private connectionAttempt = 0;

    getStatus = (): AIConnectionStatus => this.status;

    getAccount = (): AIAccountSnapshot | null => this.account;

    onStatusChange = (listener: (status: AIConnectionStatus) => void): (() => void) => {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => this.statusListeners.delete(listener);
    };

    onMessage = (listener: (message: DerivMessage) => void): (() => void) => {
        this.messageListeners.add(listener);
        return () => this.messageListeners.delete(listener);
    };

    private setStatus(status: AIConnectionStatus): void {
        this.status = status;
        this.statusListeners.forEach(listener => listener(status));
    }

    private rejectPendingRequests(reason: string): void {
        this.pendingRequests.forEach(pending => {
            clearTimeout(pending.timeout);
            pending.reject(new Error(reason));
        });
        this.pendingRequests.clear();
    }

    private handleMessage = (event: MessageEvent): void => {
        let message: DerivMessage;

        try {
            message = JSON.parse(String(event.data)) as DerivMessage;
        } catch {
            return;
        }

        if (typeof message.req_id === 'number') {
            const pending = this.pendingRequests.get(message.req_id);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(message.req_id);

                if (message.error) {
                    pending.reject(new Error(message.error.message || 'Deriv API request failed'));
                } else {
                    pending.resolve(message);
                }
            }
        }

        this.messageListeners.forEach(listener => listener(message));
    };

    private handleClose = (closedSocket: WebSocket): void => {
        // A late close event from an older socket must not clear a newer connection.
        if (this.socket !== closedSocket) return;

        this.rejectPendingRequests('AI Deriv connection closed.');
        this.socket = null;
        this.account = null;

        if (!this.intentionalClose) {
            this.setStatus('disconnected');
        }
    };

    private request = <T = DerivMessage>(payload: Record<string, unknown>): Promise<T> => {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error('AI Deriv connection is not open.'));
        }

        const reqId = ++this.requestId;
        const request = { ...payload, req_id: reqId };

        return new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(reqId);
                reject(new Error('Deriv API request timed out. Please try again.'));
            }, 12000);

            this.pendingRequests.set(reqId, {
                resolve: message => resolve(message as T),
                reject,
                timeout,
            });

            try {
                this.socket?.send(JSON.stringify(request));
            } catch (error) {
                clearTimeout(timeout);
                this.pendingRequests.delete(reqId);
                reject(error instanceof Error ? error : new Error('Unable to send Deriv API request.'));
            }
        });
    };

    /** Sends a request through the AI module's private authenticated socket only. */
    requestData = <T = DerivMessage>(payload: Record<string, unknown>): Promise<T> =>
        this.request<T>(payload);

    connect = async (): Promise<AIAccountSnapshot> => {
        if (this.status === 'connected' && this.account) return this.account;
        if (this.connectPromise) return this.connectPromise;

        this.connectPromise = this.connectPrivateSocket();

        try {
            return await this.connectPromise;
        } finally {
            this.connectPromise = null;
        }
    };

    private async getPrivateWebSocketUrl(accessToken: string): Promise<{ url: string; accountType: 'demo' | 'real' | 'unknown' }> {
        // Reuse account identity data only. The AI requests its own fresh OTP so
        // it cannot accidentally share the existing bot's one-time WebSocket URL.
        const storedAccounts = DerivWSAccountsService.getStoredAccounts();
        const accounts =
            storedAccounts && storedAccounts.length > 0
                ? storedAccounts
                : await DerivWSAccountsService.fetchAccountsList(accessToken);

        if (!accounts.length) {
            throw new Error('No Deriv accounts are available for the AI connection.');
        }

        const selectedAccountId = localStorage.getItem('active_loginid');
        const selectedAccount = selectedAccountId
            ? accounts.find(account => account.account_id === selectedAccountId)
            : accounts[0];

        if (!selectedAccount) {
            throw new Error('The selected Deriv account could not be verified. Please switch accounts and try again.');
        }

        const environment = isProduction() ? 'production' : 'staging';
        const baseUrl = brandConfig.platform.derivws.url[environment];
        const optionsDirectory = brandConfig.platform.derivws.directories.options;
        const otpEndpoint = `${baseUrl}${optionsDirectory}accounts/${selectedAccount.account_id}/otp`;

        const response = await fetch(otpEndpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Deriv could not issue a private AI connection URL (${response.status}).`);
        }

        const otpResponse = (await response.json()) as { data?: { url?: string } };
        const websocketUrl = otpResponse.data?.url;

        if (!websocketUrl) {
            throw new Error('Deriv did not return a private AI WebSocket URL.');
        }

        const accountType = selectedAccount.account_type === 'demo' || selectedAccount.account_type === 'real'
            ? selectedAccount.account_type
            : 'unknown';

        return { url: websocketUrl, accountType };
    }

    private async connectPrivateSocket(): Promise<AIAccountSnapshot> {
        const attemptId = ++this.connectionAttempt;
        let attemptSocket: WebSocket | null = null;
        this.intentionalClose = false;
        this.setStatus('connecting');

        try {
            const authInfo = OAuthTokenExchangeService.getAuthInfo();
            if (!authInfo?.access_token) {
                throw new Error('Please log in to Deriv before connecting the AI assistant.');
            }

            const selectedAccountId = localStorage.getItem('active_loginid');
            const connectionDetails = await this.getPrivateWebSocketUrl(authInfo.access_token);
            const websocketUrl = connectionDetails.url;
            if (attemptId !== this.connectionAttempt) throw new Error('AI connection was stopped.');

            if (!websocketUrl) {
                throw new Error('Deriv did not provide an authenticated WebSocket URL.');
            }

            const socket = new WebSocket(websocketUrl);
            attemptSocket = socket;
            this.socket = socket;
            socket.addEventListener('message', event => {
                if (this.socket === socket) this.handleMessage(event);
            });
            socket.addEventListener('close', () => this.handleClose(socket));

            await new Promise<void>((resolve, reject) => {
                const openTimeout = setTimeout(() => {
                    reject(new Error('Timed out while opening the AI Deriv connection.'));
                }, 15000);

                socket.addEventListener(
                    'open',
                    () => {
                        clearTimeout(openTimeout);
                        resolve();
                    },
                    { once: true }
                );

                socket.addEventListener(
                    'error',
                    () => {
                        clearTimeout(openTimeout);
                        reject(new Error('Could not establish the AI Deriv WebSocket connection.'));
                    },
                    { once: true }
                );

                socket.addEventListener(
                    'close',
                    () => {
                        clearTimeout(openTimeout);
                        reject(new Error('The AI Deriv connection closed before it was ready.'));
                    },
                    { once: true }
                );
            });

            if (attemptId !== this.connectionAttempt) throw new Error('AI connection was stopped.');

            const response = await this.request<{ balance: AIAccountSnapshot }>({ balance: 1 });
            if (attemptId !== this.connectionAttempt) throw new Error('AI connection was stopped.');
            const account = response.balance;

            if (!account?.loginid) {
                throw new Error('Deriv did not confirm the authenticated account.');
            }

            if (selectedAccountId && account.loginid !== selectedAccountId) {
                throw new Error(
                    'The AI connection account does not match the selected Deriv account. Please reconnect.'
                );
            }

            this.account = {
                loginid: account.loginid,
                balance: Number(account.balance),
                currency: account.currency,
                account_type: connectionDetails.accountType,
            };
            this.setStatus('connected');
            return this.account;
        } catch (error) {
            if (attemptId !== this.connectionAttempt) {
                if (attemptSocket && attemptSocket.readyState < WebSocket.CLOSING) {
                    attemptSocket.close();
                }
                throw error instanceof Error ? error : new Error('AI connection was stopped.');
            }

            this.intentionalClose = true;
            this.rejectPendingRequests('AI Deriv connection could not be established.');
            if (attemptSocket && attemptSocket.readyState < WebSocket.CLOSING) {
                attemptSocket.close();
            }
            if (this.socket === attemptSocket) this.socket = null;
            this.account = null;
            this.setStatus('error');
            throw error instanceof Error ? error : new Error('AI Deriv connection failed.');
        }
    }

    disconnect = (): void => {
        this.connectionAttempt += 1;
        this.intentionalClose = true;
        this.rejectPendingRequests('AI Deriv connection was stopped.');
        const socket = this.socket;
        this.socket = null;
        this.account = null;

        if (socket && socket.readyState < WebSocket.CLOSING) {
            socket.close();
        }

        this.setStatus('disconnected');
    };
}
