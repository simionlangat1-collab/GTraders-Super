import { validateAIModelOutOfSample } from '../ai-model-validation';

const makeObservations = (
    count: number,
    modelCorrect: (index: number) => boolean,
    baselineCorrect: (index: number) => boolean = () => false
) => Array.from({ length: count }, (_, index) => ({
    settledAt: 2000 + index,
    modelPredictionCorrect: modelCorrect(index),
    baselinePredictionCorrect: baselineCorrect(index),
}));

describe('validateAIModelOutOfSample', () => {
    it('validates only a clean chronological holdout with a statistically stronger model', () => {
        const result = validateAIModelOutOfSample({
            trainingCutoff: 1000,
            marketSampleSize: 500,
            dataQuality: 100,
            observations: makeObservations(300, index => index < 240, index => index < 150),
        });

        expect(result.evidence.outOfSampleTradeCount).toBe(300);
        expect(result.evidence.observedWinRate).toBe(0.8);
        expect(result.evidence.baselineWinRate).toBe(0.5);
        expect(result.evidence.validationPassed).toBe(true);
        expect(result.evidence.winRateConfidenceLowerBound).toBeGreaterThan(0.5);
    });

    it('rejects observations at or before the training cutoff', () => {
        const result = validateAIModelOutOfSample({
            trainingCutoff: 2000,
            marketSampleSize: 500,
            dataQuality: 100,
            observations: makeObservations(250, () => true),
        });

        expect(result.evidence.outOfSampleTradeCount).toBe(249);
        expect(result.rejectedObservations).toBe(1);
        expect(result.evidence.validationPassed).toBe(false);
    });

    it('rejects a holdout that does not beat the matched baseline', () => {
        const result = validateAIModelOutOfSample({
            trainingCutoff: 1000,
            marketSampleSize: 500,
            dataQuality: 100,
            observations: makeObservations(300, () => true, () => true),
        });

        expect(result.evidence.validationPassed).toBe(false);
        expect(result.evidence.winRateConfidenceLowerBound).toBeLessThanOrEqual(
            result.evidence.baselineWinRate
        );
    });

    it('requires at least 200 clean settled holdout observations', () => {
        const result = validateAIModelOutOfSample({
            trainingCutoff: 1000,
            marketSampleSize: 500,
            dataQuality: 100,
            observations: makeObservations(199, () => true),
        });

        expect(result.evidence.validationPassed).toBe(false);
    });

    it('rejects malformed input and invalid timestamps without claiming validation', () => {
        const result = validateAIModelOutOfSample({
            trainingCutoff: Number.NaN,
            marketSampleSize: -1,
            dataQuality: 101,
            observations: [{
                settledAt: Number.NaN,
                modelPredictionCorrect: true,
                baselinePredictionCorrect: true,
            }],
        });

        expect(result.evidence.validationPassed).toBe(false);
        expect(result.evidence.outOfSampleTradeCount).toBe(0);
        expect(result.rejectedObservations).toBe(1);
    });
});
