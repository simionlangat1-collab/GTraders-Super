export interface AIDependenceValidationResult {
    lagOneCorrelation: number;
    effectiveSampleSize: number;
    blockLength: number;
    blockBootstrapPValue: number;
    bootstrapRepetitions: number;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.max(minimum, Math.min(maximum, value));

const createSeededRandom = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
};

const correlationAtLagOne = (values: number[]): number => {
    if (values.length < 3) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    let numerator = 0;
    let leftSquares = 0;
    let rightSquares = 0;
    for (let index = 1; index < values.length; index += 1) {
        const left = values[index - 1] - mean;
        const right = values[index] - mean;
        numerator += left * right;
        leftSquares += left * left;
        rightSquares += right * right;
    }
    const denominator = Math.sqrt(leftSquares * rightSquares);
    return denominator > 0 ? clamp(numerator / denominator, -0.99, 0.99) : 0;
};

export interface AIEffectiveSampleEstimate {
    lagOneCorrelation: number;
    effectiveSampleSize: number;
}

/** Conservative lag-1 effective-sample estimate; negative correlation is not credited. */
export const estimateEffectiveSampleSize = (values: number[]): AIEffectiveSampleEstimate => {
    const valid = values.filter(Number.isFinite);
    const lagOneCorrelation = correlationAtLagOne(valid);
    const positiveCorrelation = Math.max(0, lagOneCorrelation);
    return {
        lagOneCorrelation,
        effectiveSampleSize: valid.length
            ? clamp(valid.length * (1 - positiveCorrelation) / (1 + positiveCorrelation), 1, valid.length)
            : 0,
    };
};

/**
 * Dependence-aware one-sided test of the paired model-minus-baseline outcome.
 * A circular moving-block bootstrap resamples contiguous blocks of the
 * centered paired-difference series, preserving short-range ordering.
 *
 * The block-length rule is a transparent lag-1 heuristic, not an optimal
 * block-length estimator. The bootstrap p-value is used conservatively:
 * callers should never replace a larger independent-test p-value with it.
 */
export const validatePairedDependence = (
    pairedDifferences: number[],
    repetitions = 2000,
    seed = 20261114
): AIDependenceValidationResult => {
    const values = pairedDifferences.filter(value =>
        Number.isFinite(value) && (value === -1 || value === 0 || value === 1)
    );
    const sampleSize = values.length;
    const lagOneCorrelation = correlationAtLagOne(values);
    const positiveCorrelation = Math.max(0, lagOneCorrelation);
    const effectiveSampleSize = sampleSize
        ? clamp(sampleSize * (1 - positiveCorrelation) / (1 + positiveCorrelation), 1, sampleSize)
        : 0;
    const absoluteCorrelation = Math.abs(lagOneCorrelation);
    const rawBlockLength = absoluteCorrelation >= 0.99
        ? sampleSize
        : Math.ceil((1 + absoluteCorrelation) / (1 - absoluteCorrelation));
    const blockLength = sampleSize
        ? clamp(rawBlockLength, 1, Math.max(1, Math.ceil(Math.sqrt(sampleSize))))
        : 0;
    const bootstrapRepetitions = clamp(
        Number.isInteger(repetitions) ? repetitions : 2000,
        500,
        10000
    );
    const observedMean = sampleSize
        ? values.reduce((sum, value) => sum + value, 0) / sampleSize
        : 0;

    if (sampleSize < 2 || observedMean <= 0) {
        return {
            lagOneCorrelation,
            effectiveSampleSize,
            blockLength,
            blockBootstrapPValue: 1,
            bootstrapRepetitions,
        };
    }

    const centered = values.map(value => value - observedMean);
    const centeredVariance = centered.reduce((sum, value) => sum + value * value, 0);
    if (centeredVariance === 0) {
        return {
            lagOneCorrelation,
            effectiveSampleSize,
            blockLength,
            blockBootstrapPValue: 1,
            bootstrapRepetitions,
        };
    }

    // Mix the supplied seed with the observed sequence for reproducibility
    // without depending on runtime APIs or mutable global random state.
    let mixedSeed = seed >>> 0;
    values.forEach((value, index) => {
        mixedSeed = Math.imul(mixedSeed ^ (value + 2) ^ index, 16777619) >>> 0;
    });
    const random = createSeededRandom(mixedSeed);
    let atLeastObserved = 0;

    for (let run = 0; run < bootstrapRepetitions; run += 1) {
        let sum = 0;
        let generated = 0;
        while (generated < sampleSize) {
            const start = Math.floor(random() * sampleSize);
            for (let offset = 0; offset < blockLength && generated < sampleSize; offset += 1) {
                sum += centered[(start + offset) % sampleSize];
                generated += 1;
            }
        }
        if (sum / sampleSize >= observedMean) atLeastObserved += 1;
    }

    return {
        lagOneCorrelation,
        effectiveSampleSize,
        blockLength,
        blockBootstrapPValue: (atLeastObserved + 1) / (bootstrapRepetitions + 1),
        bootstrapRepetitions,
    };
};
