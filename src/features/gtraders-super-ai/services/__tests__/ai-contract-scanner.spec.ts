import { evaluateAIContractOpportunity } from '../ai-contract-scanner';

describe('evaluateAIContractOpportunity', () => {
    it('selects an Over/Under contract from training and validates it on later unseen ticks', () => {
        const digits = [...Array(300).fill(8), ...Array(200).fill(8)];
        const result = evaluateAIContractOpportunity(digits, 100);

        expect(result.decision).toBe('MARKET_CANDIDATE');
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
        expect(result.contractType).toBeNull();
        expect(result.explanation).toContain('NO TRADE');
    });

    it('rejects insufficient history and poor data quality', () => {
        expect(evaluateAIContractOpportunity(Array(300).fill(8), 100).decision)
            .toBe('NO_TRADE');
        expect(evaluateAIContractOpportunity(Array(500).fill(8), 80).decision)
            .toBe('NO_TRADE');
    });

    it('rejects invalid digits instead of silently dropping them', () => {
        const digits = Array(500).fill(8);
        digits[12] = 10;
        const result = evaluateAIContractOpportunity(digits, 100);

        expect(result.decision).toBe('NO_TRADE');
        expect(result.marketSampleSize).toBe(0);
    });

    it('does not claim a candidate when a training pattern disappears in holdout', () => {
        const digits = [...Array(300).fill(8), ...Array(200).fill(0)];
        const result = evaluateAIContractOpportunity(digits, 100);

        expect(result.decision).toBe('NO_TRADE');
        expect(result.contractType).toBeNull();
    });
});
