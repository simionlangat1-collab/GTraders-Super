export type AITradeDecision = 'TRADE_CANDIDATE' | 'NO_TRADE';

export type AITradeRejectionReason =
    | 'INSUFFICIENT_MARKET_DATA'
    | 'POOR_DATA_QUALITY'
    | 'INSUFFICIENT_OUT_OF_SAMPLE_EVIDENCE'
    | 'MODEL_NOT_VALIDATED'
    | 'NO_STATISTICALLY_SUPPORTED_EDGE'
    | 'INVALID_EVIDENCE';

export interface AITradeEvidence {
    /** Number of valid, recent observations used by the market analysis. */
    marketSampleSize: number;
    /** Percentage (0-100) of expected market observations successfully received. */
    dataQuality: number;
    /** Number of genuinely out-of-sample settled trades in the validation set. */
    outOfSampleTradeCount: number;
    /** Baseline win rate for the same contract, market and test period (0-1). */
    baselineWinRate: number;
    /** Model win rate on the untouched out-of-sample validation set (0-1). */
    observedWinRate: number;
    /** Lower bound of a precomputed confidence interval for observed win rate (0-1). */
    winRateConfidenceLowerBound: number;
    /** Must only be true after leakage-free, out-of-sample validation. */
    validationPassed: boolean;
}

export interface AITradeDecisionResult {
    decision: AITradeDecision;
    reasons: AITradeRejectionReason[];
    explanation: string;
}

/**
 * Conservative permission gate for the AI.
 *
 * Historical digit frequencies and scanner activity scores are deliberately
 * not accepted as proof of a predictive edge. This gate only considers
 * independently validated out-of-sample performance. It does not place trades.
 */
export const evaluateAITradeEvidence = (
    evidence: AITradeEvidence
): AITradeDecisionResult => {
    const reasons: AITradeRejectionReason[] = [];

    const numericValues = [
        evidence.marketSampleSize,
        evidence.dataQuality,
        evidence.outOfSampleTradeCount,
        evidence.baselineWinRate,
        evidence.observedWinRate,
        evidence.winRateConfidenceLowerBound,
    ];

    if (
        numericValues.some(value => !Number.isFinite(value)) ||
        !Number.isInteger(evidence.marketSampleSize) ||
        !Number.isInteger(evidence.outOfSampleTradeCount) ||
        evidence.marketSampleSize < 0 ||
        evidence.outOfSampleTradeCount < 0 ||
        evidence.dataQuality < 0 ||
        evidence.dataQuality > 100 ||
        evidence.baselineWinRate < 0 ||
        evidence.baselineWinRate > 1 ||
        evidence.observedWinRate < 0 ||
        evidence.observedWinRate > 1 ||
        evidence.winRateConfidenceLowerBound < 0 ||
        evidence.winRateConfidenceLowerBound > 1
    ) {
        reasons.push('INVALID_EVIDENCE');
    } else {
        if (evidence.marketSampleSize < 500) {
            reasons.push('INSUFFICIENT_MARKET_DATA');
        }

        if (evidence.dataQuality < 95) {
            reasons.push('POOR_DATA_QUALITY');
        }

        if (evidence.outOfSampleTradeCount < 200) {
            reasons.push('INSUFFICIENT_OUT_OF_SAMPLE_EVIDENCE');
        }

        if (!evidence.validationPassed) {
            reasons.push('MODEL_NOT_VALIDATED');
        }

        // The conservative confidence bound must beat the matched baseline,
        // not merely the point estimate or historical digit frequency.
        if (evidence.winRateConfidenceLowerBound <= evidence.baselineWinRate) {
            reasons.push('NO_STATISTICALLY_SUPPORTED_EDGE');
        }
    }

    if (reasons.length > 0) {
        return {
            decision: 'NO_TRADE',
            reasons,
            explanation:
                'NO TRADE — the evidence has not met every independent data-quality and out-of-sample validation requirement. Keep scanning; do not force an entry.',
        };
    }

    return {
        decision: 'TRADE_CANDIDATE',
        reasons: [],
        explanation:
            'Evidence passed the configured research gate. This is only a candidate for the separate risk manager; it is not authorization to place a trade.',
    };
};
