import React, { useMemo, useState } from 'react';

type TTick = { quote: number; epoch: number; digit: number };
type Props = { ticks: TTick[] };

const TICK_WINDOW = 1000;

export const ManualTraderDistributionPanels = ({ ticks }: Props) => {
    const [overUnderDigit, setOverUnderDigit] = useState(5);

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
        <section className='manual-trader__distribution'>
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
                    <select id='manual-analysis-over-under-digit' value={overUnderDigit} onChange={event => setOverUnderDigit(Number(event.target.value))}>
                        {Array.from({ length: 10 }, (_, digit) => <option key={digit} value={digit}>{digit}</option>)}
                    </select>
                    <span>Barrier digit {overUnderDigit} is excluded from both sides.</span>
                </div>
                <div className='analysis-tool__probability-grid'>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--over'>
                        <div className='analysis-tool__probability-card-top'>
                            <div><span className='analysis-tool__probability-kicker'>OBSERVED DIGITS</span><h3>OVER {overUnderDigit}</h3></div>
                            <strong>{ticks.length ? overUnderStats.overDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'><i style={{ width: `${overUnderStats.overPercentage}%` }} /></div>
                        <div className='analysis-tool__probability-meta'><span>{overUnderStats.overCount.toLocaleString()} ticks</span><span>Above {overUnderDigit}</span></div>
                    </article>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--under'>
                        <div className='analysis-tool__probability-card-top'>
                            <div><span className='analysis-tool__probability-kicker'>OBSERVED DIGITS</span><h3>UNDER {overUnderDigit}</h3></div>
                            <strong>{ticks.length ? overUnderStats.underDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'><i style={{ width: `${overUnderStats.underPercentage}%` }} /></div>
                        <div className='analysis-tool__probability-meta'><span>{overUnderStats.underCount.toLocaleString()} ticks</span><span>Below {overUnderDigit}</span></div>
                    </article>
                </div>
                <p className='analysis-tool__probability-note'>
                    {overUnderStats.eligibleCount.toLocaleString()} eligible ticks · {overUnderStats.excludedCount.toLocaleString()} occurrences of barrier digit {overUnderDigit} excluded.
                    {overUnderStats.eligibleCount ? ` Over + Under = ${(overUnderStats.overPercentage + overUnderStats.underPercentage).toFixed(1)}%.` : ' Waiting for eligible ticks on either side of the barrier.'}
                </p>
            </section>

            <section className='analysis-tool__probability-section analysis-tool__parity-section'>
                <div className='analysis-tool__section-heading'>
                    <div><h2>Even / Odd distribution</h2><p>Live parity distribution across all observed digits</p></div>
                    <span>{ticks.length.toLocaleString()} samples</span>
                </div>
                <div className='analysis-tool__probability-grid'>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--even'>
                        <div className='analysis-tool__probability-card-top'>
                            <div><span className='analysis-tool__probability-kicker'>OBSERVED DIGITS</span><h3>EVEN</h3></div>
                            <strong>{ticks.length ? evenOddStats.evenDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'><i style={{ width: `${evenOddStats.evenPercentage}%` }} /></div>
                        <div className='analysis-tool__probability-meta'><span>{evenOddStats.evenCount.toLocaleString()} ticks</span><span>0 · 2 · 4 · 6 · 8</span></div>
                    </article>
                    <article className='analysis-tool__probability-card analysis-tool__probability-card--odd'>
                        <div className='analysis-tool__probability-card-top'>
                            <div><span className='analysis-tool__probability-kicker'>OBSERVED DIGITS</span><h3>ODD</h3></div>
                            <strong>{ticks.length ? evenOddStats.oddDisplayPercentage.toFixed(1) : '–'}<small>{ticks.length ? '%' : ''}</small></strong>
                        </div>
                        <div className='analysis-tool__probability-track'><i style={{ width: `${evenOddStats.oddPercentage}%` }} /></div>
                        <div className='analysis-tool__probability-meta'><span>{evenOddStats.oddCount.toLocaleString()} ticks</span><span>1 · 3 · 5 · 7 · 9</span></div>
                    </article>
                </div>
                <p className='analysis-tool__probability-note'>
                    Even + Odd = {ticks.length ? (evenOddStats.evenPercentage + evenOddStats.oddPercentage).toFixed(1) : '0.0'}% · Both groups use all digits, with no excluded outcomes.
                </p>
            </section>
        </section>
    );
};
