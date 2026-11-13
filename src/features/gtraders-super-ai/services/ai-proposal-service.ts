import { AIContractType } from './ai-contract-scanner';

export interface AIFreshProposalRequest {
    amount: number;
    currency: string;
    contractType: AIContractType;
    barrier: number;
    symbol: string;
}

export interface AIFreshProposal extends AIFreshProposalRequest {
    id: string;
    askPrice: number;
    payout: number;
    requestedAt: number;
}

export type AIProposalRequest = (payload: Record<string, unknown>) => Promise<unknown>;

/**
 * Requests a new one-tick Deriv proposal for the exact current candidate.
 * No quote is cached. A proposal is pricing data only; it never buys a contract.
 */
export const requestFreshAIProposal = async (
    request: AIProposalRequest,
    input: AIFreshProposalRequest
): Promise<AIFreshProposal> => {
    if (
        !Number.isFinite(input.amount) || input.amount <= 0 ||
        !input.currency ||
        !input.symbol ||
        !Number.isInteger(input.barrier) ||
        (input.contractType === 'DIGITOVER' && (input.barrier < 0 || input.barrier > 8)) ||
        (input.contractType === 'DIGITUNDER' && (input.barrier < 1 || input.barrier > 9))
    ) {
        throw new Error('A fresh proposal cannot be requested with incomplete or invalid contract details.');
    }

    // Timestamp before the network round-trip so network delay counts against freshness.\n    const requestedAt = Date.now();\n    const rawResponse = await request({
        proposal: 1,
        amount: input.amount,
        basis: 'stake',
        contract_type: input.contractType,
        currency: input.currency,
        duration: 1,
        duration_unit: 't',
        barrier: String(input.barrier),
        underlying_symbol: input.symbol,
    });
    const response = rawResponse as {
        proposal?: {
            id?: string | number;
            ask_price?: number | string;
            payout?: number | string;
        };
    };

    const proposalId = response?.proposal?.id;
    const askPrice = Number(response?.proposal?.ask_price);
    const payout = Number(response?.proposal?.payout);

    if (
        (typeof proposalId !== 'string' && typeof proposalId !== 'number') ||
        String(proposalId).trim() === '' ||
        !Number.isFinite(askPrice) ||
        !Number.isFinite(payout) ||
        askPrice <= 0 ||
        payout <= askPrice
    ) {
        throw new Error('Deriv did not return a valid fresh proposal id, stake price and payout.');
    }

    return { ...input, id: String(proposalId), askPrice, payout, requestedAt };
};
