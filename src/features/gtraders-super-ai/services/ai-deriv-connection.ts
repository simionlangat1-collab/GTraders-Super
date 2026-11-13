import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';

export type AIConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface AIAccountSnapshot {
    loginid: string;
    balance: number;
    currency: string;
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

    private handleClose = (): void => {
        this.rejectPendingRequests('AI Deriv connection closed.');
        this.socket = null;
        this.account = null;

        if (!this.intentionalClose) {
            this.setStatus('disconnected');
        }
    };

    private request = <T extends DerivMessage>(payload: Record<string, unknown>): Promise<T> => {
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

    private async connectPrivateSocket(): Promise<AIAccountSnapshot> {
        this.intentionalClose = false;
        this.setStatus('connecting');

        try {
            const authInfo = OAuthTokenExchangeService.getAuthInfo();
            if (!authInfo?.access_token) {
                throw new Error('Please log in to Deriv before connecting the AI assistant.');
            }

            const selectedAccountId = localStorage.getItem('active_loginid');
            const websocketUrl = await DerivWSAccountsService.getAuthenticatedWebSocketURL(
                authInfo.access_token
            );

            if (!websocketUrl) {
                throw new Error('Deriv did not provide an authenticated WebSocket URL.');
            }

            const socket = new WebSocket(websocketUrl);
            this.socket = socket;
            socket.addEventListener('message', this.handleMessage);
            socket.addEventListener('close', this.handleClose);

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
            });

            const response = await this.request<{ balance: AIAccountSnapshot }>({ balance: 1 });
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
            };
            this.setStatus('connected');
            return this.account;
        } catch (error) {
            this.intentionalClose = true;
            this.rejectPendingRequests('AI Deriv connection could not be established.');
            if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
                this.socket.close();
            }
            this.socket = null;
            this.account = null;
            this.setStatus('error');
            throw error instanceof Error ? error : new Error('AI Deriv connection failed.');
        }
    }

    disconnect = (): void => {
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
