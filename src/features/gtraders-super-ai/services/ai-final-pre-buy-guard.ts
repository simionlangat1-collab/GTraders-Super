import { evaluateAIProposalEconomics } from './ai-contract-scanner';
import { evaluateAIExecutionReadiness } from './ai-execution-guard';
import { AIFreshProposal } from './ai-proposal-service';
import { assessAIRisk, AIRiskSettings, AIRiskSnapshot } from './ai-risk-manager';

export interface AIFinalPreBuyInput {
    connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
    accountType: 'demo' | 'real' | 'unknown';
    hasOpenContract: boolean;
    hasQualifiedOpportunity: boolean;
    riskSettings: AIRiskSettings;
    riskSnapshot: AIRiskSnapshot;
    expectedContract: {
        amount: number;
        currency: string;
        contractType: 'DIGITOVER' | 'DIGITUNDER';
        barrier: number;
        symbol: string;
    };
    proposal: AIFreshProposal & {
        amount: number;
        currency: string;
        contractType: 'DIGITOVER' | 'DIGITUNDER';
        barrier: number;
        symbol: string;
        requestedAt: number;
    } | null;
    confidenceLowerBound: number;
    now?: number;
    maximumProposalAgeMs?: number;
}

export type AIFinalPreBuyBlockReason =
    | 'EXECUTION_PRECONDITION_FAILED'
    | 'RISK_CHECK_FAILED'
    | 'PROPOSAL_MISSING_OR_INVALID'
    | 'PROPOSAL_TERMS_MISMATCH'
    | 'PROPOSAL_NOT_FRESH'
    | 'PROPOSAL_ECONOMICS_FAILED';

export interface AIFinalPreBuyResult {
    allowed: boolean;
    reasons: AIFinalPreBuyBlockReason[];
    riskExplanation: string;
    economicsExplanation: string;
    explanation: string;
}

/**
 * Last fail-closed authorization check immediately before a future demo buy.
 * The caller must request a brand-new proposal immediately before calling this
 * function. This function never buys and never treats a scanner quote as fresh.
 */
export const evaluateAIFinalPreBuyGate = (
    input: AIFinalPreBuyInput
): AIFinalPreBuyResult => {
    const reasons: AIFinalPreBuyBlockReason[] = [];
    const risk = assessAIRisk(input.riskSettings, input.riskSnapshot);
    if (!risk.allowed) reasons.push('RISK_CHECK_FAILED');

    const readiness = evaluateAIExecutionReadiness({
        connectionStatus: input.connectionStatus,
        accountType: input.accountType,
        hasQualifiedOpportunity: input.hasQualifiedOpportunity,
        riskAllowed: risk.allowed,
        hasOpenContract: input.hasOpenContract,
    });
    if (!readiness.ready) reasons.push('EXECUTION_PRECONDITION_FAILED');

    const proposal = input.proposal;
    if (!proposal ||
        typeof proposal.id !== 'string' || proposal.id.trim() === '' ||
        !Number.isFinite(proposal.askPrice) || proposal.askPrice <= 0 ||
        !Number.isFinite(proposal.payout) || proposal.payout <= proposal.askPrice) {
        reasons.push('PROPOSAL_MISSING_OR_INVALID');
    }

    if (proposal) {
        const expected = input.expectedContract;
        if (
            proposal.amount !== expected.amount ||
            proposal.currency !== expected.currency ||
            proposal.contractType !== expected.contractType ||
            proposal.barrier !== expected.barrier ||
            proposal.symbol !== expected.symbol ||
            !Number.isFinite(expected.amount) || expected.amount <= 0 ||
            !expected.currency || !expected.symbol ||
            !Number.isInteger(expected.barrier) ||
            (expected.contractType === 'DIGITOVER' && (expected.barrier < 0 || expected.barrier > 8)) ||
            (expected.contractType === 'DIGITUNDER' && (expected.barrier < 1 || expected.barrier > 9))
        ) {
            reasons.push('PROPOSAL_TERMS_MISMATCH');
        }

        const now = input.now ?? Date.now();
        const maximumAge = input.maximumProposalAgeMs ?? 10000;
        const age = now - proposal.requestedAt;
        if (
            !Number.isFinite(proposal.requestedAt) ||
            !Number.isFinite(now) ||
            !Number.isFinite(maximumAge) ||
            maximumAge <= 0 ||
            age < 0 ||
            age > maximumAge
        ) {
            reasons.push('PROPOSAL_NOT_FRESH');
        }
    }

    const economics = proposal
        ? evaluateAIProposalEconomics(input.confidenceLowerBound, {
            askPrice: proposal.askPrice,
            payout: proposal.payout,
        })
        : {
            allowed: false,
            explanation: 'NO TRADE — a new valid proposal is required before the final payout check.',
        };
    if (!economics.allowed) reasons.push('PROPOSAL_ECONOMICS_FAILED');

    return {
        allowed: reasons.length === 0,
        reasons,
        riskExplanation: risk.explanation,
        economicsExplanation: economics.explanation,
        explanation: reasons.length === 0
            ? 'FINAL PRE-BUY CHECK PASSED for this moment only. A separate explicit demo execution action is still required; this gate never places an order.'
            : `NO BUY — final pre-buy checks failed: ${reasons.join(', ')}. Do not submit the proposal to buy.`,
    };
};
