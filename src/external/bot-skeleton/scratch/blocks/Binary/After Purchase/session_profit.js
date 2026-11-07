import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.xvt_session_profit = {
    init() {
        this.jsonInit({
            message0: localize('XVT session profit'),
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Returns the native trading engine session profit in the account currency.'),
            category: window.Blockly.Categories.After_Purchase,
        });
    },
    meta() {
        return {
            display_name: localize('XVT session profit'),
            description: localize('Reads session profit from the native Deriv Blockly trade engine.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.xvt_session_profit = () => [
    'Bot.getSessionProfit()',
    window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC,
];
