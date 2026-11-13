export interface AIRiskSettings {
    stake: number;
    targetProfit: number;
    stopLoss: number;
    maxConsecutiveLosses: number;
    maxStakePercentOfBalance?: number;
}

export interface AIRiskSnapshot {
    balance: number;
    sessionProfitLoss: number;
    consecutiveLosses: number;
}

export type AIRiskStopReason =
    | 'INVALID_RISK_SETTINGS'
    | 'INVALID_ACCOUNT_SNAPSHOT'
    | 'STAKE_EXCEEDS_BALANCE'
    | 'STAKE_EXCEEDS_BALANCE_LIMIT'
    | 'TARGET_PROFIT_REACHED'
    | 'STOP_LOSS_REACHED'
    | 'CONSECUTIVE_LOSS_LIMIT_REACHED';

export interface AIRiskAssessment {
    allowed: boolean;
    reasons: AIRiskStopReason[];
    remainingProfitTarget: number;
    remainingLossAllowance: number;
    explanation: string;
}

/**
 * Pure pre-trade/session risk guard. It never places orders and never increases
 * stake after a loss. A rejected assessment must stop the execution layer.
 */
export const assessAIRisk = (
    settings: AIRiskSettings,
    snapshot: AIRiskSnapshot
): AIRiskAssessment => {
    const reasons: AIRiskStopReason[] = [];
    const maxStakePercent = settings.maxStakePercentOfBalance ?? 2;

    const settingsAreValid =
        Number.isFinite(settings.stake) &&
        Number.isFinite(settings.targetProfit) &&
        Number.isFinite(settings.stopLoss) &&
        Number.isInteger(settings.maxConsecutiveLosses) &&
        Number.isFinite(maxStakePercent) &&
        settings.stake > 0 &&
        settings.targetProfit > 0 &&
        settings.stopLoss > 0 &&
        settings.maxConsecutiveLosses > 0 &&
        maxStakePercent > 0 &&
        maxStakePercent <= 100;

    if (!settingsAreValid) reasons.push('INVALID_RISK_SETTINGS');

    if (
        !Number.isFinite(snapshot.balance) ||
        !Number.isFinite(snapshot.sessionProfitLoss) ||
        !Number.isInteger(snapshot.consecutiveLosses) ||
        snapshot.balance <= 0 ||
        snapshot.consecutiveLosses < 0
    ) {
        reasons.push('INVALID_ACCOUNT_SNAPSHOT');
    }

    if (settingsAreValid && Number.isFinite(snapshot.balance) && snapshot.balance > 0) {
        if (settings.stake > snapshot.balance) {
            reasons.push('STAKE_EXCEEDS_BALANCE');
        }

        if (settings.stake > (snapshot.balance * maxStakePercent) / 100) {
            reasons.push('STAKE_EXCEEDS_BALANCE_LIMIT');
        }
    }

    if (settingsAreValid && Number.isFinite(snapshot.sessionProfitLoss)) {
        if (snapshot.sessionProfitLoss >= settings.targetProfit) {
            reasons.push('TARGET_PROFIT_REACHED');
        }

        if (snapshot.sessionProfitLoss <= -settings.stopLoss) {
            reasons.push('STOP_LOSS_REACHED');
        }
    }

    if (
        settingsAreValid &&
        Number.isInteger(snapshot.consecutiveLosses) &&
        snapshot.consecutiveLosses >= settings.maxConsecutiveLosses
    ) {
        reasons.push('CONSECUTIVE_LOSS_LIMIT_REACHED');
    }

    const remainingProfitTarget = Math.max(
        0,
        settings.targetProfit - (Number.isFinite(snapshot.sessionProfitLoss) ? snapshot.sessionProfitLoss : 0)
    );
    const remainingLossAllowance = Math.max(
        0,
        settings.stopLoss + (Number.isFinite(snapshot.sessionProfitLoss) ? snapshot.sessionProfitLoss : 0)
    );

    return {
        allowed: reasons.length === 0,
        reasons,
        remainingProfitTarget,
        remainingLossAllowance,
        explanation:
            reasons.length === 0
                ? 'Risk checks passed for this moment only. Recheck before every trade; this is not a prediction or a guarantee.'
                : `TRADING BLOCKED — ${reasons.join(', ')}. The AI must stop and must not increase stake to recover losses.`,
    };
};
