import { generateAIPrediction } from '../ai-prediction-engine';

const timestamps = (count: number) => Array.from({ length: count }, (_, index) => 1_700_000_000 + index);

describe('generateAIPrediction', () => {
    it('defaults to NO TRADE when the sample is too small', () => {
        const result = generateAIPrediction(Array(120).fill(7), 100, {}, timestamps(120));
        expect(result.decision).toBe('NO_TRADE');
        expect(result.predictedDigit).toBeNull();
        expect(result.explanation).toContain('NO TRADE');
    });

    it('rejects poor data quality even when a pattern looks strong', () => {
        const result = generateAIPrediction(Array(600).fill(7), 80, {}, timestamps(600));
        expect(result.decision).toBe('NO_TRADE');
        expect(result.validationPassed).toBe(false);
    });

    it('rejects invalid digits rather than silently training on a partial sequence', () => {
        const digits = [...Array(300).fill(0), ...Array(200).fill(7)];
        digits[10] = 12;
        const result = generateAIPrediction(digits, 100, {}, timestamps(500));
        expect(result.decision).toBe('NO_TRADE');
        expect(result.predictedDigit).toBeNull();
    });

    it('scores the training-selected candidate and baseline only on the same unseen chronological holdout', () => {
        const digits = [...Array(300).fill(0), ...Array(200).fill(7)];
        const result = generateAIPrediction(digits, 100, {
            candidateWindows: [20, 30, 50, 75, 100],
        }, timestamps(500));

        expect(result.trainingSampleSize).toBe(300);
        expect(result.holdoutSampleSize).toBe(200);
        expect(result.modelWinRate).toBeGreaterThan(result.baselineWinRate);
        expect(result.validationPassed).toBe(true);
        expect(result.decision).toBe('PREDICTION_CANDIDATE');
        expect(result.predictedDigit).toBe(7);
        expect(result.explanation).toContain('selected inside training');
        expect(result.explanation).toContain('does not authorize an order');
    });

    it('does not claim a statistical edge when candidate matches the baseline', () => {
        const result = generateAIPrediction(Array(500).fill(4), 100, {}, timestamps(500));
        expect(result.decision).toBe('NO_TRADE');
        expect(result.validationPassed).toBe(false);
        expect(result.predictedDigit).toBeNull();
    });

    it('requires real aligned timestamps before validating a candidate', () => {
        const result = generateAIPrediction([...Array(300).fill(0), ...Array(200).fill(7)], 100);
        expect(result.decision).toBe('NO_TRADE');
        expect(result.explanation).toContain('timestamps');
    });
});
