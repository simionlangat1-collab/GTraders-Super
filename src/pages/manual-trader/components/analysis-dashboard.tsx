import React, { useMemo, useState } from 'react';
import './analysis-dashboard.scss';

type TTick = { quote: number; epoch: number; digit: number };
type Props = {
    ticks: TTick[];
    marketName: string;
    tickConnection: 'connecting' | 'connected' | 'disconnected';
};

const TICK_WINDOW = 1000;

export const ManualTraderAnalysisDashboard = ({ ticks, marketName, tickConnection }: Props) => {
    const [overUnderDigit, setOverUnderDigit] = useState(5);
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
    const overUnderStats = useMemo(() => {
        const overCount = ticks.filter(tick => tick.digit > overUnderDigit).length;
        const underCount = ticks.filter(tick => tick.digit < overUnderDigit).length;
        const excludedCount = ticks.filter(tick => tick.digit === overUnderDigit).length;
        const eligibleCount = overCount + underCount;
        const overPercentage = eligibleCount ? (overCount / eligibleCount) * 100 : 0;
        const underPercentage = eligibleCount ? (underCount / eligibleCount) * 100 : 0;
        const overDisplayPercentage = eligibleCount ? Number(overPercentage.toFixed(1)) : 0;
        return {
            overCount, underCount, excludedCount, eligibleCount, overPercentage, underPercentage,
            overDisplayPercentage,
            underDisplayPercentage: eligibleCount ? 100 - overDisplayPercentage : 0,
        };
    }, [ticks, overUnderDigit]);
    const evenOddStats = useMemo(() => {
        const evenCount = ticks.filter(tick => tick.digit % 2 === 0).length;
        const oddCount = ticks.length - evenCount;
        const evenPercentage = ticks.length ? (evenCount / ticks.length) * 100 : 0;
        const evenDisplayPercentage = ticks.length ? Number(evenPercentage.toFixed(1)) : 0;
        return {
            evenCount, oddCount, evenPercentage,
            oddPercentage: ticks.length ? (oddCount / ticks.length) * 100 : 0,
            evenDisplayPercentage,
            oddDisplayPercentage: ticks.length ? 100 - evenDisplayPercentage : 0,
        };
    }, [ticks]);

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
                            ].filter(Boolean).join(' ')}
                            key={item.digit}
                        >
                            <div className='analysis-tool__digit-circle'>
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

            <section className='analysis-tool__probability-section'>
                <div className='analysis-tool__section-heading'>
                    <div>
                        <h2>Over / Under distribution</h2>
                        <p>Observed tick distribution around the selected barrier digit</p>
                    </div>
                    <span>{ticks.length.toLocaleString()} / {TICK_WINDOW.toLocaleString()} ticks</span>
                </div>
                <div className='analysis-tool__barrier-control'>
                    <label htmlFor='manual-analysis-over-under-digit'>Over / Under digit</label>
                    <select
                        id='manual-analysis-over-under-digit'
                        value={overUnderDigit}
                        onChange={event => setOverUnderDigit(Number(event.target.value))}
                    >
                        {Array.from({ length: 10 }, (_, digit) => <option key={digit} value={digit}>{digit}</option>)}
                    </select>
                    <span>Barrier digit {overUnderDigit} is excluded from both sides.</span>
                </div>
                <div className='analysis-tool__probability-grid'>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--over'>
                        <div className='analysis-tool__probability-card-top'>
                            <div>
                                <span className='analysis-tool__probability-kicker'>OBSERVED DIGITS</span>
                                <h3>OVER {overUnderDigit}</h3>
                            </div>
                            <strong>{ticks.length ? overUnderStats.overDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'><i style={{ width: `${overUnderStats.overPercentage}%` }} /></div>
                        <div className='analysis-tool__probability-meta'>
                            <span>{overUnderStats.overCount.toLocaleString()} ticks</span>
                            <span>Above {overUnderDigit}</span>
                        </div>
                    </article>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--under'>
                        <div className='analysis-tool__probability-card-top'>
                            <div>
                                <span className='analysis-tool__probability-kicker'>OBSERVED DIGITS</span>
                                <h3>UNDER {overUnderDigit}</h3>
                            </div>
                            <strong>{ticks.length ? overUnderStats.underDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'><i style={{ width: `${overUnderStats.underPercentage}%` }} /></div>
                        <div className='analysis-tool__probability-meta'>
                            <span>{overUnderStats.underCount.toLocaleString()} ticks</span>
                            <span>Below {overUnderDigit}</span>
                        </div>
                    </article>
                </div>
                <p className='analysis-tool__probability-note'>
                    {overUnderStats.eligibleCount.toLocaleString()} eligible ticks · {overUnderStats.excludedCount.toLocaleString()} occurrences of barrier digit {overUnderDigit} excluded.
                    {overUnderStats.eligibleCount ? ` Over + Under = ${(overUnderStats.overPercentage + overUnderStats.underPercentage).toFixed(1)}%.` : ' Waiting for eligible ticks on either side of the barrier.'}
                </p>
            </section>

            <section className='analysis-tool__probability-section analysis-tool__parity-section'>
                <div className='analysis-tool__section-heading'>
                    <div>
                        <h2>Even / Odd distribution</h2>
                        <p>Live parity distribution across all observed digits</p>
                    </div>
                    <span>{ticks.length.toLocaleString()} samples</span>
                </div>
                <div className='analysis-tool__probability-grid'>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--even'>
                        <div className='analysis-tool__probability-card-top'>
                            <div>
                                <span className='analysis-tool__probability-kicker'>OBSERVED DIGITS</span>
                                <h3>EVEN</h3>
                            </div>
                            <strong>{ticks.length ? evenOddStats.evenDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'><i style={{ width: `${evenOddStats.evenPercentage}%` }} /></div>
                        <div className='analysis-tool__probability-meta'>
                            <span>{evenOddStats.evenCount.toLocaleString()} ticks</span>
                            <span>0 · 2 · 4 · 6 · 8</span>
                        </div>
                    </article>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--odd'>
                        <div className='analysis-tool__probability-card-top'>
                            <div>
                                <span className='analysis-tool__probability-kicker'>OBSERVED DIGITS</span>
                                <h3>ODD</h3>
                            </div>
                            <strong>{ticks.length ? evenOddStats.oddDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'><i style={{ width: `${evenOddStats.oddPercentage}%` }} /></div>
                        <div className='analysis-tool__probability-meta'>
                            <span>{evenOddStats.oddCount.toLocaleString()} ticks</span>
                            <span>1 · 3 · 5 · 7 · 9</span>
                        </div>
                    </article>
                </div>
                <p className='analysis-tool__probability-note'>
                    Even + Odd = {ticks.length ? (evenOddStats.evenPercentage + evenOddStats.oddPercentage).toFixed(1) : '0.0'}% · Both groups use all digits, with no excluded outcomes.
                </p>
            </section>

            <p className='analysis-tool__disclaimer'>
                Statistics describe the selected market's observed ticks. They are historical observations, not predictions or guarantees of the next result.
                Always manage risk and verify contract settings before trading.
            </p>
        </section>
    );
};
