
import { action, makeObservable, observable, reaction } from 'mobx';
import { ApiHelpers, config as qs_config, load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { addDynamicBlockToDOM } from '@/utils/xml-dom-quick-strategy';
import { STRATEGIES } from '../pages/bot-builder/quick-strategy/config';
import { TFormData } from '../pages/bot-builder/quick-strategy/types';
import { getSetting, storeSetting } from '../utils/settings';
import RootStore from './root-store';

export type TActiveSymbol = {
    group: string;
    text: string;
    value: string;
};

export type TLossThresholdWarningData = {
    show: boolean;
    loss_amount?: string | number;
    currency?: string;
    highlight_field?: Array<string>;
    already_shown?: boolean;
};

interface IQuickStrategyStore {
    additional_data: Record<string, unknown>;
    current_duration_min_max: {
        min: number;
        max: number;
    };
    root_store: RootStore;
    is_open: boolean;
    is_gk_pioneer_mode: boolean;
    selected_strategy: string;
    selected_strategy_for_notofy: string;
    form_data: TFormData;
    loss_threshold_warning_data: {
        show: boolean;
    };
    is_contract_dialog_open: boolean;
    is_stop_bot_dialog_open: boolean;
    is_options_loading: boolean;
    setLossThresholdWarningData: (data: TLossThresholdWarningData) => void;
    setFormVisibility: (is_open: boolean) => void;
    setGKPioneerMode: (enabled: boolean) => void;
    setSelectedStrategy: (strategy: string) => void;
    setValue: (name: string, value: string) => void;
    onSubmit: (data: TFormData, targetWorkspace?: any, strategyOverride?: string) => Promise<void>;
    toggleStopBotDialog: () => void;
    setCurrentDurationMinMax: (min: number, max: number) => void;
    setOptionsLoading: (is_loading: boolean) => void;
}

export default class QuickStrategyStore implements IQuickStrategyStore {
    root_store: RootStore;
    is_open = false;
    is_gk_pioneer_mode = false;
    selected_strategy = 'MARTINGALE';
    selected_strategy_for_notofy = '';

    form_data: TFormData = {
        symbol: qs_config().QUICK_STRATEGY.DEFAULT.symbol,
        tradetype: qs_config().QUICK_STRATEGY.DEFAULT.tradetype,
        durationtype: qs_config().QUICK_STRATEGY.DEFAULT.durationtype,
        action: 'RUN',
    };

    is_contract_dialog_open = false;
    is_stop_bot_dialog_open = false;
    is_options_loading = false;

    current_duration_min_max = {
        min: 0,
        max: 10,
    };

    loss_threshold_warning_data: TLossThresholdWarningData = {
        show: false,
    };

    additional_data = {};

    constructor(root_store: RootStore) {
        makeObservable(this, {
            additional_data: observable,
            current_duration_min_max: observable,
            form_data: observable,
            is_contract_dialog_open: observable,
            is_open: observable,
            is_gk_pioneer_mode: observable,
            is_stop_bot_dialog_open: observable,
            is_options_loading: observable,
            initializeLossThresholdWarningData: action,
            selected_strategy: observable,
            selected_strategy_for_notofy: observable,
            loss_threshold_warning_data: observable,
            onSubmit: action,
            setAdditionalData: action,
            setCurrentDurationMinMax: action,
            setFormVisibility: action,
            setGKPioneerMode: action,
            setSelectedStrategy: action,
            setLossThresholdWarningData: action,
            setValue: action,
            toggleStopBotDialog: action,
            setOptionsLoading: action,
        });

        this.root_store = root_store;

        const savedStrategy = getSetting('selected_strategy_for_notofy');

        if (savedStrategy) {
            this.selected_strategy_for_notofy = savedStrategy;
        }

        reaction(
            () => this.is_open,
            () => {
                if (!this.is_open) {
                    this.selected_strategy = 'MARTINGALE';
                }
            }
        );
    }

    setAdditionalData = (data: Record<string, unknown>) => {
        this.additional_data = {
            ...this.additional_data,
            ...data,
        };
    };

    setLossThresholdWarningData = (data: TLossThresholdWarningData) => {
        this.loss_threshold_warning_data = {
            ...this.loss_threshold_warning_data,
            ...data,
        };
    };

    initializeLossThresholdWarningData = () => {
        this.loss_threshold_warning_data = {
            show: false,
            highlight_field: [],
            already_shown: false,
        };
    };

    setFormVisibility = (is_open: boolean) => {
        this.is_open = is_open;
        if (!is_open) this.is_gk_pioneer_mode = false;
    };

    setGKPioneerMode = (enabled: boolean) => {
        this.is_gk_pioneer_mode = enabled;
    };

    setSelectedStrategy = (strategy: string) => {
        this.selected_strategy = strategy;
    };

    setValue = (name: string, value: string | number | boolean) => {
        this.form_data[name as keyof TFormData] = value;
    };

    setCurrentDurationMinMax = (min = 0, max = 10) => {
        this.current_duration_min_max = {
            min,
            max,
        };
    };

    onSubmit = async (data: TFormData, targetWorkspace?: any, strategyOverride?: string) => {
        // Capture the GK Pioneer context before setFormVisibility(false) resets the mode.
        const isGKPioneerMode = this.is_gk_pioneer_mode;
        const { contracts_for } = ApiHelpers?.instance ?? {};

        if (!contracts_for) {
            console.error(
                'GTraders Super: Contract information is not ready.'
            );
            return;
        }

        const workspace = targetWorkspace ?? window.Blockly?.derivWorkspace;

        if (!workspace) {
            console.error(
                'GTraders Super: Blockly workspace is not ready.'
            );
            return;
        }

        try {
            const market = await contracts_for.getMarketBySymbol(data.symbol);
            const submarket = await contracts_for.getSubmarketBySymbol(data.symbol);
            const trade_type_cat =
                await contracts_for.getTradeTypeCategoryByTradeType(data.tradetype);

            const selected_strategy_key = strategyOverride || this.selected_strategy;
            const selected_strategy = STRATEGIES()[selected_strategy_key];

            if (!selected_strategy) {
                throw new Error('Selected strategy configuration was not found.');
            }

            if (workspace === window.Blockly?.derivWorkspace) {
                this.selected_strategy_for_notofy = selected_strategy_key;
                storeSetting('selected_strategy_for_notofy', selected_strategy_key);
            }

            const strategy_xml = await import(
                /* webpackChunkName: `[request]` */
                `../xml/${selected_strategy.name}.xml`
            );

            const strategy_dom = window.Blockly.utils.xml.textToDom(
                strategy_xml.default
            );

            addDynamicBlockToDOM(
                'PREDICTION',
                'last_digit_prediction',
                trade_type_cat,
                strategy_dom
            );

            const modifyValueInputs = (
                key: string,
                value: number
            ) => {
                const inputs = strategy_dom.querySelectorAll(
                    `value[strategy_value="${key}"]`
                );

                inputs.forEach((input: HTMLElement) => {
                    if (key.includes('boolean')) {
                        input.innerHTML = value
                            ? '<block type="logic_boolean"><field name="BOOL">TRUE</field></block>'
                            : '<block type="logic_boolean"><field name="BOOL">FALSE</field></block>';
                    } else {
                        input.innerHTML =
                            `<shadow type="math_number"><field name="NUM">${value}</field></shadow>`;
                    }
                });
            };

            const modifyFieldDropdownValues = (
                name: string,
                value: string
            ) => {
                const field_name = `${name.toUpperCase()}_LIST`;

                const fields = strategy_dom.querySelectorAll(
                    `field[name="${field_name}"]`
                );

                fields.forEach((field: HTMLElement) => {
                    field.innerHTML = value;
                });
            };

            const {
                unit,
                action,
                type,
                growth_rate,
                ...rest_data
            } = data;

            const fields_to_update = {
                market,
                submarket,
                tradetypecat: trade_type_cat,
                dalembert_unit: unit,
                oscar_unit: unit,
                type: 'both',
                ...rest_data,
                purchase: type,
                growthrate: growth_rate
                    ? growth_rate.toString()
                    : undefined,
            };

            Object.entries(fields_to_update).forEach(([key, value]) => {
                if (value === undefined || value === null) {
                    return;
                }

                if (!isNaN(value as number) && key !== 'growthrate') {
                    modifyValueInputs(key, Number(value));
                } else if (typeof value === 'string') {
                    modifyFieldDropdownValues(key, value);
                }
            });

            const blockCreated =
                action === 'RUN'
                    ? workspace.waitForBlockEvent({
                          block_type: 'trade_definition',
                          event_type: window.Blockly.Events.BLOCK_CREATE,
                          timeout: 10000,
                      })
                    : Promise.resolve();

            this.setFormVisibility(false);

            await load({
                block_string: window.Blockly.Xml.domToText(strategy_dom),
                file_name: selected_strategy.label,
                workspace,
                from: save_types.UNSAVED,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });

            // Keep the payout-rate calculation internal and off the visible
            // workspace. Initial Amount remains in the initialization chain as
            // a visible trader control and continues feeding the Martingale engine.
            if (isGKPioneerMode) {
                const isolateGKPioneerInternalBlocks = () => {
                    const internalVariableIds = [
                        'gk-payout-rate-var',
                    ];

                    workspace.getAllBlocks(false).forEach(block => {
                        if (block.type !== 'variables_set') return;

                        const variableField = block.getField('VAR');
                        const variableId = variableField?.getValue();

                        if (!internalVariableIds.includes(String(variableId))) return;

                        // Detach only this internal block from the visible
                        // initialization chain. Its following block becomes
                        // the start of the user-facing chain.
                        if (block.nextConnection?.isConnected()) {
                            block.nextConnection.disconnect();
                        }

                        // Keep the internal calculation active as a top-level
                        // Blockly block, but place it well outside the normal
                        // visible workspace area.
                        block.moveBy(-2000, -2000);

                        const blockWithVisibility = block as typeof block & {
                            setVisible?: (visible: boolean) => void;
                        };

                        // It is now safely disconnected, so hiding this block
                        // cannot hide any user-facing blocks.
                        blockWithVisibility.setVisible?.(false);
                    });
                };

                isolateGKPioneerInternalBlocks();

                requestAnimationFrame(() => {
                    isolateGKPioneerInternalBlocks();
                    requestAnimationFrame(isolateGKPioneerInternalBlocks);
                });
            }

            if (action === 'RUN') {
                await blockCreated;
                this.root_store.run_panel.onRunButtonClick();
            }
        } catch (error) {
            console.error(
                'GTraders Super Quick Strategy initialization failed:',
                error
            );

            this.setFormVisibility(false);
        }
    };

    toggleStopBotDialog = (): void => {
        this.is_contract_dialog_open = !this.is_contract_dialog_open;
        this.is_stop_bot_dialog_open = !this.is_stop_bot_dialog_open;
        this.setFormVisibility(false);
    };

    setOptionsLoading = (is_loading: boolean): void => {
        this.is_options_loading = is_loading;
    };
}
