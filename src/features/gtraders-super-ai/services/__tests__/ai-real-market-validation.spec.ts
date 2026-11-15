import { evaluateAIRealMarketHistory } from '../ai-real-market-validation';
import type { AIMarketHistory } from '../ai-market-scanner';

const makeHistory = (
    digits: number[],
    options: { dataQuality?: number; timestampStep?: number } = {}
): Pick<AIMarketHistory, 'symbol' | 'displayName' | 'ticks' | 'digitSequence' | 'tickTimes' | 'dataQuality'> => ({
    symbol: '1HZ100V',
    displayName: 'Volatility 100 (1s) Index',
    ticks: digits.length,
    digitSequence: digits,
    tickTimes: digits.map((_, index) => 1_800_000_000 + index * (options.timestampStep ?? 1)),
    dataQuality: options.dataQuality ?? 100,
});

describe('Phase 4 real-market chronological validation', () => {
    it('evaluates four models on the same unseen chronological holdout', () => {
        const digits = Array.from({ length: 1000 }, (_, index) => index % 10);
        const report = evaluateAIRealMarketHistory(makeHistory(digits), {
            minimumHistory: 100,
            minimumHoldoutTicks: 200,
        });

        expect(report.decision).toBe('RESEARCH_ONLY');
        expect(report.trainingTicks).toBe(600);
        expect(report.holdoutTicks).toBe(400);
        expect(report.trainingCutoffTimestamp).toBeLessThanOrEqual(report.firstHoldoutTimestamp);
        expect(report.scores).toHaveLength(4);
        report.scores.forEach(score => {
            expect(score.observations).toBe(400);
            expect(score.predictions + score.abstentions).toBe(400);
            expect(score.folds.reduce((sum, fold) => sum + fold.observations, 0)).toBe(400);
        });
    });

    it('rejects misaligned, invalid, or out-of-order real tick history', () => {
        const history = makeHistory(Array.from({ length: 600 }, (_, index) => index % 10));
        expect(evaluateAIRealMarketHistory({ ...history, tickTimes: history.tickTimes.slice(1) }).decision).toBe('NO_TRADE');
        const badDigits = [...history.digitSequence];
        badDigits[20] = 10;
        expect(evaluateAIRealMarketHistory({ ...history, digitSequence: badDigits }).decision).toBe('NO_TRADE');
        const badTimes = [...history.tickTimes];
        badTimes[30] = badTimes[29] - 1;
        expect(evaluateAIRealMarketHistory({ ...history, tickTimes: badTimes }).decision).toBe('NO_TRADE');
    });

    it('fails closed when data quality or sample depth is inadequate', () => {
        const digits = Array.from({ length: 600 }, (_, index) => index % 10);
        expect(evaluateAIRealMarketHistory(makeHistory(digits, { dataQuality: 94 })).decision).toBe('NO_TRADE');
        expect(evaluateAIRealMarketHistory(makeHistory(digits.slice(0, 300))).decision).toBe('NO_TRADE');
    });

    it('does not allow a research pass to become a trade authorization', () => {
        const digits = Array.from({ length: 1000 }, (_, index) => index % 10);
        const report = evaluateAIRealMarketHistory(makeHistory(digits));
        expect(report.decision).toBe('RESEARCH_ONLY');
        expect(report.explanation).toContain('not approved for live or demo trading');
    });
});
