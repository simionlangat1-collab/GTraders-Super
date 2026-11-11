import React from 'react';

type Props = {
    loading: boolean;
    buying: boolean;
    proposal: { ask_price: number; payout: number } | null;
    currency: string;
    error: string;
    onGetProposal: () => void;
    onBuy: () => void;
};

export const TradePanel = ({ loading, buying, proposal, currency, error, onGetProposal, onBuy }: Props) => (
    <section className='manual-trader__card manual-trader__execution'>
        <h3>Trade execution</h3>
        {proposal ? (
            <div className='manual-trader__quote'>
                <div><span>Stake / buy price</span><strong>{proposal.ask_price.toFixed(2)} {currency}</strong></div>
                <div><span>Potential payout</span><strong>{proposal.payout.toFixed(2)} {currency}</strong></div>
            </div>
        ) : <p className='manual-trader__muted'>Get a live quote before placing your trade.</p>}
        {error && <p className='manual-trader__error' role='alert'>{error}</p>}
        <button type='button' className='manual-trader__secondary' disabled={loading || buying} onClick={onGetProposal}>
            {loading ? 'Getting quote…' : 'Get proposal'}
        </button>
        <button type='button' className='manual-trader__buy' disabled={!proposal || loading || buying} onClick={onBuy}>
            {buying ? 'Buying…' : 'Buy contract'}
        </button>
        <p className='manual-trader__disclaimer'>Manual execution only. Review the stake and payout before buying.</p>
    </section>
);