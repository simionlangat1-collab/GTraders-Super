import { classifyPowerEvidence, runAIWindowSelectionShadowAudit } from './ai-window-selection-shadow';

describe('AI shadow window selection', () => {
    it('is deterministic and reports fold sample-size sensitivities', () => {
        const first = runAIWindowSelectionShadowAudit(200, 123);
        expect(first).toEqual(runAIWindowSelectionShadowAudit(200, 123));
        expect(first).toHaveLength(12);
        expect(first.filter(item => item.profile === 'CLEAR_WINNER').map(item => item.foldObservationsPerFold))
            .toEqual([50, 100, 200, 500]);
        expect(first.every(item => item.ambiguousRate >= 0 && item.regimeUnstableRate >= 0)).toBe(true);
    });

    it('keeps the existing stability and ambiguity criteria visible at every sample size', () => {
        const results = runAIWindowSelectionShadowAudit(500, 20261114);
        expect(results.every(item =>
            item.currentRulePassRate >= 0 && item.currentRulePassRate <= 1 &&
            item.aggregateClearCandidateRate + item.ambiguousRate + item.regimeUnstableRate
                > 0.999999
        )).toBe(true);
    });

    it('labels low design power as insufficient evidence without changing live gates', () => {
        expect(classifyPowerEvidence(0.1)).toBe('INSUFFICIENT_EVIDENCE');
        expect(classifyPowerEvidence(0.85)).toBe('ADEQUATE_DESIGN_POWER');
        expect(classifyPowerEvidence(Number.NaN)).toBe('INSUFFICIENT_EVIDENCE');
    });
});
