export interface AIMarketSymbol {
    symbol: string;
    display_name: string;
    market: string;
    submarket: string;
    pip: number;
    exchange_is_open?: number;
}

export interface AIMarketHistory {
    symbol: string;
    displayName: string;
    ticks: number;
    firstTickAt: number;
    lastTickAt: number;
    averageAbsoluteMove: number;
    ticksPerMinute: number;
    observedRange: number;
    digitCounts: number[];
    digitSequence: number[];
    dataQuality: number;
    activityScore: number;
}

interface ActiveSymbolsResponse {
    active_symbols?: Array<{
        symbol?: string;
        display_name?: string;
        underlying_symbol?: string;
        underlying_symbol_name?: string;
        market?: string;
        submarket?: string;
        pip?: number;
        pip_size?: number;
        exchange_is_open?: number;
    }>;
}

interface TickHistoryResponse {
    history?: {
        prices?: Array<string | number>;
        times?: number[];
    };
    pip_size?: number;
}

export type AIMarketRequest = <T>(payload: Record<string, unknown>) => Promise<T>;

/** Limits the AI scanner to Volatility synthetic indices, excluding other synthetic products. */
export const isVolatilityIndexMarket = (market: AIMarketSymbol): boolean =>
    /volatility/i.test(market.display_name) && /synthetic/i.test(market.market);

const MAX_DIGIT_PRECISION = 10;

const inferPricePrecision = (prices: Array<string | number>): number =>
    Math.min(
        MAX_DIGIT_PRECISION,
        prices.reduce((maximum, price) => {
            const value = String(price);
            const decimalPart = value.includes('.') ? value.split('.')[1] : '';
            return Math.max(maximum, decimalPart.length);
        }, 0)
    );

/**
 * Read-only market discovery and tick-history scanner.
 * Scores observed data activity and quality only; it does not predict outcomes
 * or authorize trades.
 */
export class AIMarketScanner {
    constructor(private readonly request: AIMarketRequest) {}

    async getAvailableMarkets(): Promise<AIMarketSymbol[]> {
        // The connected Deriv v1 API no longer accepts the legacy product_type
        // filter and uses underlying_symbol/name in place of symbol/display_name.
        const response = await this.request<ActiveSymbolsResponse>({
            active_symbols: 'brief',
        });

        return (response.active_symbols ?? [])
            .map(item => {
                const symbol = item.underlying_symbol ?? item.symbol;
                const displayName = item.underlying_symbol_name ?? item.display_name;
                if (!symbol || !displayName) return null;

                return {
                    symbol,
                    display_name: displayName,
                    market: item.market ?? 'Other',
                    submarket: item.submarket ?? 'Other',
                    pip: Number(item.pip_size ?? item.pip ?? 0),
                    exchange_is_open: item.exchange_is_open,
                };
            })
            .filter((item): item is AIMarketSymbol => item !== null);
    }

    async getTickHistory(symbol: string, count = 500): Promise<AIMarketHistory> {
        const response = await this.request<TickHistoryResponse>({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: Math.max(100, Math.min(1000, Math.floor(count))),
            end: 'latest',
            style: 'ticks',
        });

        const rawPrices = response.history?.prices ?? [];
        const priceRecords = rawPrices
            .map(rawPrice => ({ rawPrice, price: Number(rawPrice) }))
            .filter(record => Number.isFinite(record.price));
        const prices = priceRecords.map(record => record.price);
        const times = response.history?.times ?? [];
        const digitCounts = Array<number>(10).fill(0);
        const digitSequence: number[] = [];
        const reportedPrecision = response.pip_size;
        const decimals =
            Number.isInteger(reportedPrecision) &&
            reportedPrecision! >= 0 &&
            reportedPrecision! <= MAX_DIGIT_PRECISION
                ? reportedPrecision!
                : inferPricePrecision(priceRecords.map(record => record.rawPrice));

        priceRecords.forEach(({ price }) => {
            // Formatting at the reported tick precision avoids floating-point
            // multiplication changing the final digit. If pip_size is absent,
            // precision is inferred from the original price strings.
            const scaledPrice = Math.abs(price).toFixed(decimals).replace('.', '');
            const lastDigit = Number(scaledPrice[scaledPrice.length - 1]);
            digitCounts[lastDigit] += 1;
            digitSequence.push(lastDigit);
        });

        const moves = prices.slice(1).map((price, index) => Math.abs(price - prices[index]));
        const averageAbsoluteMove = moves.length
            ? moves.reduce((sum, move) => sum + move, 0) / moves.length
            : 0;
        const observedRange = prices.length
            ? Math.max(...prices) - Math.min(...prices)
            : 0;
        const firstTickAt = times.length ? Number(times[0]) : 0;
        const lastTickAt = times.length ? Number(times[times.length - 1]) : 0;
        const elapsedMinutes = lastTickAt > firstTickAt
            ? (lastTickAt - firstTickAt) / 60
            : 0;
        const ticksPerMinute = elapsedMinutes > 0 ? moves.length / elapsedMinutes : 0;
        const dataQuality = Math.min(100, Math.round((prices.length / 500) * 100));
        const activityScore = Math.round(
            dataQuality * 0.65 + Math.min(35, (ticksPerMinute / 30) * 35)
        );

        return {
            symbol,
            displayName: symbol,
            ticks: prices.length,
            firstTickAt,
            lastTickAt,
            averageAbsoluteMove,
            ticksPerMinute,
            observedRange,
            digitCounts,
            digitSequence,
            dataQuality,
            activityScore,
        };
    }

    async scanMarkets(
        markets: AIMarketSymbol[],
        options: { maxMarkets?: number; historyCount?: number; concurrency?: number } = {}
    ): Promise<AIMarketHistory[]> {
        const maxMarkets = Math.max(1, Math.min(100, options.maxMarkets ?? 30));
        const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
        const selected = markets.slice(0, maxMarkets);
        const results: AIMarketHistory[] = [];

        for (let offset = 0; offset < selected.length; offset += concurrency) {
            const batch = selected.slice(offset, offset + concurrency);
            const settled = await Promise.allSettled(
                batch.map(market => this.getTickHistory(market.symbol, options.historyCount ?? 500))
            );

            settled.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push({
                        ...result.value,
                        displayName: batch[index].display_name,
                    });
                }
            });
        }

        return results.sort(
            (a, b) => b.activityScore - a.activityScore || b.dataQuality - a.dataQuality
        );
    }
}
