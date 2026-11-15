import {
    AI_PREDICTION_RESEARCH_MODELS,
    evaluateAIPredictionCompetition,
    predictFirstOrderTransition,
    predictLastDigitPersistence,
    predictRecencyWeighted,
    predictRollingFrequency,
} from '../ai-prediction-models';

describe('shadow prediction models', () => {
    it('exposes exactly four separate research models', () => {
        expect(AI_PREDICTION_RESEARCH_MODELS.map(model => model.id)).toEqual([
            'rolling-frequency',
            'recency-weighted',
            'first-order-transition',
            'last-digit-persistence',
        ]);
    });

    it('returns the unique rolling-frequency leader and abstains on ties', () => {
        expect(predictRollingFrequency([...Array(15).fill(3), ...Array(5).fill(1)], {
            minimumHistory: 10,
            windowSize: 20,
        })).toBe(3);
        expect(predictRollingFrequency([...Array(10).fill(3), ...Array(10).fill(1)], {
            minimumHistory: 10,
            windowSize: 20,
        })).toBeNull();
    });

    it('weights recent observations more heavily than older observations', () => {
        const history = [...Array(15).fill(2), ...Array(5).fill(7)];
        expect(predictRollingFrequency(history, { minimumHistory: 10 })).toBe(2);
        expect(predictRecencyWeighted(history, {
            minimumHistory: 10,
            recencyDecay: 0.5,
        })).toBe(7);
    });

    it('uses only transitions following the current final digit', () => {
        const history = [1, 4, 1, 4, 1, 7, 1, 4, 1, 4, 1, 4, 1, 4, 1, 4, 1, 4, 1, 4];
        expect(predictFirstOrderTransition(history, { minimumHistory: 10 })).toBe(1);
    });

    it('returns the last observed digit for persistence', () => {
        expect(predictLastDigitPersistence([...Array(19).fill(2), 8])).toBe(8);
    });

    it('rejects invalid digits and insufficient history consistently', () => {
        expect(predictRollingFrequency([1, 2, 10])).toBeNull();
        expect(predictRecencyWeighted([1, 2, 3])).toBeNull();
        expect(predictFirstOrderTransition([1, 2, 3])).toBeNull();
        expect(predictLastDigitPersistence([1, 2, 3])).toBeNull();
    });
});

const seededRandomDigits = (length: number, seed = 123456789): number[] => {
    let state = seed >>> 0;
    return Array.from({ length }, () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return (state >>> 16) % 10;
    });
};

describe('Phase 3 synthetic validation', () => {
    it('recognizes a planted repeating transition without using future ticks', () => {
        const digits = Array.from({ length: 300 }, (_, index) => index % 10);
        const result = evaluateAIPredictionCompetition(digits, {
            warmupTicks: 100,
            minimumHistory: 20,
            windowSize: 100,
            foldCount: 4,
        });
        const transition = result.scores.find(score => score.modelId === 'first-order-transition')!;
        expect(transition.observations).toBe(200);
        expect(transition.coverage).toBe(1);
        expect(transition.accuracy).toBe(1);
        expect(result.decision).toBe('RESEARCH_ONLY');
    });

    it('does not report a convincing edge on seeded IID-like random digits', () => {
        const digits = seededRandomDigits(2100);
        const result = evaluateAIPredictionCompetition(digits, {
            warmupTicks: 100,
            minimumHistory: 20,
            windowSize: 100,
            foldCount: 4,
        });
        expect(result.evaluatedTicks).toBe(2000);
        result.scores.forEach(score => {
            expect(score.observations).toBe(2000);
            expect(score.accuracy).toBeLessThan(0.2);
            expect(score.folds.every(fold => fold.observations > 0)).toBe(true);
        });
    });

    it('uses the configured recent window for transition evidence', () => {
        const history = [
            ...Array.from({ length: 20 }, () => [8, 1]).flat(),
            ...Array.from({ length: 20 }, () => [8, 9]).flat(),
            8,
        ];
        expect(predictFirstOrderTransition(history, {
            minimumHistory: 10,
            windowSize: 10,
        })).toBe(9);
        expect(predictFirstOrderTransition(history, {
            minimumHistory: 10,
            windowSize: 100,
        })).toBeNull();
    });

    it('keeps all model comparisons aligned across folds and window settings', () => {
        const digits = seededRandomDigits(900, 987654321);
        [20, 50, 100].forEach(windowSize => {
            const result = evaluateAIPredictionCompetition(digits, {
                warmupTicks: 100,
                minimumHistory: 20,
                windowSize,
                foldCount: 5,
            });
            expect(result.scores).toHaveLength(4);
            result.scores.forEach(score => {
                expect(score.observations).toBe(800);
                expect(score.folds.map(fold => fold.observations).reduce((a, b) => a + b, 0)).toBe(800);
                expect(score.predictions + score.abstentions).toBe(800);
            });
        });
    });
});

describe('evaluateAIPredictionCompetition', () => {
    it('scores all models on the same chronological ticks without future leakage', () => {
        const digits = Array.from({ length: 180 }, (_, index) => index < 100
            ? index % 10
            : (index % 3 === 0 ? 7 : index % 10));
        const result = evaluateAIPredictionCompetition(digits, {
            warmupTicks: 100,
            minimumHistory: 20,
            windowSize: 40,
            foldCount: 4,
        });

        expect(result.decision).toBe('RESEARCH_ONLY');
        expect(result.warmupTicks).toBe(100);
        expect(result.evaluatedTicks).toBe(80);
        expect(result.foldCount).toBe(4);
        expect(result.scores).toHaveLength(4);
        result.scores.forEach(score => {
            expect(score.observations).toBe(80);
            expect(score.folds).toHaveLength(4);
            expect(score.folds.reduce((sum, fold) => sum + fold.observations, 0)).toBe(80);
            expect(score.correct).toBeLessThanOrEqual(score.predictions);
            expect(score.predictions + score.abstentions).toBe(80);
            expect(score.accuracy).toBe(score.correct / 80);
        });
    });

    it('counts transition-model abstentions as incorrect instead of inflating accuracy', () => {
        const digits = [
            ...Array(19).fill(4),
            9, 8, 7, 6, 5, 3, 2, 1, 0,
            9, 8, 7, 6, 5, 3, 2, 1, 0,
        ];
        const result = evaluateAIPredictionCompetition(digits, {
            warmupTicks: 20,
            minimumHistory: 20,
            foldCount: 2,
        });
        const transition = result.scores.find(score => score.modelId === 'first-order-transition')!;
        expect(transition.abstentions).toBeGreaterThan(0);
        expect(transition.predictions + transition.abstentions).toBe(result.evaluatedTicks);
        expect(transition.accuracy).toBe(transition.correct / result.evaluatedTicks);
    });

    it('fails closed on malformed history', () => {
        const result = evaluateAIPredictionCompetition([1, 2, 10, 3]);
        expect(result.decision).toBe('RESEARCH_ONLY');
        expect(result.evaluatedTicks).toBe(0);
        expect(result.scores.every(score => score.accuracy === 0)).toBe(true);
        expect(result.explanation).toContain('Invalid digit history');
    });
});
