
const fs = require('fs');
const path = require('path');

const brandConfig = require('../brand.config.json');

const THEMES_PATH = path.join(
    __dirname,
    '../src/components/shared/styles/_themes.scss'
);

const START_MARKER =
    '/* Brand colors - dynamically generated from brand.config.json */';

const END_MARKER =
    '/* End generated brand configuration */';

function validateBrandConfig() {
    const issues = [];

    if (!brandConfig.colors) {
        issues.push('Missing colors configuration.');
    } else {
        const requiredColors = [
            'primary',
            'secondary',
            'tertiary',
            'success',
            'danger',
            'warning',
            'info',
            'neutral',
            'white',
            'black'
        ];

        requiredColors.forEach((color) => {
            if (!brandConfig.colors[color]) {
                issues.push(`Missing required color: ${color}`);
            }
        });
    }

    if (!brandConfig.typography?.font_family) {
        issues.push('Missing typography.font_family configuration.');
    } else {
        ['primary', 'secondary', 'monospace'].forEach((font) => {
            if (!brandConfig.typography.font_family[font]) {
                issues.push(`Missing font: ${font}`);
            }
        });
    }

    if (issues.length > 0) {
        console.error('Brand configuration validation failed:');

        issues.forEach((issue) => {
            console.error(`- ${issue}`);
        });

        process.exit(1);
    }

    console.log('Brand configuration validated successfully.');
}

function generateBrandVariables() {
    const { colors, typography } = brandConfig;

    const lines = [
        START_MARKER,
        '    /* Brand colors */',
        `    --brand-white: ${colors.white};`,
        `    --brand-dark-grey: ${colors.black};`,
        `    --brand-red-coral: ${colors.primary};`,
        `    --brand-orange: ${colors.tertiary};`,
        '',
        '    /* Dynamic brand colors */',
        `    --brand-primary: ${colors.primary};`,
        `    --brand-secondary: ${colors.secondary};`,
        `    --brand-tertiary: ${colors.tertiary};`,
        `    --brand-success: ${colors.success};`,
        `    --brand-danger: ${colors.danger};`,
        `    --brand-warning: ${colors.warning};`,
        `    --brand-info: ${colors.info};`,
        `    --brand-neutral: ${colors.neutral};`,
        '',
        '    /* Brand typography */',
        `    --brand-font-primary: ${typography.font_family.primary};`,
        `    --brand-font-secondary: ${typography.font_family.secondary};`,
        `    --brand-font-monospace: ${typography.font_family.monospace};`,
        END_MARKER
    ];

    return lines.join('\n');
}

function updateBrandColorsInThemes() {
    if (!fs.existsSync(THEMES_PATH)) {
        throw new Error(
            `Theme file not found: ${THEMES_PATH}`
        );
    }

    let content = fs.readFileSync(THEMES_PATH, 'utf8');

    const startCount = content.split(START_MARKER).length - 1;
    const endCount = content.split(END_MARKER).length - 1;

    if (startCount !== endCount || startCount > 1) {
        throw new Error(
            'Invalid brand markers found. Check _themes.scss manually before regenerating.'
        );
    }

    const generatedSection = generateBrandVariables();

    if (startCount === 1) {
        const start = content.indexOf(START_MARKER);
        const end = content.indexOf(END_MARKER) + END_MARKER.length;

        content =
            content.substring(0, start) +
            generatedSection +
            content.substring(end);
    } else {
        const insertionText =
            '    --text-align-center: center;';

        const insertionPoint = content.indexOf(insertionText);

        if (insertionPoint === -1) {
            throw new Error(
                'Could not locate safe insertion point in _themes.scss.'
            );
        }

        const insertAfter =
            insertionPoint + insertionText.length;

        content =
            content.substring(0, insertAfter) +
            '\n\n' +
            generatedSection +
            content.substring(insertAfter);
    }

    fs.writeFileSync(THEMES_PATH, content, 'utf8');

    console.log('Brand variables updated successfully.');
    console.log('Original Deriv theme variables preserved.');
}

function main() {
    console.log('Starting GTraders Super brand generation...\n');

    validateBrandConfig();
    updateBrandColorsInThemes();

    console.log('\nGTraders Super branding generation completed.');
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error('\nBrand generation failed:');
        console.error(error.message);
        process.exit(1);
    }
}

module.exports = {
    validateBrandConfig,
    generateBrandVariables,
    updateBrandColorsInThemes
};
