import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import './analysis-tool.scss';

type DigitRank = 'hot' | 'warm' | 'cold' | 'cool' | 'neutral';

const WINDOW_OPTIONS = [100, 250, 500, 750, 1000];

const getLastDigit = (quote: number | string, precision: number) => {
    const formatted_quote = Number(quote).toFixed(precision);
    return Number(formatted_quote.charAt(formatted_quote.length - 1));
};

const AnalysisTool = observer(() => {
    const { connectionStatus, isAuthorized } = useApiBase();
    const [symbol, setSymbol] = useState('R_100');
    const [windowSize, setWindowSize] = useState(500);
    const [ticks, setTicks] = useState<number[]>([]);
    const [lastQuote, setLastQuote] = useState('—');
    const [lastDigit, setLastDigit] = useState<number | null>(null);
    const [feedStatus, setFeedStatus] = useState<'waiting' | 'connecting' | 'live' | 'error'>('waiting');
    const [feedError, setFeedError] = useState('');
    const [tickPrecision, setTickPrecision] = useState(2);

    const isConnected = connectionStatus === CONNECTION_STATUS.OPENED;

    const marketOptions = useMemo(() => {
        const symbols = (api_base.active_symbols || [])
            .map((item: any) => ({
                symbol: item.symbol || item.underlying_symbol,
                label: item.display_name || item.underlying_symbol_name || item.symbol_display || item.symbol,
            }))
            .filter((item: { symbol?: string; label?: string }) => Boolean(item.symbol && item.label));

        return symbols
            .filter((item: { symbol: string }, index: number, all: { symbol: string }[]) =>
                all.findIndex(candidate => candidate.symbol === item.symbol) === index
            )
            .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));
    }, [connectionStatus, isAuthorized, api_base.active_symbols?.length]);

    const digitStats = useMemo(() => {
        const counts = Array(10).fill(0);
        ticks.forEach(digit => {
            if (digit >= 0 && digit <= 9) counts[digit] += 1;
        });

        const total = ticks.length;
        const ranked = counts
            .map((count, digit) => ({ digit, count, percentage: total ? (count / total) * 100 : 0 }))
            .sort((a, b) => b.percentage - a.percentage || a.digit - b.digit);

        const ranks: DigitRank[] = Array(10).fill('neutral');
        if (total) {
            ranks[ranked[0].digit] = 'hot';
            ranks[ranked[1].digit] = 'warm';
            ranks[ranked[8].digit] = 'cool';
            ranks[ranked[9].digit] = 'cold';
        }

        return counts.map((count, digit) => ({
            digit,
            count,
            percentage: total ? (count / total) * 100 : 0,
            rank: ranks[digit],
        }));
    }, [ticks]);

    useEffect(() => {
        if (marketOptions.length && !marketOptions.some((item: { symbol: string }) => item.symbol === symbol)) {
            setSymbol(marketOptions[0].symbol);
        }
    }, [marketOptions, symbol]);

    useEffect(() => {
        if (!isConnected || !api_base.api) {
            setFeedStatus('waiting');
            setTicks([]);
            setLastQuote('—');
            setLastDigit(null);
            return undefined;
        }

        let subscriptionId = '';
        const requestId = Math.floor(Date.now() % 1000000000);
        let active = true;
        setFeedStatus('connecting');
        setFeedError('');
        setTicks([]);
        setLastQuote('—');
        setLastDigit(null);

        const messageStream = api_base.api.onMessage().subscribe((message: any) => {
            const data = message?.data ?? message;
            if (!active || !data) return;

            if (data.error && data.echo_req?.req_id === requestId) {
                setFeedError(data.error.message || 'Unable to load live tick data.');
                setFeedStatus('error');
                return;
            }

            if (data.msg_type === 'history' && data.echo_req?.req_id === requestId) {
                const precision = Number(data.pip_size ?? 2);
                const prices = data.history?.prices || [];
                const initial_ticks = prices
                    .map((price: number | string) => getLastDigit(price, precision))
                    .slice(-windowSize);

                subscriptionId = data.subscription?.id || subscriptionId;
                setTickPrecision(precision);
                setTicks(initial_ticks);
                if (prices.length) {
                    setLastQuote(Number(prices[prices.length - 1]).toFixed(precision));
                    setLastDigit(getLastDigit(prices[prices.length - 1], precision));
                }
                setFeedStatus('live');
                return;
            }

            if (data.msg_type === 'tick' && data.tick) {
                const belongs_to_this_feed =
                    data.echo_req?.req_id === requestId ||
                    (subscriptionId && data.subscription?.id === subscriptionId);
                if (!belongs_to_this_feed) return;

                const precision = Number(data.tick.pip_size ?? tickPrecision);
                const digit = getLastDigit(data.tick.quote, precision);
                subscriptionId = data.subscription?.id || subscriptionId;
                setTickPrecision(precision);
                setLastQuote(Number(data.tick.quote).toFixed(precision));
                setLastDigit(digit);
                setTicks(previous => [...previous, digit].slice(-windowSize));
                setFeedStatus('live');
            }
        });

        api_base.api.send({
            ticks_history: symbol,
            count: windowSize,
            end: 'latest',
            style: 'ticks',
            subscribe: 1,
            req_id: requestId,
        });

        return () => {
            active = false;
            messageStream.unsubscribe();
            if (subscriptionId && api_base.api) {
                api_base.api.send({ forget: subscriptionId });
            }
        };
    }, [isConnected, symbol, windowSize]);

    const latestDigits = ticks.slice(-20).reverse();
    const currentMarket = marketOptions.find((item: { symbol: string }) => item.symbol === symbol);

    return (
        <main className='analysis-tool'>
            <header className='analysis-tool__header'>
                <div>
                    <span className='analysis-tool__eyebrow'>GTRADERS SUPER · MARKET INTELLIGENCE</span>
                    <h1>Live Digit Analyzer</h1>
                    <p>Watch live last-digit frequency and distribution from Deriv market ticks.</p>
                </div>
                <div className={`analysis-tool__connection analysis-tool__connection--${feedStatus}`}>
                    <span />
                    {feedStatus === 'live'
                        ? 'LIVE TICK FEED'
                        : feedStatus === 'connecting'
                          ? 'CONNECTING'
                          : feedStatus === 'error'
                            ? 'FEED ERROR'
                            : isConnected
                              ? 'READY TO CONNECT'
                              : 'WAITING FOR DERIV'}
                </div>
            </header>

            <section className='analysis-tool__controls'>
                <label className='analysis-tool__control'>
                    <span>MARKET</span>
                    <select value={symbol} onChange={event => setSymbol(event.target.value)} disabled={!isConnected}>
                        {marketOptions.length ? (
                            marketOptions.map((item: { symbol: string; label: string }) => (
                                <option key={item.symbol} value={item.symbol}>
                                    {item.label}
                                </option>
                            ))
                        ) : (
                            <option value={symbol}>{symbol}</option>
                        )}
                    </select>
                </label>
                <label className='analysis-tool__control analysis-tool__control--window'>
                    <span>ANALYSIS WINDOW</span>
                    <select
                        value={windowSize}
                        onChange={event => setWindowSize(Number(event.target.value))}
                        disabled={!isConnected}
                    >
                        {WINDOW_OPTIONS.map(size => (
                            <option key={size} value={size}>
                                Last {size} ticks
                            </option>
                        ))}
                    </select>
                </label>
                <div className='analysis-tool__feed-meta'>
                    <span>MARKET</span>
                    <strong>{currentMarket?.symbol || symbol}</strong>
                    <small>{isAuthorized ? 'Deriv account connected' : 'Public market data'}</small>
                </div>
            </section>

            {feedError && <div className='analysis-tool__error'>{feedError}</div>}

            <section className='analysis-tool__overview'>
                <article className='analysis-tool__metric'>
                    <span>LAST QUOTE</span>
                    <strong>{lastQuote}</strong>
                    <small>{currentMarket?.label || symbol}</small>
                </article>
                <article className='analysis-tool__metric analysis-tool__metric--accent'>
                    <span>LATEST DIGIT</span>
                    <strong>{lastDigit === null ? '—' : lastDigit}</strong>
                    <small>Most recent tick</small>
                </article>
                <article className='analysis-tool__metric'>
                    <span>TICKS IN WINDOW</span>
                    <strong>{ticks.length}<small> / {windowSize}</small></strong>
                    <small>Rolling sample</small>
                </article>
            </section>

            <section className='analysis-tool__workspace'>
                <div className='analysis-tool__section-heading'>
                    <div>
                        <h2>Digit frequency battlefield</h2>
                        <p>Each percentage is calculated from the selected rolling tick window.</p>
                    </div>
                    <span className='analysis-tool__sample'>{ticks.length ? `${ticks.length} SAMPLES` : 'WAITING FOR TICKS'}</span>
                </div>

                <div className='analysis-tool__digit-grid'>
                    {digitStats.map(item => (
                        <div
                            className={`analysis-tool__digit analysis-tool__digit--${item.rank}${lastDigit === item.digit && feedStatus === 'live' ? ' analysis-tool__digit--active' : ''}`}
                            key={item.digit}
                        >
                            <strong>{item.digit}</strong>
                            <span>{item.percentage.toFixed(1)}%</span>
                            <small>{item.count} ticks</small>
                        </div>
                    ))}
                </div>

                <div className='analysis-tool__cursor'>
                    <div className='analysis-tool__cursor-trail'>
                        {[1, 2, 3, 4, 5].map(dot => <i key={dot} className={`analysis-tool__trail-dot analysis-tool__trail-dot--${dot}`} />)}
                    </div>
                    <div className='analysis-tool__cursor-core'>
                        <span>{lastDigit === null ? '—' : lastDigit}</span>
                    </div>
                    <div className='analysis-tool__cursor-trail analysis-tool__cursor-trail--right'>
                        {[1, 2, 3, 4, 5].map(dot => <i key={dot} className={`analysis-tool__trail-dot analysis-tool__trail-dot--${dot}`} />)}
                    </div>
                    <div className='analysis-tool__cursor-caption'>
                        {lastDigit === null ? 'Waiting for the first live digit' : `Cursor tracking latest digit · ${lastDigit}`}
                    </div>
                </div>

                <div className='analysis-tool__rank-legend'>
                    <span><i className='analysis-tool__legend-dot analysis-tool__legend-dot--hot' /> Highest frequency</span>
                    <span><i className='analysis-tool__legend-dot analysis-tool__legend-dot--warm' /> 2nd highest</span>
                    <span><i className='analysis-tool__legend-dot analysis-tool__legend-dot--cold' /> Lowest frequency</span>
                </div>
            </section>

            <section className='analysis-tool__stream'>
                <div className='analysis-tool__section-heading'>
                    <div>
                        <h2>Recent digit stream</h2>
                        <p>Latest 20 incoming digits, newest first.</p>
                    </div>
                </div>
                <div className='analysis-tool__stream-list'>
                    {latestDigits.length ? latestDigits.map((digit, index) => (
                        <span className={index === 0 ? 'analysis-tool__stream-digit analysis-tool__stream-digit--latest' : 'analysis-tool__stream-digit'} key={`${index}-${digit}`}>
                            {digit}
                        </span>
                    )) : <span className='analysis-tool__stream-empty'>Live digits will appear here when the feed starts.</span>}
                </div>
            </section>

            <p className='analysis-tool__disclaimer'>
                Statistics describe the selected historical tick sample. They do not predict or guarantee the next digit.
            </p>
        </main>
    );
});

export default AnalysisTool;
