import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { ManualContractType } from '../types';

type ProposalResult = {
    id: string;
    ask_price: number;
    payout: number;
    contract_type: ManualContractType;
};

const unwrapMessage = (message: any) => message?.data ?? message;

export class ManualTradeService {
    async getProposal(options: {
        symbol: string;
        contractType: ManualContractType;
        amount: number;
        currency: string;
        duration: number;
        prediction: number;
    }): Promise<ProposalResult> {
        const api = api_base.api;
        if (!api) throw new Error('Deriv connection is not available.');
        if (!api_base.is_authorized) throw new Error('Please authorize your Deriv account first.');

        const request: Record<string, any> = {
            proposal: 1,
            amount: options.amount,
            basis: 'stake',
            contract_type: options.contractType,
            currency: options.currency,
            duration: options.duration,
            duration_unit: 't',
            underlying_symbol: options.symbol,
            subscribe: 1,
        };

        if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(options.contractType)) {
            request.barrier = options.prediction;
        }

        // The Deriv API send() promise resolves with the matching response.
        // Consume that response directly instead of waiting for a second
        // onMessage event that may already have been emitted or may not carry
        // the passthrough fields used for correlation.
        const response: any = unwrapMessage(await api.send(request));
        if (response?.error) {
            throw new Error(response.error.message || 'Unable to get proposal.');
        }

        const proposal = response?.proposal;
        if (response?.msg_type !== 'proposal' || !proposal?.id) {
            throw new Error('Deriv returned an invalid proposal response. Please try again.');
        }

        const askPrice = Number(proposal.ask_price);
        const payout = Number(proposal.payout);
        if (!Number.isFinite(askPrice) || askPrice <= 0 || !Number.isFinite(payout) || payout <= 0) {
            throw new Error('Deriv returned an invalid price quote. Please refresh the quote and try again.');
        }

        return {
            id: String(proposal.id),
            ask_price: askPrice,
            payout,
            contract_type: options.contractType,
        };
    }

    async buy(proposalId: string, askPrice: number) {
        const api = api_base.api;
        if (!api) throw new Error('Deriv connection is not available.');
        const response: any = unwrapMessage(await api.send({ buy: proposalId, price: askPrice }));
        if (response?.error) throw new Error(response.error.message || 'Purchase failed.');
        if (!response?.buy?.contract_id) throw new Error('Deriv did not confirm the purchase.');
        return response.buy;
    }

    async observeContract(contractId: number, callback: (contract: any) => void) {
        const api = api_base.api;
        if (!api) throw new Error('Deriv connection is not available.');

        let subscriptionId = '';
        let closed = false;
        let listener: { unsubscribe: () => void } | undefined;
        const cleanup = () => {
            if (closed) return;
            closed = true;
            listener?.unsubscribe();
            if (subscriptionId) void api.send({ forget: subscriptionId });
        };
        listener = api.onMessage().subscribe((message: any) => {
            const data = unwrapMessage(message);
            const contract = data?.proposal_open_contract;
            if (data?.msg_type === 'proposal_open_contract' && Number(contract?.contract_id) === contractId) {
                callback(contract);
                if (['won', 'lost', 'sold'].includes(String(contract.status))) cleanup();
            }
        });

        try {
            const initial: any = unwrapMessage(await api.send({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1,
            }));
            if (initial?.error) throw new Error(initial.error.message || 'Unable to monitor the purchased contract.');
            subscriptionId = initial?.subscription?.id || '';
            if (initial?.proposal_open_contract) {
                callback(initial.proposal_open_contract);
                if (['won', 'lost', 'sold'].includes(String(initial.proposal_open_contract.status))) cleanup();
            }
            if (closed && subscriptionId) void api.send({ forget: subscriptionId });
        } catch (error) {
            cleanup();
            throw error;
        }

        return cleanup;
    }
}

export const manualTradeService = new ManualTradeService();
