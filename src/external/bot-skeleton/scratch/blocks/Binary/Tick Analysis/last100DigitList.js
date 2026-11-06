import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.last100DigitList = {
    init() {
        this.jsonInit({
            message0: localize('Last 100 digits'),
            output: 'Array',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize('Returns the last 100 digits from the active market tick history.'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
    },
    meta() {
        return {
            display_name: localize('Last 100 digits'),
            description: localize('Returns only the 100 most recent last digits for a focused analysis window.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.last100DigitList = () => [
    'Bot.getLastDigitList(100)',
    window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC,
];
