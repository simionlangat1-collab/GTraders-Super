import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { CONNECTION_STATUS, connectionStatus$ } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { manualTradeService } from './services/manual-trade-service';
import { TradeControls } from './components/trade-controls';
import { TradeHistory } from './components/trade-history';
import { ManualTraderAnalysisDashboard } from './components/analysis-dashboard';
import { ManualTraderDistributionPanels } from './components/distribution-dashboard';
import { ManualContractType, ManualMarketSymbol, ManualTradeRecord } from './types';
import './manual-trader.scss';

const TICK_WINDOW = 1000;
type TDigitTick = { quote: number; epoch: number; digit: number };
type TradeSide = 'over' | 'under';
type PayoutQuotes = { over: number | null; under: number | null };
type TradeResultHighlight = { digit: number; status: 'won' | 'lost'; profit: number; currency: string; key: string };
type TradeNotification = { status: 'won' | 'lost'; profit: number; currency: string; key: string };

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
    const [payoutQuotes, setPayoutQuotes] = useState<PayoutQuotes>({ over: null, under: null });
    const [buyingSide, setBuyingSide] = useState<TradeSide | null>(null);
    const [tradeError, setTradeError] = useState('');
    const [tradeResultHighlight, setTradeResultHighlight] = useState<TradeResultHighlight | null>(null);
    const [tradeNotification, setTradeNotification] = useState<TradeNotification | null>(null);
    const notificationTimer = useRef<number | null>(null);
    const completedContracts = useRef(new Set<number>());
    const buyLock = useRef(false);
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
        let active = true;
        const amount = Number(stake);
        if (!socketReady || !api_base.api || !api_base.is_authorized || !symbol || !Number.isFinite(amount) || amount <= 0) {
            setPayoutQuotes({ over: null, under: null });
            return () => { active = false; };
        }

        setPayoutQuotes({ over: null, under: null });
        const quoteTypes: Record<string, { over: ManualContractType; under: ManualContractType }> = {
            DIGITOVER: { over: 'DIGITOVER', under: 'DIGITUNDER' },
            DIGITEVEN: { over: 'DIGITEVEN', under: 'DIGITODD' },
            DIGITMATCH: { over: 'DIGITMATCH', under: 'DIGITDIFF' },
            CALL: { over: 'CALL', under: 'PUT' },
        };
        const group = contractType === 'DIGITUNDER' ? 'DIGITOVER'
            : contractType === 'DIGITODD' ? 'DIGITEVEN'
                : contractType === 'DIGITDIFF' ? 'DIGITMATCH'
                    : contractType === 'PUT' ? 'CALL' : contractType;
        const types = quoteTypes[group] || quoteTypes.DIGITOVER;
        const options = (side: TradeSide) => ({
            symbol,
            contractType: types[side],
            amount,
            currency,
            duration,
            prediction,
        });

        Promise.all([
            manualTradeService.getProposal(options('over')),
            manualTradeService.getProposal(options('under')),
        ]).then(([over, under]) => {
            if (active) setPayoutQuotes({ over: over.payout, under: under.payout });
        }).catch(() => {
            if (active) setPayoutQuotes({ over: null, under: null });
        });

        return () => { active = false; };
    }, [socketReady, symbol, contractType, stake, currency, duration, prediction]);

    useEffect(() => {
        try {
            window.sessionStorage.setItem(historyStorageKey, JSON.stringify(trades));
        } catch {
            // Keep the live workspace usable if browser storage is unavailable.
        }
    }, [historyStorageKey, trades]);

    const selectedSymbol = useMemo(() => symbols.find(item => item.symbol === symbol), [symbols, symbol]);

    const clearTradeResultHighlight = useCallback((key: string) => {
        setTradeResultHighlight(current => current?.key === key ? null : current);
    }, []);

    useEffect(() => () => {
        if (notificationTimer.current !== null) window.clearTimeout(notificationTimer.current);
    }, []);

    const executeTrade = useCallback(async (side: TradeSide) => {
        if (buyLock.current) return;
        buyLock.current = true;
        setBuyingSide(side);
        setTradeError('');
        const amount = Number(stake);
        let tradeStage: 'proposal' | 'purchase' | 'monitoring' = 'proposal';

        try {
            if (!api_base.api || !api_base.is_authorized) {
                throw new Error('Please connect and authorize your Deriv account first.');
            }
            if (!symbol) throw new Error('Please select a Volatility market.');
            if (!Number.isFinite(amount) || amount <= 0) throw new Error('Please set a stake greater than zero.');

            const quoteTypes: Record<string, { over: ManualContractType; under: ManualContractType }> = {
                DIGITOVER: { over: 'DIGITOVER', under: 'DIGITUNDER' },
                DIGITEVEN: { over: 'DIGITEVEN', under: 'DIGITODD' },
                DIGITMATCH: { over: 'DIGITMATCH', under: 'DIGITDIFF' },
                CALL: { over: 'CALL', under: 'PUT' },
            };
            const group = contractType === 'DIGITUNDER' ? 'DIGITOVER'
                : contractType === 'DIGITODD' ? 'DIGITEVEN'
                    : contractType === 'DIGITDIFF' ? 'DIGITMATCH'
                        : contractType === 'PUT' ? 'CALL' : contractType;
            const selectedContract = quoteTypes[group]?.[side];
            if (!selectedContract) throw new Error('This contract selection is not supported.');

            const proposal = await manualTradeService.getProposal({
                symbol,
                contractType: selectedContract,
                amount,
                currency,
                duration,
                prediction,
            });
            tradeStage = 'purchase';
            const purchase = await manualTradeService.buy(proposal.id, proposal.ask_price);
            const contractId = Number(purchase.contract_id);
            const record: ManualTradeRecord = {
                contract_id: contractId,
                contract_type: selectedContract,
                symbol,
                symbol_name: selectedSymbol?.display_name || symbol,
                buy_price: Number(purchase.buy_price ?? proposal.ask_price),
                payout: proposal.payout,
                currency,
                status: 'open',
                purchase_time: Date.now(),
            };
            setContractType(selectedContract);
            setTrades(previous => [record, ...previous]);
            tradeStage = 'monitoring';
            void manualTradeService.observeContract(contractId, contract => {
                const contractStatus = String(contract.status || 'open');
                const status: ManualTradeRecord['status'] =
                    contractStatus === 'won' ? 'won'
                        : contractStatus === 'lost' ? 'lost'
                            : contractStatus === 'sold' ? 'sold' : 'open';
                const profit = Number(contract.profit);
                setTrades(previous => previous.map(item => item.contract_id === contractId ? {
                    ...item,
                    status,
                    ...(Number.isFinite(profit) ? { profit } : {}),
                    ...(contract.entry_spot !== undefined ? { entry_tick: contract.entry_spot } : contract.entry_tick !== undefined ? { entry_tick: contract.entry_tick } : {}),
                    ...(contract.exit_spot !== undefined ? { exit_tick: contract.exit_spot } : contract.exit_tick !== undefined ? { exit_tick: contract.exit_tick } : {}),
                } : item));

                const resultSpot = contract.exit_spot ?? contract.exit_tick ?? contract.current_spot;
                if ((status === 'won' || status === 'lost') && Number.isFinite(profit) && resultSpot !== undefined && !completedContracts.current.has(contractId)) {
                    completedContracts.current.add(contractId);
                    const exitPrecision = (api_base.pip_sizes as Record<string, number>)?.[symbol];
                    const resultDigit = getLastDigit(resultSpot, exitPrecision);
                    const resultKey = `${contractId}-${status}-${String(resultSpot)}-${Date.now()}`;
                    const result = { digit: resultDigit, status, profit, currency, key: resultKey } as TradeResultHighlight;
                    setTradeResultHighlight(result);
                    setTradeNotification({ status, profit, currency, key: resultKey });
                    if (notificationTimer.current !== null) window.clearTimeout(notificationTimer.current);
                    notificationTimer.current = window.setTimeout(() => setTradeNotification(null), 5000);
                }
            }).catch(error => {
                setTradeError(error instanceof Error ? error.message : 'Trade opened, but contract updates could not be received.');
            });
        } catch (error: any) {
            const apiMessage =
                (typeof error === 'string' && error) ||
                error?.error?.message ||
                error?.data?.error?.message ||
                error?.message ||
                error?.data?.message ||
                (error?.code ? `${error.code}: ${error?.message || 'Request rejected'}` : '');
            const fallback = 'Deriv returned an unexpected response. Please try again.';
            setTradeError(`${tradeStage === 'proposal' ? 'Quote request' : tradeStage === 'purchase' ? 'Purchase request' : 'Contract monitoring'} failed: ${apiMessage || fallback}`);
        } finally {
            buyLock.current = false;
            setBuyingSide(null);
        }
    }, [stake, symbol, contractType, currency, duration, prediction, selectedSymbol]);

    return (
        <main className='manual-trader'>
            {tradeNotification && (
                <div
                    className={`manual-trader__trade-notification manual-trader__trade-notification--${tradeNotification.status}`}
                    role='status'
                    aria-live='polite'
                >
                    {tradeNotification.status === 'won' ? '+' : '-'} {Math.abs(tradeNotification.profit).toFixed(2)} {tradeNotification.currency} {tradeNotification.status === 'won' ? 'Win' : 'Loss'}
                </div>
            )}

            <header className='manual-trader__header'>
                <div><h2>Manual Trader</h2><p>Trade Volatility Indices with digit contracts and tick durations.</p></div>
                <span className={`manual-trader__connection ${connection === CONNECTION_STATUS.OPENED ? 'is-ready' : ''}`}>{connection === CONNECTION_STATUS.OPENED ? 'Deriv connected' : connection}</span>
            </header>

            <ManualTraderAnalysisDashboard
                ticks={digitTicks}
                marketName={selectedSymbol?.display_name || symbol}
                tickConnection={tickConnection}
                tickError={tickError}
                tradeResultHighlight={tradeResultHighlight}
                onTradeResultAnimationEnd={clearTradeResultHighlight}
                barrierDigit={prediction}
            />

            <TradeControls
                symbols={symbols}
                symbol={symbol}
                contractType={contractType}
                duration={duration}
                stake={stake}
                prediction={prediction}
                currency={currency}
                overPayout={payoutQuotes.over}
                underPayout={payoutQuotes.under}
                buyingSide={buyingSide}
                buyDisabled={!socketReady || !api_base.is_authorized || !symbol || Number(stake) <= 0}
                tradeError={tradeError}
                onBuy={executeTrade}
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
