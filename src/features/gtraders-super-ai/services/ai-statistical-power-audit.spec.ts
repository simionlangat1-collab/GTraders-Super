import { runAIStatisticalPowerAudit } from './ai-statistical-power-audit';

describe('runAIStatisticalPowerAudit', () => {
    it('is deterministic for an identical seed and configuration', () => {
        const options = {
            seed: 42,
            repetitions: 200,
            sampleSizes: [500],
            trainingFractions: [0.6],
            baselines: [0.5],
            trueEdges: [0, 0.1],
            pairedModelImprovements: [0, 0.1],
        };
        expect(runAIStatisticalPowerAudit(options)).toEqual(runAIStatisticalPowerAudit(options));
    });

    it('marks splits that cannot satisfy the existing 300/200 minimum as not run', () => {
        const result = runAIStatisticalPowerAudit({
            repetitions: 200,
            sampleSizes: [500],
            trainingFractions: [0.5, 0.6, 0.7],
            baselines: [0.5],
            trueEdges: [0.05],
            pairedModelImprovements: [0],
        });
        const rows = result.contractScenarios;
        expect(rows.find(row => row.trainingTicks === 250)?.interpretation).toBe('NOT_RUN');
        expect(rows.find(row => row.trainingTicks === 300)?.interpretation).toBe('POWER');
        expect(rows.find(row => row.holdoutTicks === 150)?.interpretation).toBe('NOT_RUN');
    });

    it('labels zero-edge runs as false-approval measurements, not power', () => {
        const result = runAIStatisticalPowerAudit({
            repetitions: 200,
            sampleSizes: [1000],
            trainingFractions: [0.6],
            baselines: [0.5],
            trueEdges: [0],
            pairedModelImprovements: [0],
        });
        expect(result.contractScenarios[0].interpretation).toBe('FALSE_APPROVAL_RATE');
        expect(result.contractScenarios[0].trueEdge).toBe(0);
    });

    it('never changes live approval or execution settings', () => {
        const result = runAIStatisticalPowerAudit({ repetitions: 200 });
        expect(result.mode).toBe('SHADOW_ONLY');
        expect(result.safeguards.some(item => item.includes('thresholds'))).toBe(true);
        expect(result.interpretation).toContain('never as permission to weaken');
    });

    it('reports window-selection fragility and dependence sensitivity separately', () => {
        const result = runAIStatisticalPowerAudit({
            repetitions: 200,
            sampleSizes: [500],
            trainingFractions: [0.6],
            baselines: [0.5],
            trueEdges: [0.05],
            pairedModelImprovements: [0],
        });
        expect(result.windowSelectionScenarios.map(item => item.profile)).toEqual([
            'CLEAR_WINNER', 'NEAR_TIE', 'REGIME_SHIFT',
        ]);
        expect(result.windowSelectionScenarios.every(item => item.aggregateSelectionAvailableRate === 1)).toBe(true);
        expect(result.dependenceSensitivity.some(item => item.lagOneCorrelation === 0.5)).toBe(true);
    });

    it('reports paired prediction power separately from contract power', () => {
        const result = runAIStatisticalPowerAudit({
            repetitions: 200,
            sampleSizes: [500],
            trainingFractions: [0.6],
            baselines: [0.5],
            trueEdges: [0.05],
            pairedModelImprovements: [0, 0.1],
        });
        expect(result.pairedScenarios).toHaveLength(2);
        expect(result.contractScenarios).toHaveLength(1);
        expect(result.pairedScenarios[0].trueModelImprovement).toBe(0);
    });
});
