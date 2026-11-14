export type AIWindowShadowProfile = 'CLEAR_WINNER' | 'NEAR_TIE' | 'REGIME_SHIFT';
export type AIWindowShadowClassification = 'CLEAR_CANDIDATE' | 'AMBIGUOUS' | 'REGIME_UNSTABLE';

export interface AIWindowShadowScenario {
    profile: AIWindowShadowProfile;
    foldObservationsPerFold: number;
    repetitions: number;
    currentRulePassRate: number;
    aggregateClearCandidateRate: number;
    ambiguousRate: number;
    regimeUnstableRate: number;
}

/**
 * Deterministic simulation only. It never selects a live market window.
 * Fold sizes are explicit design sensitivities, not claims about live data.
 */
export const runAIWindowSelectionShadowAudit = (
    repetitions = 500,
    seed = 20261114
): AIWindowShadowScenario[] => {
    const count = Math.max(200, Math.min(20000, Math.floor(repetitions)));
    let state = seed >>> 0;
    const random = () => {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const profiles: Array<{ profile: AIWindowShadowProfile; rates: number[][] }> = [
        { profile: 'CLEAR_WINNER', rates: [[.65,.65,.65],[.57,.57,.57],[.54,.54,.54],[.52,.52,.52],[.50,.50,.50]] },
        { profile: 'NEAR_TIE', rates: [[.55,.55,.55],[.54,.54,.54],[.53,.53,.53],[.52,.52,.52],[.51,.51,.51]] },
        { profile: 'REGIME_SHIFT', rates: [[.62,.50,.50],[.50,.62,.50],[.50,.50,.62],[.50,.50,.50],[.50,.50,.50]] },
    ];
    const foldSampleSizes = [50, 100, 200];
    return profiles.flatMap(({ profile, rates }) => foldSampleSizes.map(foldObservationsPerFold => {
        let currentPasses = 0;
        let clearCandidates = 0;
        let ambiguous = 0;
        let regimeUnstable = 0;
        const binomialRate = (p: number) => {
            let wins = 0;
            for (let i = 0; i < foldObservationsPerFold; i += 1) {
                if (random() < p) wins += 1;
            }
            return wins / foldObservationsPerFold;
        };
        for (let run = 0; run < count; run += 1) {
            const folds = rates.map(candidate => candidate.map(binomialRate));
            const winners = [0,1,2].map(fold => folds.reduce((best, row, index) =>
                row[fold] > folds[best][fold] ? index : best, 0));
            const foldWins = rates.map((_, candidate) => winners.filter(w => w === candidate).length);
            const means = folds.map(row => row.reduce((a,b) => a+b, 0) / 3);
            const ranking = means.map((mean,index) => ({mean,index})).sort((a,b) => b.mean-a.mean);
            const best = ranking[0];
            const margin = best.mean - ranking[1].mean;
            const bestFoldRange = Math.max(...folds[best.index]) - Math.min(...folds[best.index]);
            const mean = folds[best.index].reduce((a,b) => a+b,0)/3;
            const variance = folds[best.index].reduce((sum,value) => sum+(value-mean)**2,0)/3;
            if (foldWins[best.index] >= 2 && Math.sqrt(variance) <= .15) currentPasses += 1;
            let classification: AIWindowShadowClassification;
            if (margin <= .02) classification = 'AMBIGUOUS';
            else if (bestFoldRange > .12 || foldWins[best.index] < 2) classification = 'REGIME_UNSTABLE';
            else classification = 'CLEAR_CANDIDATE';
            if (classification === 'AMBIGUOUS') ambiguous += 1;
            if (classification === 'REGIME_UNSTABLE') regimeUnstable += 1;
            if (classification === 'CLEAR_CANDIDATE') clearCandidates += 1;
        }
        return {
            profile,
            foldObservationsPerFold,
            repetitions: count,
            currentRulePassRate: currentPasses / count,
            aggregateClearCandidateRate: clearCandidates / count,
            ambiguousRate: ambiguous / count,
            regimeUnstableRate: regimeUnstable / count,
        };
    }));
};

/** A design-power label only; never classifies a live market or changes a gate. */
export const classifyPowerEvidence = (
    detectionPower: number,
    targetPower = 0.8
): 'ADEQUATE_DESIGN_POWER' | 'INSUFFICIENT_EVIDENCE' => {
    if (!Number.isFinite(detectionPower) || detectionPower < targetPower) return 'INSUFFICIENT_EVIDENCE';
    return 'ADEQUATE_DESIGN_POWER';
};
