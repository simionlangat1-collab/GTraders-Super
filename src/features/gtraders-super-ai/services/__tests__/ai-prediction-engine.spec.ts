import { generateAIPrediction } from '../ai-prediction-engine';

const timestamps = (count: number) => Array.from({ length: count }, (_, index) => 1_700_000_000 + index);

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
        const digits = [...Array(300).fill(0), ...Array(200).fill(7)];
        const result = generateAIPrediction(digits, 100, {
            candidateWindows: [20, 30, 50, 75, 100],
        }, timestamps(500));

        expect(result.trainingSampleSize).toBe(300);
        expect(result.holdoutSampleSize).toBe(200);
        expect(result.windowSelectionFoldCount).toBe(3);
        expect(result.selectedWindow).toBe(20);
        expect(result.windowSelectionWinShare).toBe(1);
        expect(result.windowSelectionAccuracyStdDev).toBe(0);
        expect(result.windowSelectionStable).toBe(true);
        expect(result.windowSelectionSummary).toContain('fold winners');
        expect(result.windowSelectionDiagnostics).toHaveLength(5);
        expect(result.windowSelectionDiagnostics.every(item => item.foldAccuracies.length === 3)).toBe(true);
        expect(result.windowSelectionDiagnostics.reduce((sum, item) => sum + item.foldWins, 0)).toBe(3);
        expect(result.modelWinRate).toBeGreaterThan(result.baselineWinRate);
        expect(result.validationPassed).toBe(true);
        expect(result.rejectionReasons).toEqual([]);
        expect(result.modelWins).toBe(180);
        expect(result.baselineWins).toBe(0);
        expect(result.modelOnlyCorrect).toBe(180);
        expect(result.baselineOnlyCorrect).toBe(0);
        expect(result.pairedPValue).toBeLessThan(0.001);
        expect(result.adjustedPairedPValue).toBeLessThan(0.05);
        expect(result.rejectedObservations).toBe(0);
        expect(result.decision).toBe('PREDICTION_CANDIDATE');
        expect(result.predictedDigit).toBe(7);
        expect(result.explanation).toContain('stable chronological training folds');
        expect(result.explanation).toContain('does not authorize an order');
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
        expect(result.windowSelectionDiagnostics).toHaveLength(2);
        expect(result.windowSelectionDiagnostics[0].foldAccuracies).toHaveLength(3);
        expect(result.explanation).toContain('selection was unstable');
        expect(result.explanation).toContain('stability FAILED');
    });

    it('accepts window selection when the winner takes exactly two-thirds of training folds', () => {
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
        expect(result.windowSelectionAccuracyStdDev).toBeLessThanOrEqual(0.15);
        expect(result.windowSelectionStable).toBe(true);
        expect(result.windowSelectionSummary).toContain('selected 20-tick window won 2/3 folds');
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
        expect(result.windowSelectionStable).toBe(true);
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
        expect(result.predictedDigit).toBeNull();
    });

    it('requires real aligned timestamps before validating a candidate', () => {
        const result = generateAIPrediction([...Array(300).fill(0), ...Array(200).fill(7)], 100);
        expect(result.decision).toBe('NO_TRADE');
        expect(result.explanation).toContain('timestamps');
    });
});
