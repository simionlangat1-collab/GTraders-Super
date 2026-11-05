import React from 'react';
import './free-bots.scss';

const FreeBots = () => (
    <section className='free-bots-page'>
        <header className='free-bots-page__header'>
            <span className='free-bots-page__eyebrow'>GTRADERS SUPER</span>
            <h1>Free Bots</h1>
            <p>Explore ready-made trading strategies.</p>
        </header>

        <article className='free-bots-card'>
            <div className='free-bots-card__details'>
                <span className='free-bots-card__label'>FREE BOT</span>
                <h2>L-V Sniper XVT Bot</h2>
                <p>Bot profile and strategy setup will be added here.</p>
            </div>
            <span className='free-bots-card__status'>COMING SOON</span>
        </article>
    </section>
);

export default FreeBots;
