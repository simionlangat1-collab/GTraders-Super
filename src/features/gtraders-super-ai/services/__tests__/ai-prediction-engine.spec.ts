import { generateAIPrediction } from '../ai-prediction-engine';

describe('generateAIPrediction', () => {
    it('defaults to NO TRADE when the sample is too small', () => {
        const result = generateAIPrediction(Array(120).fill(7), 100);
        expect(result.decision).toBe('NO_TRADE');
        expect(result.predictedDigit).toBeNull();
        expect(result.explanation).toContain('NO TRADE');
    });

    it('rejects poor data quality even when a pattern looks strong', () => {
        const result = generateAIPrediction(Array(600).fill(7), 80);
        expect(result.decision).toBe('NO_TRADE');
        expect(result.validationPassed).toBe(false);
    });

    it('rejects invalid digits rather than silently training on a partial sequence', () => {
        const digits = [...Array(300).fill(0), ...Array(200).fill(7)];
        digits[10] = 12;
        const result = generateAIPrediction(digits, 100);
        expect(result.decision).toBe('NO_TRADE');
        expect(result.predictedDigit).toBeNull();
    });

    it('scores candidate and matched baseline only on the same unseen chronological holdout', () => {
        // Training period is all zeroes. The holdout changes to sevens.
        // The recent-window candidate adapts after 50 holdout ticks, while
        // the expanding-history baseline remains zero for this test sequence.
        const digits = [...Array(300).fill(0), ...Array(200).fill(7)];
        const result = generateAIPrediction(digits, 100);

        expect(result.trainingSampleSize).toBe(300);
        expect(result.holdoutSampleSize).toBe(200);
        expect(result.modelWinRate).toBeGreaterThan(result.baselineWinRate);
        expect(result.validationPassed).toBe(true);
        expect(result.decision).toBe('PREDICTION_CANDIDATE');
        expect(result.predictedDigit).toBe(7);
        expect(result.explanation).toContain('does not authorize an order');
    });

    it('does not claim a statistical edge when candidate matches the baseline', () => {
        const digits = Array(500).fill(4);
        const result = generateAIPrediction(digits, 100);
        expect(result.decision).toBe('NO_TRADE');
        expect(result.validationPassed).toBe(false);
        expect(result.predictedDigit).toBeNull();
    });
});
