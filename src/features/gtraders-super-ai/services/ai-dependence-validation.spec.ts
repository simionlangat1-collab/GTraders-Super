import { validatePairedDependence } from './ai-dependence-validation';

describe('validatePairedDependence', () => {
    it('is deterministic for the same ordered holdout observations', () => {
        const values = Array.from({ length: 240 }, (_, index) => (index * 7) % 11 < 3 ? 1 : 0);
        expect(validatePairedDependence(values)).toEqual(validatePairedDependence(values));
    });

    it('detects positive serial dependence and reduces effective sample size', () => {
        const clustered = Array.from({ length: 240 }, (_, index) =>
            Math.floor(index / 20) % 2 === 0 ? 1 : 0
        );
        const result = validatePairedDependence(clustered);

        expect(result.lagOneCorrelation).toBeGreaterThan(0.5);
        expect(result.effectiveSampleSize).toBeLessThan(100);
        expect(result.blockLength).toBeGreaterThan(1);
    });

    it('does not report significance under either independent-like or clustered zero-edge outcomes', () => {
        const balanced = Array.from({ length: 240 }, (_, index) => index % 2 === 0 ? 1 : -1);
        const clusteredNull = Array.from({ length: 240 }, (_, index) =>
            Math.floor(index / 20) % 2 === 0 ? 1 : -1
        );
        const independentLikeResult = validatePairedDependence(balanced);
        const clusteredResult = validatePairedDependence(clusteredNull);

        expect(independentLikeResult.blockBootstrapPValue).toBe(1);
        expect(clusteredResult.blockBootstrapPValue).toBe(1);
        expect(clusteredResult.lagOneCorrelation).toBeGreaterThan(0.5);
        expect(clusteredResult.effectiveSampleSize).toBeLessThan(100);
    });

    it('fails closed when a constant positive series makes serial dependence unidentifiable', () => {
        const result = validatePairedDependence(Array(240).fill(1), 1000);

        expect(result.effectiveSampleSize).toBe(1);
        expect(result.blockBootstrapPValue).toBe(1);
    });

    it('returns a conservative finite p-value for a positive, dispersed paired edge', () => {
        const dispersed = Array.from({ length: 300 }, (_, index) => (index * 3) % 10 < 3 ? 1 : 0);
        const result = validatePairedDependence(dispersed, 1000);

        expect(result.blockBootstrapPValue).toBeGreaterThan(0);
        expect(result.blockBootstrapPValue).toBeLessThanOrEqual(1);
        expect(result.bootstrapRepetitions).toBe(1000);
        expect(result.effectiveSampleSize).toBe(300);
    });
});
