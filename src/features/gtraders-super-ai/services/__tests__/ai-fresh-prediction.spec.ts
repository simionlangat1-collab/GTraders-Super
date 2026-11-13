import { evaluateFreshMarketPredictions } from '../ai-prediction-engine';

const timestamps = (count: number) => Array.from({ length: count }, (_, index) => 1_700_000_000 + index);

describe('evaluateFreshMarketPredictions', () => {
    it('recalculates from each supplied fresh tick sequence and never carries a prior prediction forward', () => {
        const market = {
            symbol: 'R_100',
            displayName: 'Volatility 100 Index',
            digitSequence: [...Array(300).fill(0), ...Array(200).fill(7)],
            tickTimestamps: timestamps(500),
            dataQuality: 100,
        };

        const firstScan = evaluateFreshMarketPredictions([market], {
            candidateWindows: [20, 30, 50, 75, 100],
            trainingFraction: 0.6,
            minimumMarketSample: 500,
            minimumDataQuality: 95,
        });
        expect(firstScan[0].prediction.decision).toBe('PREDICTION_CANDIDATE');
        expect(firstScan[0].prediction.predictedDigit).toBe(7);

        const changedMarket = {
            ...market,
            digitSequence: Array(500).fill(4),
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
