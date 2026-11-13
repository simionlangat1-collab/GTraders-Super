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

interface WindowScore {
    window: number;
    correct: number;
    total: number;
}

/**
 * Chooses among pre-declared recent-window models using only the final 20%
 * of the training segment. The later untouched holdout is not involved in
 * model/window selection. Ties prefer the shorter window.
 */
const selectWindowWithinTraining = (
    digits: number[],
    trainingSampleSize: number,
    windows: number[]
): WindowScore | null => {
    const selectionStart = Math.floor(trainingSampleSize * 0.8);
    const selectionSize = trainingSampleSize - selectionStart;
    if (!windows.length || selectionSize < 40 || selectionStart < Math.max(...windows)) {
        return null;
    }

    const scores = windows.map(window => {
        let correct = 0;
        for (let index = selectionStart; index < trainingSampleSize; index += 1) {
            const prediction = modeDigit(digits.slice(index - window, index));
            if (prediction === digits[index]) correct += 1;
        }
        return { window, correct, total: selectionSize };
    });

    return scores.sort((a, b) =>
        b.correct / b.total - a.correct / a.total || a.window - b.window
    )[0] ?? null;
};

/**
 * Conservative walk-forward last-digit research engine.
 *
 * A small, pre-declared family of recent-window models is compared only
 * inside the training period. The winning window is frozen before the final
 * chronological holdout. Its predictions and the all-history mode baseline
 * are then scored on the exact same later ticks.
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

    const noTrade = (explanation: string): AIPredictionResult => ({
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
        explanation: `NO TRADE — ${explanation}`,
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

    const selected = selectWindowWithinTraining(digits, trainingSampleSize, candidateWindows);
    if (!selected) {
        return noTrade('the pre-declared prediction windows could not be compared within the training period.');
    }
    const selectedWindow = selected.window;
    const trainingCutoffIndex = trainingSampleSize - 1;
    const trainingCutoffTimestamp = tickTimestamps[trainingCutoffIndex];
    const observations = [];

    for (let index = trainingSampleSize; index < digits.length; index += 1) {
        const history = digits.slice(0, index);
        const candidatePrediction = modeDigit(history.slice(-selectedWindow));
        const baselinePrediction = modeDigit(history);
        if (candidatePrediction === null || baselinePrediction === null) {
            return noTrade('walk-forward predictions could not be generated.');
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
        observations,
    });
    const gate = evaluateAITradeEvidence(validation.evidence);

    if (!validation.evidence.validationPassed || gate.decision !== 'TRADE_CANDIDATE') {
        return {
            decision: 'NO_TRADE',
            predictedDigit: null,
            historicalShare: null,
            marketSampleSize: digits.length,
            trainingSampleSize,
            holdoutSampleSize,
            modelWinRate: validation.evidence.observedWinRate,
            baselineWinRate: validation.evidence.baselineWinRate,
            confidenceLowerBound: validation.evidence.winRateConfidenceLowerBound,
            validationPassed: false,
            explanation: `NO TRADE — training-only selection chose a ${selectedWindow}-tick window. ${validation.explanation} ${gate.explanation}`,
        };
    }

    const predictedDigit = modeDigit(digits.slice(-selectedWindow));
    if (predictedDigit === null) return noTrade('no current prediction can be calculated.');
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
        explanation: `Research candidate only: the ${selectedWindow}-tick recent-window model was selected inside training and passed the separate chronological holdout comparison. Historical share is not a calibrated next-tick probability and this result does not authorize an order.`,
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
