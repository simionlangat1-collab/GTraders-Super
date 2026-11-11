import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { TradeControls } from './components/trade-controls';
import { TradeHistory } from './components/trade-history';
import { TradePanel } from './components/trade-panel';
import { manualTradeService } from './services/manual-trade-service';
import { ManualContractType, ManualMarketSymbol, ManualTradeRecord } from './types';
import './manual-trader.scss';

const ManualTrader = () => {
    const [symbols, setSymbols] = useState<ManualMarketSymbol[]>([]);
    const [symbol, setSymbol] = useState('');
    const [contractType, setContractType] = useState<ManualContractType>('DIGITOVER');
    const [duration, setDuration] = useState(1);
    const [stake, setStake] = useState('1');
    const [prediction, setPrediction] = useState(5);
    const [proposal, setProposal] = useState<{ id: string; ask_price: number; payout: number } | null>(null);
    const accountKey = String((api_base.account_info as any)?.loginid || 'guest');
    const historyStorageKey = `gtraders_manual_trader_history_${accountKey}`;
    const [trades, setTrades] = useState<ManualTradeRecord[]>(() => {
        try {
            return JSON.parse(window.sessionStorage.getItem(historyStorageKey) || '[]') as ManualTradeRecord[];
        } catch {
            return [];
        }
    });
    const [loading, setLoading] = useState(false);
    const [buying, setBuying] = useState(false);
    const [error, setError] = useState('');
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
            if (volatility.length === 0) setError('No open Volatility Indices are currently available on this account.');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to load Volatility Indices.');
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
        if (connection === CONNECTION_STATUS.OPENED && symbols.length === 0) {
            void loadSymbols();
        }
    }, [connection, symbols.length, loadSymbols]);

    useEffect(() => {
        setProposal(null);
    }, [symbol, contractType, duration, stake, prediction]);

    useEffect(() => {
        try {
            window.sessionStorage.setItem(historyStorageKey, JSON.stringify(trades));
        } catch {
            // Keep the live workspace usable if browser storage is unavailable.
        }
    }, [historyStorageKey, trades]);

    const selectedSymbol = useMemo(() => symbols.find(item => item.symbol === symbol), [symbols, symbol]);

    const getProposal = async () => {
        setError('');
        setProposal(null);
        const amount = Number(stake);
        if (!symbol) return setError('Select an available Volatility Index.');
        if (!Number.isFinite(amount) || amount <= 0) return setError('Enter a valid positive stake.');
        if (!Number.isInteger(duration) || duration < 1) return setError('Tick duration must be a positive whole number.');
        setLoading(true);
        try {
            const quote = await manualTradeService.getProposal({
                symbol, contractType, amount, currency, duration, prediction,
            });
            setProposal(quote);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to get proposal.');
        } finally {
            setLoading(false);
        }
    };

    const buy = async () => {
        if (!proposal) return;
        setBuying(true);
        setError('');
        try {
            const result = await manualTradeService.buy(proposal.id, proposal.ask_price);
            const record: ManualTradeRecord = {
                contract_id: Number(result.contract_id),
                contract_type: contractType,
                symbol,
                symbol_name: selectedSymbol?.display_name || symbol,
                buy_price: Number(result.buy_price),
                payout: proposal.payout,
                currency,
                status: 'open',
                purchase_time: Date.now(),
            };
            setTrades(current => [record, ...current]);
            setProposal(null);
            let stopWatching: (() => void) | undefined;
            let contractFinished = false;
            stopWatching = await manualTradeService.observeContract(record.contract_id, contract => {
                if (contract.is_sold || contract.is_expired) {
                    contractFinished = true;
                    setTrades(current => current.map(item => item.contract_id === record.contract_id ? {
                        ...item,
                        status: contract.status === 'won' ? 'won' : contract.status === 'lost' ? 'lost' : 'sold',
                        profit: Number(contract.profit),
                        entry_tick: contract.entry_tick,
                        exit_tick: contract.exit_tick,
                    } : item));
                    stopWatching?.();
                }
            });
            if (contractFinished) stopWatching();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Purchase failed.');
        } finally {
            setBuying(false);
        }
    };

    return (
        <main className='manual-trader'>
            <header className='manual-trader__header'>
                <div><h2>Manual Trader</h2><p>Trade Volatility Indices with digit contracts and tick durations.</p></div>
                <span className={`manual-trader__connection ${connection === CONNECTION_STATUS.OPENED ? 'is-ready' : ''}`}>{connection === CONNECTION_STATUS.OPENED ? 'Deriv connected' : connection}</span>
            </header>
            <div className='manual-trader__layout'>
                <div className='manual-trader__column'>
                    <TradeControls
                        symbols={symbols} symbol={symbol} contractType={contractType} duration={duration}
                        stake={stake} prediction={prediction} onSymbolChange={setSymbol}
                        onContractChange={setContractType} onDurationChange={setDuration}
                        onStakeChange={setStake} onPredictionChange={setPrediction}
                    />
                    <TradeHistory trades={trades} currency={currency} />
                </div>
                <div className='manual-trader__column'>
                    <TradePanel loading={loading} buying={buying} proposal={proposal} currency={currency}
                        error={error} onGetProposal={getProposal} onBuy={buy} />
                </div>
            </div>
        </main>
    );
};

export default ManualTrader;