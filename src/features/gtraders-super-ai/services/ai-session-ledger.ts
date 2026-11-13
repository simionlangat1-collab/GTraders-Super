export interface AISessionSnapshot {
    accountLoginId: string;
    startedAt: number;
    sessionProfitLoss: number;
    consecutiveLosses: number;
    settledTrades: number;
    openContractId: number | null;
    executionUncertain: boolean;
    lastContractId: number | null;
    lastContractProfit: number | null;
}

interface AIStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const isValidSnapshot = (value: unknown, accountLoginId: string): value is AISessionSnapshot => {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return item.accountLoginId === accountLoginId &&
        typeof item.startedAt === 'number' && Number.isFinite(item.startedAt) &&
        typeof item.sessionProfitLoss === 'number' && Number.isFinite(item.sessionProfitLoss) &&
        typeof item.consecutiveLosses === 'number' && Number.isInteger(item.consecutiveLosses) && item.consecutiveLosses >= 0 &&
        typeof item.settledTrades === 'number' && Number.isInteger(item.settledTrades) && item.settledTrades >= 0 &&
        (item.openContractId === null ||
            (typeof item.openContractId === 'number' && Number.isInteger(item.openContractId) && item.openContractId > 0)) &&
        typeof item.executionUncertain === 'boolean' &&
        (item.lastContractId === null ||
            (typeof item.lastContractId === 'number' && Number.isInteger(item.lastContractId) && item.lastContractId > 0)) &&
        (item.lastContractProfit === null ||
            (typeof item.lastContractProfit === 'number' && Number.isFinite(item.lastContractProfit)));
};

/**
 * Tracks only contracts explicitly purchased by this AI session. Settled P/L
 * comes from Deriv's proposal_open_contract result, never from placeholder zeros.
 * A persisted pre-buy reservation locks the session across reloads if the
 * browser closes or the buy response is lost. Browser storage is not a server ledger.
 */
export class AISessionLedger {
    private readonly storage: AIStorage;
    private readonly storageKey: string;
    private snapshot: AISessionSnapshot;

    constructor(accountLoginId: string, storage?: AIStorage) {
        if (!accountLoginId) throw new Error('A verified account is required for the AI session ledger.');
        const resolvedStorage = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
        if (!resolvedStorage) throw new Error('Session storage is unavailable. Demo execution is disabled.');
        this.storage = resolvedStorage;
        this.storageKey = `gtraders-super-ai-session-v1:${accountLoginId}`;

        let stored: string | null;
        try {
            stored = this.storage.getItem(this.storageKey);
        } catch {
            throw new Error('The AI session ledger cannot be read. Demo execution is disabled.');
        }

        if (stored) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(stored);
            } catch {
                throw new Error('The saved AI session ledger is damaged. Demo execution is disabled.');
            }
            if (!isValidSnapshot(parsed, accountLoginId)) {
                throw new Error('The saved AI session ledger failed validation. Demo execution is disabled.');
            }
            this.snapshot = parsed;
        } else {
            this.snapshot = {
                accountLoginId,
                startedAt: Date.now(),
                sessionProfitLoss: 0,
                consecutiveLosses: 0,
                settledTrades: 0,
                openContractId: null,
                executionUncertain: false,
                lastContractId: null,
                lastContractProfit: null,
            };
            this.persist();
        }
    }

    getSnapshot = (): AISessionSnapshot => ({ ...this.snapshot });

    private persist(): void {
        try {
            this.storage.setItem(this.storageKey, JSON.stringify(this.snapshot));
        } catch {
            throw new Error('The AI session ledger could not be saved. Further demo execution is disabled.');
        }
    }

    /** Persist a lock before sending the buy request, so reloads cannot forget an in-flight order. */
    reservePurchase = (): void => {
        if (this.snapshot.openContractId !== null || this.snapshot.executionUncertain) {
            throw new Error('An earlier purchase is unresolved. No additional purchase is allowed.');
        }
        this.snapshot = { ...this.snapshot, executionUncertain: true };
        this.persist();
    };

    markPurchase = (contractId: number): void => {
        if (!Number.isInteger(contractId) || contractId <= 0) {
            throw new Error('Deriv returned an invalid contract ID. Execution is locked for reconciliation.');
        }
        if (this.snapshot.openContractId !== null || !this.snapshot.executionUncertain) {
            throw new Error('A persisted pre-buy reservation is required before recording a purchase.');
        }
        this.snapshot = { ...this.snapshot, openContractId: contractId, executionUncertain: false };
        this.persist();
    };

    markPurchaseUncertain = (): void => {
        this.snapshot = { ...this.snapshot, executionUncertain: true };
        this.persist();
    };

    recordSettlement = (contractId: number, profit: number): AISessionSnapshot => {
        if (
            this.snapshot.openContractId !== contractId ||
            !Number.isInteger(contractId) ||
            !Number.isFinite(profit)
        ) {
            throw new Error('Settlement does not match the recorded open contract. The AI remains locked.');
        }

        this.snapshot = {
            ...this.snapshot,
            sessionProfitLoss: this.snapshot.sessionProfitLoss + profit,
            consecutiveLosses: profit < 0 ? this.snapshot.consecutiveLosses + 1 : 0,
            settledTrades: this.snapshot.settledTrades + 1,
            openContractId: null,
            lastContractId: contractId,
            lastContractProfit: profit,
        };
        this.persist();
        return this.getSnapshot();
    };
}
