import { save_types } from '../constants';
import { config } from '../constants/config';
import { api_base } from '../services/api/api-base';
import ApiHelpers from '../services/api/api-helpers';
import Interpreter from '../services/tradeEngine/utils/interpreter';
import { compareXml, observer as globalObserver } from '../utils';
import { getSavedWorkspaces, saveWorkspaceToRecent } from '../utils/local-storage';
import { isDbotRTL } from '../utils/workspace';
import { tradingSessionLock } from '../services/trading-session-lock';
import main_xml from './xml/main.xml';
import { forgetAccumulatorsProposalRequest } from './accumulators-proposal-handler';
import { loadBlockly } from './blockly';
import DBotStore from './dbot-store';
import { isAllRequiredBlocksEnabled, updateDisabledBlocks, validateErrorOnBlockDelete } from './utils';

class DBot {
    constructor() {
        this.interpreter = null;
        this.workspace = null;
        this.before_run_funcs = [];
        this.symbol = null;
        this.is_bot_running = false;
        this.active_session_owner = null;
    }

    /**
     * Initialises the workspace and mounts it to a container element (app_contents).
     */
    async initWorkspace(public_path, store, api_helpers_store, is_mobile, is_dark_mode) {
        const reportProgress = (progress, message) => {
            if (typeof store?.setStartupProgress === 'function') {
                store.setStartupProgress(progress, message);
            }
        };

        reportProgress(79, 'Loading Blockly modules...');

        await loadBlockly(is_dark_mode);

        reportProgress(80, 'Blockly modules loaded successfully...');

        const recent_files = await getSavedWorkspaces();

        reportProgress(82, 'Checking saved trading strategies...');

        this.interpreter = Interpreter();

        reportProgress(84, 'Preparing trading interpreter...');

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        var that = this;

        window.Blockly.Blocks.trade_definition_tradetype.onchange = function (event) {
            if (
                !this.workspace ||
                window.Blockly.derivWorkspace.isFlyoutVisible ||
                this.workspace.isDragging()
            ) {
                return;
            }

            this.enforceLimitations();

            const { name, type } = event;

            if (type === window.Blockly.Events.BLOCK_CHANGE) {
                const is_symbol_list_change = name === 'SYMBOL_LIST';
                const is_trade_type_cat_list_change = name === 'TRADETYPECAT_LIST';

                if (is_symbol_list_change || is_trade_type_cat_list_change) {
                    const { contracts_for } = ApiHelpers?.instance ?? {};
                    const top_parent_block = this.getTopParent();
                    const market_block = top_parent_block.getChildByType('trade_definition_market');
                    const market = market_block.getFieldValue('MARKET_LIST');
                    const submarket = market_block.getFieldValue('SUBMARKET_LIST');
                    const symbol = market_block.getFieldValue('SYMBOL_LIST');
                    const category = this.getFieldValue('TRADETYPECAT_LIST');
                    const trade_type = this.getFieldValue('TRADETYPE_LIST');
                    const is_trade_type_accumulator = trade_type === 'accumulator';

                    if (!is_trade_type_accumulator) {
                        forgetAccumulatorsProposalRequest(that);
                    }

                    if (is_symbol_list_change) {
                        contracts_for
                            ?.getTradeTypeCategories?.(market, submarket, symbol)
                            .then(categories => {
                                const category_field = this.getField('TRADETYPECAT_LIST');

                                if (category_field) {
                                    category_field.updateOptions(categories, {
                                        default_value: category,
                                        should_pretend_empty: true,
                                        event_group: event.group,
                                    });
                                }
                            })
                            .catch(error => {
                                console.error('Error fetching trade type categories:', error);
                            });

                        that.symbol = symbol;

                        if (
                            !that.is_bot_running &&
                            that.interpreter &&
                            !this.workspace.options.readOnly &&
                            symbol !== that.interpreter.bot.tradeEngine.symbol
                        ) {
                            const run_button = document.querySelector('#db-animation__run-button');

                            if (run_button) run_button.disabled = true;

                            that.interpreter.unsubscribeFromTicksService().then(async () => {
                                await that.interpreter?.bot.tradeEngine.watchTicks(symbol);
                            });
                        }
                    } else if (is_trade_type_cat_list_change && event.blockId === this.id) {
                        contracts_for
                            ?.getTradeTypes?.(market, submarket, symbol, category)
                            .then(trade_types => {
                                const trade_type_field = this.getField('TRADETYPE_LIST');

                                if (trade_type_field) {
                                    trade_type_field.updateOptions(trade_types, {
                                        default_value: trade_type,
                                        should_pretend_empty: true,
                                        event_group: event.group,
                                    });
                                }
                            })
                            .catch(error => {
                                console.error('Error fetching trade types:', error);
                            });
                    }
                }
            }
        };

        return new Promise((resolve, reject) => {
            try {
                __webpack_public_path__ = public_path; // eslint-disable-line no-global-assign

                ApiHelpers.setInstance(api_helpers_store);
                DBotStore.setInstance(store);

                const el_scratch_div = document.getElementById('scratch_div');

                if (!el_scratch_div) {
                    throw new Error(
                        'Blockly startup failed: #scratch_div container was not found.'
                    );
                }

                const window_width = window.innerWidth;
                let workspaceScale = 0.7;

                const { handleFileChange } = DBotStore.instance;

                if (window_width < 1640) {
                    if (is_mobile) {
                        workspaceScale = 0.6;
                    } else {
                        const scratch_div_width = el_scratch_div.offsetWidth;
                        const zoom_scale = scratch_div_width / window_width / 1.5;
                        workspaceScale = zoom_scale;
                    }
                }

                reportProgress(85, 'Creating Blockly workspace...');

                this.workspace = window.Blockly.inject(el_scratch_div, {
                    media: 'assets/media/',
                    renderer: 'zelos',
                    trashcan: !is_mobile,
                    zoom: {
                        wheel: true,
                        startScale: workspaceScale,
                    },
                    scrollbars: true,
                    theme: window.Blockly.Themes.zelos_renderer,
                });

                reportProgress(87, 'Blockly workspace created...');

                this.workspace.RTL = isDbotRTL();
                this.workspace.cached_xml = { main: main_xml };

                this.workspace.addChangeListener(
                    this.valueInputLimitationsListener.bind(this)
                );

                this.workspace.addChangeListener(event =>
                    updateDisabledBlocks(this.workspace, event)
                );

                this.workspace.addChangeListener(event =>
                    this.workspace.dispatchBlockEventEffects(event)
                );

                this.workspace.addChangeListener(event => {
                    if (event.type === 'drag' && !event.isStart && !is_mobile) {
                        validateErrorOnBlockDelete();
                    }

                    if (event.type == window.Blockly.Events.BLOCK_CHANGE) {
                        const block = this.workspace.getBlockById(event.blockId);

                        if (is_mobile && block && event.element == 'collapsed') {
                            block.contextMenu = false;
                        }
                    }
                });

                window.Blockly.derivWorkspace = this.workspace;

                const varDB = new window.Blockly.Names('window');
                varDB.variableMap = window.Blockly.derivWorkspace.getVariableMap();

                window.Blockly.JavaScript.variableDB_ = varDB;

                this.addBeforeRunFunction(this.unselectBlocks.bind(this));
                this.addBeforeRunFunction(this.disableStrayBlocks.bind(this));
                this.addBeforeRunFunction(this.checkForErroredBlocks.bind(this));
                this.addBeforeRunFunction(this.checkForRequiredBlocks.bind(this));

                this.workspace.current_strategy_id =
                    window.Blockly.utils.idGenerator.genUid();

                window.Blockly.derivWorkspace.strategy_to_load = main_xml;
                window.Blockly.getMainWorkspace().strategy_to_load = main_xml;
                window.Blockly.getMainWorkspace().RTL = isDbotRTL();

                let file_name = config().default_file_name;

                if (recent_files && recent_files.length) {
                    const latest_file = recent_files[0];

                    window.Blockly.derivWorkspace.strategy_to_load = latest_file.xml;
                    window.Blockly.getMainWorkspace().strategy_to_load = latest_file.xml;

                    file_name = latest_file.name;

                    window.Blockly.derivWorkspace.current_strategy_id = latest_file.id;
                    window.Blockly.getMainWorkspace().current_strategy_id = latest_file.id;
                }

                reportProgress(88, 'Restoring saved trading strategy...');

                const event_group = `dbot-load${Date.now()}`;

                window.Blockly.Events.setGroup(event_group);

                window.Blockly.Xml.domToWorkspace(
                    window.Blockly.utils.xml.textToDom(
                        window.Blockly.derivWorkspace.strategy_to_load
                    ),
                    this.workspace
                );

                reportProgress(89, 'Saved strategy loaded successfully...');

                const { save_modal } = DBotStore.instance;

                save_modal.updateBotName(file_name);

                this.workspace.cleanUp(0, is_mobile ? 60 : 56);
                this.workspace.clearUndo();

                window.dispatchEvent(new Event('resize'));

                window.addEventListener('dragover', DBot.handleDragOver);

                window.addEventListener('drop', e =>
                    DBot.handleDropOver(e, handleFileChange)
                );

                if (el_scratch_div.parentNode) {
                    el_scratch_div.parentNode.style.overflow = 'hidden';
                }

                reportProgress(90, 'Blockly workspace initialization complete...');

                resolve();
            } catch (error) {
                console.error('DBot.initWorkspace error:', error);
                reject(error);
            }
        });
    }

