import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { CONNECTION_STATUS, connectionStatus$ } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import './analysis-tool.scss';

type TMarket = {
    symbol: string;
    display_name: string;
    market?: string;
    submarket?: string;
    market_display?: string;
    submarket_display?: string;
    exchange_is_open?: number;
    pip_size?: number;
    pip?: number;
};

type TTick = { quote: number; epoch: number; digit: number };

const TICK_WINDOW = 1000;
const CONTRACT_TYPES = [
    { value: 'all', label: 'All contracts' },
    { value: 'DIGITOVER', label: 'Over' },
    { value: 'DIGITUNDER', label: 'Under' },
    { value: 'DIGITMATCH', label: 'Matches' },
    { value: 'DIGITDIFF', label: 'Differs' },
    { value: 'DIGITEVEN', label: 'Even' },
    { value: 'DIGITODD', label: 'Odd' },
    { value: 'CALL', label: 'Rise' },
    { value: 'PUT', label: 'Fall' },
];

const getLastDigit = (quote: number | string, precision?: number) => {
    const numericQuote = Number(quote);
    const quoteText = Number.isFinite(precision) ? numericQuote.toFixed(precision) : String(quote);
    const decimals = quoteText.split('.')[1] || '';
    return Number((decimals || quoteText).slice(-1));
};

