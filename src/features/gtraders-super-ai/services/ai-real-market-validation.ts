import { estimateEffectiveSampleSize } from './ai-dependence-validation';
import {
    AI_PREDICTION_RESEARCH_MODELS,
    type AIPredictionModelId,
} from './ai-prediction-models';
import type { AIMarketHistory } from './ai-market-scanner';

export interface AIRealMarketModelFold {
    fold: number;
    observations: number;
    correct: number;
    accuracy: number;
}

export interface AIRealMarketModelScore {
    modelId: AIPredictionModelId;
    label: string;
    observations: number;
    predictions: number;
    abstentions: number;
    coverage: number;
    correct: number;
    accuracy: number;
    chanceBaseline: number;
    effectiveSampleSize: number;
    accuracyLagOneCorrelation: number;
    confidenceLowerBound: number;
    adjustedPValue: number;
    folds: AIRealMarketModelFold[];
    researchGatePassed: boolean;
}

export interface AIRealMarketValidationReport {
    decision: 'RESEARCH_ONLY' | 'NO_TRADE';
    symbol: string;
    displayName: string;
    dataQuality: number;
    totalTicks: number;
    trainingTicks: number;
    holdoutTicks: number;
    trainingCutoffTimestamp: number;
    firstHoldoutTimestamp: number;
    lastHoldoutTimestamp: number;
    foldCount: number;
    chanceBaseline: number;
    scores: AIRealMarketModelScore[];
    rejectionReasons: string[];
    explanation: string;
}

export interface AIRealMarketValidationOptions {
    trainingFraction?: number;
    minimumDataQuality?: number;
    minimumTotalTicks?: number;
    minimumHoldoutTicks?: number;
    minimumHistory?: number;
    windowSize?: number;
    recencyDecay?: number;
    foldCount?: number;
}

const CHANCE_BASELINE = 0.1;
const MODEL_COMPARISON_COUNT = AI_PREDICTION_RESEARCH_MODELS.length;

const clampInteger = (value: number, minimum: number, maximum: number, fallback: number): number =>
    Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;

/** Normal CDF approximation used only for a conservative descriptive gate. */
const normalCdf = (value: number): number => {
    const absolute = Math.abs(value);
    const t = 1 / (1 + 0.2316419 * absolute);
    const density = 0.3989422804014327 * Math.exp(-0.5 * absolute * absolute);
    const tail = density * t * (
        0.319381530 +
        t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))
    );
    return value >= 0 ? 1 - tail : tail;
};

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

const familyWiseZ = (): number => {
    // Bonferroni one-sided family-wise 95% bound for four model comparisons.
    // Acklam approximation is unnecessary here; this fixed quantile is z(0.9875).
    return 2.2414;
};

const emptyReport = (
    history: Pick<AIMarketHistory, 'symbol' | 'displayName' | 'dataQuality' | 'ticks' | 'tickTimes' | 'digitSequence'>,
    reason: string
): AIRealMarketValidationReport => ({
    decision: 'NO_TRADE',
    symbol: history.symbol,
    displayName: history.displayName,
    dataQuality: Number.isFinite(history.dataQuality) ? history.dataQuality : 0,
    totalTicks: history.digitSequence?.length ?? 0,
    trainingTicks: 0,
    holdoutTicks: 0,
    trainingCutoffTimestamp: 0,
    firstHoldoutTimestamp: 0,
    lastHoldoutTimestamp: 0,
    foldCount: 0,
    chanceBaseline: CHANCE_BASELINE,
    scores: [],
    rejectionReasons: [reason],
    explanation: `NO TRADE — real-market research was not run: ${reason}`,
});

/**
 * Evaluates timestamped Deriv market history in a strict chronological
 * prequential holdout. Each target is predicted using only earlier digits.
 * The final 40% is never used to choose model settings or alter the models.
 *
 * This report is research-only and is deliberately disconnected from all
 * proposal, buy, execution, and risk-management services.
 */