    /** Compare stored strategy xml with currently running xml */
    isStrategyUpdated(current_xml_dom, recent_files) {
        if (recent_files && recent_files.length) {
            const stored_strategy = recent_files.filter(
                strategy => strategy?.id === this.workspace?.current_strategy_id
            )?.[0];
            if (stored_strategy?.xml) {
                const stored_strategy_xml = stored_strategy?.xml;
                const current_xml = window.Blockly.Xml.domToText(current_xml_dom);
                const is_same_strategy = compareXml(stored_strategy_xml, current_xml);
                if (is_same_strategy) {
                    return false;
                }
            }
        }
        return true;
    }

    /** Saves the current workspace to local storage
     * and update saved status if strategy changes  */
    async saveRecentWorkspace() {
        const current_xml_dom = this?.workspace ? Blockly?.Xml?.workspaceToDom(this.workspace) : null;
        try {
            const recent_files = await getSavedWorkspaces();
            if (current_xml_dom && this.isStrategyUpdated(current_xml_dom, recent_files)) {
                await saveWorkspaceToRecent(current_xml_dom, save_types.UNSAVED);
            }
        } catch (error) {
            globalObserver.emit('Error', error);
            await saveWorkspaceToRecent(current_xml_dom, save_types.UNSAVED);
        }
    }

