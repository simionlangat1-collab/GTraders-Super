import { useEffect, useState } from 'react';
import {
    AIDerivConnection,
    AIAccountSnapshot,
    AIConnectionStatus,
} from './services/ai-deriv-connection';
import { AIMarketScanner, AIMarketHistory } from './services/ai-market-scanner';
import { AIMarketStatistics, analyseMarketDigits } from './services/ai-market-statistics';
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
    const [marketResults, setMarketResults] = useState<AIMarketHistory[]>([]);
    const [availableMarketCount, setAvailableMarketCount] = useState(0);
    const [marketStatistics, setMarketStatistics] = useState<AIMarketStatistics | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [scannerError, setScannerError] = useState('');
    const [scannedAt, setScannedAt] = useState<number | null>(null);

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

    const scanMarkets = async () => {
        setScannerError('');
        setIsScanning(true);
        try {
            const scanner = new AIMarketScanner(<T,>(payload: Record<string, unknown>) =>
                connection.requestData<T>(payload)
            );
            const availableMarkets = await scanner.getAvailableMarkets();
            setAvailableMarketCount(availableMarkets.length);
            const results = await scanner.scanMarkets(availableMarkets, {
                maxMarkets: 30,
                historyCount: 500,
                concurrency: 3,
            });
            setMarketResults(results);
            setMarketStatistics(results.length ? analyseMarketDigits(results[0].digitSequence) : null);
            setScannedAt(Date.now());
            if (!results.length) {
                setScannerError('No market history was returned. Please try scanning again.');
            }
        } catch (error) {
            setScannerError(error instanceof Error ? error.message : 'Market scan failed.');
        } finally {
            setIsScanning(false);
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

                        {isConnected && (
                            <section className='gtraders-ai-scanner'>
                                <div className='gtraders-ai-scanner__heading'>
                                    <div>
                                        <strong>Independent Market Scanner</strong>
                                        <span>{availableMarketCount} markets discovered · scanning up to 30</span>
                                    </div>
                                    <button
                                        type='button'
                                        onClick={scanMarkets}
                                        disabled={isScanning}
                                    >
                                        {isScanning ? 'Scanning…' : 'Scan markets'}
                                    </button>
                                </div>
                                {scannerError && (
                                    <p className='gtraders-ai-panel__error' role='alert'>
                                        {scannerError}
                                    </p>
                                )}
                                {scannedAt && (
                                    <span className='gtraders-ai-scanner__timestamp'>
                                        Last scan: {new Date(scannedAt).toLocaleTimeString()}
                                    </span>
                                )}
                                {marketResults.length > 0 && (
                                    <div className='gtraders-ai-scanner__results'>
                                        {marketResults.slice(0, 8).map((market, index) => (
                                            <div className='gtraders-ai-scanner__result' key={market.symbol}>
                                                <span className='gtraders-ai-scanner__rank'>
                                                    {index + 1}
                                                </span>
                                                <div>
                                                    <strong>{market.displayName}</strong>
                                                    <span>{market.symbol} · {market.ticks} ticks · {market.ticksPerMinute.toFixed(1)}/min</span>
                                                </div>
                                                <div className='gtraders-ai-scanner__score'>
                                                    <strong>{market.activityScore}</strong>
                                                    <span>Activity</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p className='gtraders-ai-scanner__disclaimer'>
                                    Ranking reflects observed data availability and tick frequency only. It is not a prediction, trade signal or guarantee
                                    of profitability.
                                </p>
                            </section>
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
