import { useEffect, useRef, useState } from 'react';
import {
    AIDerivConnection,
    AIAccountSnapshot,
    AIConnectionStatus,
} from './services/ai-deriv-connection';
import { AIMarketScanner, AIMarketHistory } from './services/ai-market-scanner';
import { AILiveTickStream, AILiveTickStatus } from './services/ai-live-tick-stream';
import { AIMarketStatistics, analyseMarketDigits } from './services/ai-market-statistics';
import { assessAIRisk } from './services/ai-risk-manager';
import { AIContractOpportunity, doesAIPredictionSupportContract, evaluateAIContractOpportunity, evaluateAIProposalEconomics } from './services/ai-contract-scanner';
import { AIPredictionResult, generateAIPrediction } from './services/ai-prediction-engine';
import { requestFreshAIProposal } from './services/ai-proposal-service';
import { executeAIDemoTrade } from './services/ai-demo-execution';
import { AISessionLedger, AISessionSnapshot } from './services/ai-session-ledger';
import './gtraders-super-ai.scss';

const connectionStatusLabel: Record<AIConnectionStatus, string> = {
    disconnected: 'Not connected',
    connecting: 'Connecting securely…',
    connected: 'Private Deriv connection active',
    error: 'Connection needs attention',
};

type AIMarketRejectionDiagnostic = {
    symbol: string; displayName: string; ticks: number; dataQuality: number; dataQualityReason: string;
    contractStatus: string; contractEvidence: string; predictionStatus: string; predictionEvidence: string;
    barrierEvidence: string; quoteEvidence: string; finalReason: string;
};

type SelectedMarketOpportunity = AIContractOpportunity & {
    symbol: string;
    displayName: string;
    proposalId: string;
    askPrice: number;
    payout: number;
    breakEvenProbability: number;
    confidenceMargin: number;
    prediction: AIPredictionResult;
};

