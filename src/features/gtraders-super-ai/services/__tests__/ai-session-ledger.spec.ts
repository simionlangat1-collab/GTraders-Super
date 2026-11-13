import { AISessionLedger } from '../ai-session-ledger';

class MemoryStorage {
    private values = new Map<string, string>();
    getItem(key: string): string | null { return this.values.get(key) ?? null; }
    setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('AISessionLedger', () => {
    it('records actual settled P/L and consecutive losses without changing the stake', () => {
        const storage = new MemoryStorage();
        const ledger = new AISessionLedger('CR123', storage);
        ledger.markPurchase(101);
        const first = ledger.recordSettlement(101, -1);
        expect(first.sessionProfitLoss).toBe(-1);
        expect(first.consecutiveLosses).toBe(1);
        expect(first.settledTrades).toBe(1);

        ledger.markPurchase(102);
        const second = ledger.recordSettlement(102, -0.5);
        expect(second.sessionProfitLoss).toBe(-1.5);
        expect(second.consecutiveLosses).toBe(2);

        ledger.markPurchase(103);
        const third = ledger.recordSettlement(103, 0.8);
        expect(third.sessionProfitLoss).toBeCloseTo(-0.7);
        expect(third.consecutiveLosses).toBe(0);
        expect(third.openContractId).toBeNull();
    });

    it('restores the same account session after reload and blocks while a contract is open', () => {
        const storage = new MemoryStorage();
        const first = new AISessionLedger('CR123', storage);
        first.markPurchase(777);
        const restored = new AISessionLedger('CR123', storage);
        expect(restored.getSnapshot().openContractId).toBe(777);
        expect(() => restored.markPurchase(778)).toThrow('unresolved');
    });

    it('locks permanently when a buy response is uncertain', () => {
        const ledger = new AISessionLedger('CR123', new MemoryStorage());
        ledger.markPurchaseUncertain();
        expect(ledger.getSnapshot().executionUncertain).toBe(true);
        expect(() => ledger.markPurchase(888)).toThrow('unresolved');
    });

    it('rejects damaged stored state rather than silently resetting risk to zero', () => {
        const storage = new MemoryStorage();
        storage.setItem('gtraders-super-ai-session-v1:CR123', '{broken');
        expect(() => new AISessionLedger('CR123', storage)).toThrow('damaged');
    });

    it('rejects a settlement for a different contract', () => {
        const ledger = new AISessionLedger('CR123', new MemoryStorage());
        ledger.markPurchase(101);
        expect(() => ledger.recordSettlement(102, 1)).toThrow('does not match');
    });
});
