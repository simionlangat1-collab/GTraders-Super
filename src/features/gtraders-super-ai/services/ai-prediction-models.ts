/**
 * Shadow-only last-digit prediction models for controlled research.
 *
 * This module is deliberately not imported by the live market scanner.
 * Predictions are evaluated walk-forward: each target tick is predicted
 * using only ticks strictly before it. Abstentions score as incorrect while
 * remaining visible through each model's coverage metric.
 */

export type AIPredictionModelId =
    | 'rolling-frequency'
    | 'recency-weighted'
    | 'first-order-transition'
    | 'last-digit-persistence';

export interface AIPredictionModel {
    id: AIPredictionModelId;
    label: string;
    predict: (history: number[], options?: AIPredictionModelOptions) => number | null;
}

export interface AIPredictionModelOptions {
    windowSize?: number;
    recencyDecay?: number;
    minimumHistory?: number;
    transitionSmoothing?: number;
}

export interface AIPredictionModelFoldResult {
    fold: number;
    observations: number;
    correct: number;
    accuracy: number;
}

export interface AIPredictionModelScore {
    modelId: AIPredictionModelId;
    label: string;
    observations: number;
    predictions: number;
    abstentions: number;
    coverage: number;
    correct: number;
    accuracy: number;
    folds: AIPredictionModelFoldResult[];
}

export interface AIPredictionCompetitionResult {
    decision: 'RESEARCH_ONLY';
    warmupTicks: number;
    evaluatedTicks: number;
    foldCount: number;
    chanceAccuracy: number;
    scores: AIPredictionModelScore[];
    explanation: string;
}

const validDigits = (digits: number[]): boolean =>
    Array.isArray(digits) && digits.every(digit =>
        Number.isInteger(digit) && digit >= 0 && digit <= 9
    );

const resolveWindow = (options: AIPredictionModelOptions = {}): number => {
    const requested = options.windowSize ?? 100;
    return Number.isFinite(requested) ? Math.max(2, Math.floor(requested)) : 100;
};

const resolveMinimumHistory = (options: AIPredictionModelOptions = {}): number => {
    const requested = options.minimumHistory ?? 20;
    return Number.isFinite(requested) ? Math.max(2, Math.floor(requested)) : 20;
};

/** Returns a digit only when one digit has a unique maximum count. */
const uniqueMaximum = (scores: number[]): number | null => {
    const maximum = Math.max(...scores);
    if (!Number.isFinite(maximum) || maximum <= 0) return null;
    const leaders = scores.reduce<number[]>((result, score, digit) => {
        if (score === maximum) result.push(digit);
        return result;
    }, []);
    return leaders.length === 1 ? leaders[0] : null;
};

export const predictRollingFrequency = (
    history: number[],
    options: AIPredictionModelOptions = {}
): number | null => {
    if (!validDigits(history) || history.length < resolveMinimumHistory(options)) return null;
    const sample = history.slice(-resolveWindow(options));
    const counts = Array<number>(10).fill(0);
    sample.forEach(digit => { counts[digit] += 1; });
    return uniqueMaximum(counts);
};

/** Exponentially discounts older observations; decay must be strictly between 0 and 1. */
export const predictRecencyWeighted = (
    history: number[],
    options: AIPredictionModelOptions = {}
): number | null => {
    if (!validDigits(history) || history.length < resolveMinimumHistory(options)) return null;
    const requestedDecay = options.recencyDecay ?? 0.97;
    const decay = Number.isFinite(requestedDecay) ? requestedDecay : 0.97;
    if (decay <= 0 || decay >= 1) return null;
    const sample = history.slice(-resolveWindow(options));
    const weights = Array<number>(10).fill(0);
    sample.forEach((digit, index) => {
        const age = sample.length - index - 1;
        weights[digit] += Math.pow(decay, age);
    });
    return uniqueMaximum(weights);
};

/**
 * Predicts from transitions observed after the current final digit.
 * Additive smoothing is included in the probability calculation; because
 * the same alpha is applied to all ten outcomes, it does not change ranking.
 */
export const predictFirstOrderTransition = (
    history: number[],
    options: AIPredictionModelOptions = {}
): number | null => {
    if (!validDigits(history) || history.length < resolveMinimumHistory(options)) return null;
    const alpha = options.transitionSmoothing ?? 1;
    if (!Number.isFinite(alpha) || alpha <= 0) return null;
    const sample = history.slice(-resolveWindow(options));
    const current = sample[sample.length - 1];
    const counts = Array<number>(10).fill(0);
    let transitions = 0;
    for (let index = 0; index < sample.length - 1; index += 1) {
        if (sample[index] === current) {
            counts[sample[index + 1]] += 1;
            transitions += 1;
        }
    }
    if (!transitions) return null;
    const denominator = transitions + (10 * alpha);
    const probabilities = counts.map(count => (count + alpha) / denominator);
    return uniqueMaximum(probabilities);
};

