import { AITradeEvidence } from './ai-trade-decision';
import { validatePairedDependence } from './ai-dependence-validation';

export interface AIValidationObservation {
    /** Timestamp when this prediction was evaluated/settled, in Unix seconds. */
    settledAt: number;
    /** Original zero-based tick position; strictly after the training cutoff. */
    observationIndex: number;
    /** Whether the model's pre-settlement prediction was correct. */
    modelPredictionCorrect: boolean;
    /** Whether a pre-defined matched baseline prediction was correct. */
    baselinePredictionCorrect: boolean;
}

export interface AIModelValidationInput {
    /** Timestamp of the final training tick, in Unix seconds. */
    trainingCutoffTimestamp: number;
    trainingCutoffIndex: number;
    /** Recent valid market observations used to assess data sufficiency. */
    marketSampleSize: number;
    /** Percentage of expected market observations successfully received. */
    dataQuality: number;
    /** Number of markets tested in the same scan; controls family-wise confidence. */
    multipleComparisonCount?: number;
    /** Chronologically timestamped, settled predictions from the untouched holdout period. */
    observations: AIValidationObservation[];
    /** Deterministic circular block-bootstrap repetitions; defaults to 2,000. */
    dependenceBootstrapRepetitions?: number;
}

export interface AIModelValidationResult {
    evidence: AITradeEvidence;
    modelWins: number;
    baselineWins: number;
    modelOnlyCorrect: number;
    baselineOnlyCorrect: number;
    pairedPValue: number;
    adjustedPairedPValue: number;
    lagOneCorrelation: number;
    effectiveSampleSize: number;
    bootstrapBlockLength: number;
    blockBootstrapPValue: number;
    dependenceAdjustedPValue: number;
    rejectedObservations: number;
    explanation: string;
}

const MINIMUM_HOLDOUT_TRADES = 200;

