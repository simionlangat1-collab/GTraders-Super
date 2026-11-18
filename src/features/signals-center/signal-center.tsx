import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { CONNECTION_STATUS, connectionStatus$ } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { analyzeOverTwo, SIGNAL_TICK_WINDOW } from './analysis/over-two';
import { analyzeOneTickRecovery } from './analysis/one-tick-recovery';
import { signalCenterStore } from './signal-store';
import './signal-center.scss';

const getLastDigit = (quote: number | string, precision?: number) => {
    const numericQuote = Number(quote);
    const quoteText = Number.isFinite(precision) ? numericQuote.toFixed(precision) : String(quote);
    const decimals = quoteText.split('.')[1] || '';
    return Number((decimals || quoteText).slice(-1));
};

const SignalCenter = () => {
    const snapshot = useSyncExternalStore(
        signalCenterStore.subscribe,
        signalCenterStore.getSnapshot,
        signalCenterStore.getSnapshot
    );
    const [socketReady, setSocketReady] = useState(connectionStatus$.value === CONNECTION_STATUS.OPENED);
    const [streamStatus, setStreamStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

    useEffect(() => {
        const updateSocketReady = (status: string) => {
            setSocketReady(status === CONNECTION_STATUS.OPENED);
        };
        const statusSubscription = connectionStatus$.subscribe(updateSocketReady);
        updateSocketReady(connectionStatus$.value);
        if (api_base.api?.connection?.readyState === 1) setSocketReady(true);
        return () => statusSubscription.unsubscribe();
    }, []);

    // Signal Center owns a read-only tick subscription while its tab is active.
    // This keeps analysis live even though the Manual Trader tab is unmounted.
    useEffect(() => {
        const symbol = snapshot.selectedSymbol;
        const api = api_base.api as any;

        if (!symbol) {
            signalCenterStore.setTicks([]);
            setStreamStatus('disconnected');
            return undefined;
        }

        if (!socketReady || !api || api.connection?.readyState !== 1) {
            signalCenterStore.setTicks([]);
            setStreamStatus('disconnected');
            return undefined;
        }

        let active = true;
        let subscriptionId = '';
        setStreamStatus('connecting');
        signalCenterStore.setTicks([]);

        const precision = (api_base.pip_sizes as Record<string, number>)?.[symbol];
        const messageSubscription = api.onMessage().subscribe((message: any) => {
            const data = message?.data ?? message;
            if (!active || data?.msg_type !== 'tick' || data.tick?.symbol !== symbol) return;
            const quote = Number(data.tick.quote);
            const epoch = Number(data.tick.epoch);
            if (!Number.isFinite(quote) || !Number.isFinite(epoch)) return;
            signalCenterStore.addTick({
                symbol,
                quote,
                epoch,
                digit: getLastDigit(data.tick.quote, precision),
            });
        });

        const startStream = async () => {
            try {
                const response = await api.send({
                    ticks_history: symbol,
                    end: 'latest',
                    count: SIGNAL_TICK_WINDOW,
                    style: 'ticks',
                    subscribe: 1,
                });
                if (!active) {
                    const id = response?.subscription?.id;
                    if (id) api.send({ forget: id });
                    return;
                }

                const responseData = response?.data ?? response;
                const history = responseData?.history;
                const prices: (number | string)[] = history?.prices || [];
                const times: number[] = history?.times || [];
                const historicalTicks = prices.map((price, index) => ({
                    symbol,
                    quote: Number(price),
                    epoch: Number(times[index] || 0),
                    digit: getLastDigit(price, precision),
                }));
                const liveTicks = signalCenterStore.getSnapshot().ticks;
                signalCenterStore.setTicks(
                    [...historicalTicks, ...liveTicks].sort((a, b) => a.epoch - b.epoch)
                );
                subscriptionId = responseData?.subscription?.id || response?.subscription?.id || '';
                setStreamStatus('connected');
            } catch {
                if (!active) return;
                setStreamStatus('disconnected');
            }
        };

        void startStream();
        return () => {
            active = false;
            messageSubscription?.unsubscribe?.();
            if (subscriptionId) api.send({ forget: subscriptionId });
        };
    }, [snapshot.selectedSymbol, socketReady]);

    const analysis = useMemo(() => analyzeOverTwo(snapshot.ticks), [snapshot.ticks]);
    const recoveryAnalysis = useMemo(() => analyzeOneTickRecovery(snapshot.ticks), [snapshot.ticks]);
    const latestTick = snapshot.ticks[snapshot.ticks.length - 1] || null;
    const isReady = analysis.sampleSize === SIGNAL_TICK_WINDOW;
    const connectionLabel = !snapshot.selectedSymbol
        ? 'Select a market in Manual Trader'
        : streamStatus === 'connected'
          ? 'Live market feed'
          : streamStatus === 'connecting'
            ? 'Connecting to market'
            : 'Feed unavailable';

    return (
        <main className='signal-center'>
            <header className='signal-center__header'>
                <div>
                    <span className='signal-center__eyebrow'>GTRADERS SUPER · SIGNAL INTELLIGENCE</span>
                    <h1>Signal Center</h1>
                    <p>Live, analysis-only market signals for your selected market.</p>
                </div>
                <span className={`signal-center__connection signal-center__connection--${streamStatus === 'connected' ? 'connected' : 'disconnected'}`}>
                    <i />
                    {connectionLabel}
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
                    {!snapshot.selectedSymbol
                        ? 'Open Manual Trader and select a market to start Signal Center analysis.'
                        : isReady
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

            <section className='signal-center__recovery'>
                <div className='signal-center__section-heading'>
                    <div>
                        <h2>One-Tick Recovery Intelligence</h2>
                        <p>Observed movement from the losing zone (0–2) back into the winning zone (3–9)</p>
                    </div>
                    <span>{recoveryAnalysis.sampleSize} ticks observed</span>
                </div>

                <div className='signal-center__recovery-summary'>
                    <article>
                        <span>ONE-TOUCH RECOVERY</span>
                        <strong>{recoveryAnalysis.oneTouchRunPercentage.toFixed(1)}%</strong>
                        <small>{recoveryAnalysis.oneTouchRuns} of {recoveryAnalysis.completedRecoveryRuns} completed recovery runs</small>
                    </article>
                    <article>
                        <span>MULTI-TOUCH RECOVERY</span>
                        <strong>{recoveryAnalysis.multiTouchRunPercentage.toFixed(1)}%</strong>
                        <small>{recoveryAnalysis.multiTouchRuns} of {recoveryAnalysis.completedRecoveryRuns} completed recovery runs</small>
                    </article>
                    <article>
                        <span>IMMEDIATE NEXT-TICK RETURN</span>
                        <strong>{recoveryAnalysis.immediateRecoveryPercentage.toFixed(1)}%</strong>
                        <small>{recoveryAnalysis.immediateWinningTicks} of {recoveryAnalysis.losingTouchesWithNextTick} eligible losing touches</small>
                    </article>
                </div>

                <div className='signal-center__recovery-digits'>
                    {[0, 1, 2].map(digit => {
                        const stats = recoveryAnalysis.byLosingDigit[digit as 0 | 1 | 2];
                        return (
                            <div key={digit}>
                                <strong>{digit}</strong>
                                <span>{stats.immediateRecoveryPercentage.toFixed(1)}%</span>
                                <small>{stats.immediateWinningTicks}/{stats.observedTouches} immediate returns to 3–9</small>
                            </div>
                        );
                    })}
                </div>
                <p className='signal-center__recovery-note'>
                    One-touch means exactly one consecutive losing-zone tick (0–2) before a winning-zone tick (3–9).
                    Multi-touch means two or more consecutive losing-zone ticks before returning to 3–9.
                    Percentages describe this observed sample only; they are not guarantees or trade-entry instructions.
                </p>
            </section>

            <p className='signal-center__disclaimer'>
                Signals are statistical estimates based on observed ticks, not predictions or guarantees of the next outcome.
                Signal Center does not place, modify, or manage trades.
            </p>
        </main>
    );
};

export default SignalCenter;
