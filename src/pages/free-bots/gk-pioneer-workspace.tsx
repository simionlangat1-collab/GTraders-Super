import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { observer as botObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import './gk-pioneer-workspace.scss';

const STORAGE_KEY = 'gtraders-super:gk-pioneer-workspace:v4';
const RECOVERY_PREDICTION_KEY = `${STORAGE_KEY}:prediction-after-loss`;

const HIDDEN_SETUP_VARIABLES = new Set([
    'martingale:payoutRate',
    'martingale:cycleLoss',
    'Target Profit Enabled',
    'Target Loss Enabled',
    'setMaxStake?',
    'maxStake',
]);

const syncAmountControls = (workspace: any, event?: any) => {
    const blocks = workspace.getAllBlocks(false).filter(
        (block: any) => block.type === 'variables_set'
    );
    const initialBlock = blocks.find(
        (block: any) => block.getFieldValue('VAR') === 'Initial Amount'
    );
    const winBlock = blocks.find(
        (block: any) => block.getFieldValue('VAR') === 'Win Amount'
    );
    if (!initialBlock || !winBlock) return;

    let changedBlock = event?.blockId ? workspace.getBlockById(event.blockId) : null;
    while (changedBlock && changedBlock.type !== 'variables_set') {
        changedBlock = changedBlock.getParent?.();
    }

    const changedName = changedBlock?.getFieldValue?.('VAR');
    const sourceBlock =
        changedName === 'Win Amount'
            ? winBlock
            : changedName === 'Initial Amount'
              ? initialBlock
              : initialBlock;
    const targetBlock = sourceBlock === initialBlock ? winBlock : initialBlock;
    const sourceNumber = sourceBlock.getInputTargetBlock('VALUE')?.getField('NUM');
    const targetNumber = targetBlock.getInputTargetBlock('VALUE')?.getField('NUM');
    if (!sourceNumber || !targetNumber) return;

    const amount = Number(sourceNumber.getValue());
    if (!Number.isFinite(amount) || amount < 0) return;
    if (String(targetNumber.getValue()) === String(amount)) return;

    const events = window.Blockly?.Events;
    events?.disable();
    try {
        targetNumber.setValue(String(amount));
    } finally {
        events?.enable();
    }
};

const getTradeOptionsBlock = (workspace: any) =>
    workspace.getAllBlocks(false).find(
        (block: any) =>
            block.type === 'trade_definition_tradeoptions' ||
            block.type === 'trade_definition_tradeoptions_payout'
    );

const ensureRecoveryPredictionInput = (workspace: any, Blockly: any) => {
    const tradeOptionsBlock = getTradeOptionsBlock(workspace);
    if (
        !tradeOptionsBlock ||
        !tradeOptionsBlock.getInput('PREDICTION') ||
        !tradeOptionsBlock.getInput('PREDICTION_LABEL') ||
        tradeOptionsBlock.getInput('PREDICTION_AFTER_LOSS')
    ) {
        return false;
    }

    const basePrediction = Number(
        tradeOptionsBlock.getInputTargetBlock('PREDICTION')?.getFieldValue('NUM')
    );
    const savedRecovery = Number(window.localStorage.getItem(RECOVERY_PREDICTION_KEY));
    const defaultRecovery = basePrediction === 2 ? 3 : basePrediction === 7 ? 6 : basePrediction;
    const recoveryPrediction =
        Number.isInteger(savedRecovery) && savedRecovery >= 0 && savedRecovery <= 9
            ? savedRecovery
            : Number.isInteger(defaultRecovery) && defaultRecovery >= 0 && defaultRecovery <= 9
              ? defaultRecovery
              : 3;

    const events = Blockly.Events;
    events?.disable();
    try {
        tradeOptionsBlock
            .appendDummyInput('PREDICTION_AFTER_LOSS')
            .appendField('Prediction after Loss')
            .appendField(new Blockly.FieldNumber(recoveryPrediction, 0, 9, 1), 'PREDICTION_AFTER_LOSS');
        tradeOptionsBlock.moveInputBefore('PREDICTION_AFTER_LOSS', 'PREDICTION_LABEL');
        tradeOptionsBlock.render();
    } finally {
        events?.enable();
    }

    if (!Number.isInteger(savedRecovery) || savedRecovery < 0 || savedRecovery > 9) {
        window.localStorage.setItem(RECOVERY_PREDICTION_KEY, String(recoveryPrediction));
    }

    return true;
};

const persistRecoveryPrediction = (workspace: any) => {
    const tradeOptionsBlock = getTradeOptionsBlock(workspace);
    if (!tradeOptionsBlock?.getInput('PREDICTION_AFTER_LOSS')) return;
    const value = Number(tradeOptionsBlock.getFieldValue('PREDICTION_AFTER_LOSS'));
    if (Number.isInteger(value) && value >= 0 && value <= 9) {
        window.localStorage.setItem(RECOVERY_PREDICTION_KEY, String(value));
    }
};

const hideInternalSetupBlocks = (workspace: any) => {
    workspace.getAllBlocks(false).forEach((block: any) => {
        if (block.getParent?.() || block.type !== 'variables_set') return;
        const variableName = block.getFieldValue('VAR');
        if (!HIDDEN_SETUP_VARIABLES.has(variableName)) return;

        // Hide the rendered Blockly block itself. The block remains in the
        // workspace model/XML and is still included in generated JavaScript.
        if (typeof block.setVisible === 'function') {
            block.setVisible(false);
        } else {
            const root = block.getSvgRoot?.();
            if (root) root.style.display = 'none';
        }
    });
};

type TGKPioneerWorkspaceProps = {
    onBack: () => void;
};

const GKPioneerWorkspace = observer(({ onBack }: TGKPioneerWorkspaceProps) => {
    const { quick_strategy, run_panel } = useStore();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const workspaceRef = useRef<any>(null);
    const [status, setStatus] = useState('Preparing your independent Blockly workspace…');
    const [error, setError] = useState('');
    const completedContracts = useRef(new Set<number>());
    const isBotRunning = run_panel.is_running;

    useEffect(() => {
        let cancelled = false;
        let workspace: any;

        const initialize = async () => {
            try {
                const Blockly = window.Blockly;
                const originalWorkspace = Blockly?.derivWorkspace;
                const container = containerRef.current;

                if (!Blockly || !originalWorkspace || !container) {
                    throw new Error('The Deriv Blockly engine is not ready yet. Open Bot Builder once, then return to G-K Pioneer.');
                }

                workspace = Blockly.inject(container, {
                    media: 'assets/media/',
                    renderer: 'zelos',
                    trashcan: true,
                    scrollbars: true,
                    zoom: {
                        controls: true,
                        wheel: true,
                        startScale: window.innerWidth < 768 ? 0.62 : 0.78,
                    },
                    // G-K Pioneer deliberately uses a clean workspace without the
                    // original Deriv category toolbox/flyout overlay.
                    theme: Blockly.Themes.zelos_renderer,
                });

                workspace.RTL = originalWorkspace.RTL;
                workspaceRef.current = workspace;
                run_panel.setExecutionWorkspace(workspace);

                const persistWorkspace = (event: any) => {
                    if (event?.isUiEvent || event?.type === Blockly.Events.UI) return;
                    try {
                        ensureRecoveryPredictionInput(workspace, Blockly);
                        persistRecoveryPrediction(workspace);
                        syncAmountControls(workspace, event);
                        const xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
                        window.localStorage.setItem(STORAGE_KEY, xml);
                    } catch (saveError) {
                        console.warn('G-K Pioneer workspace could not be saved:', saveError);
                    }
                };
                workspace.addChangeListener(persistWorkspace);

                const savedXml = window.localStorage.getItem(STORAGE_KEY);
                if (savedXml) {
                    const dom = Blockly.utils.xml.textToDom(savedXml);
                    Blockly.Xml.domToWorkspace(dom, workspace);
                    ensureRecoveryPredictionInput(workspace, Blockly);
                    persistRecoveryPrediction(workspace);
                    syncAmountControls(workspace);
                    workspace.cleanUp();
                    hideInternalSetupBlocks(workspace);
                    setStatus('Your separate G-K Pioneer workspace has been restored.');
                } else {
                    setStatus('Creating the starter Martingale strategy…');
                    await quick_strategy.onSubmit(
                        {
                            symbol: '1HZ10V',
                            tradetype: 'overunder',
                            type: 'both',
                            last_digit_prediction: 2,
                            size: 2.5,
                            stake: 10,
                            durationtype: 't',
                            duration: 1,
                            profit: 10,
                            loss: 10,
                            boolean_max_stake: false,
                            max_stake: 10,
                            action: 'EDIT',
                        } as any,
                        workspace,
                        'MARTINGALE'
                    );
                    if (cancelled) return;
                    ensureRecoveryPredictionInput(workspace, Blockly);
                    persistRecoveryPrediction(workspace);
                    syncAmountControls(workspace);
                    workspace.cleanUp();
                    hideInternalSetupBlocks(workspace);
                    persistWorkspace({ type: 'create' });
                    setStatus('Independent G-K Pioneer workspace is ready. Changes are saved on this device.');
                }

                hideInternalSetupBlocks(workspace);

                if (!workspace.getAllBlocks(false).length) {
                    throw new Error('The starter strategy did not load into the independent workspace. Please reopen G-K Pioneer after Bot Builder has finished loading.');
                }

                window.dispatchEvent(new Event('resize'));
            } catch (initializationError) {
                if (!cancelled) {
                    setError(initializationError instanceof Error ? initializationError.message : 'Unable to initialize G-K Pioneer.');
                    setStatus('Workspace initialization failed.');
                }
            }
        };

        void initialize();

        return () => {
            cancelled = true;
            run_panel.setExecutionWorkspace(null);
            if (workspaceRef.current) {
                try {
                    const Blockly = window.Blockly;
                    const xml = Blockly?.Xml?.domToText(Blockly.Xml.workspaceToDom(workspaceRef.current));
                    if (xml) window.localStorage.setItem(STORAGE_KEY, xml);
                } catch {
                    // Keep the last successfully persisted workspace.
                }
                workspaceRef.current.dispose();
                workspaceRef.current = null;
            }
        };
    }, [quick_strategy]);

    useEffect(() => {
        if (!isBotRunning) return undefined;

        completedContracts.current.clear();
        const handleSettledContract = (contract: any) => {
            const result = String(contract?.status || '').toLowerCase();
            if (!contract?.is_sold || (result !== 'won' && result !== 'lost')) return;

            const contractId = Number(contract.contract_id);
            if (!Number.isFinite(contractId) || completedContracts.current.has(contractId)) return;

            try {
                const workspace = workspaceRef.current;
                const Blockly = window.Blockly;
                if (!workspace || !Blockly) {
                    throw new Error('The G-K Pioneer workspace is not available for prediction switching.');
                }

                const tradeOptionsBlock = getTradeOptionsBlock(workspace);
                if (!tradeOptionsBlock?.getInput('PREDICTION_AFTER_LOSS')) {
                    throw new Error('The recovery prediction input is not ready.');
                }

                const normalPrediction = Number(
                    tradeOptionsBlock.getInputTargetBlock('PREDICTION')?.getFieldValue('NUM')
                );
                const recoveryPrediction = Number(
                    tradeOptionsBlock.getFieldValue('PREDICTION_AFTER_LOSS')
                );
                const nextPrediction = result === 'lost' ? recoveryPrediction : normalPrediction;

                if (!Number.isInteger(nextPrediction) || nextPrediction < 0 || nextPrediction > 9) {
                    throw new Error('Prediction values must be whole digits from 0 to 9.');
                }

                const tradeEngine = run_panel.dbot?.interpreter?.bot?.tradeEngine;
                if (!tradeEngine?.trade_option || typeof tradeEngine.makeProposals !== 'function') {
                    throw new Error('The active G-K Pioneer trade engine is not ready to refresh its next proposal.');
                }

                tradeEngine.makeProposals({
                    ...tradeEngine.trade_option,
                    prediction: nextPrediction,
                });
                completedContracts.current.add(contractId);
                setError('');
                setStatus(
                    result === 'lost'
                        ? `Confirmed LOSS — next trade prediction switched to ${nextPrediction}.`
                        : `Confirmed WIN — normal prediction restored to ${nextPrediction}.`
                );
            } catch (switchError) {
                setError(
                    switchError instanceof Error
                        ? switchError.message
                        : 'Unable to switch the next G-K Pioneer prediction.'
                );
            }
        };

        botObserver.register('bot.contract', handleSettledContract);
        return () => {
            if (botObserver.isRegistered('bot.contract')) {
                botObserver.unregister('bot.contract', handleSettledContract);
            }
        };
    }, [isBotRunning, run_panel]);

    const saveNow = () => {
        try {
            const Blockly = window.Blockly;
            const workspace = workspaceRef.current;
            if (!Blockly || !workspace) return;
            ensureRecoveryPredictionInput(workspace, Blockly);
            persistRecoveryPrediction(workspace);
            const xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
            window.localStorage.setItem(STORAGE_KEY, xml);
            setStatus('G-K Pioneer workspace saved on this device.');
            setError('');
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Unable to save the workspace.');
        }
    };

    return (
        <section className='gk-pioneer'>
            <header className='gk-pioneer__header'>
                <div>
                    <span className='gk-pioneer__eyebrow'>GTRADERS SUPER · INDEPENDENT BOT</span>
                    <h2>G-K Pioneer</h2>
                    <p>A separate Blockly workspace. Your original Deriv Bot Builder remains untouched.</p>
                </div>
                <div className='gk-pioneer__header-actions'>
                    <button type='button' className='gk-pioneer__button gk-pioneer__button--quiet' onClick={onBack}>Back to Free Bots</button>
                    <button type='button' className='gk-pioneer__button gk-pioneer__button--quiet' onClick={saveNow}>Save Workspace</button>
                </div>
            </header>
            <div className='gk-pioneer__status' role='status'>
                <span className='gk-pioneer__status-dot' />
                <span>{status}</span>
            </div>
            {error && <div className='gk-pioneer__error' role='alert'>{error}</div>}
            <div className='gk-pioneer__workspace-shell'>
                <div className='gk-pioneer__workspace-toolbar'>
                    <strong>G-K Pioneer Blockly Workspace</strong>
                    <span>Independent · Local autosave</span>
                </div>
                <div className='gk-pioneer__workspace' ref={containerRef} />
            </div>
            <p className='gk-pioneer__note'>
                This editor has its own blocks and saved workspace. The common Run/Stop control uses this workspace while G-K Pioneer is open; the original Bot Builder workspace remains separate.
            </p>
        </section>
    );
});

export default GKPioneerWorkspace;
