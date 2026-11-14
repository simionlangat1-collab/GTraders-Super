import { validateAIModelOutOfSample } from './ai-model-validation';
import { evaluateAITradeEvidence } from './ai-trade-decision';

export interface AIPredictionEngineOptions {
    /** Legacy single-window setting. Prefer candidateWindows for training-only model selection. */
    candidateWindow?: number;
    /** Pre-declared recent-history windows; selection occurs only inside the training period. */
    candidateWindows?: number[];
    /** Fraction reserved for initial training; the remainder is an untouched walk-forward holdout. */
    trainingFraction?: number;
    minimumMarketSample?: number;
    minimumDataQuality?: number;
    /** Number of markets tested in the same scan; adjusts the holdout confidence bound. */
    multipleComparisonCount?: number;
    /** Number of chronological validation folds used only within training. Defaults to 3. */
    windowSelectionFoldCount?: number;
    /** Required fraction of folds won by the selected window. Defaults to 2/3. */
    minimumWindowSelectionWinShare?: number;
    /** Maximum population standard deviation of fold accuracies. Defaults to 0.15. */
    maximumWindowSelectionAccuracyStdDev?: number;
}

export interface AIPredictionResult {
    decision: 'PREDICTION_CANDIDATE' | 'NO_TRADE';
    predictedDigit: number | null;
    historicalShare: number | null;
    marketSampleSize: number;
    trainingSampleSize: number;
    holdoutSampleSize: number;
    modelWinRate: number;
    baselineWinRate: number;
    confidenceLowerBound: number;
    validationPassed: boolean;
    selectedWindow: number | null;
    windowSelectionFoldCount: number;
    windowSelectionWinShare: number;
    windowSelectionAccuracyStdDev: number;
    windowSelectionStable: boolean;
    windowSelectionSummary: string;
    explanation: string;
}

const countDigits = (digits: number[]): number[] => {
    const counts = Array<number>(10).fill(0);
    digits.forEach(digit => { counts[digit] += 1; });
    return counts;
};

const modeDigit = (digits: number[]): number | null => {
    if (!digits.length) return null;
    const counts = countDigits(digits);
    return counts.reduce((best, count, digit) => count > counts[best] ? digit : best, 0);
};

const validDigits = (input: number[]): number[] =>
    input.filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);

const normalizeWindows = (options: AIPredictionEngineOptions): number[] => {
    const requested = options.candidateWindows ??
        [options.candidateWindow ?? 50];
    return [...new Set(requested
        .filter(window => Number.isFinite(window))
        .map(window => Math.max(20, Math.min(500, Math.floor(window)))))]
        .sort((a, b) => a - b);
};

interface WindowFoldScore {
    window: number;
    correct: number;
    total: number;
    accuracy: number;
}

interface WindowSelectionResult {
    window: number;
    foldCount: number;
    winnerShare: number;
    accuracyStdDev: number;
    stable: boolean;
    summary: string;
}

const populationStdDev = (values: number[]): number => {
    if (!values.length) return 1;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    return Math.sqrt(variance);
};

/**
 * Compares pre-declared windows across chronological folds contained entirely
 * inside the training segment. Every prediction in a fold uses only ticks
 * strictly earlier than its target tick. No holdout observation is consulted.
 *
 * The selected window must win at least the configured share of folds and
 * must have sufficiently consistent fold accuracy. Unstable selection is
 * rejected instead of silently choosing the highest aggregate score.
 */
