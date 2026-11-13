import { executeAIDemoTrade } from '../ai-demo-execution';
import { AIFinalPreBuyInput } from '../ai-final-pre-buy-guard';

const gateInput = (): AIFinalPreBuyInput => ({
    connectionStatus: 'connected',
    accountType: 'demo',
    hasOpenContract: false,
    hasQualifiedOpportunity: true,
    riskSettings: { stake: 1, targetProfit: 10, stopLoss: 5, maxConsecutiveLosses: 3 },
    riskSnapshot: { balance: 100, sessionProfitLoss: 0, consecutiveLosses: 0 },
    expectedContract: {
        amount: 1, currency: 'USD', contractType: 'DIGITOVER', barrier: 2, symbol: 'R_100',
    },
    proposal: {
        id: 'proposal-1', askPrice: 1, payout: 2, amount: 1, currency: 'USD',
        contractType: 'DIGITOVER', barrier: 2, symbol: 'R_100', requestedAt: 9950,
    },
    confidenceLowerBound: 0.7,
    now: 10000,
});

describe('executeAIDemoTrade', () => {
    it('submits exactly one buy after the final gate and waits for settlement', async () => {
        const request = jest.fn(async () => ({ buy: { contract_id: 123 } }));
        const waitForSettlement = jest.fn(async () => ({
            contractId: 123, profit: 0.9, status: 'won', isSold: true,
        }));
        const onPurchased = jest.fn();
        const result = await executeAIDemoTrade(gateInput(), {
            request, waitForSettlement, onPurchased, onPurchaseUncertain: jest.fn(),
        });
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith({ buy: 'proposal-1', price: 1 });
        expect(onPurchased).toHaveBeenCalledWith(123);
        expect(waitForSettlement).toHaveBeenCalledWith(123);
        expect(result).toMatchObject({ status: 'SETTLED', contractId: 123, profit: 0.9 });
    });

    it('never buys when the final safety gate rejects the trade', async () => {
        const request = jest.fn();
        const result = await executeAIDemoTrade({ ...gateInput(), accountType: 'real' }, {
            request, waitForSettlement: jest.fn(), onPurchased: jest.fn(), onPurchaseUncertain: jest.fn(),
        });
        expect(result.status).toBe('BLOCKED');
        expect(request).not.toHaveBeenCalled();
    });

    it('does not retry an uncertain buy and locks the session', async () => {
        const request = jest.fn(async () => { throw new Error('network timeout'); });
        const onPurchaseUncertain = jest.fn();
        const result = await executeAIDemoTrade(gateInput(), {
            request, waitForSettlement: jest.fn(), onPurchased: jest.fn(), onPurchaseUncertain,
        });
        expect(result.status).toBe('PURCHASE_UNCERTAIN');
        expect(request).toHaveBeenCalledTimes(1);
        expect(onPurchaseUncertain).toHaveBeenCalledTimes(1);
    });

    it('keeps a confirmed purchase pending when settlement cannot be verified', async () => {
        const result = await executeAIDemoTrade(gateInput(), {
            request: jest.fn(async () => ({ buy: { contract_id: 456 } })),
            waitForSettlement: jest.fn(async () => { throw new Error('stream lost'); }),
            onPurchased: jest.fn(),
            onPurchaseUncertain: jest.fn(),
        });
        expect(result).toMatchObject({ status: 'SETTLEMENT_PENDING', contractId: 456 });
    });
});
