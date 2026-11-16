import React, { useMemo, useSyncExternalStore } from 'react';
import { analyzeOverTwo, SIGNAL_TICK_WINDOW } from './analysis/over-two';
import { signalCenterStore } from './signal-store';
import './signal-center.scss';

const SignalCenter = () => {
    const snapshot = useSyncExternalStore(
        signalCenterStore.subscribe,
        signalCenterStore.getSnapshot,
        signalCenterStore.getSnapshot
    );
    const analysis = useMemo(() => analyzeOverTwo(snapshot.ticks), [snapshot.ticks]);
    const latestTick = snapshot.ticks[snapshot.ticks.length - 1] || null;
    const isReady = analysis.sampleSize === SIGNAL_TICK_WINDOW;

    return (
        <main className='signal-center'>
            <header className='signal-center__header'>
                <div>
                    <span className='signal-center__eyebrow'>GTRADERS SUPER · SIGNAL INTELLIGENCE</span>
                    <h1>Signal Center</h1>
                    <p>Live, analysis-only market signals from the Manual Trader tick stream.</p>
                </div>
                <span className={`signal-center__connection signal-center__connection--${snapshot.selectedSymbol ? 'connected' : 'disconnected'}`}>
                    <i />
                    {snapshot.selectedSymbol ? 'Market selected' : 'Waiting for market'}
                </span>
            </header>

            <section className='signal-center__signal-card' aria-live='polite'>
                <div className='signal-center__signal-heading'>
                    <div>
                        <span className='signal-center__kicker'>OVER 2 · 100-TICK ANALYSIS</span>
                        <h2>{isReady ? (analysis.status === 'BUY_OVER_2' ? 'BUY OVER 2' : 'WAIT') : 'COLLECTING DATA'}</h2>
                    </div>
                    <strong className={`signal-center__signal-state ${isReady && analysis.status === 'BUY_OVER_2' ? 'is-buy' : ''}`}>
                        {isReady ? analysis.qualifyingPercentage.toFixed(1) + '%' : analysis.sampleSize + ' / ' + SIGNAL_TICK_WINDOW}
                    </strong>
                </div>
                <p>
                    {isReady
                        ? `${analysis.qualifyingDigits} of ${SIGNAL_TICK_WINDOW} observed digits were 3–9. Threshold: ${analysis.thresholdPercentage}%.`
                        : 'A complete sample of 100 valid ticks is required before a signal can be issued.'}
                </p>
                <div className='signal-center__progress'>
                    <i style={{ width: `${(analysis.sampleSize / SIGNAL_TICK_WINDOW) * 100}%` }} />
                </div>
                <div className='signal-center__meta'>
                    <span>Market: <strong>{snapshot.selectedSymbol || '—'}</strong></span>
                    <span>Latest digit: <strong>{latestTick ? latestTick.digit : '—'}</strong></span>
                </div>
            </section>

            <section className='signal-center__frequency'>
                <div className='signal-center__section-heading'>
                    <div>
                        <h2>Last-digit distribution</h2>
                        <p>Frequency in the current 100-tick sample</p>
                    </div>
                    <span>{analysis.sampleSize} / {SIGNAL_TICK_WINDOW} ticks</span>
                </div>
                <div className='signal-center__digit-grid'>
                    {Array.from({ length: 10 }, (_, digit) => {
                        const count = analysis.digitFrequencies[digit] || 0;
                        const percentage = analysis.sampleSize ? (count / analysis.sampleSize) * 100 : 0;
                        return (
                            <div className='signal-center__digit' key={digit}>
                                <strong>{digit}</strong>
                                <span>{count}</span>
                                <i><b style={{ height: `${percentage}%` }} /></i>
                                <small>{percentage.toFixed(0)}%</small>
                            </div>
                        );
                    })}
                </div>
            </section>

            <p className='signal-center__disclaimer'>
                Signals are statistical estimates based on observed ticks, not predictions or guarantees of the next outcome.
                Signal Center does not place, modify, or manage trades.
            </p>
        </main>
    );
};

export default SignalCenter;
