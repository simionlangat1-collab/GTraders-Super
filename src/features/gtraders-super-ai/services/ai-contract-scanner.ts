export type AIContractType = 'DIGITOVER' | 'DIGITUNDER';

export interface AIContractOpportunity {
    decision: 'MARKET_CANDIDATE' | 'NO_TRADE';
    contractType: AIContractType | null;
    contractLabel: 'Over' | 'Under' | null;
    barrier: number | null;
    baselineWinRate: number;
    trainingWinRate: number;
    holdoutWinRate: number;
    confidenceLowerBound: number;
    edge: number;
    marketSampleSize: number;
    trainingSampleSize: number;
    holdoutSampleSize: number;
    dataQuality: number;
    explanation: string;
}

export interface AIContractEvaluationOptions {
    trainingFraction?: number;
    minimumMarketSample?: number;
    minimumDataQuality?: number;
    minimumHoldoutSample?: number;
    /** Number of markets compared in the same scan; applies a conservative family-wise confidence adjustment. */
    multipleComparisonCount?: number;
}

interface ContractRule {
    contractType: AIContractType;
    contractLabel: 'Over' | 'Under';
    barrier: number;
    baselineWinRate: number;
    wins: (digit: number) => boolean;
}

const contractRules: ContractRule[] = [
    ...Array.from({ length: 9 }, (_, barrier) => ({
        contractType: 'DIGITOVER' as const,
        contractLabel: 'Over' as const,
        barrier,
        baselineWinRate: (9 - barrier) / 10,
        wins: (digit: number) => digit > barrier,
    })),
    ...Array.from({ length: 9 }, (_, index) => {
        const barrier = index + 1;
        return {
            contractType: 'DIGITUNDER' as const,
            contractLabel: 'Under' as const,
            barrier,
            baselineWinRate: barrier / 10,
            wins: (digit: number) => digit < barrier,
        };
    }),
];

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

const countWins = (digits: number[], rule: ContractRule): number =>
    digits.reduce((total, digit) => total + (rule.wins(digit) ? 1 : 0), 0);

const noTrade = (
    digits: number[],
    dataQuality: number,
    trainingSampleSize: number,
    holdoutSampleSize: number,
    explanation: string
): AIContractOpportunity => ({
    decision: 'NO_TRADE',
    contractType: null,
    contractLabel: null,
    barrier: null,
    baselineWinRate: 0,
    trainingWinRate: 0,
    holdoutWinRate: 0,
    confidenceLowerBound: 0,
    edge: 0,
    marketSampleSize: digits.length,
    trainingSampleSize,
    holdoutSampleSize,
    dataQuality,
    explanation: `NO TRADE — ${explanation}`,
});

/**
 * Selects one Over/Under barrier using training data, then tests that fixed
 * selection on a strictly later untouched holdout. Fair digit baselines are
 * used for comparison (Over b: (9-b)/10; Under b: b/10).
 *
 * A passing result is a research candidate only. It does not include live
 * proposal pricing, payout/breakeven validation, or order authorization.
 */
