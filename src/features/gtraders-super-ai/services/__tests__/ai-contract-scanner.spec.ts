import { doesAIPredictionSupportContract, evaluateAIContractOpportunity, evaluateAIProposalEconomics } from '../ai-contract-scanner';

describe('doesAIPredictionSupportContract', () => {
    it('requires the predicted digit to satisfy the selected Over barrier', () => {
        expect(doesAIPredictionSupportContract('DIGITOVER', 2, 3)).toBe(true);
        expect(doesAIPredictionSupportContract('DIGITOVER', 2, 2)).toBe(false);
        expect(doesAIPredictionSupportContract('DIGITOVER', 2, 1)).toBe(false);
    });

    it('requires the predicted digit to satisfy the selected Under barrier', () => {
        expect(doesAIPredictionSupportContract('DIGITUNDER', 7, 6)).toBe(true);
        expect(doesAIPredictionSupportContract('DIGITUNDER', 7, 7)).toBe(false);
        expect(doesAIPredictionSupportContract('DIGITUNDER', 7, 8)).toBe(false);
    });

    it('rejects missing and invalid prediction or barrier data', () => {
        expect(doesAIPredictionSupportContract(null, 2, 3)).toBe(false);
        expect(doesAIPredictionSupportContract('DIGITOVER', null, 3)).toBe(false);
        expect(doesAIPredictionSupportContract('DIGITOVER', 2, null)).toBe(false);
        expect(doesAIPredictionSupportContract('DIGITOVER', 9, 9)).toBe(false);
        expect(doesAIPredictionSupportContract('DIGITUNDER', 0, 0)).toBe(false);
    });
});

describe('evaluateAIContractOpportunity', () => {
    it('selects an Over/Under contract from training and validates it on later unseen ticks', () => {
        const digits = [...Array(300).fill(8), ...Array(200).fill(8)];
        const result = evaluateAIContractOpportunity(digits, 100);

        expect(result.decision).toBe('MARKET_CANDIDATE');
        expect(result.rejectionReasons).toEqual([]);
        expect(result.contractLabel).toBe('Over');
        expect(result.barrier).toBe(7);
        expect(result.trainingSampleSize).toBe(300);
        expect(result.holdoutSampleSize).toBe(200);
        expect(result.confidenceLowerBound).toBeGreaterThan(result.baselineWinRate);
        expect(result.explanation).toContain('never authorizes an order');
    });

    it('returns NO TRADE when balanced digits do not beat a fair baseline', () => {
        const digits = Array.from({ length: 500 }, (_, index) => index % 10);
        const result = evaluateAIContractOpportunity(digits, 100);

        expect(result.decision).toBe('NO_TRADE');
        expect(result.rejectionReasons).toContain('NO_POSITIVE_TRAINING_EDGE');
        expect(result.contractType).toBeNull();
        expect(result.explanation).toContain('NO TRADE');
    });

    it('rejects insufficient history and poor data quality', () => {
        const insufficient = evaluateAIContractOpportunity(Array(300).fill(8), 100);
        const poorQuality = evaluateAIContractOpportunity(Array(500).fill(8), 80);
        expect(insufficient.decision).toBe('NO_TRADE');
        expect(insufficient.rejectionReasons).toContain('INSUFFICIENT_TRAINING_OR_HOLDOUT');
        expect(poorQuality.decision).toBe('NO_TRADE');
        expect(poorQuality.rejectionReasons).toContain('DATA_QUALITY_BELOW_THRESHOLD');
    });

    it('rejects invalid digits instead of silently dropping them', () => {
        const digits = Array(500).fill(8);
        digits[12] = 10;
        const result = evaluateAIContractOpportunity(digits, 100);

        expect(result.decision).toBe('NO_TRADE');
        expect(result.rejectionReasons).toContain('INVALID_TICK_HISTORY');
        expect(result.marketSampleSize).toBe(0);
    });

    it('does not claim a candidate when a training pattern disappears in holdout', () => {
        const digits = [...Array(300).fill(8), ...Array(200).fill(0)];
        const result = evaluateAIContractOpportunity(digits, 100);

        expect(result.decision).toBe('NO_TRADE');
        expect(result.rejectionReasons).toContain('HOLDOUT_CONFIDENCE_BOUND_FAILED');
        expect(result.contractType).toBeNull();
    });
});

describe('evaluateAIProposalEconomics', () => {
    it('accepts only when the conservative confidence bound exceeds live break-even', () => {
        const result = evaluateAIProposalEconomics(0.85, {
            askPrice: 1,
            payout: 1.25,
        });

        expect(result.allowed).toBe(true);
        expect(result.breakEvenProbability).toBe(0.8);
        expect(result.confidenceMargin).toBeCloseTo(0.05);
    });

    it('rejects a confidence bound equal to or below break-even', () => {
        expect(evaluateAIProposalEconomics(0.8, {
            askPrice: 1,
            payout: 1.25,
        }).allowed).toBe(false);

        expect(evaluateAIProposalEconomics(0.79, {
            askPrice: 1,
            payout: 1.25,
        }).allowed).toBe(false);
    });

    it('rejects missing, invalid or unprofitable proposal quotes', () => {
        expect(evaluateAIProposalEconomics(0.9, {
            askPrice: 0,
            payout: 1.2,
        }).allowed).toBe(false);

        expect(evaluateAIProposalEconomics(0.9, {
            askPrice: 1,
            payout: 1,
        }).allowed).toBe(false);

        expect(evaluateAIProposalEconomics(Number.NaN, {
            askPrice: 1,
            payout: 1.5,
        }).allowed).toBe(false);
    });
});
