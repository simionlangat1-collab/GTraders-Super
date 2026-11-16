import { SignalCenterSnapshot, SignalTick } from './types';
import { SIGNAL_TICK_WINDOW } from './analysis/over-two';

/**
 * Small framework-independent store for Signal Center market data.
 * It does not place trades and has no dependency on Manual Trader services.
 */
export class SignalCenterStore {
    private selectedSymbol: string | null = null;
    private ticks: SignalTick[] = [];
    private listeners = new Set<() => void>();

    getSnapshot = (): SignalCenterSnapshot => ({
        selectedSymbol: this.selectedSymbol,
        ticks: [...this.ticks],
    });

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    setSelectedSymbol(symbol: string | null): void {
        const nextSymbol = symbol?.trim() || null;
        if (nextSymbol === this.selectedSymbol) return;
        this.selectedSymbol = nextSymbol;
        this.ticks = [];
        this.notify();
    }

    addTick(tick: SignalTick): void {
        if (!this.selectedSymbol || tick.symbol !== this.selectedSymbol) return;
        if (
            !Number.isFinite(tick.quote) ||
            !Number.isFinite(tick.epoch) ||
            !Number.isInteger(tick.digit) ||
            tick.digit < 0 ||
            tick.digit > 9
        ) return;

        this.ticks = [...this.ticks, tick].slice(-SIGNAL_TICK_WINDOW);
        this.notify();
    }

    setTicks(ticks: SignalTick[]): void {
        if (!this.selectedSymbol) return;
        this.ticks = ticks
            .filter(tick =>
                tick.symbol === this.selectedSymbol &&
                Number.isFinite(tick.quote) &&
                Number.isFinite(tick.epoch) &&
                Number.isInteger(tick.digit) &&
                tick.digit >= 0 &&
                tick.digit <= 9
            )
            .slice(-SIGNAL_TICK_WINDOW);
        this.notify();
    }

    clear(): void {
        if (this.ticks.length === 0 && this.selectedSymbol === null) return;
        this.selectedSymbol = null;
        this.ticks = [];
        this.notify();
    }

    private notify(): void {
        this.listeners.forEach(listener => listener());
    }
}

export const signalCenterStore = new SignalCenterStore();
