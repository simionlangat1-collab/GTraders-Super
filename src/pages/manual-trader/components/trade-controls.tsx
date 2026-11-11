import React from 'react';
import { ManualContractType, ManualMarketSymbol } from '../types';


type Props = {
    symbols: ManualMarketSymbol[];
    symbol: string;
    contractType: ManualContractType;
    duration: number;
    stake: string;
    prediction: number;
    onSymbolChange: (value: string) => void;
    onContractChange: (value: ManualContractType) => void;
    onDurationChange: (value: number) => void;
    onStakeChange: (value: string) => void;
    onPredictionChange: (value: number) => void;
};

const CONTRACTS: { value: ManualContractType; label: string; needsPrediction: boolean }[] = [
    { value: 'DIGITOVER', label: 'Over', needsPrediction: true },
    { value: 'DIGITUNDER', label: 'Under', needsPrediction: true },
    { value: 'DIGITMATCH', label: 'Matches', needsPrediction: true },
    { value: 'DIGITDIFF', label: 'Differs', needsPrediction: true },
    { value: 'DIGITEVEN', label: 'Even', needsPrediction: false },
    { value: 'DIGITODD', label: 'Odd', needsPrediction: false },
];

export const TradeControls = (props: Props) => {
    const selectedContract = CONTRACTS.find(contract => contract.value === props.contractType);
    return (
        <section className='manual-trader__card'>
            <h3>Trade setup</h3>
            <label className='manual-trader__field'>
                <span>Volatility market</span>
                <select value={props.symbol} onChange={event => props.onSymbolChange(event.target.value)}>
                    {props.symbols.map(item => (
                        <option key={item.symbol} value={item.symbol}>{item.display_name} ({item.symbol})</option>
                    ))}
                </select>
            </label>
            <div className='manual-trader__grid'>
                <label className='manual-trader__field'>
                    <span>Digit contract</span>
                    <select value={props.contractType} onChange={event => props.onContractChange(event.target.value as ManualContractType)}>
                        {CONTRACTS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                </label>
                <label className='manual-trader__field'>
                    <span>Duration (ticks)</span>
                    <input type='number' min='1' step='1' value={props.duration} onChange={event => props.onDurationChange(Math.max(1, Number(event.target.value) || 1))} />
                </label>
            </div>
            {selectedContract?.needsPrediction && (
                <label className='manual-trader__field'>
                    <span>Prediction digit (0–9)</span>
                    <select value={props.prediction} onChange={event => props.onPredictionChange(Number(event.target.value))}>
                        {Array.from({ length: 10 }, (_, digit) => (
                            <option key={digit} value={digit}>{digit}</option>
                        ))}
                    </select>
                </label>
            )}
            <label className='manual-trader__field'>
                <span>Stake</span>
                <input type='number' min='0.35' step='0.01' inputMode='decimal' value={props.stake} onChange={event => props.onStakeChange(event.target.value)} placeholder='Enter stake' />
            </label>
        </section>
    );
};
