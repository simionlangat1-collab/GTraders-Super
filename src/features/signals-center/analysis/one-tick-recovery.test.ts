import { analyzeOneTickRecovery } from './one-tick-recovery';
import { SignalTick } from '../types';

const ticks = (digits: number[]): SignalTick[] =>
    digits.map((digit, index) => ({
        symbol: 'TEST',
        quote: digit,
        epoch: index + 1,
        digit,
    }));

describe('analyzeOneTickRecovery', () => {
    it('separates exactly one losing touch from multi-touch recovery runs', () => {
        const result = analyzeOneTickRecovery(ticks([4, 2, 7, 6, 1, 0, 8, 9, 0, 5]));

        expect(result.oneTouchRuns).toBe(2);
        expect(result.multiTouchRuns).toBe(1);
        expect(result.completedRecoveryRuns).toBe(3);
        expect(result.oneTouchRunPercentage).toBeCloseTo(66.666, 2);
        expect(result.multiTouchRunPercentage).toBeCloseTo(33.333, 2);
    });

    it('measures immediate recovery after 0, 1 and 2 separately and collectively', () => {
        const result = analyzeOneTickRecovery(ticks([0, 7, 1, 2, 8, 2, 9]));

        expect(result.byLosingDigit[0].observedTouches).toBe(1);
        expect(result.byLosingDigit[0].immediateWinningTicks).toBe(1);
        expect(result.byLosingDigit[1].observedTouches).toBe(1);
        expect(result.byLosingDigit[1].immediateWinningTicks).toBe(0);
        expect(result.byLosingDigit[2].observedTouches).toBe(2);
        expect(result.byLosingDigit[2].immediateWinningTicks).toBe(2);
        expect(result.losingTouchesWithNextTick).toBe(4);
        expect(result.immediateWinningTicks).toBe(3);
        expect(result.immediateRecoveryPercentage).toBe(75);
    });

    it('does not count a losing run until a winning digit follows it', () => {
        const result = analyzeOneTickRecovery(ticks([3, 2, 1, 0]));

        expect(result.completedRecoveryRuns).toBe(0);
        expect(result.oneTouchRuns).toBe(0);
        expect(result.multiTouchRuns).toBe(0);
    });

    it('returns zero percentages when there are no eligible observations', () => {
        const result = analyzeOneTickRecovery(ticks([3, 4, 5]));

        expect(result.immediateRecoveryPercentage).toBe(0);
        expect(result.oneTouchRunPercentage).toBe(0);
        expect(result.multiTouchRunPercentage).toBe(0);
    });
});