    /**
     * Allows you to add a function that needs to be executed before running the bot. Each
     * function needs to return true in order for the bot to run.
     * @param {Function} func Function to execute which returns true/false.
     */
    addBeforeRunFunction(func) {
        this.before_run_funcs.push(func);
    }

    shouldRunBot() {
        return this.before_run_funcs.every(func => !!func());
    }

    async initializeInterpreter() {
        if (this.interpreter) {
            await this.interpreter.terminateSession();
        }
        this.interpreter = Interpreter();
    }
    /**
     * Runs the bot. Does a sanity check before attempting to generate the
     * JavaScript code that's fed to the interpreter.
     */
    getSessionOwner(workspace = this.workspace) {
        return workspace === this.workspace ? 'Bot Builder' : 'G-K Pioneer';
    }

    acquireExecutionSession(workspace = this.workspace) {
        const owner = this.getSessionOwner(workspace);
        if (!tradingSessionLock.acquire(owner)) {
            globalObserver.emit('Error', new Error(`Trading session is already owned by ${tradingSessionLock.owner}.`));
            return false;
        }
        this.active_session_owner = owner;
        return true;
    }

    runBot(workspace = this.workspace) {
        if (api_base.is_stopping) return false;

        const owner = this.getSessionOwner(workspace);
        if (this.active_session_owner !== owner && !this.acquireExecutionSession(workspace)) {
            return false;
        }

        const originalWorkspace = this.workspace;
        try {
            api_base.is_stopping = false;
            // Blockly code generation and validation read this.workspace.
            // Temporarily point it at the selected editor, then restore the
            // original Bot Builder workspace before asynchronous execution.
            this.workspace = workspace;
            const code = this.generateCode();
            this.workspace = originalWorkspace;

            if (!this.interpreter.bot.tradeEngine.checkTicksPromiseExists()) this.interpreter = Interpreter();

            this.is_bot_running = true;
            api_base.setIsRunning(true);
            this.interpreter.run(code).catch(error => {
                globalObserver.emit('Error', error);
                this.stopBot();
            });
            return true;
        } catch (error) {
            this.workspace = originalWorkspace;
            tradingSessionLock.release(owner);
            this.active_session_owner = null;
            globalObserver.emit('Error', error);

            if (this.interpreter) {
                this.stopBot();
            }
            return false;
        } finally {
            this.workspace = originalWorkspace;
        }
    }

