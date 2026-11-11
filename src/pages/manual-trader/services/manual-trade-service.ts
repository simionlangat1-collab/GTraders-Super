import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { ManualContractType } from '../types';

type ProposalResult = {
    id: string;
    ask_price: number;
    payout: number;
    contract_type: ManualContractType;
};

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

        let timer: ReturnType<typeof setTimeout>;
        const listener = api.onMessage().subscribe((message: any) => {
            const result = predicate(message?.data);
            if (result !== undefined) {
                clearTimeout(timer);
                listener.unsubscribe();
                resolve(result);
            }
            if (message?.data?.error) {
                clearTimeout(timer);
                listener.unsubscribe();
                reject(new Error(message.data.error.message || 'Deriv request failed.'));
            }
        });

        timer = setTimeout(() => {
            listener.unsubscribe();
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
        const passthrough = { manual_trade_request_id: requestId };
        const proposalPromise = waitForMessage<ProposalResult>(data => {
            if (data?.msg_type !== 'proposal' || data?.echo_req?.passthrough?.manual_trade_request_id !== requestId) {
                return undefined;
            }
            if (data.error) throw new Error(data.error.message || 'Unable to get proposal.');
            const proposal = data.proposal;
            if (!proposal?.id) throw new Error('Deriv returned an invalid proposal.');
            return {
                id: proposal.id,
                ask_price: Number(proposal.ask_price),
                payout: Number(proposal.payout),
                contract_type: options.contractType,
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
            passthrough,
        };

        if (['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(options.contractType)) {
            request.barrier = options.prediction;
        }

        await api.send(request);
        return proposalPromise;
    }

    async buy(proposalId: string, askPrice: number) {
        const api = api_base.api;
        if (!api) throw new Error('Deriv connection is not available.');
        const response: any = await api.send({ buy: proposalId, price: askPrice });
        if (response?.error) throw new Error(response.error.message || 'Purchase failed.');
        if (!response?.buy?.contract_id) throw new Error('Deriv did not confirm the purchase.');
        return response.buy;
    }

    observeContract(contractId: number, callback: (contract: any) => void) {
        const api = api_base.api;
        if (!api) return () => undefined;

        const listener = api.onMessage().subscribe((message: any) => {
            const data = message?.data;
            const contract = data?.proposal_open_contract;
            if (data?.msg_type === 'proposal_open_contract' && Number(contract?.contract_id) === contractId) {
                callback(contract);
            }
        });

        return () => listener.unsubscribe();
    }
}

export const manualTradeService = new ManualTradeService();