const selectWindowWithinTraining = (
    digits: number[],
    trainingSampleSize: number,
    windows: number[],
    options: AIPredictionEngineOptions
): WindowSelectionResult | null => {
    const foldCount = Number.isFinite(options.windowSelectionFoldCount)
        ? Math.max(3, Math.min(5, Math.floor(options.windowSelectionFoldCount!)))
        : 3;
    const minimumWinShare = Number.isFinite(options.minimumWindowSelectionWinShare)
        ? Math.max(0, Math.min(1, options.minimumWindowSelectionWinShare!))
        : 2 / 3;
    const maximumAccuracyStdDev = Number.isFinite(options.maximumWindowSelectionAccuracyStdDev)
        ? Math.max(0, options.maximumWindowSelectionAccuracyStdDev!)
        : 0.15;

    const selectionStart = Math.floor(trainingSampleSize * 0.5);
    const selectionSize = trainingSampleSize - selectionStart;
    const minimumFoldSize = 30;
    if (
        !windows.length ||
        selectionStart < Math.max(...windows) ||
        selectionSize < foldCount * minimumFoldSize
    ) {
        return null;
    }

    const foldScores: WindowFoldScore[][] = [];
    const foldWinners: number[] = [];

    for (let fold = 0; fold < foldCount; fold += 1) {
        const foldStart = selectionStart + Math.floor((selectionSize * fold) / foldCount);
        const foldEnd = selectionStart + Math.floor((selectionSize * (fold + 1)) / foldCount);
        const scores = windows.map(window => {
            let correct = 0;
            for (let index = foldStart; index < foldEnd; index += 1) {
                const prediction = modeDigit(digits.slice(index - window, index));
                if (prediction === digits[index]) correct += 1;
            }
            const total = foldEnd - foldStart;
            return { window, correct, total, accuracy: total ? correct / total : 0 };
        });

        const winner = [...scores].sort((a, b) =>
            b.accuracy - a.accuracy || a.window - b.window
        )[0];
        if (!winner) return null;
        foldScores.push(scores);
        foldWinners.push(winner.window);
    }

    const winnerCounts = new Map<number, number>();
    foldWinners.forEach(window => winnerCounts.set(window, (winnerCounts.get(window) ?? 0) + 1));

    const aggregate = windows.map(window => {
        const scores = foldScores.map(fold => fold.find(score => score.window === window)!);
        const correct = scores.reduce((sum, score) => sum + score.correct, 0);
        const total = scores.reduce((sum, score) => sum + score.total, 0);
        return {
            window,
            correct,
            total,
            accuracy: total ? correct / total : 0,
            foldWins: winnerCounts.get(window) ?? 0,
            foldAccuracies: scores.map(score => score.accuracy),
        };
    });

    const selected = aggregate.sort((a, b) =>
        b.foldWins - a.foldWins ||
        b.accuracy - a.accuracy ||
        a.window - b.window
    )[0];
    if (!selected) return null;

    const winnerShare = selected.foldWins / foldCount;
    const accuracyStdDev = populationStdDev(selected.foldAccuracies);
    const stable = winnerShare >= minimumWinShare &&
        accuracyStdDev <= maximumAccuracyStdDev;
    const frequency = windows
        .map(window => `${window}t: ${winnerCounts.get(window) ?? 0}/${foldCount}`)
        .join(', ');
    const summary = `Chronological training folds: ${foldCount}; fold winners (${frequency}); selected ${selected.window}-tick window won ${selected.foldWins}/${foldCount} folds; fold accuracy SD ${(accuracyStdDev * 100).toFixed(1)} percentage points; stability ${stable ? 'PASSED' : 'FAILED'}.`;

    return {
        window: selected.window,
        foldCount,
        winnerShare,
        accuracyStdDev,
        stable,
        summary,
    };
};

/**
 * Conservative walk-forward last-digit research engine.
 *
 * Candidate windows are compared across multiple chronological folds within
 * training. The selected window and stability decision are frozen before the
 * final chronological holdout. The holdout is used only for final evaluation.
 *
 * This is a research signal only. It never sends orders and never treats
 * historical frequency as certainty.
 */
