import { useState } from 'react';
import {
    AIStatisticalPowerAuditResult,
    runAIStatisticalPowerAudit,
} from './services/ai-statistical-power-audit';
import './ai-statistical-power-audit.scss';
import { classifyPowerEvidence, runAIWindowSelectionShadowAudit } from './services/ai-window-selection-shadow';

const AIStatisticalPowerAuditPanel = () => {
    const [result, setResult] = useState<AIStatisticalPowerAuditResult | null>(null);
    const [running, setRunning] = useState(false);
    const [windowShadow, setWindowShadow] = useState<ReturnType<typeof runAIWindowSelectionShadowAudit>>([]);

    const runAudit = () => {
        if (running) return;
        setRunning(true);
        try {
            setWindowShadow(runAIWindowSelectionShadowAudit(500, 20261114));
            setResult(runAIStatisticalPowerAudit({
                repetitions: 500,
                marketCount: 13,
                sampleSizes: [500, 1000, 2000, 5000],
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
                                    <th>Evidence status</th>
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
                                        <td>{item.trueEdge === 0 ? 'False-approval control' : classifyPowerEvidence(item.approvalRate).replace(/_/g, ' ')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className='gtraders-ai-power-audit__summary'>
                        <strong>Ambiguity-aware window-selection shadow test</strong>
                        <span>Same five candidate windows and live gates: at least 2 of 3 fold wins, more than 2 pp aggregate lead, and no more than 12 pp fold range. Scenarios use 50, 100, 200 and 500 synthetic observations per fold; 500 matches the current 5,000-tick scan's 60% training split and three selection folds.</span>
                        <span>These are sample-size sensitivity scenarios, not actual live-market sample counts. No threshold is relaxed and no shadow result selects a live window.</span>
                        {windowShadow.map(item => (
                            <span key={`${item.profile}-${item.foldObservationsPerFold}`}>
                                {item.profile.replace(/_/g, ' ')} · {item.foldObservationsPerFold} observations/fold: current rule passes {(item.currentRulePassRate * 100).toFixed(1)}%; clear candidate {(item.aggregateClearCandidateRate * 100).toFixed(1)}%; ambiguous {(item.ambiguousRate * 100).toFixed(1)}%; regime-unstable {(item.regimeUnstableRate * 100).toFixed(1)}%.
                            </span>
                        ))}
                    </div>
                    <div className='gtraders-ai-power-audit__summary'>
                        <strong>How to read evidence status</strong>
                        <span>INSUFFICIENT EVIDENCE means the simulated design has less than 80% power to detect the configured edge. It is not a live-market rejection, and it never authorizes relaxing a trading gate.</span>
                    </div>
                    <div className='gtraders-ai-power-audit__summary'>
                        <strong>Paired prediction validation power</strong>
                        <span>These paired-power scenarios assume independent outcomes; live serial dependence can reduce effective sample size and actual detection power. The 2,000-observation row represents the current 5,000-tick scan with a 60% training split.</span>
                        {result.pairedScenarios.filter(item => [200, 800, 2000].includes(item.holdoutTicks) && [0, 0.05].includes(item.trueModelImprovement)).map(item => (
                            <span key={`${item.holdoutTicks}-${item.trueModelImprovement}`}>
                                {item.holdoutTicks} holdout observations · +{(item.trueModelImprovement * 100).toFixed(0)} pp improvement: {(item.power * 100).toFixed(1)}% significant.
                            </span>
                        ))}
                    </div>
                    <div className='gtraders-ai-power-audit__summary'>
                        <strong>Stage 6 · dependence-aware holdout validation</strong>
                        <span>Live paired prediction validation now measures lag-1 dependence in both ordered model-minus-baseline outcomes and model-correctness outcomes, then runs a deterministic circular moving-block bootstrap.</span>
                        <span>The more conservative p-value from block bootstrap and exact paired McNemar is used before family-wise correction. Validation requires at least 200 effective observations in the paired model-minus-baseline series. Raw model-accuracy dependence is still reported for its descriptive confidence interval, but does not independently veto a statistically sound paired comparison.</span>
                        <span>The sensitivity rows below remain synthetic approximations. They do not represent live-market dependence measurements.</span>
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
