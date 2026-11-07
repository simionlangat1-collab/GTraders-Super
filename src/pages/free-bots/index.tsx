import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import XvtSniperEngine from './xvt-sniper-engine';
import './free-bots.scss';

type TMarketOption = {
    symbol: string;
    display_name: string;
};

type TLiveEvaluation = {
    digit: number;
    outcome: 'WIN' | 'LOSS';
    contractType: string;
    barrier: number;
    epoch: number;
};

type TAnalysis = {
    ticks: number;
    counts: number[];
    topDigits: number[];
    predictionDigit: number | null;
    favourableCount: number;
    favourablePercent: number;
    momentumReady: boolean;
    latestDigit: number | null;
};

const emptyAnalysis: TAnalysis = {
    ticks: 0,
    counts: Array(10).fill(0),
    topDigits: [],
    predictionDigit: null,
    favourableCount: 0,
    favourablePercent: 0,
    momentumReady: false,
    latestDigit: null,
};

const FreeBots = () => {
    const { connectionStatus, isAuthorized, authData } = useApiBase();
    const { dashboard, quick_strategy } = useStore();
    const engineRef = useRef<XvtSniperEngine | null>(null);
    const [isBotOpen, setIsBotOpen] = useState(false);
    const [symbols, setSymbols] = useState<TMarketOption[]>([]);
    const [symbol, setSymbol] = useState('');
    const [direction, setDirection] = useState<'OVER' | 'UNDER'>('OVER');
    const [entryDigit, setEntryDigit] = useState('2');
    const [stake, setStake] = useState('1');
    const [takeProfit, setTakeProfit] = useState('10');
    const [stopLoss, setStopLoss] = useState('10');
    const [martingale, setMartingale] = useState('2');
    const [isRunning, setIsRunning] = useState(false);
    const [status, setStatus] = useState('Ready. Configure your bot and connect your Deriv account.');
    const [analysis, setAnalysis] = useState<TAnalysis>(emptyAnalysis);
    const [liveEvaluations, setLiveEvaluations] = useState<TLiveEvaluation[]>([]);
    const [sessionProfit, setSessionProfit] = useState(0);
    const [tradeCount, setTradeCount] = useState(0);
    const [wins, setWins] = useState(0);
    const [losses, setLosses] = useState(0);
    const [recoveryStep, setRecoveryStep] = useState(0);
    const [recentTrades, setRecentTrades] = useState<Array<Record<string, unknown>>>([]);
    const [errorMessage, setErrorMessage] = useState('');

    const currency = authData?.currency || 'USD';
    const accountIsVirtual = authData?.is_virtual === 1;

    useEffect(() => {
        let active = true;

        const loadSymbols = async () => {
            try {
                if (api_base.active_symbols_promise) {
                    await api_base.active_symbols_promise;
                }
                if (!api_base.has_active_symbols && api_base.api) {
                    await api_base.getActiveSymbols();
                }
                if (!active) return;

                const available = (api_base.active_symbols || [])
                    .filter((item: any) => {
                        const code = item.underlying_symbol || item.symbol;
                        return Boolean(code) && item.exchange_is_open !== false && !item.is_trading_suspended;
                    })
                    .map((item: any) => ({
                        symbol: item.underlying_symbol || item.symbol,
                        display_name: item.display_name || item.underlying_symbol || item.symbol,
                    }))
                    .filter((item: TMarketOption, index: number, list: TMarketOption[]) =>
                        list.findIndex(candidate => candidate.symbol === item.symbol) === index
                    )
                    .sort((a: TMarketOption, b: TMarketOption) => a.display_name.localeCompare(b.display_name));

                setSymbols(available);
                if (available.length) {
                    setSymbol(current =>
                        available.some(item => item.symbol === current)
                            ? current
                            : available.find(item => item.symbol === 'R_100')?.symbol || available[0].symbol
                    );
                }
            } catch (error) {
                if (active) {
                    setErrorMessage(error instanceof Error ? error.message : 'Unable to load trading markets.');
                }
            }
        };

        if (isAuthorized && connectionStatus === CONNECTION_STATUS.OPENED) {
            void loadSymbols();
        } else {
            setSymbols([]);
            setSymbol('');
        }

        return () => {
            active = false;
        };
    }, [isAuthorized, connectionStatus]);

    useEffect(() => {
        if (connectionStatus !== CONNECTION_STATUS.OPENED && engineRef.current) {
            engineRef.current.dispose();
            engineRef.current = null;
            setIsRunning(false);
            setStatus('Deriv connection closed. Bot stopped.');
        }
    }, [connectionStatus]);

    useEffect(() => {
        return () => {
            engineRef.current?.stop();
            engineRef.current = null;
        };
    }, []);

    const rankedDigits = useMemo(
        () =>
            analysis.counts
                .map((count, digit) => ({ digit, count }))
                .sort((a, b) => b.count - a.count || a.digit - b.digit),
        [analysis.counts]
    );

    const startBot = async () => {
        setErrorMessage('');

        const entry = Number(entryDigit);
        const initialStake = Number(stake);
        const target = Number(takeProfit);
        const maximumLoss = Number(stopLoss);
        const multiplier = Number(martingale);

        if (!isAuthorized || connectionStatus !== CONNECTION_STATUS.OPENED) {
            setErrorMessage('Connect and authorize your Deriv account before starting.');
            return;
        }
        if (!symbol) {
            setErrorMessage('Select a trading market first.');
            return;
        }
        if (!Number.isInteger(entry) || entry < 0 || entry > 9) {
            setErrorMessage('Search Number must be a single digit from 0 to 9.');
            return;
        }
        if (![initialStake, target, maximumLoss, multiplier].every(Number.isFinite) ||
            initialStake <= 0 || target <= 0 || maximumLoss <= 0 || multiplier < 1) {
            setErrorMessage('Enter valid positive Stake, Take Profit and Stop Loss values, and a Martingale multiplier of at least 1.');
            return;
        }

        setAnalysis(emptyAnalysis);
        setLiveEvaluations([]);
        setSessionProfit(0);
        setTradeCount(0);
        setWins(0);
        setLosses(0);
        setRecoveryStep(0);
        setRecentTrades([]);
        setIsRunning(true);

        const engine = new XvtSniperEngine(
            {
                symbol,
                direction,
                entryDigit: entry,
                stake: initialStake,
                takeProfit: target,
                stopLoss: maximumLoss,
                martingale: multiplier,
                currency,
            },
            {
                onStatus: setStatus,
                onAnalysis: setAnalysis,
                onLiveDigit: evaluation => {
                    setLiveEvaluations(items => [...items.slice(-7), evaluation]);
                },
                onTrade: trade => {
                    setTradeCount(count => count + 1);
                    setRecentTrades(items => [trade, ...items].slice(0, 8));
                },
                onResult: result => {
                    setSessionProfit(Number(result.sessionProfit || 0));
                    setRecoveryStep(Number(result.lossesInCycle || 0));
                    if (result.result === 'WON') setWins(count => count + 1);
                    else setLosses(count => count + 1);
                    setRecentTrades(items => {
                        const [latest, ...rest] = items;
                        return latest
                            ? [{ ...latest, outcome: result.result, profit: result.profit }, ...rest].slice(0, 8)
                            : items;
                    });
                },
                onProfit: setSessionProfit,
                onError: setErrorMessage,
                onStopped: () => setIsRunning(false),
            }
        );

        engineRef.current = engine;
        try {
            await engine.start();
        } catch (error) {
            setIsRunning(false);
            engineRef.current = null;
            setErrorMessage(error instanceof Error ? error.message : 'Unable to start G - T Sniper XVT.');
            setStatus('Bot could not start.');
        }
    };

    const stopBot = () => {
        engineRef.current?.stop();
    };

    // Open G-K Pioneer directly in the Bot Builder workspace with Martingale loaded.
    // LOAD inserts the strategy without starting a trade or showing the strategy wizard.
    const openGKPioneer = () => {
        // Open the existing Bot Builder parameter interface. The Martingale
        // multiplier is configured there with the other trading controls.
        quick_strategy.setSelectedStrategy('MARTINGALE');
        quick_strategy.setGKPioneerMode(true);
        quick_strategy.setFormVisibility(true);
        dashboard.setActiveTab(1);
    };

    const selectedBarrier = direction === 'OVER'
        ? (recoveryStep > 0 ? 'OVER 3' : 'OVER 2')
        : (recoveryStep > 0 ? 'UNDER 6' : 'UNDER 7');

    return (
        <section className='free-bots-page'>
            <header className='free-bots-page__header'>
                <span className='free-bots-page__eyebrow'>GTRADERS SUPER</span>
                <h1>Free Bots</h1>
                <p>Explore ready-made trading strategies.</p>
            </header>

            {!isBotOpen ? (
                <>
                    <article className='free-bots-card'>
                        <div className='free-bots-card__details'>
                            <span className='free-bots-card__label'>FREE BOT</span>
                            <h2>G - T Sniper XVT Bot</h2>
                            <p>XVT Precision Sniper · Digit Over / Under strategy</p>
                        </div>
                        <button className='xvt-button xvt-button--primary' onClick={() => setIsBotOpen(true)}>
                            Open Bot
                        </button>
                    </article>
                    <article className='free-bots-card'>
                        <div className='free-bots-card__details'>
                            <span className='free-bots-card__label'>FREE BOT</span>
                            <h2>G-K Pioneer</h2>
                            <p>Bot Builder engine · Custom Martingale recovery</p>
                        </div>
                        <button
                            className='xvt-button xvt-button--primary'
                            onClick={openGKPioneer}
                        >
                            Open G-K Pioneer
                        </button>
                    </article>
                </>
            ) : (
                <div className='xvt-panel'>
                    <div className='xvt-panel__heading'>
                        <div>
                            <span className='free-bots-card__label'>GTRADERS SUPER · FREE BOT</span>
                            <h2>G - T Sniper XVT Bot</h2>
                            <p>Precision entries using a rolling 100-tick digit analysis.</p>
                        </div>
                        <button className='xvt-button xvt-button--quiet' onClick={() => setIsBotOpen(false)} disabled={isRunning}>
                            Back to Free Bots
                        </button>
                    </div>

                    <div className='xvt-account-strip'>
                        <span className={isAuthorized ? 'xvt-dot xvt-dot--online' : 'xvt-dot'} />
                        <span>{isAuthorized ? `Connected · ${authData?.loginid || 'Deriv account'}` : 'Deriv account not connected'}</span>
                        {isAuthorized && (
                            <strong>{accountIsVirtual ? 'DEMO ACCOUNT' : 'REAL ACCOUNT'} · {currency}</strong>
                        )}
                    </div>

                    {!accountIsVirtual && isAuthorized && (
                        <div className='xvt-warning'>
                            Real account selected. Test the strategy on a demo account first; digit outcomes are uncertain and losses are possible.
                        </div>
                    )}

                    <div className='xvt-config-grid'>
                        <label className='xvt-field xvt-field--wide'>
                            <span>Trading Market</span>
                            <select value={symbol} onChange={event => setSymbol(event.target.value)} disabled={isRunning}>
                                <option value=''>Select market</option>
                                {symbols.map(item => (
                                    <option key={item.symbol} value={item.symbol}>{item.display_name} ({item.symbol})</option>
                                ))}
                            </select>
                            {!symbols.length && <small>{isAuthorized ? 'Loading available markets…' : 'Connect Deriv to load markets.'}</small>}
                        </label>

                        <label className='xvt-field'>
                            <span>Contract Direction</span>
                            <select value={direction} onChange={event => setDirection(event.target.value as 'OVER' | 'UNDER')} disabled={isRunning}>
                                <option value='OVER'>Digit Over</option>
                                <option value='UNDER'>Digit Under</option>
                            </select>
                        </label>

                        <label className='xvt-field'>
                            <span>Search Number · Entry Digit</span>
                            <input type='number' min='0' max='9' step='1' inputMode='numeric' value={entryDigit} onChange={event => setEntryDigit(event.target.value)} disabled={isRunning} />
                            <small>Wait for this last digit before entering. Any digit 0–9 is accepted.</small>
                        </label>

                        <label className='xvt-field'>
                            <span>Stake ({currency})</span>
                            <input type='number' min='0.01' step='0.01' value={stake} onChange={event => setStake(event.target.value)} disabled={isRunning} />
                        </label>

                        <label className='xvt-field'>
                            <span>Take Profit ({currency})</span>
                            <input type='number' min='0.01' step='0.01' value={takeProfit} onChange={event => setTakeProfit(event.target.value)} disabled={isRunning} />
                        </label>

                        <label className='xvt-field'>
                            <span>Stop Loss ({currency})</span>
                            <input type='number' min='0.01' step='0.01' value={stopLoss} onChange={event => setStopLoss(event.target.value)} disabled={isRunning} />
                        </label>

                        <label className='xvt-field'>
                            <span>Martingale Multiplier</span>
                            <input type='number' min='1' step='0.1' value={martingale} onChange={event => setMartingale(event.target.value)} disabled={isRunning} />
                            <small>Recovery stake = initial stake × multiplier for each loss.</small>
                        </label>
                    </div>

                    <div className='xvt-strategy-strip'>
                        <div>
                            <span>Initial contract</span>
                            <strong>{direction === 'OVER' ? 'OVER 2' : 'UNDER 7'}</strong>
                        </div>
                        <div>
                            <span>After a loss</span>
                            <strong>{direction === 'OVER' ? 'OVER 3' : 'UNDER 6'}</strong>
                        </div>
                        <div>
                            <span>Current stage</span>
                            <strong>{selectedBarrier}</strong>
                        </div>
                    </div>

                    {errorMessage && <div className='xvt-error'>{errorMessage}</div>}

                    <div className='xvt-actions'>
                        {!isRunning ? (
                            <button className='xvt-button xvt-button--primary' onClick={startBot} disabled={!isAuthorized || !symbol}>
                                Start G - T Sniper XVT
                            </button>
                        ) : (
                            <button className='xvt-button xvt-button--stop' onClick={stopBot}>
                                Stop Bot
                            </button>
                        )}
                        <span className='xvt-status'>{status}</span>
                    </div>

                    <div className='xvt-stats-grid'>
                        <div className='xvt-stat'><span>Session P/L</span><strong className={sessionProfit >= 0 ? 'is-positive' : 'is-negative'}>{sessionProfit.toFixed(2)} {currency}</strong></div>
                        <div className='xvt-stat'><span>Trades</span><strong>{tradeCount}</strong></div>
                        <div className='xvt-stat'><span>Wins</span><strong>{wins}</strong></div>
                        <div className='xvt-stat'><span>Losses</span><strong>{losses}</strong></div>
                    </div>

                    <div className='xvt-analysis'>
                        <div className='xvt-live-evaluation' aria-live='polite'>
                            <div className='xvt-live-evaluation__heading'>
                                <div>
                                    <h3>Instant Tick Result</h3>
                                    <p>Every incoming tick is classified immediately using the current contract barrier.</p>
                                </div>
                                <span>LIVE SIGNAL · NOT SETTLEMENT</span>
                            </div>
                            {liveEvaluations.length ? (
                                <>
                                    <div className={`xvt-live-evaluation__latest ${liveEvaluations[liveEvaluations.length - 1].outcome === 'WIN' ? 'is-win' : 'is-loss'}`}>
                                        <div><span>Latest digit</span><strong>{liveEvaluations[liveEvaluations.length - 1].digit}</strong></div>
                                        <b>{liveEvaluations[liveEvaluations.length - 1].outcome}</b>
                                        <small>{liveEvaluations[liveEvaluations.length - 1].contractType} {liveEvaluations[liveEvaluations.length - 1].barrier}</small>
                                    </div>
                                    <div className='xvt-live-evaluation__trail'>
                                        {[...liveEvaluations].reverse().map((evaluation, index) => (
                                            <span className={evaluation.outcome === 'WIN' ? 'is-win' : 'is-loss'} key={`${evaluation.epoch}-${index}`}>
                                                {evaluation.digit} · {evaluation.outcome}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <p className='xvt-live-evaluation__empty'>Waiting for the first live market tick…</p>
                            )}
                        </div>
                        <div className='xvt-section-heading'>
                            <div><h3>Live Digit Analysis</h3><p>Latest {analysis.ticks} of 100 ticks</p></div>
                            <span className={analysis.momentumReady ? 'xvt-momentum xvt-momentum--ready' : 'xvt-momentum'}>
                                {analysis.momentumReady ? 'Momentum confirmed' : 'Waiting for momentum'}
                            </span>
                        </div>
                        <div className='xvt-prediction'>
                            <div>
                                <span>Estimated next digit</span>
                                <small>Most frequent digit in the latest {analysis.ticks} ticks · historical estimate only</small>
                            </div>
                            <strong>{analysis.predictionDigit ?? '—'}</strong>
                            <small>{analysis.predictionDigit !== null ? analysis.counts[analysis.predictionDigit] : 0} occurrence(s)</small>
                        </div>
                        <div className='xvt-digit-grid'>
                            {rankedDigits.map(item => (
                                <div className={[
                                    'xvt-digit',
                                    analysis.topDigits.includes(item.digit) ? 'xvt-digit--top' : '',
                                    item.digit === Number(entryDigit) ? 'xvt-digit--selected' : '',
                                ].filter(Boolean).join(' ')} key={item.digit}>
                                    <strong>{item.digit}</strong>
                                    <span>{item.count}</span>
                                </div>
                            ))}
                        </div>
                        <div className='xvt-analysis-footer'>
                            <span>Top digits: <strong>{analysis.topDigits.length ? analysis.topDigits.join(' · ') : '—'}</strong></span>
                            <span>Latest digit: <strong>{analysis.latestDigit ?? '—'}</strong></span>
                            <span>Favourable digits: <strong>{analysis.favourableCount}/100 ({analysis.favourablePercent.toFixed(1)}%)</strong></span>
                        </div>
                        <p className='xvt-footnote'>
                            Momentum filter: at least 75% favourable digits in the latest 100 ticks. This is the current engine threshold, not a prediction or guarantee of the next result.
                        </p>
                    </div>

                    <div className='xvt-history'>
                        <h3>Recent Trades</h3>
                        {recentTrades.length ? recentTrades.map((trade, index) => (
                            <div className='xvt-history__row' key={String(trade.contractId || index)}>
                                <span>{String(trade.contractType || 'Contract')} {String(trade.barrier || '')} · Est. digit {String(trade.estimatedDigit ?? '—')}</span>
                                <span>{String(trade.stake || '')} {currency}</span>
                                <strong className={trade.outcome === 'WON' ? 'is-positive' : trade.outcome === 'LOST' ? 'is-negative' : ''}>
                                    {String(trade.outcome || (trade.recovery ? 'RECOVERY' : 'OPEN'))}
                                    {trade.profit !== undefined ? ` · ${Number(trade.profit).toFixed(2)}` : ''}
                                </strong>
                            </div>
                        )) : <p>No trades placed in this session yet.</p>}
                    </div>

                    <p className='xvt-disclaimer'>
                        Trading involves risk. The 100-tick frequency and momentum readings describe recent history only; they do not guarantee future outcomes. Martingale can increase losses rapidly. Use demo funds while testing.
                    </p>
                </div>
            )}
        </section>
    );
};

export default FreeBots;