export const generateAIPrediction = (
    input: number[],
    dataQuality: number,
    options: AIPredictionEngineOptions = {},
    tickTimestamps?: number[]
): AIPredictionResult => {
    const isArrayInput = Array.isArray(input);
    const digits = isArrayInput ? validDigits(input) : [];
    const candidateWindows = normalizeWindows(options);
    const requestedTrainingFraction = options.trainingFraction ?? 0.6;
    const trainingFraction = Number.isFinite(requestedTrainingFraction)
        ? requestedTrainingFraction
        : 0.6;
    const minimumMarketSample = options.minimumMarketSample ?? 500;
    const minimumDataQuality = options.minimumDataQuality ?? 95;
    const trainingSampleSize = Math.floor(digits.length * trainingFraction);
    const holdoutSampleSize = digits.length - trainingSampleSize;

    const noTrade = (
        explanation: string,
        selection?: WindowSelectionResult | null
    ): AIPredictionResult => ({
        decision: 'NO_TRADE',
        predictedDigit: null,
        historicalShare: null,
        marketSampleSize: digits.length,
        trainingSampleSize,
        holdoutSampleSize,
        modelWinRate: 0,
        baselineWinRate: 0,
        confidenceLowerBound: 0,
        validationPassed: false,
        selectedWindow: selection?.window ?? null,
        windowSelectionFoldCount: selection?.foldCount ?? 0,
        windowSelectionWinShare: selection?.winnerShare ?? 0,
        windowSelectionAccuracyStdDev: selection?.accuracyStdDev ?? 0,
        windowSelectionStable: selection?.stable ?? false,
        windowSelectionSummary: selection?.summary ?? 'Window selection was not completed.',
        explanation: `NO TRADE — ${explanation}${selection ? ` ${selection.summary}` : ''}`,
    });

    if (!isArrayInput || digits.length !== input.length) {
        return noTrade('tick history contains invalid last digits.');
    }
    if (
        !Array.isArray(tickTimestamps) ||
        tickTimestamps.length !== digits.length ||
        tickTimestamps.some((timestamp, index) =>
            !Number.isFinite(timestamp) || (index > 0 && timestamp < tickTimestamps[index - 1])
        )
    ) {
        return noTrade('real tick timestamps are missing, misaligned, or out of chronological order.');
    }
    if (!Number.isFinite(dataQuality) || dataQuality < minimumDataQuality || dataQuality > 100) {
        return noTrade('market data quality is below the required threshold.');
    }
    if (digits.length < minimumMarketSample || trainingFraction <= 0 || trainingFraction >= 1) {
        return noTrade('there are not enough valid ticks for a separate training period and unseen holdout.');
    }
    if (
        !candidateWindows.length ||
        trainingSampleSize < Math.max(...candidateWindows) + 40 ||
        holdoutSampleSize < 200
    ) {
        return noTrade('the training period is too small for training-only model selection or the untouched holdout is too small.');
    }

    const selection = selectWindowWithinTraining(digits, trainingSampleSize, candidateWindows, options);
    if (!selection) {
        return noTrade('there is insufficient training history for the configured chronological window-selection folds.');
    }
    if (!selection.stable) {
        return noTrade('candidate-window selection was unstable across chronological training folds; no window will be trusted.', selection);
    }

    const selectedWindow = selection.window;
    const trainingCutoffIndex = trainingSampleSize - 1;
    const trainingCutoffTimestamp = tickTimestamps[trainingCutoffIndex];
    const observations = [];

    for (let index = trainingSampleSize; index < digits.length; index += 1) {
        const history = digits.slice(0, index);
        const candidatePrediction = modeDigit(history.slice(-selectedWindow));
        const baselinePrediction = modeDigit(history);
        if (candidatePrediction === null || baselinePrediction === null) {
            return noTrade('walk-forward predictions could not be generated.', selection);
        }
        observations.push({
            settledAt: tickTimestamps[index],
            observationIndex: index,
            modelPredictionCorrect: candidatePrediction === digits[index],
            baselinePredictionCorrect: baselinePrediction === digits[index],
        });
    }

    const validation = validateAIModelOutOfSample({
        trainingCutoffTimestamp,
        trainingCutoffIndex,
        marketSampleSize: digits.length,
        dataQuality,
        multipleComparisonCount: options.multipleComparisonCount,
        observations,
    });
    const gate = evaluateAITradeEvidence(validation.evidence);

    if (!validation.evidence.validationPassed || gate.decision !== 'TRADE_CANDIDATE') {
        return {
            ...noTrade(
                `training-only selection chose a ${selectedWindow}-tick window. ${validation.explanation} ${gate.explanation}`,
                selection
            ),
            modelWinRate: validation.evidence.observedWinRate,
            baselineWinRate: validation.evidence.baselineWinRate,
            confidenceLowerBound: validation.evidence.winRateConfidenceLowerBound,
        };
    }

    const predictedDigit = modeDigit(digits.slice(-selectedWindow));
    if (predictedDigit === null) return noTrade('no current prediction can be calculated.', selection);
    const recentCounts = countDigits(digits.slice(-selectedWindow));
    const historicalShare = recentCounts[predictedDigit] / selectedWindow;

    return {
        decision: 'PREDICTION_CANDIDATE',
        predictedDigit,
        historicalShare,
        marketSampleSize: digits.length,
        trainingSampleSize,
        holdoutSampleSize,
        modelWinRate: validation.evidence.observedWinRate,
        baselineWinRate: validation.evidence.baselineWinRate,
        confidenceLowerBound: validation.evidence.winRateConfidenceLowerBound,
        validationPassed: true,
        selectedWindow,
        windowSelectionFoldCount: selection.foldCount,
        windowSelectionWinShare: selection.winnerShare,
        windowSelectionAccuracyStdDev: selection.accuracyStdDev,
        windowSelectionStable: selection.stable,
        windowSelectionSummary: selection.summary,
        explanation: `Research candidate only: the ${selectedWindow}-tick recent-window model was selected across stable chronological training folds and passed the separate chronological holdout comparison. ${selection.summary} Historical share is not a calibrated next-tick probability and this result does not authorize an order.`,
    };
};


export interface AIFreshMarketPredictionInput {
    symbol: string;
    digitSequence: number[];
    tickTimestamps: number[];
    dataQuality: number;
}

export interface AIFreshMarketPrediction<T extends AIFreshMarketPredictionInput> {
    market: T;
    prediction: AIPredictionResult;
}

/**
 * Rebuilds every prediction from the tick histories returned by the current
 * scan. This function deliberately has no cache or previous-result fallback:
 * a missing/invalid current sequence becomes NO TRADE through the prediction
 * engine rather than reusing an earlier market prediction.
 */
export const evaluateFreshMarketPredictions = <T extends AIFreshMarketPredictionInput>(
    freshMarkets: T[],
    options: AIPredictionEngineOptions = {}
): Array<AIFreshMarketPrediction<T>> => freshMarkets.map(market => ({
    market,
    prediction: generateAIPrediction(
        market.digitSequence,
        market.dataQuality,
        options,
        market.tickTimestamps
    ),
}));
