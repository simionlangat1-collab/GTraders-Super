import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '@/hooks/useStore';
import './gk-pioneer-workspace.scss';

const STORAGE_KEY = 'gtraders-super:gk-pioneer-workspace:v1';

type TGKPioneerWorkspaceProps = {
    onBack: () => void;
};

const GKPioneerWorkspace = ({ onBack }: TGKPioneerWorkspaceProps) => {
    const { quick_strategy } = useStore();
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

                const sourceToolbox = originalWorkspace.options?.languageTree;
                if (!sourceToolbox) {
                    throw new Error('The original Deriv toolbox is not available yet.');
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
                    toolbox: sourceToolbox.cloneNode(true),
                    theme: Blockly.Themes.zelos_renderer,
                });

                workspace.RTL = originalWorkspace.RTL;
                workspaceRef.current = workspace;

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
                    persistWorkspace({ type: 'create' });
                    setStatus('Independent G-K Pioneer workspace is ready. Changes are saved on this device.');
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
                    <button type='button' className='gk-pioneer__button' onClick={saveNow}>Save Workspace</button>
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
                This editor has its own blocks and saved workspace. Trading execution will be connected through the shared Deriv engine after the isolated-workspace runner is wired and verified.
            </p>
        </section>
    );
};

export default GKPioneerWorkspace;
