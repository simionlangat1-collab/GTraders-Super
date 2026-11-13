import { AILiveTickStream, AILiveTickConnection } from '../ai-live-tick-stream';
import type { AIConnectionStatus } from '../ai-deriv-connection';

class MockTickConnection implements AILiveTickConnection {
    status: AIConnectionStatus = 'connected';
    listeners = new Set<(message: Record<string, unknown>) => void>();
    statusListeners = new Set<(status: AIConnectionStatus) => void>();
    requests: Record<string, unknown>[] = [];
    connect = jest.fn(async () => {
        this.status = 'connected';
        this.statusListeners.forEach(listener => listener(this.status));
    });
    requestData = jest.fn(async <T,>(payload: Record<string, unknown>): Promise<T> => {
        this.requests.push(payload);
        return { subscription: { id: `sub-${this.requests.length}` } } as T;
    });
    onMessage = (listener: (message: Record<string, unknown>) => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };
    onStatusChange = (listener: (status: AIConnectionStatus) => void) => {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => this.statusListeners.delete(listener);
    };
    getStatus = () => this.status;
    disconnect = () => {
        this.status = 'disconnected';
        this.statusListeners.forEach(listener => listener(this.status));
    };
    emit = (tick: { symbol: string; quote: number; epoch: number }) => {
        this.listeners.forEach(listener => listener({ tick }));
    };
    setStatus = (status: AIConnectionStatus) => {
        this.status = status;
        this.statusListeners.forEach(listener => listener(status));
    };
}

describe('AILiveTickStream', () => {
    const now = 1_700_000_010_000;
    let connection: MockTickConnection;
    let stream: AILiveTickStream;

    beforeEach(() => {
        jest.useFakeTimers();
        connection = new MockTickConnection();
        stream = new AILiveTickStream(connection, {
            nowMs: () => now,
            heartbeatIntervalMs: 100,
            silenceTimeoutMs: 1000,
            reconnectBaseDelayMs: 10,
        });
    });

    afterEach(() => {
        stream.stop();
        jest.useRealTimers();
    });

    it('requires consecutive fresh ticks before declaring the stream healthy', async () => {
        await stream.start('R_100');
        expect(stream.isHealthy()).toBe(false);

        connection.emit({ symbol: 'R_100', quote: 123.45, epoch: 1_700_000_009 });
        expect(stream.isHealthy()).toBe(false);

        connection.emit({ symbol: 'R_100', quote: 123.46, epoch: 1_700_000_010 });
        expect(stream.isHealthy()).toBe(true);
    });

    it('invalidates the stream when a tick is stale or belongs to another symbol', async () => {
        await stream.start('R_100');
        connection.emit({ symbol: 'R_50', quote: 123.45, epoch: 1_700_000_010 });
        expect(stream.getStatus()).toBe('error');
        expect(stream.isHealthy()).toBe(false);
    });

    it('rejects stale ticks even when the market symbol matches', async () => {
        await stream.start('R_100');
        connection.emit({ symbol: 'R_100', quote: 123.45, epoch: 1_700_000_008 });
        expect(stream.getStatus()).toBe('error');
        expect(stream.isHealthy()).toBe(false);
    });

    it('rejects out-of-order tick timestamps', async () => {
        await stream.start('R_100');
        connection.emit({ symbol: 'R_100', quote: 123.45, epoch: 1_700_000_009 });
        connection.emit({ symbol: 'R_100', quote: 123.46, epoch: 1_700_000_008 });
        expect(stream.getStatus()).toBe('error');
        expect(stream.isHealthy()).toBe(false);
    });

    it('reconnects after a WebSocket interruption but requires fresh ticks again', async () => {
        await stream.start('R_100');
        connection.setStatus('disconnected');
        await Promise.resolve();
        await Promise.resolve();

        expect(connection.connect).toHaveBeenCalledTimes(1);
        expect(connection.requests.filter(request => request.ticks === 'R_100')).toHaveLength(2);
        expect(stream.getStatus()).toBe('recovering');
        expect(stream.isHealthy()).toBe(false);
    });

    it('forces a fresh authenticated socket after a silent-but-open heartbeat timeout', async () => {
        let clock = now;
        stream = new AILiveTickStream(connection, {
            nowMs: () => clock,
            heartbeatIntervalMs: 100,
            silenceTimeoutMs: 1000,
            reconnectBaseDelayMs: 10,
        });
        await stream.start('R_100');
        clock += 1100;
        await jest.advanceTimersByTimeAsync(100);

        expect(connection.disconnect).toHaveBeenCalledTimes(1);
        expect(connection.connect).toHaveBeenCalledTimes(1);
        expect(connection.requests.filter(request => request.ticks === 'R_100')).toHaveLength(2);
        expect(stream.getStatus()).toBe('recovering');
        expect(stream.isHealthy()).toBe(false);
    });

    it('stops monitoring without attempting automatic reconnection', async () => {
        await stream.start('R_100');
        stream.stop();
        connection.setStatus('disconnected');
        await Promise.resolve();

        expect(stream.getStatus()).toBe('stopped');
        expect(connection.connect).not.toHaveBeenCalled();
    });
});
