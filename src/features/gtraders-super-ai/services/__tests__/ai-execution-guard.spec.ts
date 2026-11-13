import { evaluateAIExecutionReadiness } from '../ai-execution-guard';

const readyInput = {
    connectionStatus: 'connected' as const,
    accountType: 'demo' as const,
    hasQualifiedOpportunity: true,
    riskAllowed: true,
    hasOpenContract: false,
};

describe('evaluateAIExecutionReadiness', () => {
    it('allows a connected demo session only when every precondition passes', () => {
        const result = evaluateAIExecutionReadiness(readyInput);
        expect(result.ready).toBe(true);
        expect(result.reasons).toHaveLength(0);
        expect(result.explanation).toContain('explicit Run action');
    });

    it('blocks real and unverified account types', () => {
        expect(evaluateAIExecutionReadiness({ ...readyInput, accountType: 'real' }).reasons)
            .toContain('DEMO_ACCOUNT_REQUIRED');
        expect(evaluateAIExecutionReadiness({ ...readyInput, accountType: 'unknown' }).reasons)
            .toContain('DEMO_ACCOUNT_REQUIRED');
    });

    it('blocks failed connection, opportunity and risk checks', () => {
        const result = evaluateAIExecutionReadiness({
            ...readyInput,
            connectionStatus: 'disconnected',
            hasQualifiedOpportunity: false,
            riskAllowed: false,
        });
        expect(result.ready).toBe(false);
        expect(result.reasons).toEqual(expect.arrayContaining([
            'CONNECTION_NOT_READY', 'NO_QUALIFIED_OPPORTUNITY', 'RISK_CHECK_FAILED',
        ]));
    });

    it('blocks a new entry while a contract is open', () => {
        const result = evaluateAIExecutionReadiness({ ...readyInput, hasOpenContract: true });
        expect(result.ready).toBe(false);
        expect(result.reasons).toContain('CONTRACT_ALREADY_OPEN');
    });
});
