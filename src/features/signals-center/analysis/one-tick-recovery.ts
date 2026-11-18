import { SignalTick } from '../types';

export type RecoveryDigitStats = {
    digit: 0 | 1 | 2;
    observedTouches: number;
    immediateWinningTicks: number;
    immediateRecoveryPercentage: number;
};

export type OneTickRecoveryAnalysis = {
    sampleSize: number;
    completedRecoveryRuns: number;
    oneTouchRuns: number;
    multiTouchRuns: number;
    oneTouchRunPercentage: number;
    multiTouchRunPercentage: number;
    losingTouchesWithNextTick: number;
    immediateWinningTicks: number;
    immediateRecoveryPercentage: number;
    byLosingDigit: Record<0 | 1 | 2, RecoveryDigitStats>;
};

/**
 * Measures observed digit movement only; it never predicts or places trades.
 *
 * A recovery run is a consecutive sequence of losing-zone digits (0-2)
 * followed by a winning-zone digit (3-9). Exactly one losing digit is a
 * one-touch recovery; two or more are multi-touch recoveries.
 *
 * Immediate recovery percentages are calculated separately for each losing
 * digit using every occurrence that has a following tick in the sample.
 */
export const analyzeOneTickRecovery = (inputTicks: SignalTick[]): OneTickRecoveryAnalysis => {
    const ticks = inputTicks.filter(tick => Number.isInteger(tick.digit) && tick.digit >= 0 && tick.digit <= 9);
    const byLosingDigit: Record<0 | 1 | 2, RecoveryDigitStats> = {
        0: { digit: 0, observedTouches: 0, immediateWinningTicks: 0, immediateRecoveryPercentage: 0 },
        1: { digit: 1, observedTouches: 0, immediateWinningTicks: 0, immediateRecoveryPercentage: 0 },
        2: { digit: 2, observedTouches: 0, immediateWinningTicks: 0, immediateRecoveryPercentage: 0 },
    };

    let losingTouchesWithNextTick = 0;
    let immediateWinningTicks = 0;

    for (let index = 0; index < ticks.length - 1; index += 1) {
        const digit = ticks[index].digit;
        const nextDigit = ticks[index + 1].digit;
        if (digit <= 2) {
            losingTouchesWithNextTick += 1;
            byLosingDigit[digit as 0 | 1 | 2].observedTouches += 1;
            if (nextDigit >= 3) {
                immediateWinningTicks += 1;
                byLosingDigit[digit as 0 | 1 | 2].immediateWinningTicks += 1;
            }
        }
    }

    (Object.keys(byLosingDigit) as Array<'0' | '1' | '2'>).forEach(key => {
        const stats = byLosingDigit[Number(key) as 0 | 1 | 2];
        stats.immediateRecoveryPercentage = stats.observedTouches
            ? (stats.immediateWinningTicks / stats.observedTouches) * 100
            : 0;
    });

    let oneTouchRuns = 0;
    let multiTouchRuns = 0;
    let losingRunLength = 0;

    ticks.forEach(tick => {
        if (tick.digit <= 2) {
            losingRunLength += 1;
            return;
        }
        if (losingRunLength === 1) oneTouchRuns += 1;
        if (losingRunLength > 1) multiTouchRuns += 1;
        losingRunLength = 0;
    });

    const completedRecoveryRuns = oneTouchRuns + multiTouchRuns;

    return {
        sampleSize: ticks.length,
        completedRecoveryRuns,
        oneTouchRuns,
        multiTouchRuns,
        oneTouchRunPercentage: completedRecoveryRuns ? (oneTouchRuns / completedRecoveryRuns) * 100 : 0,
        multiTouchRunPercentage: completedRecoveryRuns ? (multiTouchRuns / completedRecoveryRuns) * 100 : 0,
        losingTouchesWithNextTick,
        immediateWinningTicks,
        immediateRecoveryPercentage: losingTouchesWithNextTick
            ? (immediateWinningTicks / losingTouchesWithNextTick) * 100
            : 0,
        byLosingDigit,
    };
};
