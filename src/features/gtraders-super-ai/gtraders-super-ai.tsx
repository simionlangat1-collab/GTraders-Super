import { useEffect, useState } from 'react';
import {
    AIDerivConnection,
    AIAccountSnapshot,
    AIConnectionStatus,
} from './services/ai-deriv-connection';
import { AIMarketScanner, AIMarketHistory } from './services/ai-market-scanner';
import { AIMarketStatistics, analyseMarketDigits } from './services/ai-market-statistics';
import { assessAIRisk } from './services/ai-risk-manager';
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
    const [stakeInput, setStakeInput] = useState('');
    const [targetProfitInput, setTargetProfitInput] = useState('');
    const [stopLossInput, setStopLossInput] = useState('');
    const [maxConsecutiveLossesInput, setMaxConsecutiveLossesInput] = useState('3');

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
    const stake = Number(stakeInput);
    const targetProfit = Number(targetProfitInput);
    const stopLoss = Number(stopLossInput);
    const maxConsecutiveLosses = Number(maxConsecutiveLossesInput);
    const riskInputsReady =
        stakeInput.trim() !== '' &&
        targetProfitInput.trim() !== '' &&
        stopLossInput.trim() !== '' &&
        maxConsecutiveLossesInput.trim() !== '' &&
        [stake, targetProfit, stopLoss, maxConsecutiveLosses].every(Number.isFinite) &&
        stake > 0 &&
        targetProfit > 0 &&
        stopLoss > 0 &&
        Number.isInteger(maxConsecutiveLosses) &&
        maxConsecutiveLosses > 0;
    const riskAssessment = isConnected && account && riskInputsReady
        ? assessAIRisk(
            { stake, targetProfit, stopLoss, maxConsecutiveLosses },
            { balance: account.balance, sessionProfitLoss: 0, consecutiveLosses: 0 }
        )
        : null;

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

                        {isConnected && account && (
                            <section className='gtraders-ai-risk'>
                                <div className='gtraders-ai-risk__heading'>
                                    <strong>AI Session Risk Controls</strong>
                                    <span>Set your limits before any future demo execution</span>
                                </div>
                                <div className='gtraders-ai-risk__fields'>
                                    <label>
                                        <span>Stake ({account.currency})</span>
                                        <input
                                            type='number'
                                            min='0.01'
                                            step='any'
                                            inputMode='decimal'
                                            value={stakeInput}
                                            onChange={event => setStakeInput(event.target.value)}
                                            placeholder='Enter stake'
                                        />
                                    </label>
                                    <label>
                                        <span>Target profit ({account.currency})</span>
                                        <input
                                            type='number'
                                            min='0.01'
                                            step='any'
                                            inputMode='decimal'
                                            value={targetProfitInput}
                                            onChange={event => setTargetProfitInput(event.target.value)}
                                            placeholder='Enter target'
                                        />
                                    </label>
                                    <label>
                                        <span>Stop loss ({account.currency})</span>
                                        <input
                                            type='number'
                                            min='0.01'
                                            step='any'
                                            inputMode='decimal'
                                            value={stopLossInput}
                                            onChange={event => setStopLossInput(event.target.value)}
                                            placeholder='Enter stop loss'
                                        />
                                    </label>
                                    <label>
                                        <span>Max consecutive losses</span>
                                        <input
                                            type='number'
                                            min='1'
                                            step='1'
                                            inputMode='numeric'
                                            value={maxConsecutiveLossesInput}
                                            onChange={event => setMaxConsecutiveLossesInput(event.target.value)}
                                        />
                                    </label>
                                </div>
                                {riskAssessment ? (
                                    <div
                                        className={`gtraders-ai-risk__assessment gtraders-ai-risk__assessment--${riskAssessment.allowed ? 'allowed' : 'blocked'}`}
                                        role='status'
                                    >
                                        <strong>{riskAssessment.allowed ? 'Preflight checks passed' : 'Trading blocked by risk limits'}</strong>
                                        <span>{riskAssessment.explanation}</span>
                                        <span>Remaining target: {riskAssessment.remainingProfitTarget.toFixed(2)} {account.currency}</span>
                                        <span>Remaining loss allowance: {riskAssessment.remainingLossAllowance.toFixed(2)} {account.currency}</span>
                                    </div>
                                ) : (
                                    <p className='gtraders-ai-risk__hint'>
                                        Enter a positive stake, target profit and stop loss to check the limits. The initial stake is capped at 2% of the connected account balance.
                                    </p>
                                )}
                                <p className='gtraders-ai-risk__disclaimer'>
                                    Preflight only: session profit/loss and consecutive losses are currently zero because execution is not enabled. Passing these checks does not start trading or authorize an order.
                                </p>
                            </section>
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
                                {marketStatistics && (
                                    <div className='gtraders-ai-statistics'>
                                        <div className='gtraders-ai-statistics__heading'>
                                            <strong>Digit distribution · {marketResults[0]?.displayName}</strong>
                                            <span>{marketStatistics.sampleSize} observed ticks · expected baseline 10% each</span>
                                        </div>
                                        <div className='gtraders-ai-statistics__grid'>
                                            {marketStatistics.frequencies.map(item => (
                                                <div className='gtraders-ai-statistics__digit' key={item.digit}>
                                                    <div>
                                                        <strong>{item.digit}</strong>
                                                        <span>{item.percentage.toFixed(1)}%</span>
                                                    </div>
                                                    <div className='gtraders-ai-statistics__track'>
                                                        <span style={{ width: `${Math.min(100, item.percentage * 5)}%` }} />
                                                    </div>
                                                    <small>95% interval: {item.confidenceLow.toFixed(1)}–{item.confidenceHigh.toFixed(1)}%</small>
                                                </div>
                                            ))}
                                        </div>
                                        {marketStatistics.rollingWindows.length > 0 && (
                                            <div className='gtraders-ai-statistics__windows'>
                                                <strong>Rolling sample comparison</strong>
                                                {marketStatistics.rollingWindows.map(window => {
                                                    const leadingDigit = [...window.frequencies].sort(
                                                        (a, b) => b.count - a.count
                                                    )[0];
                                                    return (
                                                        <div key={window.windowSize}>
                                                            <span>Last {window.windowSize} ticks</span>
                                                            <span>
                                                                Digit {leadingDigit.digit}: {leadingDigit.percentage.toFixed(1)}%
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        <div className='gtraders-ai-statistics__summary'>
                                            <span>Chi-square descriptive statistic: {marketStatistics.chiSquareStatistic?.toFixed(2) ?? '—'}</span>
                                            <span>Largest deviation from 10%: {marketStatistics.maxAbsoluteDeviation.toFixed(2)} pp</span>
                                        </div>
                                        <p>{marketStatistics.interpretation}</p>
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
