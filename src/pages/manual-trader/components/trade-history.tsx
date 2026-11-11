import React from 'react';
import { ManualTradeRecord } from '../types';

type Props = { trades: ManualTradeRecord[]; currency: string };

export const TradeHistory = ({ trades, currency }: Props) => (
    <section className='manual-trader__card'>
        <h3>Manual trade history</h3>
        {trades.length === 0 ? (
            <p className='manual-trader__muted'>Your completed and open manual trades will appear here.</p>
        ) : (
            <div className='manual-trader__history'>
                {trades.map(trade => (
                    <div className='manual-trader__history-row' key={trade.contract_id}>
                        <div>
                            <strong>{trade.symbol_name}</strong>
                            <span>{trade.contract_type.replace('DIGIT', '')} · {trade.contract_id}</span>
                        </div>
                        <div className='manual-trader__history-result'>
                            <strong>{trade.profit === undefined ? trade.status : `${trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)} ${currency}`}</strong>
                            <span className={`status-${trade.status}`}>{trade.status}</span>
                        </div>
                    </div>
                ))}
            </div>
        )}
    </section>
);