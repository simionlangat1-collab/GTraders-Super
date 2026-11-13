import { assessAIRisk, AIRiskSettings, AIRiskSnapshot } from '../ai-risk-manager';

const settings: AIRiskSettings = {
    stake: 1,
    targetProfit: 10,
    stopLoss: 5,
    maxConsecutiveLosses: 3,
};

const snapshot: AIRiskSnapshot = {
    balance: 100,
    sessionProfitLoss: 0,
    consecutiveLosses: 0,
};

describe('assessAIRisk', () => {
    it('allows a trade only when all configured risk checks pass', () => {
        const result = assessAIRisk(settings, snapshot);

        expect(result.allowed).toBe(true);
        expect(result.reasons).toHaveLength(0);
    });

    it('blocks a stake above the configured balance percentage', () => {
        const result = assessAIRisk({ ...settings, stake: 3 }, snapshot);

        expect(result.allowed).toBe(false);
        expect(result.reasons).toContain('STAKE_EXCEEDS_BALANCE_LIMIT');
    });

    it('blocks trading when target profit is reached', () => {
        const result = assessAIRisk(settings, { ...snapshot, sessionProfitLoss: 10 });

        expect(result.allowed).toBe(false);
        expect(result.reasons).toContain('TARGET_PROFIT_REACHED');
    });

    it('blocks trading when stop loss is reached', () => {
        const result = assessAIRisk(settings, { ...snapshot, sessionProfitLoss: -5 });

        expect(result.allowed).toBe(false);
        expect(result.reasons).toContain('STOP_LOSS_REACHED');
    });

    it('blocks trading after the consecutive-loss limit', () => {
        const result = assessAIRisk(settings, { ...snapshot, consecutiveLosses: 3 });

        expect(result.allowed).toBe(false);
        expect(result.reasons).toContain('CONSECUTIVE_LOSS_LIMIT_REACHED');
    });

    it('rejects invalid settings and account data', () => {
        const result = assessAIRisk(
            { ...settings, stake: 0, maxConsecutiveLosses: 0 },
            { ...snapshot, balance: Number.NaN }
        );

        expect(result.allowed).toBe(false);
        expect(result.reasons).toContain('INVALID_RISK_SETTINGS');
        expect(result.reasons).toContain('INVALID_ACCOUNT_SNAPSHOT');
    });

    it('never approves a stake larger than the account balance', () => {
        const result = assessAIRisk({ ...settings, stake: 101 }, snapshot);

        expect(result.allowed).toBe(false);
        expect(result.reasons).toContain('STAKE_EXCEEDS_BALANCE');
    });
});
