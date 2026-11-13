import { useState } from 'react';
import './gtraders-super-ai.scss';

const GTradersSuperAI = () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button
                type='button'
                className='gtraders-ai-float'
                aria-label='Open GTraders Super AI'
                aria-expanded={isOpen}
                aria-controls='gtraders-ai-panel'
                onClick={() => setIsOpen(open => !open)}
            >
                <span className='gtraders-ai-float__ring' aria-hidden='true' />
                <span className='gtraders-ai-float__letters'>AI</span>
            </button>

            {isOpen && (
                <section
                    id='gtraders-ai-panel'
                    className='gtraders-ai-panel'
                    role='dialog'
                    aria-modal='false'
                    aria-labelledby='gtraders-ai-title'
                >
                    <header className='gtraders-ai-panel__header'>
                        <div>
                            <span className='gtraders-ai-panel__eyebrow'>GTRADERS SUPER</span>
                            <h2 id='gtraders-ai-title'>AI Trading Assistant</h2>
                        </div>
                        <button
                            type='button'
                            className='gtraders-ai-panel__close'
                            aria-label='Close AI assistant'
                            onClick={() => setIsOpen(false)}
                        >
                            ×
                        </button>
                    </header>

                    <div className='gtraders-ai-panel__body'>
                        <div className='gtraders-ai-panel__status'>
                            <span className='gtraders-ai-panel__status-dot' />
                            Independent module initialized
                        </div>
                        <p>
                            Your AI workspace is being built separately from the existing GTraders
                            Super trading components.
                        </p>
                        <p className='gtraders-ai-panel__notice'>
                            Market analysis, risk controls and the independent execution engine
                            will be connected only after their interfaces have been inspected and
                            tested.
                        </p>
                        <span className='gtraders-ai-panel__demo'>DEMO-FIRST DEVELOPMENT</span>
                    </div>
                </section>
            )}
        </>
    );
};

export default GTradersSuperAI;
