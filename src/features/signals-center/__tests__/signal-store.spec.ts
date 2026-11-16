import { SignalCenterStore } from '../signal-store';
import { SignalTick } from '../types';

const tick = (symbol: string, digit: number, epoch: number): SignalTick => ({
    symbol,
    quote: epoch,
    epoch,
    digit,
});

describe('SignalCenterStore', () => {
    it('keeps only the latest 100 ticks for the selected market', () => {
        const store = new SignalCenterStore();
        store.setSelectedSymbol('R_100');

        for (let index = 0; index < 105; index += 1) {
            store.addTick(tick('R_100', index % 10, index));
        }

        const snapshot = store.getSnapshot();
        expect(snapshot.selectedSymbol).toBe('R_100');
        expect(snapshot.ticks).toHaveLength(100);
        expect(snapshot.ticks[0].epoch).toBe(5);
        expect(snapshot.ticks[99].epoch).toBe(104);
    });

    it('keeps the snapshot reference stable until the store changes', () => {
        const store = new SignalCenterStore();
        const initialSnapshot = store.getSnapshot();

        expect(store.getSnapshot()).toBe(initialSnapshot);
        store.setSelectedSymbol('R_100');
        expect(store.getSnapshot()).not.toBe(initialSnapshot);
    });

    it('ignores ticks from a market other than the selected market', () => {
        const store = new SignalCenterStore();
        store.setSelectedSymbol('R_100');
        store.addTick(tick('R_50', 8, 1));

        expect(store.getSnapshot().ticks).toHaveLength(0);
    });

    it('clears the tick window when the selected market changes', () => {
        const store = new SignalCenterStore();
        store.setSelectedSymbol('R_100');
        store.addTick(tick('R_100', 8, 1));
        store.setSelectedSymbol('R_50');

        expect(store.getSnapshot()).toEqual({
            selectedSymbol: 'R_50',
            ticks: [],
        });
    });

    it('notifies subscribers when market data changes and supports unsubscribe', () => {
        const store = new SignalCenterStore();
        const listener = jest.fn();
        const unsubscribe = store.subscribe(listener);

        store.setSelectedSymbol('R_100');
        store.addTick(tick('R_100', 8, 1));
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        store.addTick(tick('R_100', 7, 2));
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
