import { classifyPowerEvidence, runAIWindowSelectionShadowAudit } from './ai-window-selection-shadow';

describe('AI shadow window selection', () => {
    it('is deterministic and distinguishes ambiguity from regime instability', () => {
        const first = runAIWindowSelectionShadowAudit(200, 123);
        expect(first).toEqual(runAIWindowSelectionShadowAudit(200, 123));
        expect(first.map(item => item.profile)).toEqual(['CLEAR_WINNER', 'NEAR_TIE', 'REGIME_SHIFT']);
        expect(first.every(item => item.ambiguousRate >= 0 && item.regimeUnstableRate >= 0)).toBe(true);
    });

    it('labels low design power as insufficient evidence without changing live gates', () => {
        expect(classifyPowerEvidence(0.1)).toBe('INSUFFICIENT_EVIDENCE');
        expect(classifyPowerEvidence(0.85)).toBe('ADEQUATE_DESIGN_POWER');
        expect(classifyPowerEvidence(Number.NaN)).toBe('INSUFFICIENT_EVIDENCE');
    });
});
