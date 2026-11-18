export const addDynamicBlockToDOM = (
    name_block: string,
    strategy_value: string,
    trade_type_cat: string,
    strategy_dom: HTMLElement,
    default_value = 0
) => {
    if (trade_type_cat === 'digits' || trade_type_cat === 'highlowticks') {
        const block = document.createElement('value');
        block.setAttribute('name', name_block);
        block.setAttribute('strategy_value', strategy_value);

        const shadow_block = document.createElement('shadow');
        shadow_block.setAttribute('type', 'math_number_positive');
        shadow_block.setAttribute('id', name_block === 'RECOVERY_PREDICTION' ? 'gkRecoveryPrediction' : 'p0O]7-M{ZORlORxGuIEb');

        const field_block = document.createElement('field');
        field_block.setAttribute('name', 'NUM');
        field_block.textContent = String(default_value);

        shadow_block.appendChild(field_block);
        block.appendChild(shadow_block);

        const parent_input = name_block === 'RECOVERY_PREDICTION'
            ? strategy_dom.querySelector('value[name="PREDICTION"]')
            : strategy_dom.querySelector('value[name="AMOUNT"]');
        if (parent_input?.parentNode) {
            parent_input.parentNode.insertBefore(block, parent_input.nextSibling);
        }
    }
    if (name_block === 'PREDICTION' && strategy_dom) {
        const mutation_element = strategy_dom.querySelector('block[type="trade_definition_tradeoptions"] > mutation');
        if (mutation_element) {
            mutation_element.setAttribute('has_prediction', 'true');
        }
    }
    if (name_block === 'RECOVERY_PREDICTION' && strategy_dom) {
        const mutation_element = strategy_dom.querySelector('block[type="trade_definition_tradeoptions"] > mutation');
        if (mutation_element) {
            mutation_element.setAttribute('has_recovery_prediction', 'true');
        }
    }
};
