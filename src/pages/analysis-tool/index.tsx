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

    const loadMarkets = useCallback(async () => {
        const api = api_base.api as any;
        if (!api || api.connection?.readyState !== 1) {
            setConnection('disconnected');
            return;
        }
        try {
            const response = await api.send({ active_symbols: 'brief' });
            const list = (response?.active_symbols || [])
                .filter((item: TMarket) => item.symbol && item.display_name)
                .sort((a: TMarket, b: TMarket) => a.display_name.localeCompare(b.display_name));
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
                : list.find((item: TMarket) => item.symbol === 'R_100')?.symbol || list[0]?.symbol || previous);
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
            setTicks(previous => [...previous, { quote, epoch, digit: getLastDigit(quote) }].slice(-TICK_WINDOW));
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
                const history = response?.history;
                const prices: (number | string)[] = history?.prices || [];
                const times: number[] = history?.times || [];
                setTicks(prices.map((price, index) => ({
                    quote: Number(price),
                    epoch: Number(times[index] || 0),
                    digit: getLastDigit(price, marketPrecisions[selectedMarket] ?? api_base.pip_sizes?.[selectedMarket]),
                })).slice(-TICK_WINDOW));
                subscriptionId = response?.subscription?.id || '';
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
        setSelectedMarket(event.target.value);
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
                        {markets.length ? markets.map(market => (
                            <option key={market.symbol} value={market.symbol}>{market.display_name} ({market.symbol})</option>
                        )) : <option value={selectedMarket}>{selectedMarket}</option>}
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
                    <span className='analysis-tool__panel-label'>Latest digit</span>
                    <div className='analysis-tool__digit-circle analysis-tool__digit-circle--latest'>
                        {latestDigit === null ? '–' : latestDigit}
                    </div>
                    <span className='analysis-tool__muted'>{ticks.length.toLocaleString()} / {TICK_WINDOW.toLocaleString()} ticks collected</span>
                </div>
                <div className='analysis-tool__panel analysis-tool__leader'>
                    <span className='analysis-tool__panel-label'>Most frequent digit</span>
                    <div className='analysis-tool__leader-row'>
                        <div className='analysis-tool__digit-circle analysis-tool__digit-circle--leader'>
                            {ticks.length ? highestDigit.digit : '–'}
                        </div>
                        <div>
                            <strong>{ticks.length ? highestDigit.percentage.toFixed(2) + '%' : '–'}</strong>
                            <span className='analysis-tool__muted'>of observed ticks</span>
                        </div>
                    </div>
                    <span className='analysis-tool__muted'>A statistical frequency leader, not a prediction guarantee.</span>
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
                        <div className={`analysis-tool__digit-card${ticks.length && item.digit === highestDigit.digit ? ' is-leading' : ''}`} key={item.digit}>
                            <div className='analysis-tool__digit-circle'>{item.digit}</div>
                            <strong>{item.percentage.toFixed(1)}%</strong>
                            <span>{item.count} ticks</span>
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
