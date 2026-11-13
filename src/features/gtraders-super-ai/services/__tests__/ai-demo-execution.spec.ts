import { executeAIDemoTrade } from '../ai-demo-execution';
import { AIFinalPreBuyInput } from '../ai-final-pre-buy-guard';

const gateInput = (): AIFinalPreBuyInput => ({
    connectionStatus: 'connected',
    accountType: 'demo',
    hasOpenContract: false,
    hasQualifiedOpportunity: true,
    liveTickStreamHealthy: true,
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

const intent = jest.fn();
const onPurchased = jest.fn();
const onPurchaseUncertain = jest.fn();

describe('executeAIDemoTrade', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('persists the pre-buy reservation before submitting exactly one purchase', async () => {
        const order: string[] = [];
        const result = await executeAIDemoTrade(gateInput(), {
            onPurchaseIntent: () => { order.push('reserve'); intent(); },
            request: jest.fn(async () => { order.push('buy'); return { buy: { contract_id: 123 } }; }),
            onPurchased: id => { order.push('record'); onPurchased(id); },
            onPurchaseUncertain,
            waitForSettlement: async () => ({ contractId: 123, profit: 0.9, status: 'won', isSold: true }),
        });
        expect(order).toEqual(['reserve', 'buy', 'record']);
        expect(onPurchased).toHaveBeenCalledWith(123);
        expect(result).toMatchObject({ status: 'SETTLED', contractId: 123, profit: 0.9 });
    });

    it('never buys when the final safety gate rejects the trade', async () => {
        const request = jest.fn();
        const result = await executeAIDemoTrade({ ...gateInput(), accountType: 'real' }, {
            onPurchaseIntent: intent, request, waitForSettlement: jest.fn(),
            onPurchased, onPurchaseUncertain,
        });
        expect(result.status).toBe('BLOCKED');
        expect(request).not.toHaveBeenCalled();
        expect(intent).not.toHaveBeenCalled();
    });

    it('does not send a buy if the local pre-buy reservation fails', async () => {
        const request = jest.fn();
        const result = await executeAIDemoTrade(gateInput(), {
            onPurchaseIntent: () => { throw new Error('storage unavailable'); },
            request, waitForSettlement: jest.fn(), onPurchased, onPurchaseUncertain,
        });
        expect(result.status).toBe('EXECUTION_ABORTED');
        expect(request).not.toHaveBeenCalled();
    });

    it('does not retry an uncertain buy and locks the session', async () => {
        const request = jest.fn(async () => { throw new Error('network timeout'); });
        const result = await executeAIDemoTrade(gateInput(), {
            onPurchaseIntent: intent, request, waitForSettlement: jest.fn(),
            onPurchased, onPurchaseUncertain,
        });
        expect(result.status).toBe('PURCHASE_UNCERTAIN');
        expect(request).toHaveBeenCalledTimes(1);
        expect(onPurchaseUncertain).toHaveBeenCalledTimes(1);
    });

    it('keeps a confirmed purchase pending when settlement cannot be verified', async () => {
        const result = await executeAIDemoTrade(gateInput(), {
            onPurchaseIntent: intent,
            request: jest.fn(async () => ({ buy: { contract_id: 456 } })),
            waitForSettlement: jest.fn(async () => { throw new Error('stream lost'); }),
            onPurchased, onPurchaseUncertain,
        });
        expect(result).toMatchObject({ status: 'SETTLEMENT_PENDING', contractId: 456 });
    });
});
