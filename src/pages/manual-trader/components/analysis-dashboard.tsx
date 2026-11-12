import React, { useMemo } from 'react';
import '../../analysis-tool/analysis-tool.scss';

type TTick = { quote: number; epoch: number; digit: number };
type Props = {
    ticks: TTick[];
    marketName: string;
    tickConnection: 'connecting' | 'connected' | 'disconnected';
    tickError?: string;
    tradeResultHighlight?: { digit: number; status: 'won' | 'lost'; key: string } | null;
    barrierDigit: number;
};

const TICK_WINDOW = 1000;

export const ManualTraderAnalysisDashboard = ({ ticks, marketName, tickConnection, tickError, tradeResultHighlight, barrierDigit }: Props) => {
    const frequencies = useMemo(
        () => Array.from({ length: 10 }, (_, digit) => {
            const count = ticks.filter(tick => tick.digit === digit).length;
            return { digit, count, percentage: ticks.length ? (count / ticks.length) * 100 : 0 };
        }),
        [ticks]
    );
    const highestDigit = useMemo(
        () => frequencies.reduce((best, item) => item.count > best.count ? item : best, frequencies[0]),
        [frequencies]
    );
    const rankedDigits = useMemo(
        () => [...frequencies].sort((a, b) => a.count - b.count || a.digit - b.digit),
        [frequencies]
    );
    const latestTick = ticks.length ? ticks[ticks.length - 1] : null;
    return (
        <section className='analysis-tool manual-trader-analysis'>
            <header className='analysis-tool__header'>
                <div>
                    <span className='analysis-tool__eyebrow'>GTRADERS SUPER · MARKET INTELLIGENCE</span>
                    <h1>Live Market Analysis</h1>
                    <p>{marketName || 'Selected Volatility Index'} · rolling latest {TICK_WINDOW.toLocaleString()} ticks</p>
                </div>
                <div className={`analysis-tool__status analysis-tool__status--${tickConnection}`}>
                    <span />
                    {tickConnection === 'connected' ? 'Live tick stream' : tickConnection === 'connecting' ? 'Connecting' : 'Tick stream offline'}
                </div>
            </header>

            {tickError && <div className='analysis-tool__error' role='alert'>Tick subscription error: {tickError}</div>}

            <section className='analysis-tool__overview'>
                <div className='analysis-tool__panel analysis-tool__latest'>
                    <span className='analysis-tool__panel-label'>Latest tick digit</span>
                    <strong className='analysis-tool__metric-value'>{latestTick ? latestTick.digit : '–'}</strong>
                    <span className='analysis-tool__muted'>
                        {latestTick ? `Latest quote: ${latestTick.quote}` : 'Waiting for the first tick'}
                    </span>
                    <span className='analysis-tool__muted'>The glowing cursor follows the latest digit.</span>
                </div>
                <div className='analysis-tool__panel analysis-tool__leader'>
                    <span className='analysis-tool__panel-label'>Frequency leader</span>
                    <strong className='analysis-tool__metric-value analysis-tool__metric-value--leader'>
                        {ticks.length ? `${highestDigit.digit} · ${highestDigit.percentage.toFixed(2)}%` : '–'}
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
                    <span>{ticks.length.toLocaleString()} / {TICK_WINDOW.toLocaleString()} samples</span>
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
                                latestTick?.digit === item.digit ? 'is-current' : '',
                                tradeResultHighlight?.digit === item.digit && tradeResultHighlight.status === 'won' ? 'is-trade-win' : '',
                                tradeResultHighlight?.digit === item.digit && tradeResultHighlight.status === 'lost' ? 'is-trade-loss' : '',
                            ].filter(Boolean).join(' ')}
                            key={tradeResultHighlight?.digit === item.digit ? tradeResultHighlight.key : item.digit}
                        >
                            <div className={`analysis-tool__digit-circle ${item.digit === barrierDigit ? 'is-barrier' : ''} ${tradeResultHighlight?.digit === item.digit ? `is-trade-result is-trade-result-${tradeResultHighlight.status}` : ''}`}>
                                <span className='analysis-tool__digit-number'>{item.digit}</span>
                                <strong className='analysis-tool__digit-percentage'>{item.percentage.toFixed(1)}%</strong>
                                {latestTick?.digit === item.digit && <span className='analysis-tool__tick-cursor' aria-label='Latest tick' />}
                            </div>
                            <span>{item.count.toLocaleString()} ticks</span>
                            <div className='analysis-tool__bar'><i style={{ width: `${item.percentage}%` }} /></div>
                        </div>
                    ))}
                </div>
            </section>
        </section>
    );
};
