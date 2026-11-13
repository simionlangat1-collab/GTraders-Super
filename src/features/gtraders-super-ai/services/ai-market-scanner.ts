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
    dataQuality: number;
    activityScore: number;
}

interface ActiveSymbolsResponse {
    active_symbols?: Array<{
        symbol: string;
        display_name: string;
        market?: string;
        submarket?: string;
        pip?: number;
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

/**
 * Read-only market discovery and tick-history scanner.
 * Scores observed data activity and quality only; it does not predict outcomes
 * or authorize trades.
 */
export class AIMarketScanner {
    constructor(private readonly request: AIMarketRequest) {}

    async getAvailableMarkets(): Promise<AIMarketSymbol[]> {
        const response = await this.request<ActiveSymbolsResponse>({
            active_symbols: 'brief',
            product_type: 'basic',
        });

        return (response.active_symbols ?? [])
            .filter(item => item.symbol && item.display_name)
            .map(item => ({
                symbol: item.symbol,
                display_name: item.display_name,
                market: item.market ?? 'Other',
                submarket: item.submarket ?? 'Other',
                pip: Number(item.pip ?? 0),
                exchange_is_open: item.exchange_is_open,
            }));
    }

    async getTickHistory(symbol: string, count = 500): Promise<AIMarketHistory> {
        const response = await this.request<TickHistoryResponse>({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: Math.max(100, Math.min(1000, Math.floor(count))),
            end: 'latest',
            style: 'ticks',
        });

        const prices = (response.history?.prices ?? []).map(Number).filter(Number.isFinite);
        const times = response.history?.times ?? [];
        const digitCounts = Array<number>(10).fill(0);

        prices.forEach(price => {
            const decimals = Math.max(0, response.pip_size ?? 2);
            const scaled = Math.round(price * Math.pow(10, decimals));
            const lastDigit = Math.abs(scaled) % 10;
            digitCounts[lastDigit] += 1;
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
