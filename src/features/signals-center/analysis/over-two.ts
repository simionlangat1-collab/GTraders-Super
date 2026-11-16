import { OverTwoAnalysis, SignalTick } from '../types';

export const DEFAULT_OVER_TWO_THRESHOLD = 75;
export const SIGNAL_TICK_WINDOW = 100;

/**
 * Analyses the latest 100 digits for an OVER 2 opportunity.
 * Digits 3-9 qualify. The threshold is configurable and expressed as a percentage.
 * Fewer than 100 valid ticks always produces WAIT.
 */
export const analyzeOverTwo = (
    inputTicks: SignalTick[],
    thresholdPercentage = DEFAULT_OVER_TWO_THRESHOLD
): OverTwoAnalysis => {
    if (!Number.isFinite(thresholdPercentage) || thresholdPercentage < 0 || thresholdPercentage > 100) {
        throw new Error('Threshold must be a percentage between 0 and 100.');
    }

    const validTicks = inputTicks
        .filter(tick => Number.isInteger(tick.digit) && tick.digit >= 0 && tick.digit <= 9)
        .slice(-SIGNAL_TICK_WINDOW);

    const digitFrequencies: Record<number, number> = {
        0: 0, 1: 0, 2: 0, 3: 0, 4: 0,
        5: 0, 6: 0, 7: 0, 8: 0, 9: 0,
    };

    validTicks.forEach(tick => {
        digitFrequencies[tick.digit] += 1;
    });

    const qualifyingDigits = Object.entries(digitFrequencies)
        .filter(([digit]) => Number(digit) >= 3)
        .reduce((total, [, count]) => total + count, 0);

    const sampleSize = validTicks.length;
    const qualifyingPercentage = sampleSize === SIGNAL_TICK_WINDOW
        ? (qualifyingDigits / sampleSize) * 100
        : 0;

    return {
        status: sampleSize === SIGNAL_TICK_WINDOW && qualifyingPercentage >= thresholdPercentage
            ? 'BUY_OVER_2'
            : 'WAIT',
        sampleSize,
        qualifyingDigits,
        qualifyingPercentage,
        thresholdPercentage,
        digitFrequencies,
    };
};
