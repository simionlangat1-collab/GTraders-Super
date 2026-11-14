import { generateAIPrediction } from '../ai-prediction-engine';

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

describe('generateAIPrediction', () => {
    it('defaults to NO TRADE when the sample is too small', () => {
        const result = generateAIPrediction(Array(120).fill(7), 100, {}, timestamps(120));
        expect(result.decision).toBe('NO_TRADE');
        expect(result.predictedDigit).toBeNull();
        expect(result.explanation).toContain('NO TRADE');
    });

    it('rejects poor data quality even when a pattern looks strong', () => {
        const result = generateAIPrediction(Array(600).fill(7), 80, {}, timestamps(600));
        expect(result.decision).toBe('NO_TRADE');
        expect(result.validationPassed).toBe(false);
    });

    it('rejects invalid digits rather than silently training on a partial sequence', () => {
        const digits = [...Array(300).fill(0), ...Array(200).fill(7)];
        digits[10] = 12;
        const result = generateAIPrediction(digits, 100, {}, timestamps(500));
        expect(result.decision).toBe('NO_TRADE');
        expect(result.predictedDigit).toBeNull();
    });

    it('selects a window across three chronological training folds before the untouched holdout', () => {
        const digits = makePredictiveDigits(5000);
        const result = generateAIPrediction(digits, 100, {
            candidateWindows: [20, 30, 50, 75, 100],
        }, timestamps(digits.length));

        expect(result.trainingSampleSize).toBe(3000);
        expect(result.holdoutSampleSize).toBe(2000);
        expect(result.windowSelectionFoldCount).toBe(3);
        expect(result.selectedWindow).toBe(20);
        expect(result.windowSelectionWinShare).toBe(1);
        expect(result.windowSelectionStable).toBe(true);
        expect(result.windowSelectionLeadMargin).toBeGreaterThan(0.02);
        expect(result.windowSelectionAccuracyRange).toBeLessThanOrEqual(0.12);
        expect(result.windowSelectionSummary).toContain('required >2.00 pp');
        expect(result.windowSelectionSummary).toContain('maximum 12.0 pp');
        expect(result.windowSelectionSummary).toContain('fold winners');
        expect(result.windowSelectionDiagnostics).toHaveLength(5);
        expect(result.windowSelectionDiagnostics.every(item => item.foldAccuracies.length === 3)).toBe(true);
        expect(result.windowSelectionDiagnostics.reduce((sum, item) => sum + item.foldWins, 0)).toBe(3);
        expect(result.modelWinRate).toBeGreaterThan(result.baselineWinRate);
        expect(result.validationPassed).toBe(true);
        expect(result.effectiveSampleSize).toBeGreaterThanOrEqual(200);
        expect(result.accuracyEffectiveSampleSize).toBeGreaterThanOrEqual(200);
        expect(result.rejectionReasons).toEqual([]);
        expect(result.modelWins).toBeGreaterThan(result.baselineWins);
        expect(result.modelOnlyCorrect).toBeGreaterThan(result.baselineOnlyCorrect);
        expect(result.pairedPValue).toBeLessThan(0.001);
        expect(result.adjustedPairedPValue).toBeLessThan(0.05);
        expect(result.rejectedObservations).toBe(0);
        expect(result.decision).toBe('PREDICTION_CANDIDATE');
        expect(result.predictedDigit).not.toBeNull();
        expect(result.explanation).toContain('stable chronological training folds');
        expect(result.explanation).toContain('does not authorize an order');
    });

    it('rejects a highly clustered holdout even when its raw win count looks strong', () => {
        const digits = [...Array(300).fill(0), ...Array(200).fill(7)];
        const result = generateAIPrediction(digits, 100, {
            // A single pre-declared candidate isolates the dependence gate;
            // window ambiguity is tested separately below.
            candidateWindows: [20],
        }, timestamps(500));

        expect(result.windowSelectionStable).toBe(true);
        expect(result.holdoutEvaluated).toBe(true);
        expect(result.modelWins).toBeGreaterThan(180);
        expect(result.effectiveSampleSize).toBeLessThan(200);
        expect(result.validationPassed).toBe(false);
        expect(result.decision).toBe('NO_TRADE');
        expect(result.rejectionReasons).toContain('DEPENDENCE_ADJUSTED_SAMPLE_BELOW_MINIMUM');
    });

    it('rejects a window whose fold performance varies beyond the stability limit', () => {
        const alternating = Array.from({ length: 100 }, (_, index) => index % 2);
        const digits = [
            ...Array(200).fill(0),
            ...alternating.slice(0, 50),
            ...alternating.slice(50),
            ...Array(200).fill(7),
        ];
        const result = generateAIPrediction(digits, 100, {
            candidateWindows: [20, 30],
        }, timestamps(500));

        expect(result.decision).toBe('NO_TRADE');
        expect(result.validationPassed).toBe(false);
        expect(result.selectedWindow).toBe(20);
        expect(result.windowSelectionFoldCount).toBe(3);
        expect(result.windowSelectionAccuracyStdDev).toBeGreaterThan(0);
        expect(result.windowSelectionStable).toBe(false);
        expect(result.rejectionReasons).toContain('WINDOW_SELECTION_UNSTABLE');
        expect(result.holdoutEvaluated).toBe(false);
        expect(result.modelWins).toBe(0);
        expect(result.pairedPValue).toBe(1);
        expect(result.windowSelectionDiagnostics).toHaveLength(2);
        expect(result.windowSelectionDiagnostics[0].foldAccuracies).toHaveLength(3);
        expect(result.explanation).toContain('selection was unstable');
        expect(result.explanation).toContain('stability FAILED');
    });

    it('rejects a two-of-three fold winner when its aggregate lead is still ambiguous', () => {
        let state = 3;
        const random = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        };
        const training = Array.from({ length: 150 }, () => Math.floor(random() * 10));
        const foldPersistence = [0.85, 0.35, 0.85];

        for (let fold = 0; fold < 3; fold += 1) {
            for (let index = 0; index < 50; index += 1) {
                if (index > 0 && random() < foldPersistence[fold]) {
                    training.push(training[training.length - 1]);
                } else {
                    training.push(Math.floor(random() * 10));
                }
            }
        }

        const result = generateAIPrediction(
            [...training, ...Array(200).fill(7)],
            100,
            { candidateWindows: [20, 30] },
            timestamps(500)
        );

        expect(result.selectedWindow).toBe(20);
        expect(result.windowSelectionWinShare).toBeCloseTo(2 / 3, 10);
        expect(result.windowSelectionLeadMargin).toBeCloseTo(0, 10);
        expect(result.windowSelectionAccuracyRange).toBeGreaterThan(0.12);
        expect(result.windowSelectionStable).toBe(false);
        expect(result.rejectionReasons).toContain('WINDOW_SELECTION_UNSTABLE');
        expect(result.windowSelectionSummary).toContain('selected 20-tick window won 2/3 folds');
        expect(result.windowSelectionSummary).toContain('lead over runner-up 0.00 pp');
    });

    it('keeps window selection completely unchanged when only holdout observations change', () => {
        const training = Array(300).fill(0);
        const first = generateAIPrediction([...training, ...Array(200).fill(7)], 100, {
            candidateWindows: [20, 30, 50],
        }, timestamps(500));
        const second = generateAIPrediction([...training, ...Array(200).fill(9)], 100, {
            candidateWindows: [20, 30, 50],
        }, timestamps(500));

        expect(first.selectedWindow).toBe(second.selectedWindow);
        expect(first.windowSelectionSummary).toBe(second.windowSelectionSummary);
        expect(first.windowSelectionWinShare).toBe(second.windowSelectionWinShare);
        expect(first.windowSelectionAccuracyStdDev).toBe(second.windowSelectionAccuracyStdDev);
        expect(first.windowSelectionDiagnostics).toEqual(second.windowSelectionDiagnostics);
    });

    it('breaks exact fold-score ties deterministically in favour of the shorter window', () => {
        const result = generateAIPrediction(Array(500).fill(4), 100, {
            candidateWindows: [50, 20, 30],
        }, timestamps(500));

        expect(result.selectedWindow).toBe(20);
        expect(result.windowSelectionFoldCount).toBe(3);
        expect(result.windowSelectionWinShare).toBe(1);
        expect(result.windowSelectionStable).toBe(false);
        expect(result.windowSelectionLeadMargin).toBe(0);
        expect(result.rejectionReasons).toContain('WINDOW_SELECTION_UNSTABLE');
        expect(result.windowSelectionDiagnostics.map(item => item.window)).toEqual([20, 30, 50]);
        expect(result.windowSelectionDiagnostics.map(item => item.foldWins)).toEqual([3, 0, 0]);
        expect(result.decision).toBe('NO_TRADE');
        expect(result.validationPassed).toBe(false);
    });

    it('rejects a holdout tick sharing the final training timestamp instead of treating it as later evidence', () => {
        const tickTimes = timestamps(500);
        tickTimes[300] = tickTimes[299];

        const result = generateAIPrediction(
            [...Array(300).fill(0), ...Array(200).fill(7)],
            100,
            { candidateWindows: [20, 30, 50] },
            tickTimes
        );

        expect(result.windowSelectionStable).toBe(true);
        expect(result.selectedWindow).toBe(20);
        expect(result.decision).toBe('NO_TRADE');
        expect(result.validationPassed).toBe(false);
        expect(result.explanation).toContain('199 clean settled holdout observations were accepted and 1 rejected');
        expect(result.rejectionReasons).toContain('INVALID_HOLDOUT_OBSERVATIONS');
        expect(result.rejectedObservations).toBe(1);
    });

    it('does not claim a statistical edge when candidate matches the baseline', () => {
        const result = generateAIPrediction(Array(500).fill(4), 100, {}, timestamps(500));
        expect(result.decision).toBe('NO_TRADE');
        expect(result.validationPassed).toBe(false);
        expect(result.holdoutEvaluated).toBe(true);
        expect(result.predictedDigit).toBeNull();
    });

    it('requires real aligned timestamps before validating a candidate', () => {
        const result = generateAIPrediction([...Array(300).fill(0), ...Array(200).fill(7)], 100);
        expect(result.decision).toBe('NO_TRADE');
        expect(result.explanation).toContain('timestamps');
    });

    it('detects lag-2 dependence even when lag-1 dependence looks harmless', () => {
        const training = [...Array(1500).fill(0), ...Array(1500).fill(1)];
        const holdout = Array.from({ length: 2000 }, (_, index) => {
            if (index % 2 === 0) return 1;
            const dependenceBlock = Math.floor((index / 2) / 50);
            return dependenceBlock % 10 < 7 ? 1 : 0;
        });

        const result = generateAIPrediction(
            [...training, ...holdout],
            100,
            { candidateWindows: [20, 30, 50, 75, 100] },
            timestamps(5000)
        );

        expect(result.holdoutEvaluated).toBe(true);
        // This adversarial fixture targets the dependence guard itself. The
        // generated model need not beat the baseline for the safety gate to
        // demonstrate that its lag-2 clustered evidence is not independent.
        expect(result.lagOneCorrelation).toBeLessThan(0);
        expect(result.effectiveSampleSize).toBeLessThan(200);
        expect(result.validationPassed).toBe(false);
        expect(result.decision).toBe('NO_TRADE');
        expect(result.rejectionReasons).toContain('DEPENDENCE_ADJUSTED_SAMPLE_BELOW_MINIMUM');
        expect(result.explanation).toContain('dependence');
    });

});
