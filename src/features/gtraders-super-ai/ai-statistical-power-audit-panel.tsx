import { useState } from 'react';
import {
    AIStatisticalPowerAuditResult,
    runAIStatisticalPowerAudit,
} from './services/ai-statistical-power-audit';
import './ai-statistical-power-audit.scss';

const AIStatisticalPowerAuditPanel = () => {
    const [result, setResult] = useState<AIStatisticalPowerAuditResult | null>(null);
    const [running, setRunning] = useState(false);

    const runAudit = () => {
        if (running) return;
        setRunning(true);
        try {
            setResult(runAIStatisticalPowerAudit({
                repetitions: 500,
                marketCount: 13,
                sampleSizes: [500, 1000, 2000],
                trainingFractions: [0.5, 0.6, 0.7],
                baselines: [0.5, 0.7, 0.9],
                trueEdges: [0, 0.02, 0.05, 0.1],
                pairedModelImprovements: [0, 0.02, 0.05, 0.1],
            }));
        } finally {
            setRunning(false);
        }
    };

    const contractRows = result?.contractScenarios.filter(item =>
        item.trainingTicks === Math.floor(item.totalTicks * 0.6) &&
        [0.5, 0.9].includes(item.baseline) &&
        [0, 0.05].includes(item.trueEdge)
    ) ?? [];

    return (
        <section className='gtraders-ai-power-audit' aria-live='polite'>
            <div className='gtraders-ai-power-audit__heading'>
                <div>
                    <strong>Shadow Statistical Power Audit</strong>
                    <span>Simulations only · does not alter market approvals or trading rules</span>
                </div>
                <button type='button' onClick={runAudit} disabled={running}>
                    {running ? 'Running simulations…' : result ? 'Run again' : 'Run power audit'}
                </button>
            </div>
            {result && (
                <>
                    <p className='gtraders-ai-power-audit__notice'>
                        {result.repetitions.toLocaleString()} deterministic-seed Monte Carlo repetitions per scenario. These are synthetic design tests, not live-market evidence.
                    </p>
                    <div className='gtraders-ai-power-audit__table-wrap'>
                        <table>
                            <thead>
                                <tr>
                                    <th>Ticks</th>
                                    <th>Holdout</th>
                                    <th>Baseline</th>
                                    <th>True edge</th>
                                    <th>Result rate</th>
                                    <th>Meaning</th>
                                </tr>
                            </thead>
                            <tbody>
                                {contractRows.map((item, index) => (
                                    <tr key={`${item.totalTicks}-${item.baseline}-${item.trueEdge}-${index}`}>
                                        <td>{item.totalTicks}</td>
                                        <td>{item.holdoutTicks}</td>
                                        <td>{(item.baseline * 100).toFixed(0)}%</td>
                                        <td>+{(item.trueEdge * 100).toFixed(0)} pp</td>
                                        <td>{(item.approvalRate * 100).toFixed(1)}%</td>
                                        <td>{item.interpretation === 'POWER' ? 'Detection power' : 'False approval'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className='gtraders-ai-power-audit__summary'>
                        <strong>Window-selection stress test</strong>
                        {result.windowSelectionScenarios.map(item => (
                            <span key={item.profile}>
                                {item.profile.replace(/_/g, ' ')}: current rule passes {(item.legacyStabilityPassRate * 100).toFixed(1)}%; aggregate alternative finds a candidate in {(item.aggregateSelectionAvailableRate * 100).toFixed(0)}%; close/ambiguous result {(item.aggregateAmbiguityRate * 100).toFixed(1)}%.
                            </span>
                        ))}
                    </div>
                    <div className='gtraders-ai-power-audit__summary'>
                        <strong>Paired prediction validation power</strong>
                        {result.pairedScenarios.filter(item => [200, 800].includes(item.holdoutTicks) && [0, 0.05].includes(item.trueModelImprovement)).map(item => (
                            <span key={`${item.holdoutTicks}-${item.trueModelImprovement}`}>
                                {item.holdoutTicks} holdout observations · +{(item.trueModelImprovement * 100).toFixed(0)} pp improvement: {(item.power * 100).toFixed(1)}% significant.
                            </span>
                        ))}
                    </div>
                    <div className='gtraders-ai-power-audit__summary'>
                        <strong>Serial-dependence sensitivity</strong>
                        {result.dependenceSensitivity.filter(item => item.holdoutTicks === 200).map(item => (
                            <span key={item.lagOneCorrelation}>
                                Lag-1 correlation {item.lagOneCorrelation.toFixed(2)}: approximate effective sample {item.approximateEffectiveSampleSize.toFixed(0)} / 200.
                            </span>
                        ))}
                    </div>
                    <p className='gtraders-ai-power-audit__notice'>{result.interpretation}</p>
                </>
            )}
        </section>
    );
};

export default AIStatisticalPowerAuditPanel;
