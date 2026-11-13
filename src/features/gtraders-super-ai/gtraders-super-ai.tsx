import { useEffect, useState } from 'react';
import {
    AIDerivConnection,
    AIAccountSnapshot,
    AIConnectionStatus,
} from './services/ai-deriv-connection';
import './gtraders-super-ai.scss';

const connectionStatusLabel: Record<AIConnectionStatus, string> = {
    disconnected: 'Not connected',
    connecting: 'Connecting securely…',
    connected: 'Private Deriv connection active',
    error: 'Connection needs attention',
};

const GTradersSuperAI = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [connection] = useState(() => new AIDerivConnection());
    const [connectionStatus, setConnectionStatus] =
        useState<AIConnectionStatus>('disconnected');
    const [account, setAccount] = useState<AIAccountSnapshot | null>(null);
    const [connectionError, setConnectionError] = useState('');

    useEffect(() => {
        const unsubscribe = connection.onStatusChange(status => {
            setConnectionStatus(status);
            setAccount(connection.getAccount());
        });

        return () => {
            unsubscribe();
            connection.disconnect();
        };
    }, [connection]);

    const connectAI = async () => {
        setConnectionError('');
        try {
            const connectedAccount = await connection.connect();
            setAccount(connectedAccount);
        } catch (error) {
            setConnectionError(
                error instanceof Error ? error.message : 'Unable to connect to Deriv.'
            );
        }
    };

    const disconnectAI = () => {
        connection.disconnect();
        setAccount(null);
        setConnectionError('');
    };

    const isConnecting = connectionStatus === 'connecting';
    const isConnected = connectionStatus === 'connected';

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
                        <div
                            className={`gtraders-ai-panel__status gtraders-ai-panel__status--${connectionStatus}`}
                        >
                            <span className='gtraders-ai-panel__status-dot' />
                            {connectionStatusLabel[connectionStatus]}
                        </div>

                        {isConnected && account ? (
                            <div className='gtraders-ai-panel__account'>
                                <span>Authenticated account</span>
                                <strong>{account.loginid}</strong>
                                <span>
                                    Balance: {account.balance.toLocaleString(undefined, {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    })}{' '}
                                    {account.currency}
                                </span>
                            </div>
                        ) : (
                            <p>
                                The AI uses its own Deriv connection and keeps its subscriptions
                                separate from your existing trading tools.
                            </p>
                        )}

                        {connectionError && (
                            <p className='gtraders-ai-panel__error' role='alert'>
                                {connectionError}
                            </p>
                        )}

                        <div className='gtraders-ai-panel__actions'>
                            {!isConnected ? (
                                <button
                                    type='button'
                                    className='gtraders-ai-panel__connect'
                                    onClick={connectAI}
                                    disabled={isConnecting}
                                >
                                    {isConnecting ? 'Connecting…' : 'Connect AI to Deriv'}
                                </button>
                            ) : (
                                <button
                                    type='button'
                                    className='gtraders-ai-panel__disconnect'
                                    onClick={disconnectAI}
                                >
                                    Disconnect AI
                                </button>
                            )}
                        </div>

                        <p className='gtraders-ai-panel__notice'>
                            Connection verification only. Automated trading remains disabled
                            until market-data handling, execution safeguards and demo tests are
                            completed.
                        </p>
                        <span className='gtraders-ai-panel__demo'>DEMO-FIRST DEVELOPMENT</span>
                    </div>
                </section>
            )}
        </>
    );
};

export default GTradersSuperAI;
