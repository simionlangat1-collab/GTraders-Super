import type { AIConnectionStatus } from './ai-deriv-connection';

export type AILiveTickStatus = 'stopped' | 'recovering' | 'healthy' | 'interrupted' | 'error';

export interface AILiveTick {
    symbol: string;
    quote: number;
    epoch: number;
}

interface DerivTickMessage {
    tick?: {
        symbol?: string;
        quote?: number | string;
        epoch?: number | string;
    };
    subscription?: { id?: string };
}

export interface AILiveTickConnection {
    requestData<T = DerivTickMessage>(payload: Record<string, unknown>): Promise<T>;
    onMessage(listener: (message: Record<string, unknown>) => void): () => void;
    onStatusChange(listener: (status: AIConnectionStatus) => void): () => void;
    getStatus(): AIConnectionStatus;
    connect(): Promise<unknown>;
    disconnect(): void;
}

export interface AILiveTickStreamOptions {
    silenceTimeoutMs?: number;
    heartbeatIntervalMs?: number;
    reconnectAttempts?: number;
    reconnectBaseDelayMs?: number;
    recoveryTicksRequired?: number;
    nowMs?: () => number;
    onStatus?: (status: AILiveTickStatus, reason: string) => void;
    onTick?: (tick: AILiveTick) => void;
}

/**
 * Monitors one live Deriv tick subscription. A stream is usable only after
 * consecutive, fresh, ordered ticks. Interruptions invalidate health before
 * reconnection begins; reconnecting never authorizes or repeats a purchase.
 */
export class AILiveTickStream {
    private readonly silenceTimeoutMs: number;
    private readonly heartbeatIntervalMs: number;
    private readonly reconnectAttempts: number;
    private readonly reconnectBaseDelayMs: number;
    private readonly recoveryTicksRequired: number;
    private readonly nowMs: () => number;
    private status: AILiveTickStatus = 'stopped';
    private symbol = '';
    private lastEpoch = 0;
    private lastTickAt = 0;
    private recoveryTicks = 0;
    private subscriptionId: string | null = null;
    private unsubscribeMessages: (() => void) | null = null;
    private unsubscribeConnection: (() => void) | null = null;
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private generation = 0;
    private reconnecting = false;
    private consecutiveReconnectCycles = 0;
    private manuallyStopped = false;

    constructor(
        private readonly connection: AILiveTickConnection,
        private readonly options: AILiveTickStreamOptions = {}
    ) {
        this.silenceTimeoutMs = options.silenceTimeoutMs ?? 10000;
        this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 1000;
        this.reconnectAttempts = options.reconnectAttempts ?? 3;
        this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1000;
        this.recoveryTicksRequired = options.recoveryTicksRequired ?? 2;
        this.nowMs = options.nowMs ?? (() => Date.now());
    }

    getStatus = (): AILiveTickStatus => this.status;

    isHealthy = (): boolean => this.status === 'healthy';

    start = async (symbol: string): Promise<void> => {
        if (!symbol.trim()) throw new Error('A market symbol is required for live tick monitoring.');
        this.stop();
        this.manuallyStopped = false;
        this.symbol = symbol;
        const generation = ++this.generation;

        if (this.connection.getStatus() !== 'connected') {
            this.setStatus('error', 'The authenticated Deriv connection is not ready. NO TRADE.');
            throw new Error('The authenticated Deriv connection is not ready. NO TRADE.');
        }

        this.attachListeners();
        this.lastTickAt = this.nowMs();
        this.setStatus('recovering', 'Waiting for consecutive fresh ticks before enabling market evidence.');
        this.startHeartbeat();

        try {
            await this.subscribe(generation);
        } catch (error) {
            this.clearSubscriptions();
            this.stopHeartbeat();
            this.setStatus('error', error instanceof Error ? error.message : 'Live tick subscription failed. NO TRADE.');
            throw error;
        }
    };

    private setStatus(status: AILiveTickStatus, reason: string): void {
        this.status = status;
        this.options.onStatus?.(status, reason);
    }

    private attachListeners(): void {
        this.unsubscribeMessages?.();
        this.unsubscribeConnection?.();
        this.unsubscribeMessages = this.connection.onMessage(message => this.handleMessage(message));
        this.unsubscribeConnection = this.connection.onStatusChange(status => {
            if ((status === 'disconnected' || status === 'error') && !this.manuallyStopped) {
                void this.recover('Deriv WebSocket disconnected. Live evidence invalidated; NO TRADE.');
            }
        });
    }

    private stopHeartbeat(): void {
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
    }