const GTradersSuperAI = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [connection] = useState(() => new AIDerivConnection());
    const [liveTickStatus, setLiveTickStatus] = useState<AILiveTickStatus>('stopped');
    const [liveTickStream] = useState(() => new AILiveTickStream(connection, {
        onStatus: status => setLiveTickStatus(status),
    }));
    const [connectionStatus, setConnectionStatus] =
        useState<AIConnectionStatus>('disconnected');
    const [account, setAccount] = useState<AIAccountSnapshot | null>(null);
    const [connectionError, setConnectionError] = useState('');
    const [marketResults, setMarketResults] = useState<AIMarketHistory[]>([]);
    const [rejectionDiagnostics, setRejectionDiagnostics] = useState<AIMarketRejectionDiagnostic[]>([]);
    const [availableMarketCount, setAvailableMarketCount] = useState(0);
    const [marketStatistics, setMarketStatistics] = useState<AIMarketStatistics | null>(null);
    const [marketOpportunity, setMarketOpportunity] = useState<SelectedMarketOpportunity | null>(null);
    const [scannerOutcomeMessage, setScannerOutcomeMessage] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const [scannerError, setScannerError] = useState('');
    const [scannedAt, setScannedAt] = useState<number | null>(null);
    const [stakeInput, setStakeInput] = useState('');
    const [targetProfitInput, setTargetProfitInput] = useState('');
    const [stopLossInput, setStopLossInput] = useState('');
    const [maxConsecutiveLossesInput, setMaxConsecutiveLossesInput] = useState('3');
    const [sessionLedger, setSessionLedger] = useState<AISessionLedger | null>(null);
    const [sessionSnapshot, setSessionSnapshot] = useState<AISessionSnapshot | null>(null);
    const [ledgerError, setLedgerError] = useState('');
    const [isExecuting, setIsExecuting] = useState(false);
    const [executionMessage, setExecutionMessage] = useState('');
    const [preparedOpportunity, setPreparedOpportunity] = useState<SelectedMarketOpportunity | null>(null);
    const [isBotRunning, setIsBotRunning] = useState(false);
    const botStopRequested = useRef(false);
    const executionLock = useRef(false);

    useEffect(() => {
        const unsubscribe = connection.onStatusChange(status => {
            setConnectionStatus(status);
            setAccount(connection.getAccount());
        });

        return () => {
            unsubscribe();
            liveTickStream.stop();
            connection.disconnect();
        };
    }, [connection, liveTickStream]);

    const connectAI = async () => {
        setConnectionError('');
        try {
            const connectedAccount = await connection.connect();
            setAccount(connectedAccount);
            try {
                const ledger = new AISessionLedger(connectedAccount.loginid);
                setSessionLedger(ledger);
                setSessionSnapshot(ledger.getSnapshot());
                setLedgerError('');
            } catch (error) {
                setSessionLedger(null);
                setSessionSnapshot(null);
                setLedgerError(error instanceof Error ? error.message : 'AI session ledger could not be initialized.');
            }
        } catch (error) {
            setConnectionError(
                error instanceof Error ? error.message : 'Unable to connect to Deriv.'
            );
        }
    };

    const scanMarkets = async (balanceOverride?: number): Promise<SelectedMarketOpportunity | null> => {
        if (!riskInputsReady) {
            setScannerError('Enter your stake, target profit and stop loss before scanning.');
            return null;
        }
        if (!account || !sessionLedger || !sessionSnapshot) {
            setScannerError('Connect a verified account and initialize the AI session ledger first.');
            return null;
        }
        const currentSession = sessionLedger.getSnapshot();
        const scanRisk = assessAIRisk(
            { stake: Number(stakeInput), targetProfit: Number(targetProfitInput), stopLoss: Number(stopLossInput), maxConsecutiveLosses: Number(maxConsecutiveLossesInput) },
            { balance: balanceOverride ?? account.balance, sessionProfitLoss: currentSession.sessionProfitLoss, consecutiveLosses: currentSession.consecutiveLosses }
        );
        if (!scanRisk.allowed) {
            setScannerError(scanRisk.explanation);
            return null;
        }

        const scanStake = Number(stakeInput);
        const scanCurrency = account.currency;
        setScannerError('');
        setScannerOutcomeMessage('');
        setMarketResults([]);
        setRejectionDiagnostics([]);
        setMarketStatistics(null);
        setMarketOpportunity(null);
        setAvailableMarketCount(0);
        setScannedAt(null);
        setIsScanning(true);
        try {
            const scanner = new AIMarketScanner(<T,>(payload: Record<string, unknown>) =>
                connection.requestData<T>(payload)
            );
            // Every scan request re-discovers active symbols and fetches new
            // tick history. Demo confirmation performs another complete scan.
            const freshScan = await scanner.scanFreshVolatilityMarkets({
                maxMarkets: 100,
                historyCount: 500,
                concurrency: 3,
            });
            setAvailableMarketCount(freshScan.availableMarketCount);

            if (!freshScan.markets.length) {
                setScannerOutcomeMessage(
                    'NO TRADE — no eligible Volatility Index markets were returned by Deriv.'
                );
                setScannedAt(Date.now());
                return null;
            }

            const results = freshScan.histories;
            setMarketResults(results);

            const evaluatedMarkets = results.map(market => ({
                market,
                opportunity: evaluateAIContractOpportunity(
                    market.digitSequence,
                    market.dataQuality,
                    { multipleComparisonCount: results.length }
                ),
                prediction: generateAIPrediction(
                    market.digitSequence,
                    market.dataQuality,
                    {
                        candidateWindows: [20, 30, 50, 75, 100],
                        trainingFraction: 0.6,
                        minimumMarketSample: 500,
                        minimumDataQuality: 95,
                    },
                    market.tickTimes
                ),
            }));
            const contractQualified = evaluatedMarkets.filter(
                item => item.opportunity.decision === 'MARKET_CANDIDATE'
            );
            // Both independent gates must pass: an Over/Under edge and a
            // separately validated next-digit research prediction.
            const predictionQualified = contractQualified.filter(
                item => item.prediction.decision === 'PREDICTION_CANDIDATE'
            );
            // Reject conflicting signals: the predicted digit itself must satisfy
            // the selected Over/Under barrier before the market can be shortlisted.
            const qualifying = predictionQualified
                .filter(item => doesAIPredictionSupportContract(
                    item.opportunity.contractType,
                    item.opportunity.barrier,
                    item.prediction.predictedDigit
                ))
                .sort((a, b) => b.opportunity.edge - a.opportunity.edge);

            // Request live quotes only for the ten strongest research candidates.
            // Proposal requests price the contract; they do not buy or subscribe.
            const quoteResults = await Promise.allSettled(
                qualifying.slice(0, 10).map(async candidate => {
                    if (
                        !candidate.opportunity.contractType ||
                        candidate.opportunity.barrier === null
                    ) {
                        throw new Error('The candidate is missing its contract details.');
                    }

                    const proposal = await requestFreshAIProposal(
                        <T,>(payload: Record<string, unknown>) => connection.requestData<T>(payload),
                        {
                            amount: scanStake,
                            currency: scanCurrency,
                            contractType: candidate.opportunity.contractType,
                            barrier: candidate.opportunity.barrier,
                            symbol: candidate.market.symbol,
                        }
                    );
                    const { askPrice, payout } = proposal;
                    const economics = evaluateAIProposalEconomics(
                        candidate.opportunity.confidenceLowerBound,
                        { askPrice, payout }
                    );

                    return { ...candidate, proposalId: proposal.id, askPrice, payout, economics };
                })
            );

            const rejectionDetails: AIMarketRejectionDiagnostic[] = evaluatedMarkets.map(item => {
                const contractPassed = item.opportunity.decision === 'MARKET_CANDIDATE';
                const predictionPassed = item.prediction.decision === 'PREDICTION_CANDIDATE';
                const barrierPassed = contractPassed && predictionPassed && doesAIPredictionSupportContract(
                    item.opportunity.contractType, item.opportunity.barrier, item.prediction.predictedDigit
                );
                const quoteIndex = qualifying.findIndex(candidate => candidate.market.symbol === item.market.symbol);
                const quoteResult = quoteIndex >= 0 && quoteIndex < 10 ? quoteResults[quoteIndex] : undefined;
                const quoteEvidence = !barrierPassed
                    ? 'Not requested: an earlier evidence gate failed.'
                    : quoteIndex >= 10
                        ? 'Not requested: candidate ranked outside the top 10 quote requests.'
                        : quoteResult?.status === 'fulfilled'
                            ? quoteResult.value.economics.explanation
                            : quoteResult?.status === 'rejected'
                                ? (quoteResult.reason instanceof Error ? quoteResult.reason.message : String(quoteResult.reason))
                                : 'Quote status unavailable.';
                const finalReason = !contractPassed ? item.opportunity.explanation
                    : !predictionPassed ? item.prediction.explanation
                    : !barrierPassed ? 'Predicted last digit does not satisfy the selected Over/Under barrier.'
                    : quoteResult?.status === 'fulfilled' && quoteResult.value.economics.allowed
                        ? 'Passed all scanner gates; eligible for candidate selection.'
                        : quoteIndex >= 10 ? 'Evidence passed, but no live quote was requested because this candidate ranked outside the top 10.'
                        : quoteEvidence;
                return {
                    symbol: item.market.symbol, displayName: item.market.displayName, ticks: item.market.ticks,
                    dataQuality: item.market.dataQuality, dataQualityReason: item.market.dataQualityReason,
                    contractStatus: contractPassed ? 'PASSED' : 'REJECTED',
                    contractEvidence: `${item.opportunity.explanation} Training/holdout: ${item.opportunity.trainingSampleSize}/${item.opportunity.holdoutSampleSize}; holdout win rate ${(item.opportunity.holdoutWinRate * 100).toFixed(1)}%; fair baseline ${(item.opportunity.baselineWinRate * 100).toFixed(1)}%; adjusted lower bound ${(item.opportunity.confidenceLowerBound * 100).toFixed(1)}%.`,
                    predictionStatus: predictionPassed ? 'PASSED' : 'REJECTED',
                    predictionEvidence: `${item.prediction.explanation} Training/holdout: ${item.prediction.trainingSampleSize}/${item.prediction.holdoutSampleSize}; model accuracy ${(item.prediction.modelWinRate * 100).toFixed(1)}%; matched baseline ${(item.prediction.baselineWinRate * 100).toFixed(1)}%; confidence lower bound ${(item.prediction.confidenceLowerBound * 100).toFixed(1)}%.`,
                    barrierEvidence: barrierPassed
                        ? `Predicted digit ${item.prediction.predictedDigit} satisfies ${item.opportunity.contractLabel} ${item.opportunity.barrier}.`
                        : contractPassed && predictionPassed
                            ? `Predicted digit ${item.prediction.predictedDigit ?? '—'} conflicts with ${item.opportunity.contractLabel} ${item.opportunity.barrier}.`
                            : 'Not evaluated because an earlier gate failed.',
                    quoteEvidence, finalReason,
                };
            });
            setRejectionDiagnostics(rejectionDetails);

            const approvedQuotes = quoteResults.flatMap(result =>
                result.status === 'fulfilled' && result.value.economics.allowed
                    ? [result.value]
                    : []
            );
            const selected = approvedQuotes.sort(
                (a, b) => b.economics.confidenceMargin - a.economics.confidenceMargin
            )[0];

            const selectedOpportunity: SelectedMarketOpportunity | null = selected
                ? {
                    ...selected.opportunity,
                    explanation: selected.economics.explanation,
                    symbol: selected.market.symbol,
                    displayName: selected.market.displayName,
                    proposalId: selected.proposalId,
                    askPrice: selected.askPrice,
                    payout: selected.payout,
                    breakEvenProbability: selected.economics.breakEvenProbability,
                    confidenceMargin: selected.economics.confidenceMargin,
                    prediction: selected.prediction,
                }
                : null;
            setMarketOpportunity(selectedOpportunity);
            if (selectedOpportunity) {
                await liveTickStream.start(selectedOpportunity.symbol);
            } else {
                liveTickStream.stop();
            }

            const statisticsMarket = selected?.market ?? qualifying[0]?.market ?? results[0];
            setMarketStatistics(
                statisticsMarket
                    ? analyseMarketDigits(statisticsMarket.digitSequence)
                    : null
            );
            setScannerOutcomeMessage(
                selected
                    ? ''
                    : !contractQualified.length
                        ? 'NO TRADE — none of the scanned Volatility markets passed the independent Over/Under holdout test. The AI will not force a selection.'
                        : !predictionQualified.length
                            ? 'NO TRADE — an Over/Under pattern was found, but the separate last-digit prediction model did not beat its matched baseline on unseen ticks. The AI will not force a selection.'
                            : !qualifying.length
                                ? 'NO TRADE — the predicted last digit conflicts with the selected Over/Under barrier. The AI will not force a selection.'
                                : 'NO TRADE — the evidence-qualified candidates did not pass the live proposal payout/breakeven check. The AI will not force a selection.'
            );
            setScannedAt(Date.now());

            if (!results.length) {
                setScannerError('No market history was returned. Please try scanning again.');
            }
            return selectedOpportunity;
        } catch (error) {
            setScannerError(error instanceof Error ? error.message : 'Market scan failed.');
            return null;
        } finally {
            setIsScanning(false);
        }
    };


    const getFreshDemoBalance = async (): Promise<AIAccountSnapshot> => {
        if (!account || account.account_type !== 'demo') {
            throw new Error('A verified Deriv demo account is required. Real and unverified accounts are blocked.');
        }
        const response = await connection.requestData<{ balance: AIAccountSnapshot }>({ balance: 1 });
        const fresh = response.balance;
        if (!fresh?.loginid || fresh.loginid !== account.loginid || fresh.currency !== account.currency ||
            !Number.isFinite(Number(fresh.balance)) || Number(fresh.balance) <= 0) {
            throw new Error('The fresh balance response does not match the connected demo account. No trade will be placed.');
        }
        return { ...account, balance: Number(fresh.balance) };
    };

    const prepareDemoTrade = async () => {
        if (executionLock.current) return;
        executionLock.current = true;
        setIsExecuting(true);
        setExecutionMessage('');
        setPreparedOpportunity(null);
        try {
            if (!sessionLedger || !sessionSnapshot || ledgerError) {
                throw new Error('The AI session ledger is unavailable. Demo execution is disabled.');
            }
            const current = sessionLedger.getSnapshot();
            if (current.openContractId !== null || current.executionUncertain) {
                throw new Error('An earlier purchase is unresolved. Reconcile it before preparing another trade.');
            }
            const freshAccount = await getFreshDemoBalance();
            setAccount(freshAccount);
            const candidate = await scanMarkets(freshAccount.balance);
            if (!candidate) {
                setExecutionMessage('NO TRADE — the fresh market scan found no candidate that passed every evidence and pricing check.');
                return;
            }
            setPreparedOpportunity(candidate);
            setExecutionMessage(`Candidate prepared: ${candidate.displayName}, ${candidate.contractLabel} ${candidate.barrier}. Preparation does not buy. Confirmation runs another fresh scan and requests a new proposal.`);
        } catch (error) {
            setExecutionMessage(error instanceof Error ? error.message : 'Demo preparation failed.');
        } finally {
            executionLock.current = false;
            setIsExecuting(false);
        }
    };

    const confirmDemoTrade = async () => {
        if (executionLock.current || !preparedOpportunity) return;
        executionLock.current = true;
        setIsExecuting(true);
        setExecutionMessage('Rechecking account, market evidence and contract pricing…');
        try {
            if (!sessionLedger || !account || account.account_type !== 'demo' || ledgerError) {
                throw new Error('A verified demo account and valid AI session ledger are required.');
            }
            const beforeScan = sessionLedger.getSnapshot();
            if (beforeScan.openContractId !== null || beforeScan.executionUncertain) {
                throw new Error('An earlier purchase is unresolved. No additional purchase is allowed.');
            }

            const freshAccount = await getFreshDemoBalance();
            setAccount(freshAccount);
            const initialRisk = assessAIRisk(
                { stake, targetProfit, stopLoss, maxConsecutiveLosses },
                { balance: freshAccount.balance, sessionProfitLoss: beforeScan.sessionProfitLoss, consecutiveLosses: beforeScan.consecutiveLosses }
            );
            if (!initialRisk.allowed) {
                setPreparedOpportunity(null);
                setExecutionMessage(initialRisk.explanation);
                return;
            }

            const candidate = await scanMarkets(freshAccount.balance);
            if (!candidate || !candidate.contractType || candidate.barrier === null) {
                setPreparedOpportunity(null);
                setExecutionMessage('NO TRADE — the confirmation scan did not produce a fully qualified candidate.');
                return;
            }

            const preBuyAccount = await getFreshDemoBalance();
            setAccount(preBuyAccount);
            const proposal = await requestFreshAIProposal(
                <T,>(payload: Record<string, unknown>) => connection.requestData<T>(payload),
                { amount: stake, currency: preBuyAccount.currency, contractType: candidate.contractType, barrier: candidate.barrier, symbol: candidate.symbol }
            );
            // Refresh the authenticated balance after the proposal round-trip,
            // so the final gate sees the latest available account funds.
            const finalAccount = await getFreshDemoBalance();
            setAccount(finalAccount);
            const latestSession = sessionLedger.getSnapshot();
            const gateInput = {
                connectionStatus: connection.getStatus(),
                accountType: finalAccount.account_type,
                hasOpenContract: latestSession.openContractId !== null || latestSession.executionUncertain,
                hasQualifiedOpportunity: candidate.decision === 'MARKET_CANDIDATE' &&
                    candidate.prediction.decision === 'PREDICTION_CANDIDATE' &&
                    doesAIPredictionSupportContract(candidate.contractType, candidate.barrier, candidate.prediction.predictedDigit),
                liveTickStreamHealthy: liveTickStream.isHealthy(),
                riskSettings: { stake, targetProfit, stopLoss, maxConsecutiveLosses },
                riskSnapshot: { balance: finalAccount.balance, sessionProfitLoss: latestSession.sessionProfitLoss, consecutiveLosses: latestSession.consecutiveLosses },
                expectedContract: { amount: stake, currency: finalAccount.currency, contractType: candidate.contractType, barrier: candidate.barrier, symbol: candidate.symbol },
                proposal,
                confidenceLowerBound: candidate.confidenceLowerBound,
            };

            const result = await executeAIDemoTrade(gateInput, {
                request: payload => connection.requestData(payload),
                waitForSettlement: contractId => connection.waitForContractSettlement(contractId),
                onPurchaseIntent: () => {
                    sessionLedger.reservePurchase();
                    setSessionSnapshot(sessionLedger.getSnapshot());
                },
                onPurchased: contractId => {
                    sessionLedger.markPurchase(contractId);
                    setSessionSnapshot(sessionLedger.getSnapshot());
                },
                onPurchaseUncertain: () => {
                    sessionLedger.markPurchaseUncertain();
                    setSessionSnapshot(sessionLedger.getSnapshot());
                },
            });

            if (result.status === 'BLOCKED') {
                setExecutionMessage(result.gate.explanation);
                return;
            }
            if (result.status === 'EXECUTION_ABORTED' || result.status === 'PURCHASE_UNCERTAIN' || result.status === 'SETTLEMENT_PENDING') {
                setExecutionMessage(result.message);
                setSessionSnapshot(sessionLedger.getSnapshot());
                setPreparedOpportunity(null);
                return;
            }

            const settledSession = sessionLedger.recordSettlement(result.contractId, result.profit);
            setSessionSnapshot(settledSession);
            const balanceAfter = await connection.requestData<{ balance: AIAccountSnapshot }>({ balance: 1 });
            if (balanceAfter.balance?.loginid !== finalAccount.loginid || balanceAfter.balance.currency !== finalAccount.currency ||
                !Number.isFinite(Number(balanceAfter.balance.balance))) {
                throw new Error('The contract settled, but the post-settlement balance could not be reconciled. The verified contract P/L remains in the session ledger.');
            }
            setAccount({ ...finalAccount, balance: Number(balanceAfter.balance.balance) });
            setExecutionMessage(`DEMO CONTRACT SETTLED — ${result.settlementStatus.toUpperCase()}. Realized P/L: ${result.profit.toFixed(2)} ${finalAccount.currency}. Session P/L: ${settledSession.sessionProfitLoss.toFixed(2)} ${finalAccount.currency}. Consecutive losses: ${settledSession.consecutiveLosses}. Stake unchanged; no Martingale.`);
            setPreparedOpportunity(null);
        } catch (error) {
            if (sessionLedger) setSessionSnapshot(sessionLedger.getSnapshot());
            setExecutionMessage(error instanceof Error ? error.message : 'Demo execution stopped safely.');
        } finally {
            executionLock.current = false;
            setIsExecuting(false);
        }
    };

    const runBot = async () => {
        if (isBotRunning) {
            botStopRequested.current = true;
            setIsBotRunning(false);
            setExecutionMessage('STOP BOT requested — no new demo purchase will be started.');
            return;
        }

        if (!riskInputsReady || !riskAssessment?.allowed || !isConnected || account?.account_type !== 'demo') {
            setExecutionMessage('RUN BOT is blocked until the verified DEMO account, risk controls and session checks are ready.');
            return;
        }

        botStopRequested.current = false;
        setIsBotRunning(true);
        setExecutionMessage('RUN BOT started — scanning for the latest qualified demo opportunity…');

        try {
            if (!sessionLedger || !sessionSnapshot || ledgerError) {
                throw new Error('The AI session ledger is unavailable. Demo execution is disabled.');
            }

            const freshAccount = await getFreshDemoBalance();
            setAccount(freshAccount);

            if (botStopRequested.current) {
                setExecutionMessage('BOT STOPPED before a trade was prepared.');
                return;
            }

            const candidate = await scanMarkets(freshAccount.balance);
            if (!candidate || !candidate.contractType || candidate.barrier === null) {
                setExecutionMessage('NO TRADE — the fresh market scan produced no fully qualified candidate.');
                return;
            }

            if (botStopRequested.current) {
                setExecutionMessage('BOT STOPPED before confirmation. The scanned candidate was not purchased.');
                return;
            }

            setPreparedOpportunity(candidate);
            setExecutionMessage(`AI selected: ${candidate.displayName} · ${candidate.contractLabel} · digit ${candidate.prediction.predictedDigit}. Revalidating before the demo purchase…`);

            const beforeScan = sessionLedger.getSnapshot();
            if (beforeScan.openContractId !== null || beforeScan.executionUncertain) {
                throw new Error('An earlier purchase is unresolved. No additional purchase is allowed.');
            }

            const preBuyAccount = await getFreshDemoBalance();
            setAccount(preBuyAccount);

            if (botStopRequested.current) {
                setPreparedOpportunity(null);
                setExecutionMessage('BOT STOPPED before the final purchase gate.');
                return;
            }

            const candidateProposal = await requestFreshAIProposal(
                <T,>(payload: Record<string, unknown>) => connection.requestData<T>(payload),
                {
                    amount: stake,
                    currency: preBuyAccount.currency,
                    contractType: candidate.contractType,
                    barrier: candidate.barrier,
                    symbol: candidate.symbol,
                }
            );

            const finalAccount = await getFreshDemoBalance();
            setAccount(finalAccount);
            const latestSession = sessionLedger.getSnapshot();

            const gateInput = {
                connectionStatus: connection.getStatus(),
                accountType: finalAccount.account_type,
                hasOpenContract: latestSession.openContractId !== null || latestSession.executionUncertain,
                hasQualifiedOpportunity: candidate.decision === 'MARKET_CANDIDATE' &&
                    candidate.prediction.decision === 'PREDICTION_CANDIDATE' &&
                    doesAIPredictionSupportContract(candidate.contractType, candidate.barrier, candidate.prediction.predictedDigit),
                liveTickStreamHealthy: liveTickStream.isHealthy(),
                riskSettings: { stake, targetProfit, stopLoss, maxConsecutiveLosses },
                riskSnapshot: { balance: finalAccount.balance, sessionProfitLoss: latestSession.sessionProfitLoss, consecutiveLosses: latestSession.consecutiveLosses },
                expectedContract: { amount: stake, currency: finalAccount.currency, contractType: candidate.contractType, barrier: candidate.barrier, symbol: candidate.symbol },
                proposal: candidateProposal,
                confidenceLowerBound: candidate.confidenceLowerBound,
            };

            if (botStopRequested.current) {
                setPreparedOpportunity(null);
                setExecutionMessage('BOT STOPPED before the final execution gate.');
                return;
            }

            const result = await executeAIDemoTrade(gateInput, {
                request: payload => connection.requestData(payload),
                waitForSettlement: contractId => connection.waitForContractSettlement(contractId),
                onPurchaseIntent: () => {
                    sessionLedger.reservePurchase();
                    setSessionSnapshot(sessionLedger.getSnapshot());
                },
                onPurchased: contractId => {
                    sessionLedger.markPurchase(contractId);
                    setSessionSnapshot(sessionLedger.getSnapshot());
                },
                onPurchaseUncertain: () => {
                    sessionLedger.markPurchaseUncertain();
                    setSessionSnapshot(sessionLedger.getSnapshot());
                },
            });

            if (result.status === 'BLOCKED' || result.status === 'EXECUTION_ABORTED' || result.status === 'PURCHASE_UNCERTAIN' || result.status === 'SETTLEMENT_PENDING') {
                setExecutionMessage(result.status === 'BLOCKED' ? result.gate.explanation : result.message);
                setSessionSnapshot(sessionLedger.getSnapshot());
                return;
            }

            const settledSession = sessionLedger.recordSettlement(result.contractId, result.profit);
            setSessionSnapshot(settledSession);
            const balanceAfter = await connection.requestData<{ balance: AIAccountSnapshot }>({ balance: 1 });
            if (balanceAfter.balance?.loginid !== finalAccount.loginid || balanceAfter.balance.currency !== finalAccount.currency ||
                !Number.isFinite(Number(balanceAfter.balance.balance))) {
                throw new Error('The contract settled, but the post-settlement balance could not be reconciled. The verified contract P/L remains in the session ledger.');
            }

            setAccount({ ...finalAccount, balance: Number(balanceAfter.balance.balance) });
            setExecutionMessage(`DEMO BOT TRADE SETTLED — ${result.settlementStatus.toUpperCase()}. Realized P/L: ${result.profit.toFixed(2)} ${finalAccount.currency}. Session P/L: ${settledSession.sessionProfitLoss.toFixed(2)} ${finalAccount.currency}. The bot remains stopped after this controlled demo trade.`);
            setPreparedOpportunity(null);
        } catch (error) {
            setExecutionMessage(error instanceof Error ? error.message : 'Bot execution stopped safely.');
        } finally {
            botStopRequested.current = false;
            setIsBotRunning(false);
            setPreparedOpportunity(null);
        }
    };

    const resumeSettlementMonitoring = async () => {
        if (executionLock.current || !sessionLedger) return;
        const openContractId = sessionLedger.getSnapshot().openContractId;
        if (openContractId === null) return;
        executionLock.current = true;
        setIsExecuting(true);
        setExecutionMessage(`Resuming settlement monitoring for contract ${openContractId}…`);
        try {
            const settlement = await connection.waitForContractSettlement(openContractId);
            const updatedSession = sessionLedger.recordSettlement(openContractId, settlement.profit);
            setSessionSnapshot(updatedSession);
            const freshBalance = await getFreshDemoBalance();
            setAccount(freshBalance);
            setExecutionMessage(`CONTRACT RECONCILED — ${settlement.status.toUpperCase()}. Realized P/L: ${settlement.profit.toFixed(2)} ${freshBalance.currency}. Session P/L: ${updatedSession.sessionProfitLoss.toFixed(2)} ${freshBalance.currency}.`);
        } catch (error) {
            setSessionSnapshot(sessionLedger.getSnapshot());
            setExecutionMessage(error instanceof Error ? error.message : 'Settlement is still unverified. Trading remains locked.');
        } finally {
            executionLock.current = false;
            setIsExecuting(false);
        }
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
    const riskAssessment = isConnected && account && sessionSnapshot && riskInputsReady
        ? assessAIRisk(
            { stake, targetProfit, stopLoss, maxConsecutiveLosses },
            { balance: account.balance, sessionProfitLoss: sessionSnapshot.sessionProfitLoss, consecutiveLosses: sessionSnapshot.consecutiveLosses }
        )
        : null;

    return (
        <>
            <button
                type='button'
                className='gtraders-ai-float'
                aria-label={isOpen ? 'Close GTraders Super AI window' : 'Open GTraders Super AI window'}
                aria-expanded={isOpen}
                aria-controls='gtraders-ai-panel'
                onClick={() => setIsOpen(open => !open)}
            >
                <span className='gtraders-ai-float__ring' aria-hidden='true' />
                <span className='gtraders-ai-float__letters'>AI</span>
            </button>

            {isOpen && (
                <div
                    className='gtraders-ai-overlay'
                    role='presentation'
                    onClick={() => setIsOpen(false)}
                >
                <section
                    id='gtraders-ai-panel'
                    className='gtraders-ai-panel'
                    role='dialog'
                    aria-modal='true'
                    aria-labelledby='gtraders-ai-title'
                    onClick={event => event.stopPropagation()}
                >
                    <header className='gtraders-ai-panel__header'>
                        <div>
                            <span className='gtraders-ai-panel__eyebrow'>GTRADERS SUPER</span>
                            <h2 id='gtraders-ai-title'>AI Trading Assistant</h2>
                        </div>
                        <button
                            type='button'
                            className='gtraders-ai-panel__close'
                            aria-label='Close AI trading window'
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
                                    Account type: {account.account_type === 'demo'
                                        ? 'DEMO · execution eligible after all safety checks'
                                        : account.account_type === 'real'
                                            ? 'REAL · autonomous execution blocked during demo validation'
                                            : 'UNVERIFIED · autonomous execution blocked'}
                                </span>
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
                                    <span>Session limits for controlled demo execution</span>
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
                                        <span>Remaining target: {riskAssessment.remainingProfitTarget.toFixed(2)} {account?.currency ?? ''}</span>
                                        <span>Remaining loss allowance: {riskAssessment.remainingLossAllowance.toFixed(2)} {account?.currency ?? ''}</span>
                                    </div>
                                ) : (
                                    <p className='gtraders-ai-risk__hint'>
                                        Enter a positive stake, target profit and stop loss to check the limits. The initial stake is capped at 2% of the connected account balance.
                                    </p>
                                )}
                                {sessionSnapshot && (
                                    <div className='gtraders-ai-session-summary'>
                                        <strong>Verified AI session ledger</strong>
                                        <span>Realized session P/L: {sessionSnapshot.sessionProfitLoss.toFixed(2)} {account.currency}</span>
                                        <span>Consecutive losses: {sessionSnapshot.consecutiveLosses}</span>
                                        <span>Settled AI contracts: {sessionSnapshot.settledTrades}</span>
                                        {sessionSnapshot.openContractId !== null && <span>Unsettled contract: {sessionSnapshot.openContractId} · new purchases locked</span>}
                                        {sessionSnapshot.executionUncertain && <span>Purchase status uncertain · execution locked pending manual reconciliation</span>}
                                    </div>
                                )}
                                {ledgerError && <p className='gtraders-ai-panel__error' role='alert'>{ledgerError}</p>}
                            </section>
                        )}

                        {isConnected && account && (
                            <section className='gtraders-ai-execution'>
                                <div className='gtraders-ai-risk__heading'>
                                    <strong>Controlled Demo Execution</strong>
                                    <span>One trade at a time · fresh confirmation scan · no Martingale</span>
                                    <span role='status'>Live tick stream: {liveTickStatus.toUpperCase()} · {liveTickStream.isHealthy() ? 'evidence current' : 'NO TRADE until revalidated'}</span>
                                </div>
                                <p>Prepare only scans and displays a candidate. Confirmation rescans the markets, requests a brand-new proposal, refreshes account balance and runs the final safety gate before one demo purchase.</p>
                                {preparedOpportunity && (
                                    <div className='gtraders-ai-execution__candidate'>
                                        <strong>AI-selected candidate: {preparedOpportunity.displayName}</strong>
                                        <span>{preparedOpportunity.contractLabel} {preparedOpportunity.barrier} · predicted last digit {preparedOpportunity.prediction.predictedDigit}</span>
                                        <span>Run Bot uses this selection only after a fresh confirmation scan and final safety gate.</span>
                                    </div>
                                )}
                                {sessionSnapshot && sessionSnapshot.openContractId !== null && (
                                    <button type='button' onClick={resumeSettlementMonitoring} disabled={isExecuting || !isConnected}>
                                        {isExecuting ? 'Checking settlement…' : `Resume settlement for contract ${sessionSnapshot.openContractId}`}
                                    </button>
                                )}
                                {executionMessage && <p className='gtraders-ai-execution__message' role='status'>{executionMessage}</p>}
                                {sessionSnapshot?.executionUncertain && <p className='gtraders-ai-panel__error' role='alert'>The pre-buy reservation or purchase outcome is unresolved. Do not retry. Check the Deriv demo account and reconcile before using this AI session again.</p>}
                                <p className='gtraders-ai-risk__disclaimer'>Only explicitly confirmed single DEMO purchases are enabled for validation. No live-account purchase, automatic retry, Martingale or continuous trading loop is enabled.</p>
                            </section>
                        )}

                        {isConnected && (
                            <section className='gtraders-ai-scanner'>
                                <div className='gtraders-ai-scanner__heading'>
                                    <div>
                                        <strong>Independent Market Scanner</strong>
                                        <span>{availableMarketCount} Volatility Index markets found · fresh scan across all returned eligible markets</span>
                                    </div>
                                    <button
                                        type='button'
                                        onClick={() => scanMarkets()}
                                        disabled={isScanning || isExecuting || !riskInputsReady || !riskAssessment?.allowed}
                                    >
                                        {isScanning ? 'Scanning markets…' : 'Market Scanner'}
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
                                {rejectionDiagnostics.length > 0 && (
                                    <section className='gtraders-ai-diagnostics' aria-live='polite'>
                                        <div className='gtraders-ai-diagnostics__heading'>
                                            <strong>AI Rejection Diagnostics</strong>
                                            <span>Per-market gate results from this scan. Qualification thresholds and execution safeguards are unchanged.</span>
                                        </div>
                                        <div className='gtraders-ai-diagnostics__totals'>
                                            <div><strong>{rejectionDiagnostics.length}</strong><span>Markets evaluated</span></div>
                                            <div><strong>{rejectionDiagnostics.filter(item => item.finalReason.startsWith('Passed all')).length}</strong><span>Passed all scanner gates</span></div>
                                            <div><strong>{rejectionDiagnostics.filter(item => !item.finalReason.startsWith('Passed all')).length}</strong><span>Rejected / not selected</span></div>
                                        </div>
                                        {rejectionDiagnostics.map(item => (
                                            <article className='gtraders-ai-diagnostics__item' key={item.symbol}>
                                                <strong>{item.displayName} · {item.symbol}</strong>
                                                <span>{item.ticks} valid ticks · data quality {item.dataQuality.toFixed(1)}% · {item.dataQualityReason}</span>
                                                <div className='gtraders-ai-diagnostics__status'>
                                                    <span className={item.contractStatus === 'PASSED' ? 'is-passed' : 'is-rejected'}>Over/Under: {item.contractStatus}</span>
                                                    <span className={item.predictionStatus === 'PASSED' ? 'is-passed' : 'is-rejected'}>Prediction: {item.predictionStatus}</span>
                                                </div>
                                                <span><strong>Contract evidence:</strong> {item.contractEvidence}</span>
                                                <span><strong>Prediction evidence:</strong> {item.predictionEvidence}</span>
                                                <span><strong>Barrier compatibility:</strong> {item.barrierEvidence}</span>
                                                <span><strong>Live quote:</strong> {item.quoteEvidence}</span>
                                                <span className='gtraders-ai-diagnostics__reason'><strong>Final outcome:</strong> {item.finalReason}</span>
                                                {marketResults.find(market => market.symbol === item.symbol)?.scanError && (
                                                    <span><strong>History request error:</strong> {marketResults.find(market => market.symbol === item.symbol)?.scanError}</span>
                                                )}
                                            </article>
                                        ))}
                                    </section>
                                )}
                                {marketStatistics && (
                                    <div className='gtraders-ai-statistics'>
                                        <div className='gtraders-ai-statistics__heading'>
                                            <strong>Digit distribution · {marketOpportunity?.displayName ?? marketResults[0]?.displayName}</strong>
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
                                {scannedAt && (
                                    <section className='gtraders-ai-prediction' aria-live='polite'>
                                        <div className='gtraders-ai-statistics__heading'>
                                            <strong>AI Market Selection</strong>
                                            <span>Volatility market scan · training selection · untouched chronological holdout</span>
                                        </div>
                                        {marketOpportunity ? (
                                            <>
                                                <strong>{marketOpportunity.displayName}</strong>
                                                <span>Market symbol: {marketOpportunity.symbol}</span>
                                                <div className='gtraders-ai-statistics__summary'>
                                                    <span>Contract type: {marketOpportunity.contractLabel}</span>
                                                    <span>Digit barrier: {marketOpportunity.barrier}</span>
                                                    <span>Contract code: {marketOpportunity.contractType} · 1 tick</span>
                                                    <span>AI estimated next last digit: {marketOpportunity.prediction.predictedDigit}</span>
                                                    <span>Recent-window historical share: {((marketOpportunity.prediction.historicalShare ?? 0) * 100).toFixed(1)}% (not a calibrated probability)</span>
                                                    <span>Prediction holdout accuracy: {(marketOpportunity.prediction.modelWinRate * 100).toFixed(1)}%</span>
                                                    <span>Matched baseline accuracy: {(marketOpportunity.prediction.baselineWinRate * 100).toFixed(1)}%</span>
                                                    <span>Prediction confidence lower bound: {(marketOpportunity.prediction.confidenceLowerBound * 100).toFixed(1)}%</span>
                                                    <span>Training win rate: {(marketOpportunity.trainingWinRate * 100).toFixed(1)}%</span>
                                                    <span>Unseen holdout win rate: {(marketOpportunity.holdoutWinRate * 100).toFixed(1)}%</span>
                                                    <span>Fair baseline: {(marketOpportunity.baselineWinRate * 100).toFixed(1)}%</span>
                                                    <span>Adjusted lower confidence bound: {(marketOpportunity.confidenceLowerBound * 100).toFixed(1)}%</span>
                                                    <span>Fresh proposal ID: {marketOpportunity.proposalId}</span>
                                                    <span>Live stake quote: {marketOpportunity.askPrice.toFixed(2)} {account?.currency ?? ''}</span>
                                                    <span>Potential payout: {marketOpportunity.payout.toFixed(2)} {account?.currency ?? ''}</span>
                                                    <span>Break-even win rate: {(marketOpportunity.breakEvenProbability * 100).toFixed(1)}%</span>
                                                    <span>Confidence margin above break-even: {(marketOpportunity.confidenceMargin * 100).toFixed(2)} pp</span>
                                                    <span>Training / holdout ticks: {marketOpportunity.trainingSampleSize} / {marketOpportunity.holdoutSampleSize}</span>
                                                </div>
                                                <span>{marketOpportunity.explanation}</span>
                                            </>
                                        ) : (
                                            <>
                                                <strong>NO TRADE</strong>
                                                <span>{scannerOutcomeMessage || 'No market passed the required evidence checks.'}</span>
                                            </>
                                        )}
                                        <span>
                                            Market Scanner never places an order. Any selected candidate still requires separate demo execution validation before automated trading can be enabled.
                                        </span>
                                    </section>
                                )}
                                <p className='gtraders-ai-scanner__disclaimer'>
                                    Market activity ranking is context only. Contract selection is separately tested against a fair baseline on an untouched holdout; it is still research, not a profitability guarantee.
                                </p>
                            </section>
                        )}

                        {isConnected && (
                            <section className='gtraders-ai-selected' aria-live='polite'>
                                <div className='gtraders-ai-selected__heading'>
                                    <strong>Selected by AI</strong>
                                    <span>{marketOpportunity ? 'Live scanner results · automatically populated' : scannedAt ? 'NO QUALIFIED MARKET · values shown as null' : 'Waiting for Market Scanner · values shown as null'}</span>
                                </div>
                                <div className='gtraders-ai-selected__grid'>
                                    <div className='gtraders-ai-selected__card'>
                                        <span>Market</span>
                                        <strong>{marketOpportunity ? marketOpportunity.displayName : 'null'}</strong>
                                        <small>{marketOpportunity ? marketOpportunity.symbol : 'No tradable market selected'}</small>
                                    </div>
                                    <div className='gtraders-ai-selected__card'>
                                        <span>Contract</span>
                                        <strong>{marketOpportunity ? marketOpportunity.contractLabel : 'null'}</strong>
                                        <small>{marketOpportunity ? `${marketOpportunity.contractType} · 1 tick` : 'No qualified contract'}</small>
                                    </div>
                                    <div className='gtraders-ai-selected__card'>
                                        <span>Digit</span>
                                        <strong>{marketOpportunity ? marketOpportunity.prediction.predictedDigit : 'null'}</strong>
                                        <small>{marketOpportunity ? 'AI estimated last digit' : 'No validated prediction'}</small>
                                    </div>
                                </div>
                            </section>
                        )}

                        {isConnected && (
                            <button type='button' onClick={runBot}
                                className={`gtraders-ai-execution__run-button${isBotRunning ? ' gtraders-ai-execution__run-button--stop' : ''}`}
                                disabled={!isBotRunning && (!marketOpportunity || !riskInputsReady || account.account_type !== 'demo' || !sessionLedger || Boolean(ledgerError) || !sessionSnapshot || sessionSnapshot.openContractId !== null || sessionSnapshot.executionUncertain || isExecuting)}>
                                {isBotRunning ? '■ Stop Bot' : '▶ Run Bot'}
                            </button>
                        )}

                        {!isConnected && (
                            <div className='gtraders-ai-panel__actions'>
                                <button
                                    type='button'
                                    className='gtraders-ai-panel__connect'
                                    onClick={connectAI}
                                    disabled={isConnecting}
                                >
                                    {isConnecting ? 'Connecting…' : 'Connect AI to Deriv'}
                                </button>
                            </div>
                        )}

                        <p className='gtraders-ai-panel__notice'>
                            Only explicitly confirmed single DEMO purchases are enabled for validation. Continuous autonomous trading and all REAL-account execution remain disabled.
                        </p>
                        <span className='gtraders-ai-panel__demo'>DEMO-FIRST DEVELOPMENT</span>
                    </div>
                </section>
                </div>
            )}
        </>
    );
};

export default GTradersSuperAI;