    /**
     * Generates the code that is passed to the interpreter.
     * @param {Object} limitations Optional limitations (legacy argument)
     */
    generateCode(limitations = {}) {
        return `
            var BinaryBotPrivateInit;
            var BinaryBotPrivateStart;
            var BinaryBotPrivateBeforePurchase; 
            var BinaryBotPrivateDuringPurchase;
            var BinaryBotPrivateAfterPurchase;
            var BinaryBotPrivateLastTickTime;
            var BinaryBotPrivateTickAnalysisList = [];
            var BinaryBotPrivateHasCalledTradeOptions = false;

           
            function recursiveList(list, final_list){
                for(var i=0; i < list.length; i++){
                    if(typeof(list[i]) === 'object'){
                        recursiveList(list[i], final_list);
                    }
                    if(typeof(list[i]) == 'number'){
                        final_list.push(list[i]);   
                                  
                    }
                }
                return final_list;
            }

            function BinaryBotPrivateRun(f, arg) {
                if (f) return f(arg);
                return false;
            }
            function BinaryBotPrivateTickAnalysis() {
                var currentTickTime = Bot.getLastTick(true);
                while (currentTickTime === 'MarketIsClosed') {
                    sleep(5);
                    currentTickTime = Bot.getLastTick(true);
                }
                currentTickTime = currentTickTime.epoch;
                if (currentTickTime === BinaryBotPrivateLastTickTime) {
                    return;
                }
                BinaryBotPrivateLastTickTime = currentTickTime;
                for (var BinaryBotPrivateI = 0; BinaryBotPrivateI < BinaryBotPrivateTickAnalysisList.length; BinaryBotPrivateI++) {
                    BinaryBotPrivateRun(BinaryBotPrivateTickAnalysisList[BinaryBotPrivateI]);
                }
            }
            var BinaryBotPrivateLimitations = ${JSON.stringify(limitations)};
            ${window.Blockly.JavaScript.javascriptGenerator.workspaceToCode(this.workspace)}
            BinaryBotPrivateRun(BinaryBotPrivateInit);
            while (true) {
                BinaryBotPrivateTickAnalysis();
                BinaryBotPrivateRun(BinaryBotPrivateStart);
                if (Bot.getXvtStopRequested && Bot.getXvtStopRequested()) {
                    break;
                }
                if (!BinaryBotPrivateHasCalledTradeOptions) {
                    sleep(1);
                    continue;
                }
                while (watch('before')) {
                    BinaryBotPrivateTickAnalysis();
                    BinaryBotPrivateRun(BinaryBotPrivateBeforePurchase);
                }
                while (watch('during')) {
                    BinaryBotPrivateTickAnalysis();
                    BinaryBotPrivateRun(BinaryBotPrivateDuringPurchase);
                }
                BinaryBotPrivateTickAnalysis();
                if (!BinaryBotPrivateRun(BinaryBotPrivateAfterPurchase)) {
                    break;
                }
            }
            
            `;
    }

    /**
     * Instructs the interpreter to stop the bot. If there is an active trade
     * that trade will be completed first to reflect correct contract status in UI.
     */
    async stopBot() {
        if (api_base.is_stopping) return;

        api_base.setIsRunning(false);

        const sessionOwner = this.active_session_owner;
        try {
            await this.interpreter.stop();
            this.is_bot_running = false;
            this.interpreter = null;
            this.interpreter = Interpreter();
            await this.interpreter.bot.tradeEngine.watchTicks(this.symbol);
            forgetAccumulatorsProposalRequest(this);
        } finally {
            if (sessionOwner) tradingSessionLock.release(sessionOwner);
            this.active_session_owner = null;
        }
    }

    /**
     * Immediately instructs the interpreter to terminate the WS connection and bot.
     */
    async terminateBot() {
        if (this.interpreter) {
            await this.interpreter.terminateSession();
            this.interpreter = null;
            this.interpreter = Interpreter();
            await this.interpreter.bot.tradeEngine.watchTicks(this.symbol);
            if (this.active_session_owner) tradingSessionLock.release(this.active_session_owner);
            this.active_session_owner = null;
        }
    }