    private startHeartbeat(): void {
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => {
            if (this.manuallyStopped || this.status === 'stopped' || this.status === 'error') return;
            if (this.nowMs() - this.lastTickAt > this.silenceTimeoutMs) {
                void this.recover('Live tick heartbeat expired. Market data is unreliable; NO TRADE.');
            }
        }, this.heartbeatIntervalMs);
    }

    private async subscribe(generation: number): Promise<void> {
        const response = await this.connection.requestData<DerivTickMessage>({
            ticks: this.symbol,
            subscribe: 1,
        });
        if (generation !== this.generation || this.manuallyStopped) return;
        this.subscriptionId = response.subscription?.id ?? null;
        if (response.tick) this.acceptTick(response.tick);
    }

    private handleMessage(message: Record<string, unknown>): void {
        const tickMessage = message as DerivTickMessage;
        if (tickMessage.tick) this.acceptTick(tickMessage.tick);
    }

    private acceptTick(raw: NonNullable<DerivTickMessage['tick']>): void {
        if (this.manuallyStopped || this.status === 'interrupted' || this.status === 'error') return;
        const quote = Number(raw.quote);
        const epoch = Number(raw.epoch);
        const nowSeconds = this.nowMs() / 1000;

        if (
            raw.symbol !== this.symbol ||
            !Number.isFinite(quote) ||
            !Number.isFinite(epoch) ||
            epoch <= 0 ||
            epoch > nowSeconds + 5 ||
            nowSeconds - epoch > this.silenceTimeoutMs / 1000
        ) {
            this.invalidate('Invalid, stale, future-dated or mismatched tick received. NO TRADE.');
            return;
        }
        if (this.lastEpoch > 0 && epoch < this.lastEpoch) {
            this.invalidate('Out-of-order tick timestamp received. NO TRADE.');
            return;
        }

        this.lastEpoch = epoch;
        this.lastTickAt = this.nowMs();
        this.recoveryTicks += 1;
        const tick = { symbol: this.symbol, quote, epoch };
        this.options.onTick?.(tick);

        if (this.recoveryTicks >= this.recoveryTicksRequired) {
            this.consecutiveReconnectCycles = 0;
            this.setStatus('healthy', 'Live tick stream is fresh and ordered.');
        } else {
            this.setStatus('recovering', 'Revalidating live stream with consecutive ticks.');
        }
    }

    private invalidate(reason: string): void {
        this.recoveryTicks = 0;
        this.setStatus('error', reason);
        this.clearSubscriptions();
        this.stopHeartbeat();
    }

    private async recover(reason: string): Promise<void> {
        if (this.manuallyStopped || this.reconnecting || this.status === 'error') return;
        if (this.consecutiveReconnectCycles >= this.reconnectAttempts) {
            this.setStatus('error', 'Live stream did not recover within the allowed reconnect cycles. NO TRADE.');
            this.stopHeartbeat();
            this.clearSubscriptions();
            return;
        }
        this.consecutiveReconnectCycles += 1;
        this.reconnecting = true;
        const generation = ++this.generation;
        this.recoveryTicks = 0;
        const previousSubscriptionId = this.subscriptionId;
        this.subscriptionId = null;
        if (previousSubscriptionId && this.connection.getStatus() === 'connected') {
            void this.connection.requestData({ forget: previousSubscriptionId }).catch(() => undefined);
        }
        this.setStatus('interrupted', reason);

        try {
            for (let attempt = 1; attempt <= this.reconnectAttempts; attempt += 1) {
                if (this.manuallyStopped || generation !== this.generation) return;
                try {
                    // First test the authenticated socket without tearing it down.
                    // A quiet tick feed is not, by itself, proof that the account
                    // connection is dead. Reconnect only when the Deriv ping fails.
                    if (this.connection.getStatus() === 'connected') {
                        try {
                            await this.connection.requestData({ ping: 1 });
                        } catch {
                            this.connection.disconnect();
                        }
                    }
                    if (this.connection.getStatus() !== 'connected') {
                        await this.connection.connect();
                    }
                    if (this.manuallyStopped || generation !== this.generation) return;
                    this.lastTickAt = this.nowMs();
                    await this.subscribe(generation);
                    if (generation !== this.generation || this.manuallyStopped) return;
                    this.setStatus('recovering', 'Reconnected. Waiting for fresh ticks; trading remains blocked.');
                    return;
                } catch {
                    if (attempt === this.reconnectAttempts) {
                        this.setStatus('error', 'Safe reconnection failed after bounded attempts. NO TRADE.');
                        this.stopHeartbeat();
                        this.clearSubscriptions();
                        return;
                    }
                    await new Promise(resolve => setTimeout(resolve, this.reconnectBaseDelayMs * 2 ** (attempt - 1)));
                }
            }
        } finally {
            this.reconnecting = false;
        }
    }

    private clearSubscriptions(): void {
        this.unsubscribeMessages?.();
        this.unsubscribeConnection?.();
        this.unsubscribeMessages = null;
        this.unsubscribeConnection = null;
        const id = this.subscriptionId;
        this.subscriptionId = null;
        if (id && this.connection.getStatus() === 'connected') {
            void this.connection.requestData({ forget: id }).catch(() => undefined);
        }
    }

    stop = (): void => {
        this.manuallyStopped = true;
        this.generation += 1;
        this.stopHeartbeat();
        this.clearSubscriptions();
        this.recoveryTicks = 0;
        this.lastEpoch = 0;
        this.lastTickAt = 0;
        this.reconnecting = false;
        this.consecutiveReconnectCycles = 0;
        this.setStatus('stopped', 'Live tick monitoring stopped. Trading must remain blocked until restarted.');
    };
}
