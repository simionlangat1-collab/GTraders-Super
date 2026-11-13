import { AIMarketScanner, AIMarketRequest, isVolatilityIndexMarket } from '../ai-market-scanner';

describe('AIMarketScanner', () => {
    it('uses the Deriv v1 active-symbol fields and does not send legacy filters', async () => {
        const request = jest.fn(async () => ({
            active_symbols: [
                {
                    underlying_symbol: 'R_100',
                    underlying_symbol_name: 'Volatility 100 Index',
                    market: 'synthetic_index',
                    submarket: 'random_index',
                    pip_size: 0.01,
                    exchange_is_open: 1,
                },
            ],
        }));
        const scanner = new AIMarketScanner(request as unknown as AIMarketRequest);

        const markets = await scanner.getAvailableMarkets();

        expect(request).toHaveBeenCalledWith({ active_symbols: 'brief' });
        expect(markets).toEqual([
            {
                symbol: 'R_100',
                display_name: 'Volatility 100 Index',
                market: 'synthetic_index',
                submarket: 'random_index',
                pip: 0.01,
                exchange_is_open: 1,
            },
        ]);
    });

    it('retains the observed last-digit sequence using Deriv tick precision', async () => {
        const request = jest.fn(async () => ({
            history: {
                prices: ['123.41', '123.45', '123.49'],
                times: [1000, 1001, 1002],
            },
            pip_size: 2,
        }));
        const scanner = new AIMarketScanner(request as unknown as AIMarketRequest);

        const history = await scanner.getTickHistory('R_100', 3);

        expect(history.digitSequence).toEqual([1, 5, 9]);
        expect(history.digitCounts[1]).toBe(1);
        expect(history.digitCounts[5]).toBe(1);
        expect(history.digitCounts[9]).toBe(1);
        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                ticks_history: 'R_100',
                count: 100,
                end: 'latest',
                style: 'ticks',
            })
        );
    });

    it('infers precision from original price strings when pip_size is missing', async () => {
        const request = jest.fn(async () => ({
            history: {
                prices: ['123.417', '123.425', '123.439'],
                times: [1000, 1001, 1002],
            },
        }));
        const scanner = new AIMarketScanner(request as unknown as AIMarketRequest);

        const history = await scanner.getTickHistory('R_100', 3);

        expect(history.digitSequence).toEqual([7, 5, 9]);
        expect(history.digitCounts[7]).toBe(1);
        expect(history.digitCounts[5]).toBe(1);
        expect(history.digitCounts[9]).toBe(1);
    });
});

describe('isVolatilityIndexMarket', () => {
    it('includes Volatility synthetic indices only', () => {
        expect(isVolatilityIndexMarket({
            symbol: 'R_100',
            display_name: 'Volatility 100 Index',
            market: 'synthetic_index',
            submarket: 'random_index',
            pip: 2,
        })).toBe(true);

        expect(isVolatilityIndexMarket({
            symbol: 'R_100_CLOSED',
            display_name: 'Volatility 100 Index',
            market: 'synthetic_index',
            submarket: 'random_index',
            pip: 2,
            exchange_is_open: 0,
        })).toBe(false);

        expect(isVolatilityIndexMarket({
            symbol: 'CRASH500',
            display_name: 'Crash 500 Index',
            market: 'synthetic_index',
            submarket: 'crash_index',
            pip: 2,
        })).toBe(false);

        expect(isVolatilityIndexMarket({
            symbol: 'frxEURUSD',
            display_name: 'EUR/USD',
            market: 'forex',
            submarket: 'major_pairs',
            pip: 4,
        })).toBe(false);
    });
});

it('marks history with missing or unusable timestamps as poor quality', async () => {
    const request = jest.fn(async () => ({
        history: {
            prices: Array(500).fill('123.45'),
            times: Array(500).fill(0),
        },
        pip_size: 2,
    }));
    const scanner = new AIMarketScanner(request as unknown as AIMarketRequest);

    const history = await scanner.getTickHistory('R_100', 500);

    expect(history.ticks).toBe(500);
    expect(history.dataQuality).toBe(0);
});


describe('AIMarketScanner tick-data lifecycle checks', () => {
    const freshTimes = Array.from({ length: 500 }, (_, index) => 1_700_000_000 + index);

    it('rejects stale history even when the prices and timestamps otherwise look valid', async () => {
        const request = jest.fn(async () => ({
            history: { prices: Array(500).fill('123.45'), times: freshTimes },
            pip_size: 2,
        }));
        const scanner = new AIMarketScanner(request as unknown as AIMarketRequest, () => 1_700_000_600);

        const history = await scanner.getTickHistory('R_100', 500);

        expect(history.isFresh).toBe(false);
        expect(history.dataQuality).toBe(0);
        expect(history.dataQualityReason).toMatch(/stale/i);
    });

    it('rejects future-dated ticks beyond the allowed clock-skew tolerance', async () => {
        const request = jest.fn(async () => ({
            history: { prices: Array(500).fill('123.45'), times: freshTimes },
            pip_size: 2,
        }));
        const scanner = new AIMarketScanner(request as unknown as AIMarketRequest, () => 1_700_000_100);

        const history = await scanner.getTickHistory('R_100', 500);

        expect(history.isFresh).toBe(false);
        expect(history.dataQuality).toBe(0);
        expect(history.dataQualityReason).toMatch(/stale or unexpectedly future-dated/i);
    });

    it('rejects mismatched price and timestamp arrays', async () => {
        const request = jest.fn(async () => ({
            history: {
                prices: Array(500).fill('123.45'),
                times: freshTimes.slice(0, 499),
            },
            pip_size: 2,
        }));
        const scanner = new AIMarketScanner(request as unknown as AIMarketRequest, () => 1_700_000_600);

        const history = await scanner.getTickHistory('R_100', 500);

        expect(history.dataQuality).toBe(0);
        expect(history.dataQualityReason).toMatch(/do not align/i);
    });

    it('rejects out-of-order timestamps while allowing same-second ticks', async () => {
        const times = [...freshTimes];
        times[300] = times[299] - 1;
        const request = jest.fn(async () => ({
            history: { prices: Array(500).fill('123.45'), times },
            pip_size: 2,
        }));
        const scanner = new AIMarketScanner(request as unknown as AIMarketRequest, () => 1_700_000_600);

        const history = await scanner.getTickHistory('R_100', 500);

        expect(history.dataQuality).toBe(0);
        expect(history.dataQualityReason).toMatch(/out of order/i);
    });

    it('accepts fresh, aligned, ordered history and allows second-level timestamp ties', async () => {
        const times = [...freshTimes];
        times[300] = times[299];
        const request = jest.fn(async () => ({
            history: { prices: Array(500).fill('123.45'), times },
            pip_size: 2,
        }));
        const scanner = new AIMarketScanner(request as unknown as AIMarketRequest, () => 1_700_000_550);

        const history = await scanner.getTickHistory('R_100', 500);

        expect(history.isFresh).toBe(true);
        expect(history.dataQuality).toBe(100);
        expect(history.dataQualityReason).toMatch(/passed/i);
    });
});
