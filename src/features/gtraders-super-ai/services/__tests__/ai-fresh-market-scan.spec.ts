import { AIMarketScanner, AIMarketRequest } from '../ai-market-scanner';

describe('AIMarketScanner.scanFreshVolatilityMarkets', () => {
    it('rediscovers active symbols and requests new history on every call', async () => {
        let discoveryCount = 0;
        const request = jest.fn(async (payload: Record<string, unknown>) => {
            if (payload.active_symbols) {
                discoveryCount += 1;
                return {
                    active_symbols: [
                        {
                            underlying_symbol: 'R_100',
                            underlying_symbol_name: 'Volatility 100 Index',
                            market: 'synthetic_index',
                            submarket: 'random_index',
                            pip_size: 2,
                            exchange_is_open: 1,
                        },
                        {
                            underlying_symbol: 'CRASH500',
                            underlying_symbol_name: 'Crash 500 Index',
                            market: 'synthetic_index',
                            submarket: 'crash_index',
                            pip_size: 2,
                            exchange_is_open: 1,
                        },
                    ],
                };
            }

            return {
                history: {
                    prices: Array.from({ length: 500 }, (_, index) => `100.${String(index % 10).padStart(2, '0')}`),
                    times: Array.from({ length: 500 }, (_, index) => 1000 + index),
                },
                pip_size: 2,
            };
        });
        const scanner = new AIMarketScanner(request as unknown as AIMarketRequest);

        const first = await scanner.scanFreshVolatilityMarkets({ maxMarkets: 100, concurrency: 1 });
        const second = await scanner.scanFreshVolatilityMarkets({ maxMarkets: 100, concurrency: 1 });

        expect(discoveryCount).toBe(2);
        expect(first.availableMarketCount).toBe(1);
        expect(second.availableMarketCount).toBe(1);
        expect(first.histories).toHaveLength(1);
        expect(second.histories).toHaveLength(1);
        expect(request).toHaveBeenCalledTimes(4);
        expect(request.mock.calls.filter(([payload]) => payload.ticks_history === 'R_100')).toHaveLength(2);
    });

    it('returns no histories when Deriv has no eligible Volatility markets', async () => {
        const request = jest.fn(async () => ({
            active_symbols: [{
                underlying_symbol: 'frxEURUSD',
                underlying_symbol_name: 'EUR/USD',
                market: 'forex',
                submarket: 'major_pairs',
                pip_size: 4,
                exchange_is_open: 1,
            }],
        }));
        const scanner = new AIMarketScanner(request as unknown as AIMarketRequest);

        const result = await scanner.scanFreshVolatilityMarkets();

        expect(result.availableMarketCount).toBe(0);
        expect(result.markets).toEqual([]);
        expect(result.histories).toEqual([]);
        expect(request).toHaveBeenCalledTimes(1);
    });
});
