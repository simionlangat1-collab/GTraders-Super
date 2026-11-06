import { localize } from '@deriv-com/translations';

window.Blockly.Blocks.xvt_sniper_trade_options = {
    init() {
        this.jsonInit({
            message0: localize('XVT %1  Search %2  Stake %3'),
            message1: localize('Martingale %1  Target +%2  Target -%3'),
            args0: [
                { type: 'field_dropdown', name: 'DIRECTION', options: [[localize('OVER'), 'OVER'], [localize('UNDER'), 'UNDER']] },
                { type: 'field_number', name: 'SEARCH_NUMBER', value: 0, min: 0, max: 9, precision: 1 },
                { type: 'field_number', name: 'INITIAL_STAKE', value: 1, min: 0.01, precision: 0.01 },
            ],
            args1: [
                { type: 'field_number', name: 'MARTINGALE', value: 2, min: 1, precision: 0.01 },
                { type: 'field_number', name: 'TARGET_PROFIT', value: 0, min: 0, precision: 0.01 },
                { type: 'field_number', name: 'TARGET_LOSS', value: 0, min: 0, precision: 0.01 },
            ],
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            previousStatement: null,
            nextStatement: null,
            tooltip: localize('XVT Sniper: wait for the Search Number, require 75% momentum from the latest 100 digits, then trade the current barrier. After a loss, switch OVER 2 to OVER 3 or UNDER 7 to UNDER 6 and apply Martingale. A win resets the original barrier and stake.'),
            category: window.Blockly.Categories.Trade_Definition,
        });
    },
    meta() {
        return {
            display_name: localize('G - T Sniper XVT'),
            description: localize('Native Blockly XVT Sniper trade options with Search Number, 75% momentum, recovery barriers, Martingale and target stops.'),
        };
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.xvt_sniper_trade_options = block => {
    const direction = block.getFieldValue('DIRECTION') || 'OVER';
    const searchNumber = Number(block.getFieldValue('SEARCH_NUMBER') || 0);
    const initialStake = Number(block.getFieldValue('INITIAL_STAKE') || 1);
    const martingale = Number(block.getFieldValue('MARTINGALE') || 2);
    const targetProfit = Number(block.getFieldValue('TARGET_PROFIT') || 0);
    const targetLoss = Number(block.getFieldValue('TARGET_LOSS') || 0);

    return [
        'BinaryBotPrivateHasCalledTradeOptions = Bot.startXvtTrade({',
        "direction: '" + direction + "',",
        'searchNumber: ' + searchNumber + ',',
        'initialStake: ' + initialStake + ',',
        'martingaleMultiplier: ' + martingale + ',',
        'targetProfit: ' + targetProfit + ',',
        'targetLoss: ' + targetLoss + ',',
        "duration: 1, durationUnit: 't'",
        '});',
    ].join('\\n');
};
