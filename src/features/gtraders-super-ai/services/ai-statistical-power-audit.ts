import { calculatePairedExactPValue, getFamilyWiseConfidenceZ } from './ai-model-validation';

export interface AIStatisticalPowerAuditOptions {
    /** Deterministic seed so repeated runs with identical options are reproducible. */
    seed?: number;
    /** Monte Carlo repetitions per scenario. Defaults to 2,000; capped at 20,000. */
    repetitions?: number;
    marketCount?: number;
    sampleSizes?: number[];
    trainingFractions?: number[];
    baselines?: number[];
    trueEdges?: number[];
    pairedModelImprovements?: number[];
    /** Assumed fraction of paired holdout observations on which model and baseline disagree. */
    pairedDiscordanceRate?: number;
}

export interface AIContractPowerScenario {
    totalTicks: number;
    trainingTicks: number;
    holdoutTicks: number;
    baseline: number;
    trueEdge: number;
    repetitions: number;
    approvals: number;
    approvalRate: number;
    interpretation: 'FALSE_APPROVAL_RATE' | 'POWER' | 'NOT_RUN';
}

export interface AIPairedPowerScenario {
    holdoutTicks: number;
    trueModelImprovement: number;
    discordanceRate: number;
    repetitions: number;
    significantRuns: number;
    power: number;
}

export interface AIWindowSelectionScenario { profile: 'CLEAR_WINNER' | 'NEAR_TIE' | 'REGIME_SHIFT'; repetitions: number; legacyStabilityPassRate: number; aggregateSelectionAvailableRate: number; aggregateAmbiguityRate: number; }

export interface AIDependenceSensitivity { holdoutTicks: number; lagOneCorrelation: number; approximateEffectiveSampleSize: number; }

export interface AIStatisticalPowerAuditResult {
    mode: 'SHADOW_ONLY';
    seed: number;
    repetitions: number;
    marketCount: number;
    confidenceLevel: number;
    contractScenarios: AIContractPowerScenario[];
    pairedScenarios: AIPairedPowerScenario[];
    windowSelectionScenarios: AIWindowSelectionScenario[];
    dependenceSensitivity: AIDependenceSensitivity[];
    safeguards: string[];
    interpretation: string;
}

const DEFAULT_BASELINES = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const DEFAULT_EDGES = [0, 0.02, 0.05, 0.1];
const DEFAULT_SAMPLE_SIZES = [500, 1000, 2000, 5000];
const DEFAULT_SPLITS = [0.5, 0.6, 0.7];
const DEFAULT_PAIRED_IMPROVEMENTS = [0, 0.02, 0.05, 0.1];

const clamp = (value: number, low: number, high: number): number =>
    Math.max(low, Math.min(high, value));

const wilsonLowerBound = (wins: number, sampleSize: number, z: number): number => {
    if (sampleSize <= 0) return 0;
    const proportion = wins / sampleSize;
    const zSquared = z * z;
    const denominator = 1 + zSquared / sampleSize;
    const centre = proportion + zSquared / (2 * sampleSize);
    const margin = z * Math.sqrt(
        (proportion * (1 - proportion) / sampleSize) +
        (zSquared / (4 * sampleSize * sampleSize))
    );
    return Math.max(0, (centre - margin) / denominator);
};

/** Small deterministic PRNG; this is simulation-only, never used for trading. */
const createRandom = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
};

const countBinomial = (sampleSize: number, probability: number, random: () => number): number => {
    let successes = 0;
    for (let index = 0; index < sampleSize; index += 1) {
        if (random() < probability) successes += 1;
    }
    return successes;
};

const normalizePositiveIntegers = (values: number[] | undefined, fallback: number[]): number[] =>
    [...new Set((values ?? fallback)
        .filter(value => Number.isInteger(value) && value > 0)
        .map(value => Math.min(100000, value)))].sort((a, b) => a - b);

const normalizeRates = (values: number[] | undefined, fallback: number[]): number[] =>
    [...new Set((values ?? fallback)
        .filter(value => Number.isFinite(value) && value >= 0 && value <= 1)
        .map(value => Number(value.toFixed(4))))].sort((a, b) => a - b);

/**
 * Shadow-mode power study.
 *
 * Contract simulations are conditional on a contract/window having already
 * been selected using training data. The holdout is independent and untouched.
 * Consequently, the confidence adjustment covers the number of markets
 * evaluated on holdout; it does not multiply by training-only candidate
 * barriers/windows a second time. If any candidate is selected or tuned using
 * holdout results, this assumption is violated and the adjustment is invalid.
 *
 * Paired prediction simulations model McNemar discordant pairs separately.
 * Both studies are diagnostics only and cannot change scanner decisions.
 */