export const evaluateAIContractOpportunity = (
    input: number[],
    dataQuality: number,
    options: AIContractEvaluationOptions = {}
): AIContractOpportunity => {
    const digits = Array.isArray(input) ? input : [];
    const trainingFraction = options.trainingFraction ?? 0.6;
    const minimumMarketSample = options.minimumMarketSample ?? 500;
    const minimumDataQuality = options.minimumDataQuality ?? 95;
    const minimumHoldoutSample = options.minimumHoldoutSample ?? 200;
    const trainingSampleSize = Number.isFinite(trainingFraction)
        ? Math.floor(digits.length * trainingFraction)
        : 0;
    const holdoutSampleSize = digits.length - trainingSampleSize;

    if (!Array.isArray(input) || digits.some(
        digit => !Number.isInteger(digit) || digit < 0 || digit > 9
    )) {
        return noTrade([], Number.isFinite(dataQuality) ? dataQuality : 0, 0, 0,
            'tick history contains invalid last digits.');
    }
    if (!Number.isFinite(dataQuality) || dataQuality < minimumDataQuality || dataQuality > 100) {
        return noTrade(digits, dataQuality, trainingSampleSize, holdoutSampleSize,
            'market data quality is below the required threshold.');
    }
    if (
        !Number.isFinite(trainingFraction) ||
        trainingFraction <= 0 ||
        trainingFraction >= 1 ||
        digits.length < minimumMarketSample ||
        trainingSampleSize < 300 ||
        holdoutSampleSize < minimumHoldoutSample
    ) {
        return noTrade(digits, dataQuality, trainingSampleSize, holdoutSampleSize,
            'there is not enough valid history for separate training and unseen holdout periods.');
    }

    const trainingDigits = digits.slice(0, trainingSampleSize);
    const holdoutDigits = digits.slice(trainingSampleSize);
    const rankedRules = contractRules.map(rule => {
        const trainingWinRate = countWins(trainingDigits, rule) / trainingSampleSize;
        return {
            rule,
            trainingWinRate,
            trainingEdge: trainingWinRate - rule.baselineWinRate,
        };
    }).sort((a, b) =>
        b.trainingEdge - a.trainingEdge ||
        b.trainingWinRate - a.trainingWinRate ||
        a.rule.barrier - b.rule.barrier
    );

    const selected = rankedRules[0];
    if (!selected || selected.trainingEdge <= 0) {
        return noTrade(digits, dataQuality, trainingSampleSize, holdoutSampleSize,
            'no Over/Under barrier showed a positive training-period edge over its fair baseline.');
    }

    const holdoutWins = countWins(holdoutDigits, selected.rule);
    const holdoutWinRate = holdoutWins / holdoutSampleSize;
    const confidenceZ = (options.multipleComparisonCount ?? 1) > 1 ? 2.94 : 1.645;
    const confidenceLowerBound = wilsonLowerBound(holdoutWins, holdoutSampleSize, confidenceZ);
    const validated = confidenceLowerBound > selected.rule.baselineWinRate;

    if (!validated) {
        return {
            decision: 'NO_TRADE',
            contractType: null,
            contractLabel: null,
            barrier: null,
            baselineWinRate: selected.rule.baselineWinRate,
            trainingWinRate: selected.trainingWinRate,
            holdoutWinRate,
            confidenceLowerBound,
            edge: confidenceLowerBound - selected.rule.baselineWinRate,
            marketSampleSize: digits.length,
            trainingSampleSize,
            holdoutSampleSize,
            dataQuality,
            explanation: 'NO TRADE — the training-selected contract did not beat its fair baseline with the conservative holdout confidence bound.',
        };
    }

    return {
        decision: 'MARKET_CANDIDATE',
        contractType: selected.rule.contractType,
        contractLabel: selected.rule.contractLabel,
        barrier: selected.rule.barrier,
        baselineWinRate: selected.rule.baselineWinRate,
        trainingWinRate: selected.trainingWinRate,
        holdoutWinRate,
        confidenceLowerBound,
        edge: confidenceLowerBound - selected.rule.baselineWinRate,
        marketSampleSize: digits.length,
        trainingSampleSize,
        holdoutSampleSize,
        dataQuality,
        explanation: 'Research candidate only: the contract was selected before the holdout and its conservative adjusted lower confidence bound beat the fair digit baseline. Check live proposal pricing and breakeven before any demo execution; this result never authorizes an order.',
    };
};

export interface AIProposalQuote {
    askPrice: number;
    payout: number;
}

export interface AIProposalEconomics {
    allowed: boolean;
    breakEvenProbability: number;
    confidenceMargin: number;
    explanation: string;
}

/**
 * Requires the conservative holdout confidence bound to exceed the live
 * proposal's break-even win rate. This is still a candidate gate, never a buy.
 */
export const evaluateAIProposalEconomics = (
    confidenceLowerBound: number,
    quote: AIProposalQuote
): AIProposalEconomics => {
    const validQuote =
        Number.isFinite(confidenceLowerBound) &&
        confidenceLowerBound >= 0 &&
        confidenceLowerBound <= 1 &&
        Number.isFinite(quote.askPrice) &&
        Number.isFinite(quote.payout) &&
        quote.askPrice > 0 &&
        quote.payout > quote.askPrice;

    if (!validQuote) {
        return {
            allowed: false,
            breakEvenProbability: 1,
            confidenceMargin: -1,
            explanation: 'NO TRADE — the live proposal quote is missing, invalid, or has no positive payout above stake.',
        };
    }

    const breakEvenProbability = quote.askPrice / quote.payout;
    const confidenceMargin = confidenceLowerBound - breakEvenProbability;
    const allowed = confidenceMargin > 0;

    return {
        allowed,
        breakEvenProbability,
        confidenceMargin,
        explanation: allowed
            ? 'Live proposal quote passed: the conservative holdout confidence bound is above the current break-even win rate. This remains a candidate only, not an order authorization.'
            : 'NO TRADE — the conservative holdout confidence bound does not exceed the live contract break-even win rate.',
    };
};
