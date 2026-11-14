import { evaluateAITradeEvidence, AITradeEvidence } from '../ai-trade-decision';

const strongEvidence: AITradeEvidence = {
    marketSampleSize: 1000,
    dataQuality: 99,
    outOfSampleTradeCount: 500,
    baselineWinRate: 0.45,
    observedWinRate: 0.52,
    winRateConfidenceLowerBound: 0.48,
    modelOnlyCorrect: 40,
    baselineOnlyCorrect: 10,
    pairedPValue: 0.001,
    adjustedPairedPValue: 0.013,
    validationPassed: true,
};

describe('evaluateAITradeEvidence', () => {
    it('defaults to NO TRADE when evidence is absent or weak', () => {
        const result = evaluateAITradeEvidence({
            ...strongEvidence,
            marketSampleSize: 40,
            dataQuality: 70,
            outOfSampleTradeCount: 20,
            validationPassed: false,
        });

        expect(result.decision).toBe('NO_TRADE');
        expect(result.reasons).toEqual(
            expect.arrayContaining([
                'INSUFFICIENT_MARKET_DATA',
                'POOR_DATA_QUALITY',
                'INSUFFICIENT_OUT_OF_SAMPLE_EVIDENCE',
                'MODEL_NOT_VALIDATED',
            ])
        );
        expect(result.explanation).toContain('NO TRADE');
    });

    it('rejects paired evidence when its family-wise adjusted p-value exceeds 0.05', () => {
        const result = evaluateAITradeEvidence({
            ...strongEvidence,
            observedWinRate: 0.8,
            winRateConfidenceLowerBound: 0.44,
            adjustedPairedPValue: 0.08,
        });

        expect(result.decision).toBe('NO_TRADE');
        expect(result.reasons).toContain('NO_STATISTICALLY_SUPPORTED_EDGE');
    });

    it('rejects malformed or out-of-range evidence', () => {
        const result = evaluateAITradeEvidence({
            ...strongEvidence,
            dataQuality: 140,
        });

        expect(result.decision).toBe('NO_TRADE');
        expect(result.reasons).toContain('INVALID_EVIDENCE');
    });

    it('passes evidence only as a candidate, never as direct trade authorization', () => {
        const result = evaluateAITradeEvidence(strongEvidence);

        expect(result.decision).toBe('TRADE_CANDIDATE');
        expect(result.reasons).toHaveLength(0);
        expect(result.explanation).toContain('not authorization to place a trade');
    });

    it('requires the model validation flag even with a measured edge', () => {
        const result = evaluateAITradeEvidence({
            ...strongEvidence,
            validationPassed: false,
        });

        expect(result.decision).toBe('NO_TRADE');
        expect(result.reasons).toContain('MODEL_NOT_VALIDATED');
    });
});
