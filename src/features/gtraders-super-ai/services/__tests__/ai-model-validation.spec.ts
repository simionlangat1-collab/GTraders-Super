import { calculatePairedExactPValue, getFamilyWiseConfidenceZ, validateAIModelOutOfSample } from '../ai-model-validation';

const makeObservations = (
    count: number,
    modelCorrect: (index: number) => boolean,
    baselineCorrect: (index: number) => boolean = () => false
) => Array.from({ length: count }, (_, index) => ({
    settledAt: 2000 + index,
    observationIndex: index + 1,
    modelPredictionCorrect: modelCorrect(index),
    baselinePredictionCorrect: baselineCorrect(index),
}));

const baseInput = {
    trainingCutoffTimestamp: 1000,
    trainingCutoffIndex: 0,
    marketSampleSize: 500,
    dataQuality: 100,
};

describe('validateAIModelOutOfSample', () => {
    it('validates only a clean chronological holdout with a statistically stronger model', () => {
        const result = validateAIModelOutOfSample({
            ...baseInput,
            observations: makeObservations(300, index => index < 240, index => index < 150),
        });

        expect(result.evidence.outOfSampleTradeCount).toBe(300);
        expect(result.evidence.observedWinRate).toBe(0.8);
        expect(result.evidence.baselineWinRate).toBe(0.5);
        expect(result.evidence.validationPassed).toBe(true);
        expect(result.evidence.winRateConfidenceLowerBound).toBeGreaterThan(0.5);
    });

    it('rejects observations at or before the training timestamp cutoff', () => {
        const result = validateAIModelOutOfSample({
            ...baseInput,
            trainingCutoffTimestamp: 2000,
            observations: makeObservations(250, () => true),
        });

        expect(result.evidence.outOfSampleTradeCount).toBe(249);
        expect(result.rejectedObservations).toBe(1);
        expect(result.evidence.validationPassed).toBe(false);
    });

    it('rejects out-of-order timestamps and tick positions', () => {
        const observations = makeObservations(250, () => true);
        observations[120].settledAt = observations[119].settledAt - 1;
        const result = validateAIModelOutOfSample({
            ...baseInput,
            observations,
        });

        expect(result.rejectedObservations).toBe(1);
        expect(result.evidence.validationPassed).toBe(false);
    });

    it('allows equal second-level timestamps when tick positions remain strictly increasing', () => {
        const observations = makeObservations(250, () => true);
        observations[120].settledAt = observations[119].settledAt;
        const result = validateAIModelOutOfSample({
            ...baseInput,
            observations,
        });

        expect(result.rejectedObservations).toBe(0);
        expect(result.evidence.outOfSampleTradeCount).toBe(250);
    });

    it('rejects a holdout when paired predictions have no discordant advantage', () => {
        const result = validateAIModelOutOfSample({
            ...baseInput,
            observations: makeObservations(300, () => true, () => true),
        });

        expect(result.evidence.validationPassed).toBe(false);
        expect(result.adjustedPairedPValue).toBe(1);
        expect(result.modelOnlyCorrect).toBe(0);
        expect(result.baselineOnlyCorrect).toBe(0);
    });

    it('requires at least 200 clean settled holdout observations', () => {
        const result = validateAIModelOutOfSample({
            ...baseInput,
            observations: makeObservations(199, () => true),
        });

        expect(result.evidence.validationPassed).toBe(false);
    });

    it('uses exact paired discordances and family-wise adjusted p-values', () => {
        expect(calculatePairedExactPValue(10, 0)).toBeCloseTo(1 / 1024, 8);
        expect(calculatePairedExactPValue(5, 5)).toBeGreaterThan(0.5);
        const single = validateAIModelOutOfSample({
            ...baseInput,
            observations: makeObservations(200, index => index < 119, index => index >= 119),
        });
        const family = validateAIModelOutOfSample({
            ...baseInput,
            multipleComparisonCount: 13,
            observations: makeObservations(200, index => index < 120, index => index >= 120),
        });
        expect(single.modelOnlyCorrect).toBe(119);
        expect(single.baselineOnlyCorrect).toBe(81);
        expect(family.adjustedPairedPValue).toBeCloseTo(
            Math.min(1, single.pairedPValue * 13), 10
        );
        expect(family.evidence.validationPassed).toBe(false);
    });

    it('uses a stricter confidence bound when more markets are compared', () => {
        expect(getFamilyWiseConfidenceZ(1)).toBeCloseTo(1.645, 2);
        expect(getFamilyWiseConfidenceZ(100)).toBeCloseTo(3.291, 2);
        expect(getFamilyWiseConfidenceZ(100)).toBeGreaterThan(getFamilyWiseConfidenceZ(1));
    });

    it('rejects malformed input and invalid timestamps without claiming validation', () => {
        const result = validateAIModelOutOfSample({
            ...baseInput,
            trainingCutoffTimestamp: Number.NaN,
            marketSampleSize: -1,
            dataQuality: 101,
            observations: [{
                settledAt: Number.NaN,
                observationIndex: 1,
                modelPredictionCorrect: true,
                baselinePredictionCorrect: true,
            }],
        });

        expect(result.evidence.validationPassed).toBe(false);
        expect(result.evidence.outOfSampleTradeCount).toBe(0);
        expect(result.rejectedObservations).toBe(1);
    });
});
