import { analyseMarketDigits } from '../ai-market-statistics';

describe('analyseMarketDigits', () => {
    it('returns an empty, non-sufficient analysis for no observations', () => {
        const result = analyseMarketDigits([]);

        expect(result.sampleSize).toBe(0);
        expect(result.chiSquareStatistic).toBeNull();
        expect(result.sufficientSample).toBe(false);
        expect(result.mostObservedDigit).toBeNull();
        expect(result.frequencies).toHaveLength(10);
    });

    it('counts valid digits and ignores invalid values', () => {
        const result = analyseMarketDigits([0, 1, 1, 9, -1, 10, 1.5]);

        expect(result.sampleSize).toBe(4);
        expect(result.frequencies[1].count).toBe(2);
        expect(result.frequencies[0].count).toBe(1);
        expect(result.frequencies[9].count).toBe(1);
    });

    it('marks 100 observations as the minimum sufficient descriptive sample', () => {
        const result = analyseMarketDigits(Array.from({ length: 100 }, (_, index) => index % 10));

        expect(result.sufficientSample).toBe(true);
        expect(result.rollingWindows.map(window => window.windowSize)).toEqual([50, 100]);
        expect(result.frequencies.every(item => item.percentage === 10)).toBe(true);
        expect(result.chiSquareStatistic).toBe(0);
    });

    it('calculates Wilson intervals within valid percentage bounds', () => {
        const result = analyseMarketDigits([0, 0, 0, 1, 2, 3, 4, 5, 6, 7]);

        result.frequencies.forEach(item => {
            expect(item.confidenceLow).toBeGreaterThanOrEqual(0);
            expect(item.confidenceHigh).toBeLessThanOrEqual(100);
            expect(item.confidenceLow).toBeLessThanOrEqual(item.confidenceHigh);
        });
    });

    it('labels the output as historical description, not next-tick probability', () => {
        const result = analyseMarketDigits(Array.from({ length: 120 }, (_, index) => index % 10));

        expect(result.interpretation).toContain('not next-tick probabilities');
    });
});
