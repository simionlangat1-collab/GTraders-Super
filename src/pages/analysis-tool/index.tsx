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

const AnalysisTool = observer(() => {
    const [markets, setMarkets] = useState<TMarket[]>([]);
    const [marketPrecisions, setMarketPrecisions] = useState<Record<string, number>>({});
    const [socketReady, setSocketReady] = useState(false);
    const [selectedMarket, setSelectedMarket] = useState('R_100');
    const [contractType, setContractType] = useState('all');
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
            // Request the full, unfiltered Deriv catalogue so every available
            // market and symbol can be selected in this independent analyzer.
            const response = await api.send({ active_symbols: 'full' });
            const payload = typeof response === 'string' ? JSON.parse(response) : response;
            const data = payload?.data ?? payload;
            const list = (data?.active_symbols || [])
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
        if (!socketReady || !api || api.connection?.readyState !== 1 || !selectedMarket) {
            setConnection('disconnected');
            return undefined;
        }

        let active = true;
        let subscriptionId = '';
        setTicks([]);
        setError('');
        setConnection('connecting');

        const messageSubscription = api.onMessage().subscribe((message: any) => {
            const data = message?.data;
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
                            const group = market.market_display || market.market || 'Other markets';
                            const submarket = market.submarket_display || market.submarket;
                            const label = [group, submarket, market.display_name]
                                .filter((value, index, values) => value && values.indexOf(value) === index)
                                .join(' · ');
                            return <option key={market.symbol} value={market.symbol}>{label} ({market.symbol})</option>;
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

            <p className='analysis-tool__disclaimer'>
                Statistics describe the selected market's observed ticks. They do not predict or guarantee the next result.
                Always manage risk and verify contract settings before trading.
            </p>
        </main>
    );
});

export default AnalysisTool;
