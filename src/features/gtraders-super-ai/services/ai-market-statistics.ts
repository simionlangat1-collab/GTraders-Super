export interface DigitFrequency {
    digit: number;
    count: number;
    percentage: number;
    expectedPercentage: number;
    confidenceLow: number;
    confidenceHigh: number;
}

export interface DigitWindowAnalysis {
    windowSize: number;
    sampleSize: number;
    frequencies: DigitFrequency[];
}

export interface AIMarketStatistics {
    sampleSize: number;
    frequencies: DigitFrequency[];
    chiSquareStatistic: number | null;
    maxAbsoluteDeviation: number;
    mostObservedDigit: number | null;
    leastObservedDigit: number | null;
    sufficientSample: boolean;
    rollingWindows: DigitWindowAnalysis[];
    interpretation: string;
}

const DIGIT_COUNT = 10;
const MINIMUM_SAMPLE = 100;

const wilsonInterval = (successes: number, sampleSize: number): [number, number] => {
    if (sampleSize <= 0) return [0, 0];

    // 95% Wilson score interval; z = 1.96.
    const z = 1.96;
    const proportion = successes / sampleSize;
    const zSquared = z * z;
    const denominator = 1 + zSquared / sampleSize;
    const centre = (proportion + zSquared / (2 * sampleSize)) / denominator;
    const margin =
        (z *
            Math.sqrt(
                (proportion * (1 - proportion)) / sampleSize +
                    zSquared / (4 * sampleSize * sampleSize)
            )) /
        denominator;

    return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
};

const countDigits = (digits: number[]): number[] => {
    const counts = Array<number>(DIGIT_COUNT).fill(0);
    digits.forEach(digit => {
        if (Number.isInteger(digit) && digit >= 0 && digit < DIGIT_COUNT) {
            counts[digit] += 1;
        }
    });
    return counts;
};

const analyseWindow = (digits: number[], windowSize: number): DigitWindowAnalysis => {
    const sample = digits.slice(-windowSize);
    const counts = countDigits(sample);
    const sampleSize = sample.length;

    return {
        windowSize,
        sampleSize,
        frequencies: counts.map((count, digit) => {
            const [low, high] = wilsonInterval(count, sampleSize);
            return {
                digit,
                count,
                percentage: sampleSize ? (count / sampleSize) * 100 : 0,
                expectedPercentage: 10,
                confidenceLow: low * 100,
                confidenceHigh: high * 100,
            };
        }),
    };
};

/**
 * Describes historical last-digit frequencies. It deliberately does not
 * estimate the probability of the next digit or produce a trade signal.
 */
export const analyseMarketDigits = (input: number[]): AIMarketStatistics => {
    const digits = input.filter(
        digit => Number.isInteger(digit) && digit >= 0 && digit < DIGIT_COUNT
    );
    const sampleSize = digits.length;
    const counts = countDigits(digits);
    const frequencies = counts.map((count, digit) => {
        const [low, high] = wilsonInterval(count, sampleSize);
        return {
            digit,
            count,
            percentage: sampleSize ? (count / sampleSize) * 100 : 0,
            expectedPercentage: 10,
            confidenceLow: low * 100,
            confidenceHigh: high * 100,
        };
    });

    const chiSquareStatistic =
        sampleSize > 0
            ? counts.reduce((sum, count) => {
                  const expected = sampleSize / DIGIT_COUNT;
                  return sum + Math.pow(count - expected, 2) / expected;
              }, 0)
            : null;

    const ordered = [...frequencies].sort((a, b) => b.count - a.count);
    const maxAbsoluteDeviation = frequencies.reduce(
        (maximum, item) => Math.max(maximum, Math.abs(item.percentage - 10)),
        0
    );
    const rollingWindows = [50, 100, 250]
        .filter(size => sampleSize >= size)
        .map(size => analyseWindow(digits, size));

    return {
        sampleSize,
        frequencies,
        chiSquareStatistic,
        maxAbsoluteDeviation,
        mostObservedDigit: sampleSize ? ordered[0].digit : null,
        leastObservedDigit: sampleSize ? ordered[ordered.length - 1].digit : null,
        sufficientSample: sampleSize >= MINIMUM_SAMPLE,
        rollingWindows,
        interpretation:
            sampleSize < MINIMUM_SAMPLE
                ? `Descriptive sample only: ${sampleSize} observations. At least ${MINIMUM_SAMPLE} valid ticks are required for the minimum statistical review.`
                : 'Historical frequencies only. Confidence intervals describe observed proportions; they are not next-tick probabilities or trade confidence.',
    };
};
