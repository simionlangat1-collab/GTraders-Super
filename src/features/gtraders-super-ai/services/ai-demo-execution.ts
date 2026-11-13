import { evaluateAIFinalPreBuyGate, AIFinalPreBuyInput, AIFinalPreBuyResult } from './ai-final-pre-buy-guard';

export interface AIContractSettlement {
    contractId: number;
    profit: number;
    status: string;
    isSold: boolean;
}

export interface AIDemoExecutionDependencies {
    request: (payload: Record<string, unknown>) => Promise<unknown>;
    waitForSettlement: (contractId: number) => Promise<AIContractSettlement>;
    onPurchaseIntent: () => void;
    onPurchased: (contractId: number) => void;
    onPurchaseUncertain: () => void;
}

export type AIDemoExecutionResult =
    | { status: 'BLOCKED'; gate: AIFinalPreBuyResult }
    | { status: 'EXECUTION_ABORTED'; message: string }
    | { status: 'PURCHASE_UNCERTAIN'; message: string }
    | { status: 'SETTLEMENT_PENDING'; contractId: number; message: string }
    | { status: 'SETTLED'; contractId: number; profit: number; settlementStatus: string; gate: AIFinalPreBuyResult };

/**
 * Executes exactly one explicitly confirmed demo purchase. A persisted local
 * reservation is written before the buy request. The buy is never retried:
 * uncertain outcomes lock the session for manual reconciliation.
 */
export const executeAIDemoTrade = async (
    gateInput: AIFinalPreBuyInput,
    dependencies: AIDemoExecutionDependencies
): Promise<AIDemoExecutionResult> => {
    const gate = evaluateAIFinalPreBuyGate(gateInput);
    if (!gate.allowed || !gateInput.proposal) return { status: 'BLOCKED', gate };

    try {
        dependencies.onPurchaseIntent();
    } catch {
        return {
            status: 'EXECUTION_ABORTED',
            message: 'The pre-buy safety reservation could not be saved. The buy request was NOT sent.',
        };
    }

    let buyResponse: unknown;
    try {
        buyResponse = await dependencies.request({
            buy: gateInput.proposal.id,
            price: gateInput.proposal.askPrice,
        });
    } catch {
        try { dependencies.onPurchaseUncertain(); } catch { /* Fail closed even if local persistence fails. */ }
        return {
            status: 'PURCHASE_UNCERTAIN',
            message: 'Deriv did not confirm the purchase response. It will NOT be retried. Check the Deriv account before taking any further action.',
        };
    }

    const buy = (buyResponse as { buy?: { contract_id?: number | string } } | null)?.buy;
    const contractId = Number(buy?.contract_id);
    if (!Number.isInteger(contractId) || contractId <= 0) {
        try { dependencies.onPurchaseUncertain(); } catch { /* Fail closed even if local persistence fails. */ }
        return {
            status: 'PURCHASE_UNCERTAIN',
            message: 'The buy response did not contain a verifiable contract ID. No retry will be attempted; reconcile the Deriv account first.',
        };
    }

    try {
        dependencies.onPurchased(contractId);
    } catch {
        try { dependencies.onPurchaseUncertain(); } catch { /* Fail closed. */ }
        return {
            status: 'SETTLEMENT_PENDING',
            contractId,
            message: 'Deriv returned a contract ID, but the local ledger could not record it. Do not trade again; reconcile this contract in Deriv.',
        };
    }

    try {
        const settlement = await dependencies.waitForSettlement(contractId);
        if (
            settlement.contractId !== contractId ||
            !settlement.isSold ||
            !Number.isFinite(settlement.profit) ||
            !['won', 'lost', 'sold'].includes(settlement.status.toLowerCase())
        ) {
            throw new Error('Deriv has not supplied a verified final settlement.');
        }
        return {
            status: 'SETTLED',
            contractId,
            profit: settlement.profit,
            settlementStatus: settlement.status,
            gate,
        };
    } catch {
        return {
            status: 'SETTLEMENT_PENDING',
            contractId,
            message: 'The demo purchase was accepted, but final settlement is not yet verified. The AI is locked against another purchase until this contract is reconciled.',
        };
    }
};