const AnalysisTool = observer(({ onRunBot, onStopBot, isBotRunning }: { onRunBot: () => void; onStopBot: () => void; isBotRunning: boolean }) => {
    const [markets, setMarkets] = useState<TMarket[]>([]);
    const [marketPrecisions, setMarketPrecisions] = useState<Record<string, number>>({});
    const [socketReady, setSocketReady] = useState(false);
    const [selectedMarket, setSelectedMarket] = useState('R_100');
    const [contractType, setContractType] = useState('all');
    const [overUnderDigit, setOverUnderDigit] = useState(5);
    const [ticks, setTicks] = useState<TTick[]>([]);
    const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [error, setError] = useState('');

    const frequencies = useMemo(
        () => Array.from({ length: 10 }, (_, digit) => ({
            digit,
            count: ticks.filter(tick => tick.digit === digit).length,
            percentage: ticks.length ? (ticks.filter(tick => tick.digit === digit).length / ticks.length) * 100 : 0,
        })),
        [ticks]
    );
    const highestDigit = useMemo(
        () => frequencies.reduce((best, item) => (item.count > best.count ? item : best), frequencies[0]),
        [frequencies]
    );
    const latestDigit = ticks.length ? ticks[ticks.length - 1].digit : null;
    // Over/Under percentages are conditional on outcomes above or below the
    // selected barrier. The barrier digit itself is excluded and disclosed.
    const overUnderStats = useMemo(() => {
        const overCount = ticks.filter(tick => tick.digit > overUnderDigit).length;
        const underCount = ticks.filter(tick => tick.digit < overUnderDigit).length;
        const excludedCount = ticks.filter(tick => tick.digit === overUnderDigit).length;
        const eligibleCount = overCount + underCount;
        return {
            overCount,
            underCount,
            excludedCount,
            eligibleCount,
            overPercentage: eligibleCount ? (overCount / eligibleCount) * 100 : 0,
            underPercentage: eligibleCount ? (underCount / eligibleCount) * 100 : 0,
            // Make the rounded card labels add to exactly 100.0%.
            overDisplayPercentage: eligibleCount ? Number(((overCount / eligibleCount) * 100).toFixed(1)) : 0,
            underDisplayPercentage: eligibleCount ? 100 - Number(((overCount / eligibleCount) * 100).toFixed(1)) : 0,
        };
    }, [ticks, overUnderDigit]);
    const evenOddStats = useMemo(() => {
        const evenCount = ticks.filter(tick => tick.digit % 2 === 0).length;
        const oddCount = ticks.length - evenCount;
        return {
            evenCount,
            oddCount,
            evenPercentage: ticks.length ? (evenCount / ticks.length) * 100 : 0,
            oddPercentage: ticks.length ? (oddCount / ticks.length) * 100 : 0,
            evenDisplayPercentage: ticks.length ? Number(((evenCount / ticks.length) * 100).toFixed(1)) : 0,
            oddDisplayPercentage: ticks.length ? 100 - Number(((evenCount / ticks.length) * 100).toFixed(1)) : 0,
        };
    }, [ticks]);
    const aiSelections = useMemo(() => {
        const buildSelection = (contract: 'OVER 2' | 'UNDER 7', barrier: number, isOver: boolean) => {
            const eligible = ticks.filter(tick => (isOver ? tick.digit > barrier : tick.digit < barrier));
            const counts = Array.from({ length: 10 }, (_, digit) => ({
                digit,
                count: eligible.filter(tick => tick.digit === digit).length,
            })).filter(item => item.count > 0);
            const prediction = counts.reduce((best, item) => (item.count > best.count ? item : best), counts[0] || { digit: isOver ? 3 : 6, count: 0 });
            return {
                contract,
                barrier,
                probability: eligible.length ? (eligible.length / ticks.length) * 100 : 0,
                prediction: prediction.digit,
                predictionShare: eligible.length ? (prediction.count / eligible.length) * 100 : 0,
            };
        };

        return [
            buildSelection('OVER 2', 2, true),
            buildSelection('UNDER 7', 7, false),
        ];
    }, [ticks]);

    const rankedDigits = useMemo(
        () => [...frequencies].sort((a, b) => a.count - b.count || a.digit - b.digit),
        [frequencies]
    );

    const loadMarkets = useCallback(async () => {
        const api = api_base.api as any;
        if (!api || api.connection?.readyState !== 1) {
            setConnection('disconnected');
            return;
        }
        try {
            // Use the same active-symbol loader as the rest of GTraders Super.
            // The "brief" catalogue contains the complete active symbol list
            // while keeping this tool on the app's established API path.
            const list = ((await api_base.getActiveSymbols()) || [])
                .filter((item: TMarket) => item.symbol)
                .map((item: TMarket) => ({ ...item, display_name: item.display_name || item.symbol }))
                .sort((a: TMarket, b: TMarket) => {
                    const groupA = a.market_display || a.market || a.submarket_display || a.submarket || '';
                    const groupB = b.market_display || b.market || b.submarket_display || b.submarket || '';
                    return groupA.localeCompare(groupB) || a.display_name.localeCompare(b.display_name);
                });
            setMarkets(list);
            const precisions: Record<string, number> = {};
            list.forEach((item: TMarket) => {
                const pip = item.pip_size || item.pip;
                if (pip && Number(pip) > 0) {
                    const exponent = Number(Number(pip).toExponential().split('e')[1]);
                    precisions[item.symbol] = Math.abs(exponent);
                }
            });
            setMarketPrecisions(precisions);
            setSelectedMarket(previous => list.some((item: TMarket) => item.symbol === previous)
                ? previous
                : list[0]?.symbol || '');
            setConnection('connected');
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Unable to load Deriv markets.');
            setConnection('disconnected');
        }
    }, []);

    useEffect(() => {
        const subscription = connectionStatus$.subscribe(status => {
            const isOpen = status === CONNECTION_STATUS.OPENED;
            setSocketReady(isOpen);
            if (isOpen) loadMarkets();
            else setConnection('disconnected');
        });
        if (api_base.api?.connection?.readyState === 1) {
            setSocketReady(true);
            loadMarkets();
        }
        return () => subscription.unsubscribe();
    }, [loadMarkets]);

    useEffect(() => {
        const api = api_base.api as any;
        if (!socketReady || !api || api.connection?.readyState !== 1) {
            setConnection('disconnected');
            return undefined;
        }
        if (!selectedMarket) {
            setConnection('connecting');
            return undefined;
        }

        let active = true;
        let subscriptionId = '';
        setTicks([]);
        setError('');
        setConnection('connecting');

        const messageSubscription = api.onMessage().subscribe((message: any) => {
            const data = message?.data ?? message;
            if (!active || data?.msg_type !== 'tick' || data.tick?.symbol !== selectedMarket) return;
            const quote = Number(data.tick.quote);
            const epoch = Number(data.tick.epoch);
            if (!Number.isFinite(quote) || !Number.isFinite(epoch)) return;
            const precision = marketPrecisions[selectedMarket] ?? (api_base.pip_sizes as Record<string, number>)?.[selectedMarket];
            setTicks(previous => [...previous, { quote, epoch, digit: getLastDigit(data.tick.quote, precision) }].slice(-TICK_WINDOW));
        });

        const startStream = async () => {
            try {
                const response = await api.send({
                    ticks_history: selectedMarket,
                    end: 'latest',
                    count: TICK_WINDOW,
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
                setTicks(prices.map((price, index) => ({
                    quote: Number(price),
                    epoch: Number(times[index] || 0),
                    digit: getLastDigit(price, marketPrecisions[selectedMarket] ?? api_base.pip_sizes?.[selectedMarket]),
                })).slice(-TICK_WINDOW));
                subscriptionId = responseData?.subscription?.id || response?.subscription?.id || '';
                setConnection('connected');
            } catch (requestError) {
                if (!active) return;
                setError(requestError instanceof Error ? requestError.message : 'Unable to stream market ticks.');
                setConnection('disconnected');
            }
        };

        startStream();

        return () => {
            active = false;
            messageSubscription?.unsubscribe?.();
            if (subscriptionId) api.send({ forget: subscriptionId });
        };
    }, [selectedMarket, socketReady, marketPrecisions]);

    const handleMarketChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        if (event.target.value) setSelectedMarket(event.target.value);
    };

    return (
        <main className='analysis-tool'>
            <header className='analysis-tool__header'>
                <div>
                    <span className='analysis-tool__eyebrow'>GTRADERS SUPER · MARKET INTELLIGENCE</span>
                    <h1>Analysis Tool</h1>
                    <p>Live Deriv digit statistics, built into GTraders Super.</p>
                </div>
                <div className={`analysis-tool__status analysis-tool__status--${connection}`}>
                    <span />
                    {connection === 'connected' ? 'Live connection' : connection === 'connecting' ? 'Connecting' : 'Disconnected'}
                </div>
            </header>

            <section className='analysis-tool__controls'>
                <label>
                    <span>Market</span>
                    <select value={selectedMarket} onChange={handleMarketChange}>
                        {markets.length ? markets.map(market => {
                            // Keep the original Deriv symbol as the option value;
                            // only simplify the human-readable label.
                            const label = (market.display_name || market.symbol)
                                .replace(/^(?:Synthetic_Indices|Random_Index)\s*[•·\-:]\s*/i, '');
                            return <option key={market.symbol} value={market.symbol}>{label}</option>;
                        }) : <option value='' disabled>Loading all Deriv markets…</option>}
                    </select>
                </label>
                <label>
                    <span>Contract analysis</span>
                    <select value={contractType} onChange={event => setContractType(event.target.value)}>
                        {CONTRACT_TYPES.map(contract => <option key={contract.value} value={contract.value}>{contract.label}</option>)}
                    </select>
                </label>
                <div className='analysis-tool__window'>
                    <span>Tick window</span>
                    <strong>{TICK_WINDOW.toLocaleString()} ticks</strong>
                </div>
            </section>

            {error && <div className='analysis-tool__error' role='alert'>{error}</div>}

            <section className='analysis-tool__ai-selection'>
                <div className='analysis-tool__section-heading'>
                    <div>
                        <span className='analysis-tool__ai-kicker'>AI MARKET SELECTIONS</span>
                        <h2>Live trade candidates</h2>
                        <p>Estimated from the current tick sample. The last digit shown is an estimate, not a guarantee.</p>
                    </div>
                    <span>{ticks.length.toLocaleString()} live ticks</span>
                </div>
                <div className='analysis-tool__ai-grid'>
                    {aiSelections.map(selection => {
                        const strongest = aiSelections.reduce((best, item) => item.probability > best.probability ? item : best, aiSelections[0]);
                        const isRecommended = ticks.length > 0 && selection.contract === strongest.contract;
                        return (
                            <article key={selection.contract} className={`analysis-tool__ai-card ${isRecommended ? 'is-recommended' : ''}`}>
                                <div className='analysis-tool__ai-card-top'>
                                    <div>
                                        <span className='analysis-tool__ai-contract'>{selection.contract}</span>
                                        <span className='analysis-tool__ai-label'>{isRecommended ? 'AI PREFERRED' : 'AI CANDIDATE'}</span>
                                    </div>
                                    <strong>{ticks.length ? selection.probability.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                                </div>
                                <div className='analysis-tool__ai-prediction'>
                                    <span>Estimated last digit</span>
                                    <strong>{ticks.length ? selection.prediction : '–'}</strong>
                                    <small>{ticks.length ? `Within contract: ${selection.predictionShare.toFixed(1)}%` : 'Waiting for live ticks'}</small>
                                </div>
                            </article>
                        );
                    })}
                </div>
                <button
                    type='button'
                    className={`analysis-tool__run-bot ${isBotRunning ? 'is-stop' : ''}`}
                    onClick={isBotRunning ? onStopBot : onRunBot}
                    disabled={!isBotRunning && !socketReady}
                    aria-pressed={isBotRunning}
                >
                    {isBotRunning ? 'STOP BOT' : 'RUN BOT'}
                </button>
            </section>

            <section className='analysis-tool__overview'>
                <div className='analysis-tool__panel analysis-tool__latest'>
                    <span className='analysis-tool__panel-label'>Latest tick digit</span>
                    <strong className='analysis-tool__metric-value'>{latestDigit === null ? '–' : latestDigit}</strong>
                    <span className='analysis-tool__muted'>The glowing cursor follows this digit in the grid.</span>
                </div>
                <div className='analysis-tool__panel analysis-tool__leader'>
                    <span className='analysis-tool__panel-label'>Frequency leader</span>
                    <strong className='analysis-tool__metric-value analysis-tool__metric-value--leader'>
                        {ticks.length ? highestDigit.digit + ' · ' + highestDigit.percentage.toFixed(2) + '%' : '–'}
                    </strong>
                    <span className='analysis-tool__muted'>Highest observed frequency in the current tick window.</span>
                </div>
            </section>

            <section className='analysis-tool__panel analysis-tool__frequency'>
                <div className='analysis-tool__section-heading'>
                    <div>
                        <h2>Digit frequency</h2>
                        <p>Distribution across the latest {TICK_WINDOW.toLocaleString()} ticks</p>
                    </div>
                    <span>{ticks.length.toLocaleString()} samples</span>
                </div>
                <div className='analysis-tool__digit-grid'>
                    {frequencies.map(item => (
                        <div
                            className={[
                                'analysis-tool__digit-card',
                                ticks.length && item.digit === highestDigit.digit ? 'is-leading' : '',
                                ticks.length > 1 && item.digit === rankedDigits[8].digit ? 'is-second' : '',
                                ticks.length && item.digit === rankedDigits[0].digit ? 'is-lowest' : '',
                                ticks.length > 1 && item.digit === rankedDigits[1].digit ? 'is-second-lowest' : '',
                                latestDigit === item.digit ? 'is-current' : '',
                            ].filter(Boolean).join(' ')}
                            key={item.digit}
                        >
                            <div className='analysis-tool__digit-circle'>
                                <span className='analysis-tool__digit-number'>{item.digit}</span>
                                <strong className='analysis-tool__digit-percentage'>{item.percentage.toFixed(1)}%</strong>
                                {latestDigit === item.digit && <span className='analysis-tool__tick-cursor' aria-label='Latest tick' />}
                            </div>
                            <span>{item.count.toLocaleString()} ticks</span>
                            <div className='analysis-tool__bar'><i style={{ width: `${item.percentage}%` }} /></div>
                        </div>
                    ))}
                </div>
            </section>

            <section className='analysis-tool__probability-section'>
                <div className='analysis-tool__section-heading'>
                    <div>
                        <h2>Over / Under probability</h2>
                        <p>Choose a barrier digit to compare the live tick distribution</p>
                    </div>
                    <span>{ticks.length.toLocaleString()} / {TICK_WINDOW.toLocaleString()} ticks</span>
                </div>
                <div className='analysis-tool__barrier-control'>
                    <label htmlFor='analysis-over-under-digit'>Over / Under digit</label>
                    <select
                        id='analysis-over-under-digit'
                        value={overUnderDigit}
                        onChange={event => setOverUnderDigit(Number(event.target.value))}
                    >
                        {Array.from({ length: 10 }, (_, digit) => (
                            <option key={digit} value={digit}>{digit}</option>
                        ))}
                    </select>
                    <span>Barrier digit {overUnderDigit} is excluded from both sides.</span>
                </div>
                <div className='analysis-tool__probability-grid'>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--over'>
                        <div className='analysis-tool__probability-card-top'>
                            <div>
                                <span className='analysis-tool__probability-kicker'>DIGIT CONTRACT</span>
                                <h3>OVER {overUnderDigit}</h3>
                            </div>
                            <strong>{ticks.length ? overUnderStats.overDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'>
                            <i style={{ width: `${overUnderStats.overPercentage}%` }} />
                        </div>
                        <div className='analysis-tool__probability-meta'>
                            <span>{overUnderStats.overCount.toLocaleString()} ticks</span>
                            <span>Above {overUnderDigit}</span>
                        </div>
                    </article>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--under'>
                        <div className='analysis-tool__probability-card-top'>
                            <div>
                                <span className='analysis-tool__probability-kicker'>DIGIT CONTRACT</span>
                                <h3>UNDER {overUnderDigit}</h3>
                            </div>
                            <strong>{ticks.length ? overUnderStats.underDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'>
                            <i style={{ width: `${overUnderStats.underPercentage}%` }} />
                        </div>
                        <div className='analysis-tool__probability-meta'>
                            <span>{overUnderStats.underCount.toLocaleString()} ticks</span>
                            <span>Below {overUnderDigit}</span>
                        </div>
                    </article>
                </div>
                <p className='analysis-tool__probability-note'>
                    {overUnderStats.eligibleCount.toLocaleString()} eligible ticks · {overUnderStats.excludedCount.toLocaleString()} occurrences of barrier digit {overUnderDigit} excluded.
                    {overUnderStats.eligibleCount ? ` Over + Under = ${(overUnderStats.overPercentage + overUnderStats.underPercentage).toFixed(1)}%.` : ' Waiting for eligible ticks on either side of the barrier.'}
                </p>
            </section>

            <section className='analysis-tool__probability-section analysis-tool__parity-section'>
                <div className='analysis-tool__section-heading'>
                    <div>
                        <h2>Even / Odd probability</h2>
                        <p>Live parity distribution across all observed digits</p>
                    </div>
                    <span>{ticks.length.toLocaleString()} samples</span>
                </div>
                <div className='analysis-tool__probability-grid'>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--even'>
                        <div className='analysis-tool__probability-card-top'>
                            <div>
                                <span className='analysis-tool__probability-kicker'>DIGIT CONTRACT</span>
                                <h3>EVEN</h3>
                            </div>
                            <strong>{ticks.length ? evenOddStats.evenDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'>
                            <i style={{ width: `${evenOddStats.evenPercentage}%` }} />
                        </div>
                        <div className='analysis-tool__probability-meta'>
                            <span>{evenOddStats.evenCount.toLocaleString()} ticks</span>
                            <span>0 · 2 · 4 · 6 · 8</span>
                        </div>
                    </article>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--odd'>
                        <div className='analysis-tool__probability-card-top'>
                            <div>
                                <span className='analysis-tool__probability-kicker'>DIGIT CONTRACT</span>
                                <h3>ODD</h3>
                            </div>
                            <strong>{ticks.length ? evenOddStats.oddDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'>
                            <i style={{ width: `${evenOddStats.oddPercentage}%` }} />
                        </div>
                        <div className='analysis-tool__probability-meta'>
                            <span>{evenOddStats.oddCount.toLocaleString()} ticks</span>
                            <span>1 · 3 · 5 · 7 · 9</span>
                        </div>
                    </article>
                </div>
                <p className='analysis-tool__probability-note'>
                    Even + Odd = {ticks.length ? (evenOddStats.evenPercentage + evenOddStats.oddPercentage).toFixed(1) : '0.0'}% · Both groups use all digits, with no excluded outcomes.
                </p>
            </section>

            <p className='analysis-tool__disclaimer'>
                Statistics describe the selected market's observed ticks. They do not predict or guarantee the next result.
                Always manage risk and verify contract settings before trading.
            </p>
        </main>
    );
});

export default AnalysisTool;
