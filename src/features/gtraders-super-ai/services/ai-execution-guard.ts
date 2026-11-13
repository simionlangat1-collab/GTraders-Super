export interface AIExecutionReadinessInput {
    connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
    accountType: 'demo' | 'real' | 'unknown';
    hasQualifiedOpportunity: boolean;
    riskAllowed: boolean;
    hasOpenContract: boolean;
}

export type AIExecutionBlockReason =
    | 'CONNECTION_NOT_READY'
    | 'DEMO_ACCOUNT_REQUIRED'
    | 'NO_QUALIFIED_OPPORTUNITY'
    | 'RISK_CHECK_FAILED'
    | 'CONTRACT_ALREADY_OPEN';

/** Fail-closed execution gate. Real and unverified accounts are blocked during demo validation. */
export const evaluateAIExecutionReadiness = (
    input: AIExecutionReadinessInput
): { ready: boolean; reasons: AIExecutionBlockReason[]; explanation: string } => {
    const reasons: AIExecutionBlockReason[] = [];
    if (input.connectionStatus !== 'connected') reasons.push('CONNECTION_NOT_READY');
    if (input.accountType !== 'demo') reasons.push('DEMO_ACCOUNT_REQUIRED');
    if (!input.hasQualifiedOpportunity) reasons.push('NO_QUALIFIED_OPPORTUNITY');
    if (!input.riskAllowed) reasons.push('RISK_CHECK_FAILED');
    if (input.hasOpenContract) reasons.push('CONTRACT_ALREADY_OPEN');

    return {
        ready: reasons.length === 0,
        reasons,
        explanation: reasons.length === 0
            ? 'Demo execution preconditions passed. A separate explicit Run action and final pre-buy checks are still required.'
            : `EXECUTION BLOCKED — ${reasons.join(', ')}. The AI must not place an order.`,
    };
};