    terminateConnection = () => {
        api_base.terminate();
    };

    /**
     * Unselects any selected block before running the bot.
     */
    // eslint-disable-next-line class-methods-use-this
    unselectBlocks() {
        if (window.Blockly.getSelected()) {
            window.Blockly.getSelected().unselect();
        }
        return true;
    }

    /**
     * Disable blocks outside of any main or independent blocks.
     */
    disableStrayBlocks() {
        const top_blocks = this.workspace.getTopBlocks();
        top_blocks.forEach(block => {
            if (!block.isMainBlock() && !block.isIndependentBlock()) {
                this.disableBlocksRecursively(block);
            }
        });
        return true;
    }

    /**
     * Disable blocks and their optional children.
     */
    disableBlocksRecursively(block) {
        block.setDisabled(true);
        if (block.nextConnection?.targetConnection) {
            this.disableBlocksRecursively(block.nextConnection.targetConnection.sourceBlock_);
        }
    }

    /**
     * Check if there are any blocks highlighted for errors.
     */
    checkForErroredBlocks() {
        // Force a check on value inputs.
        this.valueInputLimitationsListener({}, true);

        const all_blocks = this.workspace.getAllBlocks(true);
        const error_blocks = all_blocks
            .filter(block => block.is_error_highlighted && !block.disabled)
            // filter out duplicated error message
            .filter((block, index, self) => index === self.findIndex(b => b.error_message === block.error_message));

        if (!error_blocks.length) {
            return true;
        }

        this.workspace.centerOnBlock(error_blocks[0].id);
        error_blocks.forEach(block => {
            globalObserver.emit('ui.log.error', block.error_message);
        });

        return false;
    }

    centerAndHighlightBlock(block_id, should_animate = false) {
        const block_to_highlight = this.workspace.getBlockById(block_id);

        if (!block_to_highlight) {
            return;
        }

        const all_blocks = this.workspace.getAllBlocks();

        all_blocks.forEach(block => block.setErrorHighlighted(false));
        if (should_animate) {
            block_to_highlight.blink();
        }
        block_to_highlight.setErrorHighlighted(true);

        this.workspace.centerOnBlock(block_to_highlight.id);
    }

    unHighlightAllBlocks() {
        this.workspace?.getAllBlocks().forEach(block => block.setErrorHighlighted(false));
    }

    /**
     * Checks whether the workspace contains all required blocks before running the strategy.
     */
    checkForRequiredBlocks() {
        return isAllRequiredBlocksEnabled(this.workspace);
    }

