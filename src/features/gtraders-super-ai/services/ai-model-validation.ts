import { AITradeEvidence } from './ai-trade-decision';

export interface AIValidationObservation {
    /** Timestamp when this prediction was evaluated/settled, in Unix milliseconds. */
    settledAt: number;
    /** Whether the model's pre-settlement prediction was correct. */
    modelPredictionCorrect: boolean;
    /** Whether a pre-defined matched baseline prediction was correct. */
    baselinePredictionCorrect: boolean;
}

export interface AIModelValidationInput {
    /** End of the model-training period, in Unix milliseconds. */
    trainingCutoff: number;
    /** Recent valid market observations used to assess data sufficiency. */
    marketSampleSize: number;
    /** Percentage of expected market observations successfully received. */
    dataQuality: number;
    /** Chronologically timestamped, settled predictions from the untouched holdout period. */
    observations: AIValidationObservation[];
}

export interface AIModelValidationResult {
    evidence: AITradeEvidence;
    modelWins: number;
    baselineWins: number;
    rejectedObservations: number;
    explanation: string;
}

const MINIMUM_HOLDOUT_TRADES = 200;

/** One-sided 95% Wilson lower confidence bound for a binomial win rate. */
const wilsonLowerBound = (wins: number, sampleSize: number): number => {
    if (sampleSize <= 0) return 0;
    const z = 1.645;
    const proportion = wins / sampleSize;
    const zSquared = z * z;
    const denominator = 1 + zSquared / sampleSize;
    const centre = proportion + zSquared / (2 * sampleSize);
    const margin = z * Math.sqrt(
        (proportion * (1 - proportion) / sampleSize) +
        (zSquared / (4 * sampleSize * sampleSize))
    );
    return Math.max(0, (centre - margin) / denominator);
};

/**
 * Evaluates only settled observations strictly after the training cutoff.
 * The model and baseline are scored on the exact same holdout observations.
 * This function does not train a model, create predictions, or place trades.
 */
export const validateAIModelOutOfSample = (
    input: AIModelValidationInput
): AIModelValidationResult => {
    const validInput =
        Number.isFinite(input.trainingCutoff) &&
        Number.isInteger(input.marketSampleSize) &&
        input.marketSampleSize >= 0 &&
        Number.isFinite(input.dataQuality) &&
        input.dataQuality >= 0 &&
        input.dataQuality <= 100 &&
        Array.isArray(input.observations);

    const eligible = validInput
        ? input.observations.filter(item =>
            Number.isFinite(item.settledAt) &&
            item.settledAt > input.trainingCutoff &&
            typeof item.modelPredictionCorrect === 'boolean' &&
            typeof item.baselinePredictionCorrect === 'boolean'
        )
        : [];

    const rejectedObservations = validInput
        ? input.observations.length - eligible.length
        : Array.isArray(input.observations) ? input.observations.length : 0;

    const modelWins = eligible.filter(item => item.modelPredictionCorrect).length;
    const baselineWins = eligible.filter(item => item.baselinePredictionCorrect).length;
    const sampleSize = eligible.length;
    const observedWinRate = sampleSize ? modelWins / sampleSize : 0;
    const baselineWinRate = sampleSize ? baselineWins / sampleSize : 0;
    const confidenceLowerBound = wilsonLowerBound(modelWins, sampleSize);

    // A contaminated or malformed holdout is never marked validated.
    const validationPassed =
        validInput &&
        rejectedObservations === 0 &&
        sampleSize >= MINIMUM_HOLDOUT_TRADES &&
        confidenceLowerBound > baselineWinRate;

    const evidence: AITradeEvidence = {
        marketSampleSize: validInput ? input.marketSampleSize : 0,
        dataQuality: validInput ? input.dataQuality : 0,
        outOfSampleTradeCount: sampleSize,
        baselineWinRate,
        observedWinRate,
        winRateConfidenceLowerBound: confidenceLowerBound,
        validationPassed,
    };

    return {
        evidence,
        modelWins,
        baselineWins,
        rejectedObservations,
        explanation: validationPassed
            ? 'Untouched chronological holdout passed the initial statistical check. The separate evidence and risk gates must still approve; no trade is authorized by validation alone.'
            : 'Model not validated. Require clean, settled observations strictly after the training cutoff and stronger out-of-sample evidence than the matched baseline.',
    };
};
