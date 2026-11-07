import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.xvt_momentum_ready = {
    init() {
        this.jsonInit({
            message0: localize('XVT momentum ready for %1 recovery %2'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'DIRECTION',
                    options: [
                        [localize('OVER'), 'OVER'],
                        [localize('UNDER'), 'UNDER'],
                    ],
                },
                {
                    type: 'field_checkbox',
                    name: 'RECOVERY',
                    checked: false,
                },
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Special2.colour,
            colourSecondary: window.Blockly.Colours.Special2.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special2.colourTertiary,
            tooltip: localize('Checks whether at least 75% of the latest 100 tick digits meet the XVT favourable-digit threshold. OVER uses 3 (4 in recovery); UNDER uses 6 (5 in recovery).'),
            category: window.Blockly.Categories.Tick_Analysis,
        });
    },
    meta() {
        return {
            display_name: localize('XVT momentum ready'),
            description: localize('Returns true when at least 75 of the latest 100 digits meet the selected XVT direction and recovery threshold.'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.xvt_momentum_ready = block => {
    const direction = block.getFieldValue('DIRECTION');
    const recovery = block.getFieldValue('RECOVERY') === 'TRUE';
    return [
        `Bot.getXvtMomentumReady('${direction}', ${recovery})`,
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC,
    ];
};
