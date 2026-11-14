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

    it('does not report significance when paired outcomes show no positive improvement', () => {
        const balanced = Array.from({ length: 240 }, (_, index) => index % 2 === 0 ? 1 : -1);
        const result = validatePairedDependence(balanced);

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
