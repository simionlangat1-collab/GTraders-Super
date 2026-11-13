import { AIMarketScanner, AIMarketRequest } from '../ai-market-scanner';

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
