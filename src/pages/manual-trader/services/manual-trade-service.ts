import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { ManualContractType } from '../types';

type ProposalResult = {
    id: string;
    ask_price: number;
    payout: number;
    contract_type: ManualContractType;
};

const unwrapMessage = (message: any) => message?.data ?? message;

const waitForMessage = <T,>(
    predicate: (data: any) => T | undefined,
    timeoutMs = 15000
): Promise<T> =>
    new Promise((resolve, reject) => {
        const api = api_base.api;
        if (!api) {
            reject(new Error('Deriv connection is not available. Please log in again.'));
            return;
        }

        let timer: ReturnType<typeof setTimeout> | undefined;
        let listener: { unsubscribe: () => void } | undefined;
        listener = api.onMessage().subscribe((message: any) => {
            const result = predicate(unwrapMessage(message));
            if (result !== undefined) {
                if (timer) clearTimeout(timer);
                listener?.unsubscribe();
                resolve(result);
            }
        });
        timer = setTimeout(() => {
            listener?.unsubscribe();
            reject(new Error('Deriv did not respond in time. Please try again.'));
        }, timeoutMs);
    });

export class ManualTradeService {
    private requestSequence = 0;

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

        const requestId = `manual-${Date.now()}-${++this.requestSequence}`;
        const proposalPromise = waitForMessage<any>(data => {
            if (data?.echo_req?.passthrough?.manual_trade_request_id !== requestId) return undefined;
            if (data.error) return { error: data.error.message || 'Unable to get proposal.' };
            if (data.msg_type !== 'proposal') return undefined;
            const proposal = data.proposal;
            if (!proposal?.id) return { error: 'Deriv returned an invalid proposal.' };
            return {
                proposal: {
                    id: proposal.id,
                    ask_price: Number(proposal.ask_price),
                    payout: Number(proposal.payout),
                    contract_type: options.contractType,
                },
            };
        });

        const request: Record<string, any> = {
            proposal: 1,
            amount: options.amount,
            basis: 'stake',
            contract_type: options.contractType,
            currency: options.currency,
            duration: options.duration,
            duration_unit: 't',
            symbol: options.symbol,
            passthrough: { manual_trade_request_id: requestId },
        };

        if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(options.contractType)) {
            request.barrier = options.prediction;
        }

        await api.send(request);
        const result = await proposalPromise;
        if (result.error) throw new Error(result.error);
        return result.proposal;
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