export const evaluateAIRealMarketHistory = (
    history: Pick<AIMarketHistory,
        'symbol' | 'displayName' | 'ticks' | 'digitSequence' | 'tickTimes' | 'dataQuality'>,
    options: AIRealMarketValidationOptions = {}
): AIRealMarketValidationReport => {
    const digits = history.digitSequence;
    const times = history.tickTimes;
    const minimumDataQuality = options.minimumDataQuality ?? 95;
    const minimumTotalTicks = clampInteger(options.minimumTotalTicks ?? 500, 200, 5000, 500);
    const minimumHoldoutTicks = clampInteger(options.minimumHoldoutTicks ?? 200, 100, 2000, 200);
    const minimumHistory = clampInteger(options.minimumHistory ?? 100, 20, 1000, 100);
    const windowSize = clampInteger(options.windowSize ?? 100, 20, 1000, 100);
    const foldCount = clampInteger(options.foldCount ?? 4, 2, 5, 4);
    const trainingFraction = options.trainingFraction ?? 0.6;

    if (!Array.isArray(digits) || !Array.isArray(times) || digits.length !== times.length) {
        return emptyReport(history, 'tick digits and timestamps are missing or misaligned.');
    }
    if (
        !digits.every(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9) ||
        !times.every(time => Number.isFinite(time) && time > 0) ||
        times.some((time, index) => index > 0 && time < times[index - 1])
    ) {
        return emptyReport(history, 'tick history contains invalid digits, timestamps, or chronological order.');
    }
    if (
        !Number.isFinite(history.dataQuality) ||
        history.dataQuality < minimumDataQuality ||
        history.dataQuality > 100
    ) {
        return emptyReport(history, 'market data quality is below the required threshold.');
    }
    if (
        !Number.isFinite(trainingFraction) ||
        trainingFraction <= 0 ||
        trainingFraction >= 1 ||
        digits.length < minimumTotalTicks
    ) {
        return emptyReport(history, 'the sample is too small or the chronological training split is invalid.');
    }

    const trainingTicks = Math.floor(digits.length * trainingFraction);
    const holdoutTicks = digits.length - trainingTicks;
    if (trainingTicks < minimumHistory || holdoutTicks < minimumHoldoutTicks) {
        return emptyReport(history, 'there are insufficient training or untouched holdout ticks.');
    }

    const trainingCutoffTimestamp = times[trainingTicks - 1];
    const firstHoldoutTimestamp = times[trainingTicks];
    const lastHoldoutTimestamp = times[times.length - 1];
    const foldTotals = Array<number>(foldCount).fill(0);
    const foldCorrect = AI_PREDICTION_RESEARCH_MODELS.map(() => Array<number>(foldCount).fill(0));
    const totals = AI_PREDICTION_RESEARCH_MODELS.map(() => ({ predictions: 0, correct: 0 }));
    const correctness = AI_PREDICTION_RESEARCH_MODELS.map((): number[] => []);

    for (let offset = 0; offset < holdoutTicks; offset += 1) {
        const targetIndex = trainingTicks + offset;
        const fold = Math.min(foldCount - 1, Math.floor((offset * foldCount) / holdoutTicks));
        foldTotals[fold] += 1;
        // The current target digit is intentionally excluded from model history.
        const priorDigits = digits.slice(0, targetIndex);
        AI_PREDICTION_RESEARCH_MODELS.forEach((model, modelIndex) => {
            const prediction = model.predict(priorDigits, {
                minimumHistory,
                windowSize,
                recencyDecay: options.recencyDecay ?? 0.97,
            });
            const isCorrect = prediction !== null && prediction === digits[targetIndex];
            if (prediction !== null) totals[modelIndex].predictions += 1;
            if (isCorrect) {
                totals[modelIndex].correct += 1;
                foldCorrect[modelIndex][fold] += 1;
            }
            // Abstentions are zeroes, not removed from the accuracy denominator.
            correctness[modelIndex].push(Number(isCorrect));
        });
    }

    const z = familyWiseZ();
    const scores = AI_PREDICTION_RESEARCH_MODELS.map((model, modelIndex) => {
        const total = totals[modelIndex];
        const accuracy = holdoutTicks ? total.correct / holdoutTicks : 0;
        const dependence = estimateEffectiveSampleSize(correctness[modelIndex]);
        const effectiveSampleSize = dependence.effectiveSampleSize;
        const effectiveWins = accuracy * effectiveSampleSize;
        const confidenceLowerBound = wilsonLowerBound(effectiveWins, effectiveSampleSize, z);
        const standardError = Math.sqrt(
            CHANCE_BASELINE * (1 - CHANCE_BASELINE) / Math.max(1, effectiveSampleSize)
        );
        const zAgainstChance = (accuracy - CHANCE_BASELINE) / standardError;
        const rawPValue = 1 - normalCdf(zAgainstChance);
        const adjustedPValue = Math.min(1, rawPValue * MODEL_COMPARISON_COUNT);
        const researchGatePassed =
            effectiveSampleSize >= minimumHoldoutTicks &&
            confidenceLowerBound > CHANCE_BASELINE &&
            adjustedPValue <= 0.05;
        return {
            modelId: model.id,
            label: model.label,
            observations: holdoutTicks,
            predictions: total.predictions,
            abstentions: holdoutTicks - total.predictions,
            coverage: total.predictions / holdoutTicks,
            correct: total.correct,
            accuracy,
            chanceBaseline: CHANCE_BASELINE,
            effectiveSampleSize,
            accuracyLagOneCorrelation: dependence.lagOneCorrelation,
            confidenceLowerBound,
            adjustedPValue,
            folds: foldTotals.map((observations, fold) => ({
                fold: fold + 1,
                observations,
                correct: foldCorrect[modelIndex][fold],
                accuracy: observations ? foldCorrect[modelIndex][fold] / observations : 0,
            })),
            researchGatePassed,
        };
    });

    const rejectionReasons = scores.every(score => !score.researchGatePassed)
        ? ['NO_MODEL_BEAT_THE_10_PERCENT_CHANCE_BASELINE_WITH_DEPENDENCE_ADJUSTED_EVIDENCE']
        : [];
    return {
        decision: 'RESEARCH_ONLY',
        symbol: history.symbol,
        displayName: history.displayName,
        dataQuality: history.dataQuality,
        totalTicks: digits.length,
        trainingTicks,
        holdoutTicks,
        trainingCutoffTimestamp,
        firstHoldoutTimestamp,
        lastHoldoutTimestamp,
        foldCount,
        chanceBaseline: CHANCE_BASELINE,
        scores,
        rejectionReasons,
        explanation: 'Research-only chronological prequential evaluation on real Deriv tick history. Every holdout prediction used only earlier ticks; all models faced the same holdout targets; abstentions count as incorrect. Accuracy confidence bounds use dependence-adjusted effective sample size and a four-model family-wise correction. A model passing this research screen is not approved for live or demo trading and must still pass the existing untouched contract/economics/risk gates.',
    };
};

export const evaluateAIRealMarketScan = (
    histories: Array<Pick<AIMarketHistory,
        'symbol' | 'displayName' | 'ticks' | 'digitSequence' | 'tickTimes' | 'dataQuality'>>,
    options: AIRealMarketValidationOptions = {}
): AIRealMarketValidationReport[] =>
    histories.map(history => evaluateAIRealMarketHistory(history, options));
