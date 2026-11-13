import { evaluateAIFinalPreBuyGate, AIFinalPreBuyInput } from '../ai-final-pre-buy-guard';

const validInput = (): AIFinalPreBuyInput => ({
    connectionStatus: 'connected',
    accountType: 'demo',
    hasOpenContract: false,
    hasQualifiedOpportunity: true,
    liveTickStreamHealthy: true,
    riskSettings: {
        stake: 1,
        targetProfit: 10,
        stopLoss: 5,
        maxConsecutiveLosses: 3,
    },
    riskSnapshot: {
        balance: 100,
        sessionProfitLoss: 0,
        consecutiveLosses: 0,
    },
    expectedContract: {
        amount: 1,
        currency: 'USD',
        contractType: 'DIGITOVER',
        barrier: 2,
        symbol: 'R_100',
    },
    proposal: {
        id: 'fresh-proposal',
        askPrice: 1,
        payout: 2,
        amount: 1,
        currency: 'USD',
        contractType: 'DIGITOVER',
        barrier: 2,
        symbol: 'R_100',
        requestedAt: 9950,
    },
    confidenceLowerBound: 0.7,
    now: 10000,
});

describe('evaluateAIFinalPreBuyGate', () => {
    it('passes only a fresh, exact-match demo proposal with acceptable risk and payout', () => {
        const result = evaluateAIFinalPreBuyGate(validInput());
        expect(result.allowed).toBe(true);
        expect(result.reasons).toHaveLength(0);
        expect(result.explanation).toContain('never places an order');
    });

    it('blocks real or unverified accounts and open contracts', () => {
        const real = evaluateAIFinalPreBuyGate({ ...validInput(), accountType: 'real' });
        expect(real.allowed).toBe(false);
        expect(real.reasons).toContain('EXECUTION_PRECONDITION_FAILED');

        const open = evaluateAIFinalPreBuyGate({
            ...validInput(),
            hasOpenContract: true,
        });
        expect(open.reasons).toContain('EXECUTION_PRECONDITION_FAILED');
    });

    it('rechecks current session risk and stops at target, stop loss or loss limit', () => {
        const target = evaluateAIFinalPreBuyGate({
            ...validInput(),
            riskSnapshot: { balance: 100, sessionProfitLoss: 10, consecutiveLosses: 0 },
        });
        expect(target.reasons).toContain('RISK_CHECK_FAILED');

        const stop = evaluateAIFinalPreBuyGate({
            ...validInput(),
            riskSnapshot: { balance: 100, sessionProfitLoss: -5, consecutiveLosses: 0 },
        });
        expect(stop.reasons).toContain('RISK_CHECK_FAILED');

        const losses = evaluateAIFinalPreBuyGate({
            ...validInput(),
            riskSnapshot: { balance: 100, sessionProfitLoss: -2, consecutiveLosses: 3 },
        });
        expect(losses.reasons).toContain('RISK_CHECK_FAILED');
    });

    it('blocks proposals with mismatched stake, currency, market, contract or barrier', () => {
        const result = evaluateAIFinalPreBuyGate({
            ...validInput(),
            proposal: { ...validInput().proposal!, symbol: 'R_50' },
        });
        expect(result.allowed).toBe(false);
        expect(result.reasons).toContain('PROPOSAL_TERMS_MISMATCH');
    });

    it('blocks stale, future-dated or missing proposals', () => {
        const stale = evaluateAIFinalPreBuyGate({
            ...validInput(),
            proposal: { ...validInput().proposal!, requestedAt: 0 },
            now: 10001,
        });
        expect(stale.reasons).toContain('PROPOSAL_NOT_FRESH');

        const future = evaluateAIFinalPreBuyGate({
            ...validInput(),
            proposal: { ...validInput().proposal!, requestedAt: 10001 },
        });
        expect(future.reasons).toContain('PROPOSAL_NOT_FRESH');

        const missing = evaluateAIFinalPreBuyGate({ ...validInput(), proposal: null });
        expect(missing.reasons).toContain('PROPOSAL_MISSING_OR_INVALID');
    });

    it('blocks a proposal whose break-even price is not beaten by the conservative evidence bound', () => {
        const result = evaluateAIFinalPreBuyGate({
            ...validInput(),
            proposal: { ...validInput().proposal!, askPrice: 1.5, payout: 2 },
        });
        expect(result.allowed).toBe(false);
        expect(result.reasons).toContain('PROPOSAL_ECONOMICS_FAILED');
    });

    it('blocks a candidate when the risk settings or account snapshot are invalid', () => {
        const result = evaluateAIFinalPreBuyGate({
            ...validInput(),
            riskSettings: { ...validInput().riskSettings, stake: 0 },
        });
        expect(result.reasons).toContain('RISK_CHECK_FAILED');
    });
});