    /**
     * Checks all blocks in the workspace to see if they need to be highlighted
     * in case one of their inputs is not populated, returns an empty value, or doesn't
     * pass the custom validator.
     * Note: The value passed to the custom validator is always a string value
     * @param {window.Blockly.Event} event Workspace event
     */
    valueInputLimitationsListener(event, force_check = false) {
        if (!force_check && (!this.workspace || this.workspace.isDragging())) {
            return;
        }

        window.Blockly.JavaScript.javascriptGenerator.init(this.workspace);

        if (force_check) {
            window.Blockly.hideChaff(false);
        }

        const isGlobalEndDragEvent = () => event.type === window.Blockly.Events.BLOCK_DRAG && !event.isStart;
        const isGlobalDeleteEvent = () => event.type === window.Blockly.Events.BLOCK_DELETE;
        const isGlobalCreateEvent = () => event.type === window.Blockly.Events.BLOCK_CREATE;
        const isClickEvent = () =>
            event.type === window.Blockly.Events.UI && (event.element === 'click' || event.element === 'selected');
        const isChangeEvent = b => event.type === window.Blockly.Events.BLOCK_CHANGE && event.blockId === b.id;
        const isChangeInMyInputs = b => {
            if (event.type === window.Blockly.Events.BLOCK_CHANGE) {
                return b.inputList.some(input => {
                    if (input.connection) {
                        const target_block = input.connection.targetBlock();
                        return target_block && event.blockId === target_block.id;
                    }
                    return false;
                });
            }
            return false;
        };
        const isParentEnabledEvent = b => {
            if (event.type === window.Blockly.Events.BLOCK_CHANGE && event.element === 'disabled') {
                let parent_block = b.getParent();

                while (parent_block !== null) {
                    if (parent_block.id === event.blockId) {
                        return true;
                    }

                    parent_block = parent_block.getParent();
                }
            }
            return false;
        };

        this.workspace.getAllBlocks(true).forEach(block => {
            if (
                force_check ||
                isGlobalEndDragEvent() ||
                isGlobalDeleteEvent() ||
                isGlobalCreateEvent() ||
                isClickEvent() ||
                isChangeEvent(block) ||
                isChangeInMyInputs(block) ||
                isParentEnabledEvent(block)
            ) {
                // Unhighlight disabled blocks and their optional children.
                if (block.disabled) {
                    const unhighlightRecursively = child_blocks => {
                        child_blocks.forEach(child_block => {
                            child_block.setErrorHighlighted(false);
                            unhighlightRecursively(child_block.getChildren());
                        });
                    };

                    unhighlightRecursively([block]);
                    return;
                }

                // No required inputs, ignore this block.
                if (!block.getRequiredValueInputs) {
                    return;
                }

                const required_inputs_object = block.getRequiredValueInputs();
                const required_input_names = Object.keys(required_inputs_object);
                const should_highlight = required_input_names.some(input_name => {
                    const is_selected = window.Blockly.getSelected() === block; // Don't highlight selected blocks.
                    const is_disabled = block.disabled || block.getInheritedDisabled(); // Don't highlight disabled blocks.

                    if (is_selected || is_disabled) {
                        return false;
                    }

                    // Don't unhighlight collapsed blocks with highlighted descendants.
                    if (block.isCollapsed() && block.hasErrorHighlightedDescendant()) {
                        return true;
                    }

                    const input = block.getInput(input_name);

                    if (!input && !block.domToMutation) {
                        // Detected a non-existent required input
                    } else if (input && input?.connection) {
                        const order = window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC;
                        const value = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
                            block,
                            input_name,
                            order
                        );
                        const inputValidatorFn = required_inputs_object[input_name];

                        // If a custom validator was supplied, use this to determine whether
                        // the block should be highlighted.
                        if (typeof inputValidatorFn === 'function') {
                            return !!inputValidatorFn(value);
                        }

                        // If there's no custom validator, only check if input was populated and
                        // doesn't return an empty value.
                        return !value;
                    }

                    return true;
                });

                if (should_highlight) {
                    // Remove select highlight in favour of error highlight.
                    block.removeSelect();
                }

                block.setErrorHighlighted(should_highlight, block.error_message || undefined);

                // Automatically expand blocks that have been highlighted.
                if (force_check && (block.is_error_highlighted || block.hasErrorHighlightedDescendant())) {
                    let current_collapsed_block = block;
                    while (current_collapsed_block) {
                        current_collapsed_block.setCollapsed(false);
                        current_collapsed_block = current_collapsed_block.getParent();
                    }
                }
            }
        });
    }

    /**
     * Checks whether the workspace contains non-silent notification blocks. Returns array of names for audio files to be played.
     */
    getStrategySounds() {
        const all_blocks = this.workspace.getAllBlocks();
        const notify_blocks = all_blocks.filter(block => block.type === 'notify');
        const strategy_sounds = [];

        notify_blocks.forEach(block => {
            const selected_sound = block.inputList[0].fieldRow[3].value_;

            if (selected_sound !== 'silent') {
                strategy_sounds.push(selected_sound);
            }
        });

        return strategy_sounds;
    }

    static handleDragOver(event) {
        event.stopPropagation();
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy'; // eslint-disable-line no-param-reassign
    }

    static handleDropOver(event, handleFileChange) {
        const main_workspace_dom = document.getElementById('scratch_div');
        const local_drag_zone = document.getElementById('load-strategy__local-dropzone-area');

        if (main_workspace_dom.contains(event.target)) {
            handleFileChange(event);
        } else if (local_drag_zone && local_drag_zone.contains(event.target)) {
            handleFileChange(event, false);
        } else {
            event.stopPropagation();
            event.preventDefault();
            event.dataTransfer.effectAllowed = 'none';
            event.dataTransfer.dropEffect = 'none';
        }
    }
}

export default new DBot();