export const predictLastDigitPersistence = (
    history: number[],
    options: AIPredictionModelOptions = {}
): number | null => {
    if (!validDigits(history) || history.length < resolveMinimumHistory(options)) return null;
    return history[history.length - 1];
};

export const AI_PREDICTION_RESEARCH_MODELS: AIPredictionModel[] = [
    {
        id: 'rolling-frequency',
        label: 'Rolling frequency',
        predict: predictRollingFrequency,
    },
    {
        id: 'recency-weighted',
        label: 'Recency-weighted frequency',
        predict: predictRecencyWeighted,
    },
    {
        id: 'first-order-transition',
        label: 'First-order transition',
        predict: predictFirstOrderTransition,
    },
    {
        id: 'last-digit-persistence',
        label: 'Last-digit persistence',
        predict: predictLastDigitPersistence,
    },
];

/**
 * Runs a common-opportunity walk-forward comparison. The model receives only
 * the history preceding each target tick. This is descriptive research, not
 * a statistical approval or permission to trade.
 */
export const evaluateAIPredictionCompetition = (
    digits: number[],
    options: AIPredictionModelOptions & {
        warmupTicks?: number;
        foldCount?: number;
    } = {}
): AIPredictionCompetitionResult => {
    const valid = validDigits(digits);
    const requestedWarmup = options.warmupTicks ?? 100;
    const warmupTicks = Number.isFinite(requestedWarmup)
        ? Math.max(resolveMinimumHistory(options), Math.floor(requestedWarmup))
        : 100;
    const requestedFolds = options.foldCount ?? 3;
    const foldCount = Number.isFinite(requestedFolds)
        ? Math.max(2, Math.min(5, Math.floor(requestedFolds)))
        : 3;
    const evaluatedTicks = valid ? Math.max(0, digits.length - warmupTicks) : 0;
    const foldTotals = Array.from({ length: foldCount }, () => 0);
    const foldCorrect = AI_PREDICTION_RESEARCH_MODELS.map(() =>
        Array<number>(foldCount).fill(0)
    );
    const totals = AI_PREDICTION_RESEARCH_MODELS.map(() => ({
        predictions: 0,
        correct: 0,
    }));

    if (valid && evaluatedTicks > 0) {
        for (let offset = 0; offset < evaluatedTicks; offset += 1) {
            const targetIndex = warmupTicks + offset;
            const fold = Math.min(
                foldCount - 1,
                Math.floor((offset * foldCount) / evaluatedTicks)
            );
            foldTotals[fold] += 1;
            const history = digits.slice(0, targetIndex);
            AI_PREDICTION_RESEARCH_MODELS.forEach((model, modelIndex) => {
                const prediction = model.predict(history, options);
                if (prediction !== null) totals[modelIndex].predictions += 1;
                if (prediction === digits[targetIndex]) {
                    totals[modelIndex].correct += 1;
                    foldCorrect[modelIndex][fold] += 1;
                }
            });
        }
    }

    const scores = AI_PREDICTION_RESEARCH_MODELS.map((model, modelIndex) => {
        const total = totals[modelIndex];
        return {
            modelId: model.id,
            label: model.label,
            observations: evaluatedTicks,
            predictions: total.predictions,
            abstentions: evaluatedTicks - total.predictions,
            coverage: evaluatedTicks ? total.predictions / evaluatedTicks : 0,
            correct: total.correct,
            // Abstentions remain in the denominator: models cannot inflate
            // accuracy by declining difficult observations.
            accuracy: evaluatedTicks ? total.correct / evaluatedTicks : 0,
            folds: foldTotals.map((foldTotal, fold) => ({
                fold: fold + 1,
                observations: foldTotal,
                correct: foldCorrect[modelIndex][fold],
                accuracy: foldTotal ? foldCorrect[modelIndex][fold] / foldTotal : 0,
            })),
        };
    });

    return {
        decision: 'RESEARCH_ONLY',
        warmupTicks,
        evaluatedTicks,
        foldCount,
        chanceAccuracy: 0.1,
        scores,
        explanation: valid
            ? 'All four models were scored on the same chronological target ticks. Each prediction used only earlier ticks; abstentions count as incorrect for accuracy and are reported separately. These descriptive scores do not establish statistical edge, pass the live validation gates, or authorize trades.'
            : 'Invalid digit history. No research scores were produced.',
    };
};
