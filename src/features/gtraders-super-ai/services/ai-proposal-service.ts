import { AIContractType } from './ai-contract-scanner';

export interface AIFreshProposalRequest {
    amount: number;
    currency: string;
    contractType: AIContractType;
    barrier: number;
    symbol: string;
}

export interface AIFreshProposal {
    id: string;
    askPrice: number;
    payout: number;
}

export type AIProposalRequest = <T>(payload: Record<string, unknown>) => Promise<T>;

/**
 * Requests a new, one-tick proposal from Deriv for the exact current candidate.
 * No quote is cached. The returned proposal id is retained for the later
 * execution stage; receiving a proposal never buys a contract.
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

    const response = await request<{
        proposal?: {
            id?: string | number;
            ask_price?: number | string;
            payout?: number | string;
        };
    }>({
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

    const proposalId = response.proposal?.id;
    const askPrice = Number(response.proposal?.ask_price);
    const payout = Number(response.proposal?.payout);

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

    return { id: String(proposalId), askPrice, payout };
};
