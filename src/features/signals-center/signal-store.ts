import { SIGNAL_TICK_WINDOW } from './analysis/over-two';
import { SignalCenterSnapshot, SignalTick } from './types';

/**
 * Small framework-independent store for Signal Center market data.
 * It does not place trades and has no dependency on Manual Trader services.
 */
export class SignalCenterStore {
    private snapshot: SignalCenterSnapshot = {
        selectedSymbol: null,
        ticks: [],
    };
    private listeners = new Set<() => void>();

    // Keep the same snapshot reference between updates for React external-store compatibility.
    getSnapshot = (): SignalCenterSnapshot => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    setSelectedSymbol(symbol: string | null): void {
        const nextSymbol = symbol?.trim() || null;
        if (nextSymbol === this.snapshot.selectedSymbol) return;
        this.snapshot = { selectedSymbol: nextSymbol, ticks: [] };
        this.notify();
    }

    addTick(tick: SignalTick): void {
        if (!this.snapshot.selectedSymbol || tick.symbol !== this.snapshot.selectedSymbol) return;
        if (
            !Number.isFinite(tick.quote) ||
            !Number.isFinite(tick.epoch) ||
            !Number.isInteger(tick.digit) ||
            tick.digit < 0 ||
            tick.digit > 9
        ) return;

        this.snapshot = {
            ...this.snapshot,
            ticks: [...this.snapshot.ticks, tick].slice(-SIGNAL_TICK_WINDOW),
        };
        this.notify();
    }

    setTicks(ticks: SignalTick[]): void {
        if (!this.snapshot.selectedSymbol) return;
        const selectedSymbol = this.snapshot.selectedSymbol;
        this.snapshot = {
            ...this.snapshot,
            ticks: ticks
                .filter(tick =>
                    tick.symbol === selectedSymbol &&
                    Number.isFinite(tick.quote) &&
                    Number.isFinite(tick.epoch) &&
                    Number.isInteger(tick.digit) &&
                    tick.digit >= 0 &&
                    tick.digit <= 9
                )
                .slice(-SIGNAL_TICK_WINDOW),
        };
        this.notify();
    }

    clear(): void {
        if (this.snapshot.ticks.length === 0 && this.snapshot.selectedSymbol === null) return;
        this.snapshot = { selectedSymbol: null, ticks: [] };
        this.notify();
    }

    private notify(): void {
        this.listeners.forEach(listener => listener());
    }
}

export const signalCenterStore = new SignalCenterStore();
