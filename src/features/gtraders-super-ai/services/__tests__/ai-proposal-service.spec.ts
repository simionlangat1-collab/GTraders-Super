import { requestFreshAIProposal } from '../ai-proposal-service';

describe('requestFreshAIProposal', () => {
    it('requests a new one-tick proposal for the exact market and retains its proposal id', async () => {
        const request = jest.fn(async () => ({
            proposal: { id: 'proposal-123', ask_price: '1.00', payout: '1.90' },
        }));

        const result = await requestFreshAIProposal(request, {
            amount: 1,
            currency: 'USD',
            contractType: 'DIGITOVER',
            barrier: 2,
            symbol: 'R_100',
        });

        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith({
            proposal: 1,
            amount: 1,
            basis: 'stake',
            contract_type: 'DIGITOVER',
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
            barrier: '2',
            underlying_symbol: 'R_100',
        });
        expect(result).toEqual({ id: 'proposal-123', askPrice: 1, payout: 1.9 });
    });

    it('requests a separate quote each time instead of reusing a cached proposal', async () => {
        let nextId = 0;
        const request = jest.fn(async () => ({
            proposal: { id: `proposal-${++nextId}`, ask_price: 1, payout: 1.9 },
        }));
        const input = {
            amount: 1,
            currency: 'USD',
            contractType: 'DIGITUNDER' as const,
            barrier: 7,
            symbol: 'R_50',
        };

        const first = await requestFreshAIProposal(request, input);
        const second = await requestFreshAIProposal(request, input);

        expect(request).toHaveBeenCalledTimes(2);
        expect(first.id).toBe('proposal-1');
        expect(second.id).toBe('proposal-2');
    });

    it('rejects missing proposal ids or invalid quote economics', async () => {
        const request = jest.fn(async () => ({
            proposal: { ask_price: 1, payout: 1 },
        }));

        await expect(requestFreshAIProposal(request, {
            amount: 1,
            currency: 'USD',
            contractType: 'DIGITOVER',
            barrier: 2,
            symbol: 'R_100',
        })).rejects.toThrow('valid fresh proposal');
    });

    it('rejects invalid contract inputs before making an API request', async () => {
        const request = jest.fn();
        await expect(requestFreshAIProposal(request, {
            amount: 0,
            currency: 'USD',
            contractType: 'DIGITOVER',
            barrier: 2,
            symbol: 'R_100',
        })).rejects.toThrow('incomplete or invalid');
        expect(request).not.toHaveBeenCalled();
    });
});
