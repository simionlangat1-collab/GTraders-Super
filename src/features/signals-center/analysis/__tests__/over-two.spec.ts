import { analyzeOverTwo, DEFAULT_OVER_TWO_THRESHOLD } from '../over-two';
import { SignalTick } from '../../types';

const makeTicks = (digits: number[]): SignalTick[] =>
    digits.map((digit, index) => ({
        symbol: 'R_100',
        quote: index,
        epoch: index,
        digit,
    }));

describe('analyzeOverTwo', () => {
    it('uses a configurable threshold and signals when the qualifying frequency meets it', () => {
        const result = analyzeOverTwo(makeTicks([
            ...Array(75).fill(3),
            ...Array(25).fill(2),
        ]));

        expect(result.status).toBe('BUY_OVER_2');
        expect(result.sampleSize).toBe(100);
        expect(result.qualifyingDigits).toBe(75);
        expect(result.qualifyingPercentage).toBe(75);
        expect(result.thresholdPercentage).toBe(DEFAULT_OVER_TWO_THRESHOLD);
    });

    it('waits when the qualifying frequency is below the threshold', () => {
        const result = analyzeOverTwo(makeTicks([
            ...Array(74).fill(9),
            ...Array(26).fill(1),
        ]));

        expect(result.status).toBe('WAIT');
        expect(result.qualifyingPercentage).toBe(74);
    });

    it('waits until a complete 100-tick sample is available', () => {
        const result = analyzeOverTwo(makeTicks(Array(99).fill(9)));

        expect(result.status).toBe('WAIT');
        expect(result.sampleSize).toBe(99);
        expect(result.qualifyingPercentage).toBe(0);
    });

    it('uses only the latest 100 ticks', () => {
        const result = analyzeOverTwo(makeTicks([
            ...Array(100).fill(1),
            ...Array(100).fill(8),
        ]));

        expect(result.status).toBe('BUY_OVER_2');
        expect(result.sampleSize).toBe(100);
        expect(result.qualifyingDigits).toBe(100);
    });

    it('counts the frequency of every digit from 0 to 9', () => {
        const result = analyzeOverTwo(makeTicks([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 0);

        expect(result.digitFrequencies).toEqual({
            0: 1, 1: 1, 2: 1, 3: 1, 4: 1,
            5: 1, 6: 1, 7: 1, 8: 1, 9: 1,
        });
    });

    it('rejects thresholds outside the percentage range', () => {
        expect(() => analyzeOverTwo([], 101)).toThrow('Threshold must be a percentage between 0 and 100.');
        expect(() => analyzeOverTwo([], -1)).toThrow('Threshold must be a percentage between 0 and 100.');
    });
});
