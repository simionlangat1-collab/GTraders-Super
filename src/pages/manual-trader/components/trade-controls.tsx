import React, { useState } from 'react';
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

const CONTRACT_GROUPS: { value: ManualContractType; label: string; needsPrediction: boolean }[] = [
    { value: 'DIGITOVER', label: 'Over / Under', needsPrediction: true },
    { value: 'DIGITEVEN', label: 'Even / Odd', needsPrediction: false },
    { value: 'DIGITMATCH', label: 'Matches / Differs', needsPrediction: true },
    { value: 'CALL', label: 'Rise / Fall', needsPrediction: false },
];

const CONTRACT_OPTIONS: Record<string, { over: ManualContractType; under: ManualContractType; overLabel: string; underLabel: string }> = {
    DIGITOVER: { over: 'DIGITOVER', under: 'DIGITUNDER', overLabel: 'Over', underLabel: 'Under' },
    DIGITEVEN: { over: 'DIGITEVEN', under: 'DIGITODD', overLabel: 'Even', underLabel: 'Odd' },
    DIGITMATCH: { over: 'DIGITMATCH', under: 'DIGITDIFF', overLabel: 'Matches', underLabel: 'Differs' },
    CALL: { over: 'CALL', under: 'PUT', overLabel: 'Rise', underLabel: 'Fall' },
};

const clampDuration = (value: number) => Math.max(1, Math.round(value || 1));

export const TradeControls = (props: Props) => {
    const [marketOpen, setMarketOpen] = useState(false);
    const [stakeEditing, setStakeEditing] = useState(false);
    const groupIndex = Math.max(0, CONTRACT_GROUPS.findIndex(group => {
        if (group.value === 'DIGITOVER') return props.contractType === 'DIGITOVER' || props.contractType === 'DIGITUNDER';
        if (group.value === 'DIGITEVEN') return props.contractType === 'DIGITEVEN' || props.contractType === 'DIGITODD';
        if (group.value === 'DIGITMATCH') return props.contractType === 'DIGITMATCH' || props.contractType === 'DIGITDIFF';
        return props.contractType === 'CALL' || props.contractType === 'PUT';
    }));
    const group = CONTRACT_GROUPS[groupIndex];
    const option = CONTRACT_OPTIONS[group.value];
    const activeSide = props.contractType === option.under ? 'under' : 'over';

    const selectGroup = (nextIndex: number) => {
        const next = CONTRACT_GROUPS[nextIndex];
        props.onContractChange(CONTRACT_OPTIONS[next.value].over);
    };

    return (
        <section className='manual-trader__card manual-trader__trade-setup'>
            <div className='manual-trader__trade-setup-header'>
                <div className='manual-trader__trade-setup-title'>Trade Setup</div>
                <button
                    type='button'
                    className='manual-trader__contract-switch'
                    onClick={() => selectGroup((groupIndex + 1) % CONTRACT_GROUPS.length)}
                    aria-label='Switch contract type'
                >
                    <span>{group.label}</span>
                    <strong>›</strong>
                </button>
            </div>

            <div className='manual-trader__setup-row manual-trader__market-row'>
                <div className='manual-trader__setup-item'>
                    <span className='manual-trader__setup-label'>Volatility Market</span>
                    <button type='button' className='manual-trader__market-value' onClick={() => setMarketOpen(value => !value)}>
                        {props.symbols.find(item => item.symbol === props.symbol)?.display_name || props.symbol || 'Select market'}
                        <span>⌄</span>
                    </button>
                    {marketOpen && (
                        <div className='manual-trader__market-menu'>
                            {props.symbols.map(item => (
                                <button
                                    type='button'
                                    key={item.symbol}
                                    onClick={() => {
                                        props.onSymbolChange(item.symbol);
                                        setMarketOpen(false);
                                    }}
                                >
                                    {item.display_name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {group.needsPrediction && (
                <div className='manual-trader__digit-grid' aria-label='Prediction digit'>
                    {Array.from({ length: 10 }, (_, digit) => (
                        <button
                            type='button'
                            key={digit}
                            className={`manual-trader__digit-button ${props.prediction === digit ? 'is-selected' : ''}`}
                            onClick={() => props.onPredictionChange(digit)}
                        >
                            {digit}
                        </button>
                    ))}
                </div>
            )}

            <div className='manual-trader__setup-row manual-trader__value-row'>
                <div className='manual-trader__ticks-stepper' aria-label='Trade duration in ticks'>
                    <button
                        type='button'
                        className='manual-trader__ticks-stepper-button'
                        onClick={() => props.onDurationChange(clampDuration(props.duration - 1))}
                        disabled={props.duration <= 1}
                        aria-label='Decrease tick duration'
                    >
                        −
                    </button>
                    <span className='manual-trader__ticks-value'>
                        {props.duration} {props.duration === 1 ? 'Tick' : 'Ticks'}
                    </span>
                    <button
                        type='button'
                        className='manual-trader__ticks-stepper-button'
                        onClick={() => props.onDurationChange(clampDuration(props.duration + 1))}
                        aria-label='Increase tick duration'
                    >
                        +
                    </button>
                </div>

                <div className='manual-trader__stake-editor'>
                    {stakeEditing ? (
                        <input
                            autoFocus
                            type='number'
                            min='0.35'
                            step='0.01'
                            inputMode='decimal'
                            value={props.stake}
                            onChange={event => props.onStakeChange(event.target.value)}
                            onBlur={() => setStakeEditing(false)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') setStakeEditing(false);
                            }}
                        />
                    ) : (
                        <button type='button' onClick={() => setStakeEditing(true)}>
                            {Number(props.stake || 0).toFixed(2)} USD
                        </button>
                    )}
                </div>
                <span className='manual-trader__stake-label'>Stake</span>
            </div>

            <div className='manual-trader__execution-actions'>
                <button
                    type='button'
                    className={`manual-trader__execution-button manual-trader__execution-button--over ${activeSide === 'over' ? 'is-active' : ''}`}
                    onClick={() => props.onContractChange(option.over)}
                >
                    <span>{option.overLabel}</span>
                    <small>Payout</small>
                    <strong>—</strong>
                </button>
                <button
                    type='button'
                    className={`manual-trader__execution-button manual-trader__execution-button--under ${activeSide === 'under' ? 'is-active' : ''}`}
                    onClick={() => props.onContractChange(option.under)}
                >
                    <span>{option.underLabel}</span>
                    <small>Payout</small>
                    <strong>—</strong>
                </button>
            </div>

            <div className='manual-trader__setup-hint'>
                {group.label} · {props.duration} ticks · {Number(props.stake || 0).toFixed(2)} USD
            </div>
        </section>
    );
};
