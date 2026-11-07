import { localize } from '@deriv-com/translations';

window.Blockly.Blocks.set_trade_amount = {
    init() {
        this.appendValueInput('AMOUNT')
            .setCheck('Number')
            .appendField(localize('Set next trade stake'));
        this.setPreviousStatement(true);
        this.setNextStatement(true);
        this.setColour(window.Blockly.Colours.Special1.colour);
        this.setTooltip(localize('Update the stake used by the next purchase in the current bot session.'));
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.set_trade_amount = block => {
    const amount =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'AMOUNT',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '0';

    return `Bot.setTradeAmount(${amount});\n`;
};