/** Acklam inverse-normal approximation, retained for descriptive Wilson intervals. */
const inverseNormalCdf = (probability: number): number => {
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969,
        138.357751867269, -30.6647980661472, 2.50662827745924];
    const b = [-54.4760987982241, 161.585836858041, -155.698979859887,
        66.8013118877197, -13.2806815528857];
    const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184,
        -2.54973253934373, 4.37466414146497, 2.93816398269878];
    const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    const p = Math.min(1 - 1e-12, Math.max(1e-12, probability));
    if (p < 0.02425) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - 0.02425) {
        const q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
        (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};

/** One-sided family-wise 95% critical value for the descriptive accuracy interval. */
export const getFamilyWiseConfidenceZ = (comparisonCount = 1): number => {
    const count = Number.isFinite(comparisonCount) ? Math.max(1, Math.floor(comparisonCount)) : 1;
    return inverseNormalCdf(1 - 0.05 / count);
};

/** One-sided family-wise 95% Wilson lower confidence bound. */
const wilsonLowerBound = (wins: number, sampleSize: number, z: number): number => {
    if (sampleSize <= 0) return 0;
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
 * Exact one-sided McNemar/binomial test for paired predictions.
 * Only discordant pairs contribute: model-only wins versus baseline-only wins.
 */
export const calculatePairedExactPValue = (
    modelOnlyCorrect: number,
    baselineOnlyCorrect: number
): number => {
    const wins = Math.max(0, Math.floor(modelOnlyCorrect));
    const losses = Math.max(0, Math.floor(baselineOnlyCorrect));
    const discordant = wins + losses;
    if (!discordant) return 1;

    // P[X >= wins], X ~ Binomial(discordant, 0.5).
    let probability = Math.pow(0.5, discordant);
    let tail = 0;
    for (let k = 0; k <= discordant; k += 1) {
        if (k >= wins) tail += probability;
        if (k < discordant) {
            probability *= (discordant - k) / (k + 1);
        }
    }
    return Math.min(1, Math.max(0, tail));
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
        Number.isFinite(input.trainingCutoffTimestamp) &&
        Number.isInteger(input.trainingCutoffIndex) &&
        input.trainingCutoffIndex >= 0 &&
        Number.isInteger(input.marketSampleSize) &&
        input.marketSampleSize >= 0 &&
        Number.isFinite(input.dataQuality) &&
        input.dataQuality >= 0 &&
        input.dataQuality <= 100 &&
        Array.isArray(input.observations);

    let previousTimestamp = input.trainingCutoffTimestamp;
    let previousIndex = input.trainingCutoffIndex;
    const eligible = validInput
        ? input.observations.filter(item => {
            const isValid =
                Number.isFinite(item.settledAt) &&
                item.settledAt > input.trainingCutoffTimestamp &&
                item.settledAt >= previousTimestamp &&
                Number.isInteger(item.observationIndex) &&
                item.observationIndex > previousIndex &&
                typeof item.modelPredictionCorrect === 'boolean' &&
                typeof item.baselinePredictionCorrect === 'boolean';
            if (isValid) {
                previousTimestamp = item.settledAt;
                previousIndex = item.observationIndex;
            }
            return isValid;
        })
        : [];

    const rejectedObservations = validInput
        ? input.observations.length - eligible.length
        : Array.isArray(input.observations) ? input.observations.length : 0;

    const modelWins = eligible.filter(item => item.modelPredictionCorrect).length;
    const baselineWins = eligible.filter(item => item.baselinePredictionCorrect).length;
    const sampleSize = eligible.length;
    const modelOnlyCorrect = eligible.filter(item =>
        item.modelPredictionCorrect && !item.baselinePredictionCorrect
    ).length;
    const baselineOnlyCorrect = eligible.filter(item =>
        !item.modelPredictionCorrect && item.baselinePredictionCorrect
    ).length;
    const pairedPValue = calculatePairedExactPValue(modelOnlyCorrect, baselineOnlyCorrect);
    const dependence = validatePairedDependence(
        eligible.map(item => Number(item.modelPredictionCorrect) - Number(item.baselinePredictionCorrect)),
        input.dependenceBootstrapRepetitions ?? 2000
    );
    // Never let the dependence-aware result make the independent paired test
    // more permissive. The larger raw p-value controls before family correction.
    const dependenceAdjustedPValue = Math.max(pairedPValue, dependence.blockBootstrapPValue);
    const comparisonCount = Number.isFinite(input.multipleComparisonCount)
        ? Math.max(1, Math.floor(input.multipleComparisonCount!))
        : 1;
    const adjustedPairedPValue = Math.min(1, dependenceAdjustedPValue * comparisonCount);
    const observedWinRate = sampleSize ? modelWins / sampleSize : 0;
    const baselineWinRate = sampleSize ? baselineWins / sampleSize : 0;
    const confidenceZ = getFamilyWiseConfidenceZ(input.multipleComparisonCount);
    const confidenceLowerBound = wilsonLowerBound(modelWins, sampleSize, confidenceZ);

    // A contaminated or malformed holdout is never marked validated.
    const validationPassed =
        validInput &&
        rejectedObservations === 0 &&
        sampleSize >= MINIMUM_HOLDOUT_TRADES &&
        dependence.effectiveSampleSize >= MINIMUM_HOLDOUT_TRADES &&
        adjustedPairedPValue <= 0.05;

    const evidence: AITradeEvidence = {
        marketSampleSize: validInput ? input.marketSampleSize : 0,
        dataQuality: validInput ? input.dataQuality : 0,
        outOfSampleTradeCount: sampleSize,
        baselineWinRate,
        observedWinRate,
        winRateConfidenceLowerBound: confidenceLowerBound,
        modelOnlyCorrect,
        baselineOnlyCorrect,
        pairedPValue,
        adjustedPairedPValue,
        validationPassed,
    };

    return {
        evidence,
        modelWins,
        baselineWins,
        modelOnlyCorrect,
        baselineOnlyCorrect,
        pairedPValue,
        adjustedPairedPValue,
        lagOneCorrelation: dependence.lagOneCorrelation,
        effectiveSampleSize: dependence.effectiveSampleSize,
        bootstrapBlockLength: dependence.blockLength,
        blockBootstrapPValue: dependence.blockBootstrapPValue,
        dependenceAdjustedPValue,
        rejectedObservations,
        explanation: validationPassed
            ? `Untouched chronological holdout passed the dependence-aware paired test. Lag-1 correlation: ${dependence.lagOneCorrelation.toFixed(3)}; effective sample: ${dependence.effectiveSampleSize.toFixed(0)}/${sampleSize}; circular block length: ${dependence.blockLength}; block-bootstrap p-value: ${dependence.blockBootstrapPValue.toFixed(4)}. Model-only wins: ${modelOnlyCorrect}; baseline-only wins: ${baselineOnlyCorrect}; raw p-value: ${pairedPValue.toFixed(4)}; family-wise adjusted p-value: ${adjustedPairedPValue.toFixed(4)}. Separate evidence and risk gates must still approve; no trade is authorized by validation alone.`
            : `Model not validated. ${sampleSize} clean settled holdout observations were accepted and ${rejectedObservations} rejected; require at least ${MINIMUM_HOLDOUT_TRADES}, strictly later tick positions, non-decreasing real timestamps, and at least ${MINIMUM_HOLDOUT_TRADES} effective observations after lag-1 dependence adjustment. Require both the exact paired McNemar reference and circular block-bootstrap p-value to pass after family-wise correction (adjusted p-value at or below 0.05). Lag-1 correlation: ${dependence.lagOneCorrelation.toFixed(3)}; effective sample: ${dependence.effectiveSampleSize.toFixed(0)}/${sampleSize}; block length: ${dependence.blockLength}; block-bootstrap p-value: ${dependence.blockBootstrapPValue.toFixed(4)}. Model-only wins: ${modelOnlyCorrect}; baseline-only wins: ${baselineOnlyCorrect}; adjusted p-value: ${adjustedPairedPValue.toFixed(4)}.`,
    };
};
