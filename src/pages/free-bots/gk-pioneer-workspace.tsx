import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import './gk-pioneer-workspace.scss';

const STORAGE_KEY = 'gtraders-super:gk-pioneer-workspace:v1';

const HIDDEN_SETUP_VARIABLES = new Set([
    'martingale:initialStake',
    'martingale:payoutRate',
    'martingale:cycleLoss',
    'martingale:Multiplier',
    'Target Profit Enabled',
    'Target Profit',
    'Target Loss Enabled',
    'Target Loss',
    'setMaxStake?',
    'maxStake',
]);

const hideInternalSetupBlocks = (workspace: any) => {
    workspace
        .getAllBlocks(false)
        .filter((block: any) => !block.getParent() && block.type === 'variables_set')
        .forEach((block: any) => {
            const variableName = block.getFieldValue('VAR');
            if (HIDDEN_SETUP_VARIABLES.has(variableName)) {
                // Keep these runtime initialization blocks in the workspace/code,
                // but hide them from the visual editor so the trading surface stays clean.
                block.getSvgRoot?.()?.classList.add('gk-pioneer-hidden-block');
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

    const saveNow = () => {
        try {
            const Blockly = window.Blockly;
            const workspace = workspaceRef.current;
            if (!Blockly || !workspace) return;
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
