import React from 'react';
import { ManualContractType, ManualMarketSymbol } from '../types';

type TDigitFrequency = { digit: number; count: number; percentage: number };

type Props = {
    symbols: ManualMarketSymbol[];
    symbol: string;
    contractType: ManualContractType;
    duration: number;
    stake: string;
    prediction: number;
    digitFrequencies: TDigitFrequency[];
    latestDigit: number | null;
    tickCount: number;
    tickConnection: 'connecting' | 'connected' | 'disconnected';
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
    const rankedDigits = [...props.digitFrequencies].sort((a, b) => a.count - b.count || a.digit - b.digit);
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
                    <div className='manual-trader__frequency-heading'>
                        <span>Live distribution · latest 1,000 ticks</span>
                        <strong className={`manual-trader__tick-status is-${props.tickConnection}`}>
                            {props.tickConnection === 'connected' ? 'LIVE' : props.tickConnection === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
                        </strong>
                        <small>{props.tickCount.toLocaleString()} / 1,000</small>
                    </div>
                    <div className='manual-trader__digits'>
                        {props.digitFrequencies.map(item => {
                            const isSelected = props.prediction === item.digit;
                            const isLeading = props.tickCount > 0 && item.digit === rankedDigits[9]?.digit;
                            const isSecond = props.tickCount > 1 && item.digit === rankedDigits[8]?.digit;
                            const isLowest = props.tickCount > 0 && item.digit === rankedDigits[0]?.digit;
                            const isSecondLowest = props.tickCount > 1 && item.digit === rankedDigits[1]?.digit;
                            const isCurrent = props.latestDigit === item.digit;
                            const classes = [
                                'manual-trader__digit-card',
                                isSelected ? 'is-selected' : '',
                                isLeading ? 'is-leading' : '',
                                isSecond ? 'is-second' : '',
                                isLowest ? 'is-lowest' : '',
                                isSecondLowest ? 'is-second-lowest' : '',
                                isCurrent ? 'is-current' : '',
                            ].filter(Boolean).join(' ');
                            return (
                                <button
                                    type='button'
                                    key={item.digit}
                                    className={classes}
                                    aria-pressed={isSelected}
                                    aria-label={`Select digit ${item.digit}, ${item.percentage.toFixed(1)} percent across latest ticks`}
                                    onClick={() => props.onPredictionChange(item.digit)}
                                >
                                    <span className='manual-trader__digit-circle'>
                                        <span className='manual-trader__digit-number'>{item.digit}</span>
                                        <strong className='manual-trader__digit-percentage'>{item.percentage.toFixed(1)}%</strong>
                                        {isCurrent && <span className='manual-trader__tick-cursor' aria-label='Latest tick' />}
                                    </span>
                                    <span className='manual-trader__digit-count'>{item.count.toLocaleString()} ticks</span>
                                    <span className='manual-trader__digit-bar'><i style={{ width: `${item.percentage}%` }} /></span>
                                </button>
                            );
                        })}
                    </div>
                </label>
            )}
            <label className='manual-trader__field'>
                <span>Stake</span>
                <input type='number' min='0.35' step='0.01' inputMode='decimal' value={props.stake} onChange={event => props.onStakeChange(event.target.value)} placeholder='Enter stake' />
            </label>
        </section>
    );
};
