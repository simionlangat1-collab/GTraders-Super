import { evaluateFreshMarketPredictions } from '../ai-prediction-engine';

const timestamps = (count: number) => Array.from({ length: count }, (_, index) => 1_700_000_000 + index);

/** Deterministic regime changes with independent within-regime noise.
 * The initial zero-dominated history keeps the full-history baseline distinct;
 * the recent 20-tick mode can adapt to each new regime.
 */
const makePredictiveDigits = (count: number): number[] => {
    const digits = Array<number>(Math.min(1500, count)).fill(0);
    let state = 0x5eed;
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };

    for (let index = digits.length; index < count; index += 1) {
        const regimeDigit = (Math.floor((index - 1500) / 100) % 9) + 1;
        if (random() < 0.9) {
            digits.push(regimeDigit);
        } else {
            const offset = Math.floor(random() * 8) + 1;
            digits.push(((regimeDigit - 1 + offset) % 9) + 1);
        }
    }
    return digits;
};

describe('evaluateFreshMarketPredictions', () => {
    it('recalculates from each supplied fresh tick sequence and never carries a prior prediction forward', () => {
        const market = {
            symbol: 'R_100',
            displayName: 'Volatility 100 Index',
            digitSequence: makePredictiveDigits(5000),
            tickTimestamps: timestamps(5000),
            dataQuality: 100,
        };

        const firstScan = evaluateFreshMarketPredictions([market], {
            candidateWindows: [20, 30, 50, 75, 100],
            trainingFraction: 0.6,
            minimumMarketSample: 500,
            minimumDataQuality: 95,
        });
        expect(firstScan[0].prediction.decision).toBe('PREDICTION_CANDIDATE');
        expect(firstScan[0].prediction.predictedDigit).not.toBeNull();
        expect(firstScan[0].prediction.validationPassed).toBe(true);

        const changedMarket = {
            ...market,
            digitSequence: Array(5000).fill(4),
        };
        const secondScan = evaluateFreshMarketPredictions([changedMarket], {
            candidateWindows: [20, 30, 50, 75, 100],
            trainingFraction: 0.6,
            minimumMarketSample: 500,
            minimumDataQuality: 95,
        });

        expect(secondScan[0].prediction.decision).toBe('NO_TRADE');
        expect(secondScan[0].prediction.predictedDigit).toBeNull();
        expect(secondScan[0].prediction.validationPassed).toBe(false);
        expect(secondScan[0].prediction.rejectionReasons).toContain('PAIRED_TEST_NOT_SIGNIFICANT');
    });

    it('returns no trade for a current market with insufficient fresh data', () => {
        const result = evaluateFreshMarketPredictions([{
            symbol: 'R_50',
            digitSequence: Array(120).fill(2),
            tickTimestamps: timestamps(120),
            dataQuality: 100,
        }]);

        expect(result[0].prediction.decision).toBe('NO_TRADE');
        expect(result[0].prediction.predictedDigit).toBeNull();
    });
});