export const runAIStatisticalPowerAudit = (
    options: AIStatisticalPowerAuditOptions = {}
): AIStatisticalPowerAuditResult => {
    const seed = Number.isInteger(options.seed) ? options.seed! >>> 0 : 20261114;
    const repetitions = clamp(
        Number.isInteger(options.repetitions) ? options.repetitions! : 2000,
        200,
        20000
    );
    const marketCount = clamp(
        Number.isInteger(options.marketCount) ? options.marketCount! : 13,
        1,
        1000
    );
    const sampleSizes = normalizePositiveIntegers(options.sampleSizes, DEFAULT_SAMPLE_SIZES);
    const splits = normalizeRates(options.trainingFractions, DEFAULT_SPLITS)
        .filter(value => value > 0 && value < 1);
    const baselines = normalizeRates(options.baselines, DEFAULT_BASELINES)
        .filter(value => value > 0 && value < 1);
    const edges = normalizeRates(options.trueEdges, DEFAULT_EDGES);
    const pairedImprovements = normalizeRates(
        options.pairedModelImprovements,
        DEFAULT_PAIRED_IMPROVEMENTS
    );
    const discordanceRate = clamp(
        Number.isFinite(options.pairedDiscordanceRate) ? options.pairedDiscordanceRate! : 0.2,
        0.01,
        1
    );
    const random = createRandom(seed);
    const z = getFamilyWiseConfidenceZ(marketCount);
    const contractScenarios: AIContractPowerScenario[] = [];

    for (const totalTicks of sampleSizes) {
        for (const trainingFraction of splits) {
            const trainingTicks = Math.floor(totalTicks * trainingFraction);
            const holdoutTicks = totalTicks - trainingTicks;
            const eligible = trainingTicks >= 300 && holdoutTicks >= 200;
            for (const baseline of baselines) {
                for (const trueEdge of edges) {
                    if (!eligible) {
                        contractScenarios.push({
                            totalTicks, trainingTicks, holdoutTicks, baseline, trueEdge,
                            repetitions: 0, approvals: 0, approvalRate: 0,
                            interpretation: 'NOT_RUN',
                        });
                        continue;
                    }
                    const trueWinRate = Math.min(1, baseline + trueEdge);
                    let approvals = 0;
                    for (let run = 0; run < repetitions; run += 1) {
                        const wins = countBinomial(holdoutTicks, trueWinRate, random);
                        if (wilsonLowerBound(wins, holdoutTicks, z) > baseline) approvals += 1;
                    }
                    contractScenarios.push({
                        totalTicks, trainingTicks, holdoutTicks, baseline, trueEdge,
                        repetitions, approvals, approvalRate: approvals / repetitions,
                        interpretation: trueEdge === 0 ? 'FALSE_APPROVAL_RATE' : 'POWER',
                    });
                }
            }
        }
    }

    const pairedScenarios: AIPairedPowerScenario[] = [];
    const pairedHoldoutSizes = [...new Set(sampleSizes
        .flatMap(total => splits.map(split => total - Math.floor(total * split)))
        .filter(size => size >= 200))].sort((a, b) => a - b);
    for (const holdoutTicks of pairedHoldoutSizes) {
        for (const improvement of pairedImprovements) {
            // Keep the requested discordance rate feasible for both directions.
            const effectiveDiscordance = Math.max(discordanceRate, improvement);
            const modelOnlyRate = (effectiveDiscordance + improvement) / 2;
            const baselineOnlyRate = (effectiveDiscordance - improvement) / 2;
            let significantRuns = 0;
            for (let run = 0; run < repetitions; run += 1) {
                let modelOnly = 0;
                let baselineOnly = 0;
                for (let index = 0; index < holdoutTicks; index += 1) {
                    const draw = random();
                    if (draw < modelOnlyRate) modelOnly += 1;
                    else if (draw < modelOnlyRate + baselineOnlyRate) baselineOnly += 1;
                }
                const rawP = calculatePairedExactPValue(modelOnly, baselineOnly);
                if (Math.min(1, rawP * marketCount) <= 0.05) significantRuns += 1;
            }
            pairedScenarios.push({
                holdoutTicks,
                trueModelImprovement: improvement,
                discordanceRate: effectiveDiscordance,
                repetitions,
                significantRuns,
                power: significantRuns / repetitions,
            });
        }
    }


    const windowProfiles: Array<{ profile: AIWindowSelectionScenario['profile']; rates: number[][] }> = [
        { profile: 'CLEAR_WINNER', rates: [[0.65, 0.65, 0.65], [0.57, 0.57, 0.57], [0.54, 0.54, 0.54], [0.52, 0.52, 0.52], [0.5, 0.5, 0.5]] },
        { profile: 'NEAR_TIE', rates: [[0.55, 0.55, 0.55], [0.54, 0.54, 0.54], [0.53, 0.53, 0.53], [0.52, 0.52, 0.52], [0.51, 0.51, 0.51]] },
        { profile: 'REGIME_SHIFT', rates: [[0.62, 0.5, 0.5], [0.5, 0.62, 0.5], [0.5, 0.5, 0.62], [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]] },
    ];
    const windowSelectionScenarios: AIWindowSelectionScenario[] = windowProfiles.map(scenario => {
        let legacyPasses = 0;
        let ambiguousSelections = 0;
        for (let run = 0; run < repetitions; run += 1) {
            const foldAccuracies = scenario.rates.map(candidate =>
                candidate.map(probability => countBinomial(50, probability, random) / 50)
            );
            const foldWinners = [0, 1, 2].map(fold =>
                foldAccuracies.reduce((best, candidate, index) =>
                    candidate[fold] > foldAccuracies[best][fold] ? index : best, 0)
            );
            const winsByCandidate = scenario.rates.map((_, candidate) =>
                foldWinners.filter(winner => winner === candidate).length
            );
            const aggregateRates = scenario.rates.map((_, candidate) =>
                foldAccuracies[candidate].reduce((sum, accuracy) => sum + accuracy, 0) / 3
            );
            const selected = aggregateRates.reduce((best, rate, index) =>
                rate > aggregateRates[best] ? index : best, 0);
            const sortedAggregate = [...aggregateRates].sort((a, b) => b - a);
            const selectedWins = winsByCandidate[selected];
            const selectedFolds = foldAccuracies[selected];
            const foldMean = selectedFolds.reduce((a, b) => a + b, 0) / 3;
            const variance = selectedFolds.reduce((sum, value) =>
                sum + ((value - foldMean) ** 2), 0) / 3;
            if (selectedWins / 3 >= 2 / 3 && Math.sqrt(variance) <= 0.15) legacyPasses += 1;
            if (sortedAggregate[0] - sortedAggregate[1] <= 0.02) ambiguousSelections += 1;
        }
        return {
            profile: scenario.profile,
            repetitions,
            legacyStabilityPassRate: legacyPasses / repetitions,
            aggregateSelectionAvailableRate: 1,
            aggregateAmbiguityRate: ambiguousSelections / repetitions,
        };
    });
    const dependenceHoldouts = [...new Set(contractScenarios
        .filter(item => item.interpretation !== 'NOT_RUN')
        .map(item => item.holdoutTicks))].sort((a, b) => a - b);
    const dependenceSensitivity: AIDependenceSensitivity[] = dependenceHoldouts.flatMap(holdoutTicks =>
        [0, 0.1, 0.25, 0.5].map(lagOneCorrelation => ({
            holdoutTicks,
            lagOneCorrelation,
            approximateEffectiveSampleSize: holdoutTicks * (1 - lagOneCorrelation) / (1 + lagOneCorrelation),
        }))
    );

    return {
        mode: 'SHADOW_ONLY',
        seed,
        repetitions,
        marketCount,
        confidenceLevel: 0.95,
        contractScenarios,
        pairedScenarios,
        windowSelectionScenarios,
        dependenceSensitivity,
        safeguards: [
            'No scanner thresholds, model settings, trade decisions, or execution permissions are read or changed.',
            'No simulated result can approve a market or authorize a proposal or order.',
            'Contract power is conditional on selection using training data only; holdout must remain untouched.',
            'The family-wise adjustment is applied across the markets tested in this scan.',
            'The paired model gate is simulated separately; its evidence must not be mistaken for contract profitability.',
            'Independent Bernoulli simulations are optimistic when ticks are serially dependent; the effective-sample-size table is only a sensitivity approximation. Live paired holdout validation separately uses a circular moving-block bootstrap and an effective-sample-size gate.',
            'Window-selection results compare the current two-of-three fold-winner rule with aggregate ranking in shadow mode; aggregate ranking never bypasses the untouched holdout.',
            'A close aggregate winner is labelled ambiguous rather than treated as proof that one window is superior.',
        ],
        interpretation: 'This is a Monte Carlo design audit, not evidence that any live market has an edge. Compare false-approval rates at zero edge against detection power at positive edges. Treat low power as inconclusive evidence, never as permission to weaken approval rules.',
    };
};
