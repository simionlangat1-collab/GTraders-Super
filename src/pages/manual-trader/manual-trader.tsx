import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { CONNECTION_STATUS, connectionStatus$ } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { TradeControls } from './components/trade-controls';
import { TradeHistory } from './components/trade-history';
import { ManualTraderAnalysisDashboard } from './components/analysis-dashboard';
import { ManualTraderDistributionPanels } from './components/distribution-dashboard';
import { ManualContractType, ManualMarketSymbol, ManualTradeRecord } from './types';
import './manual-trader.scss';

const TICK_WINDOW = 1000;
type TDigitTick = { quote: number; epoch: number; digit: number };

const getLastDigit = (quote: number | string, precision?: number) => {
    const numericQuote = Number(quote);
    const quoteText = Number.isFinite(precision) ? numericQuote.toFixed(precision) : String(quote);
    const decimals = quoteText.split('.')[1] || '';
    return Number((decimals || quoteText).slice(-1));
};

const ManualTrader = () => {
    const [symbols, setSymbols] = useState<ManualMarketSymbol[]>([]);
    const [symbol, setSymbol] = useState('');
    const [contractType, setContractType] = useState<ManualContractType>('DIGITOVER');
    const [duration, setDuration] = useState(1);
    const [stake, setStake] = useState('0.00');
    const [prediction, setPrediction] = useState(5);
    const [digitTicks, setDigitTicks] = useState<TDigitTick[]>([]);
    const [tickConnection, setTickConnection] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [socketReady, setSocketReady] = useState(false);
    const [tickError, setTickError] = useState('');
    const accountKey = String((api_base.account_info as any)?.loginid || 'guest');
    const historyStorageKey = `gtraders_manual_trader_history_${accountKey}`;
    const [trades, setTrades] = useState<ManualTradeRecord[]>(() => {
        try {
            return JSON.parse(window.sessionStorage.getItem(historyStorageKey) || '[]') as ManualTradeRecord[];
        } catch {
            return [];
        }
    });
    const [connection, setConnection] = useState(api_base.getConnectionStatus());
    const currency = String((api_base.account_info as any)?.currency || 'USD');

    const loadSymbols = useCallback(async () => {
        try {
            if (!api_base.api) return;
            const available = api_base.active_symbols.length ? api_base.active_symbols : await api_base.getActiveSymbols();
            const volatility = (available || [])
                .filter((item: any) => item.market === 'synthetic_index' && item.exchange_is_open && !item.is_trading_suspended)
                .map((item: any) => ({
                    symbol: item.symbol,
                    display_name: item.display_name || item.symbol,
                    market: item.market,
                    exchange_is_open: item.exchange_is_open,
                    is_trading_suspended: item.is_trading_suspended,
                }))
                .sort((a: ManualMarketSymbol, b: ManualMarketSymbol) => a.display_name.localeCompare(b.display_name));
            setSymbols(volatility);
            setSymbol(current => volatility.some(item => item.symbol === current) ? current : volatility[0]?.symbol || '');
        } catch {
            setSymbols([]);
        }
    }, []);

    useEffect(() => {
        const refresh = () => setConnection(api_base.getConnectionStatus());
        refresh();
        const interval = window.setInterval(refresh, 1500);
        void loadSymbols();
        return () => window.clearInterval(interval);
    }, [loadSymbols]);

    useEffect(() => {
        const updateSocketReady = (status: string) => {
            setSocketReady(status === CONNECTION_STATUS.OPENED);
        };
        const statusSubscription = connectionStatus$.subscribe(updateSocketReady);
        updateSocketReady(connectionStatus$.value);
        if (api_base.api?.connection?.readyState === 1) setSocketReady(true);
        return () => statusSubscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (connection === CONNECTION_STATUS.OPENED && symbols.length === 0) {
            void loadSymbols();
        }
    }, [connection, symbols.length, loadSymbols]);

    useEffect(() => {
        const api = api_base.api as any;
        if (!socketReady || !api || api.connection?.readyState !== 1 || !symbol) {
            setTickConnection('disconnected');
            setDigitTicks([]);
            return undefined;
        }

        let active = true;
        let subscriptionId = '';
        setDigitTicks([]);
        setTickError('');
        setTickConnection('connecting');

        const precision = (api_base.pip_sizes as Record<string, number>)?.[symbol];
        const messageSubscription = api.onMessage().subscribe((message: any) => {
            const data = message?.data ?? message;
            if (!active || data?.msg_type !== 'tick' || data.tick?.symbol !== symbol) return;
            const quote = Number(data.tick.quote);
            const epoch = Number(data.tick.epoch);
            if (!Number.isFinite(quote) || !Number.isFinite(epoch)) return;
            setDigitTicks(previous => [
                ...previous,
                { quote, epoch, digit: getLastDigit(data.tick.quote, precision) },
            ].slice(-TICK_WINDOW));
        });

        const startStream = async () => {
            try {
                const response = await api.send({
                    ticks_history: symbol,
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
                const historicalTicks = prices.map((price, index) => ({
                    quote: Number(price),
                    epoch: Number(times[index] || 0),
                    digit: getLastDigit(price, precision),
                }));
                setDigitTicks(previous => [...historicalTicks, ...previous].sort((a, b) => a.epoch - b.epoch).slice(-TICK_WINDOW));
                subscriptionId = responseData?.subscription?.id || response?.subscription?.id || '';
                setTickConnection('connected');
            } catch (requestError) {
                if (!active) return;
                setTickError(requestError instanceof Error ? requestError.message : 'Unable to stream market ticks.');
                setTickConnection('disconnected');
            }
        };

        void startStream();
        return () => {
            active = false;
            messageSubscription?.unsubscribe?.();
            if (subscriptionId) api.send({ forget: subscriptionId });
        };
    }, [symbol, socketReady]);

    useEffect(() => {
        try {
            window.sessionStorage.setItem(historyStorageKey, JSON.stringify(trades));
        } catch {
            // Keep the live workspace usable if browser storage is unavailable.
        }
    }, [historyStorageKey, trades]);

    const selectedSymbol = useMemo(() => symbols.find(item => item.symbol === symbol), [symbols, symbol]);

    return (
        <main className='manual-trader'>
            <header className='manual-trader__header'>
                <div><h2>Manual Trader</h2><p>Trade Volatility Indices with digit contracts and tick durations.</p></div>
                <span className={`manual-trader__connection ${connection === CONNECTION_STATUS.OPENED ? 'is-ready' : ''}`}>{connection === CONNECTION_STATUS.OPENED ? 'Deriv connected' : connection}</span>
            </header>

            <ManualTraderAnalysisDashboard
                ticks={digitTicks}
                marketName={selectedSymbol?.display_name || symbol}
                tickConnection={tickConnection}
                tickError={tickError}
            />

            <TradeControls
                symbols={symbols}
                symbol={symbol}
                contractType={contractType}
                duration={duration}
                stake={stake}
                prediction={prediction}
                onSymbolChange={setSymbol}
                onContractChange={setContractType}
                onDurationChange={setDuration}
                onStakeChange={setStake}
                onPredictionChange={setPrediction}
            />

            <TradeHistory trades={trades} currency={currency} />

            <ManualTraderDistributionPanels ticks={digitTicks} />
        </main>
    );
};

export default ManualTrader;
