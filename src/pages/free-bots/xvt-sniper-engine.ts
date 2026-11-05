import { api_base } from '@/external/bot-skeleton/services/api/api-base';

type XvtDirection = 'OVER' | 'UNDER';

type XvtConfig = {
    symbol: string;
    direction: XvtDirection;
    entryDigit: number;
    stake: number;
    takeProfit: number;
    stopLoss: number;
    martingale: number;
    currency: string;
};

type DigitAnalysis = {
    ticks: number;
    counts: number[];
    topDigits: number[];
    predictionDigit: number | null;
    favourableCount: number;
    favourablePercent: number;
    momentumReady: boolean;
    latestDigit: number | null;
};

type XvtCallbacks = {
    onStatus?: (message: string) => void;
    onAnalysis?: (analysis: DigitAnalysis) => void;
    onTrade?: (trade: Record<string, unknown>) => void;
    onResult?: (result: Record<string, unknown>) => void;
    onProfit?: (profit: number) => void;
    onError?: (message: string) => void;
    onStopped?: () => void;
};

const ANALYSIS_WINDOW = 100;
const MIN_FAVOURABLE_PERCENT = 75;

export default class XvtSniperEngine {
    private api: any = null;
    private config: XvtConfig;
    private callbacks: XvtCallbacks;
    private digits: number[] = [];
    private lastEpoch = 0;
    private messageSubscription: { unsubscribe: () => void } | null = null;
    private tickSubscriptionId = '';
    private openContractSubscriptionId = '';
    private currentContractId = '';
    private running = false;
    private busy = false;
    private lossesInCycle = 0;
    private currentStake = 0;
    private sessionProfit = 0;
    private latestBalance = 0;
    private settledContractIds = new Set<string>();
    private latestAnalysis: DigitAnalysis = {
        ticks: 0,
        counts: Array(10).fill(0),
        topDigits: [],
        predictionDigit: null,
        favourableCount: 0,
        favourablePercent: 0,
        momentumReady: false,
        latestDigit: null,
    };

    constructor(config: XvtConfig, callbacks: XvtCallbacks = {}) {
        this.config = config;
        this.callbacks = callbacks;
        this.currentStake = config.stake;
    }

    async start() {
        if (this.running) return;
        this.api = api_base.api as any;

        if (!api_base.is_authorized || !this.api || this.api.connection?.readyState !== 1) {
            throw new Error('Please connect and authorize your Deriv account first.');
        }

        this.running = true;
        this.busy = false;
        this.lossesInCycle = 0;
        this.currentStake = this.config.stake;
        this.sessionProfit = 0;
        this.settledContractIds.clear();
        this.latestBalance = Number((api_base.account_info as any)?.balance ?? 0);
        this.digits = [];
        this.lastEpoch = 0;
        this.setStatus('Connecting to live ticks…');

        this.messageSubscription = this.api.onMessage().subscribe(({ data }: { data: any }) => {
            if (data?.msg_type === 'balance' && data.balance) {
                this.latestBalance = Number(data.balance.balance ?? this.latestBalance);
            }

            if (data?.msg_type === 'tick' && data.tick?.symbol === this.config.symbol) {
                this.handleTick(data.tick);
            }

            if (data?.msg_type === 'proposal_open_contract') {
                const contract = data.proposal_open_contract;
                if (contract && String(contract.contract_id) === this.currentContractId) {
                    if (data.subscription?.id) this.openContractSubscriptionId = data.subscription.id;
                    this.handleContractUpdate(contract);
                }
            }
        });

        try {
            const response = await this.api.send({
                ticks_history: this.config.symbol,
                end: 'latest',
                count: ANALYSIS_WINDOW,
                style: 'ticks',
                subscribe: 1,
            });

            if (response?.error) throw new Error(response.error.message || 'Unable to load tick history.');
            const prices: (string | number)[] = response?.history?.prices || [];
            const times: (string | number)[] = response?.history?.times || [];

            if (!prices.length) throw new Error('Deriv returned no tick history for this market.');

            const pipSize = this.getPipSize();
            this.digits = prices.slice(-ANALYSIS_WINDOW).map(price => this.lastDigit(price, pipSize));
            this.lastEpoch = Number(times[times.length - 1] || 0);
            this.tickSubscriptionId = response?.subscription?.id || '';
            this.publishAnalysis();
            this.setStatus('Monitoring entry digit and momentum.');
        } catch (error) {
            this.running = false;
            this.cleanup();
            this.callbacks.onStopped?.();
            throw error;
        }
    }

    stop() {
        this.running = false;
        this.forgetTickSubscription();
        if (this.currentContractId || this.busy) {
            this.setStatus('Stopping: resolving the pending trade request or waiting for the open contract to settle. No new trades will be placed.');
        } else {
            this.cleanup();
            this.setStatus('Bot stopped.');
            this.callbacks.onStopped?.();
        }
    }

    dispose() {
        this.running = false;
        this.currentContractId = '';
        this.busy = false;
        this.cleanup();
        this.callbacks.onStopped?.();
    }

    getSessionProfit() {
        return this.sessionProfit;
    }

    private getPipSize() {
        const sizes = api_base.pip_sizes as Record<string, number>;
        const size = Number(sizes?.[this.config.symbol]);
        return Number.isInteger(size) && size >= 0 && size <= 10 ? size : 2;
    }

    private lastDigit(value: string | number, pipSize: number) {
        const formatted = Number(value).toFixed(pipSize);
        return Number(formatted.charAt(formatted.length - 1));
    }

    private handleTick(tick: any) {
        if (!this.running || !tick) return;
        const epoch = Number(tick.epoch || 0);
        if (epoch && epoch <= this.lastEpoch) return;
        if (epoch) this.lastEpoch = epoch;

        const digit = this.lastDigit(tick.quote, this.getPipSize());
        this.digits = [...this.digits.slice(-(ANALYSIS_WINDOW - 1)), digit];
        this.publishAnalysis();

        if (
            this.running &&
            !this.busy &&
            !this.currentContractId &&
            digit === this.config.entryDigit &&
            this.latestAnalysis.momentumReady
        ) {
            void this.placeTrade();
        }
    }

    private publishAnalysis() {
        const counts = Array(10).fill(0) as number[];
        this.digits.forEach(digit => {
            if (Number.isInteger(digit) && digit >= 0 && digit <= 9) counts[digit] += 1;
        });

        const topDigits = counts
            .map((count, digit) => ({ digit, count }))
            .sort((a, b) => b.count - a.count || a.digit - b.digit)
            .slice(0, 2)
            .map(item => item.digit);

        const isRecovery = this.lossesInCycle > 0;
        const favourableCount = this.config.direction === 'OVER'
            ? this.digits.filter(digit => digit >= (isRecovery ? 4 : 3)).length
            : this.digits.filter(digit => digit <= (isRecovery ? 5 : 6)).length;
        const favourablePercent = this.digits.length
            ? (favourableCount / this.digits.length) * 100
            : 0;

        this.latestAnalysis = {
            ticks: this.digits.length,
            counts,
            topDigits,
            predictionDigit: this.digits.length ? topDigits[0] : null,
            favourableCount,
            favourablePercent,
            momentumReady: this.digits.length === ANALYSIS_WINDOW && favourablePercent >= MIN_FAVOURABLE_PERCENT,
            latestDigit: this.digits.length ? this.digits[this.digits.length - 1] : null,
        };
        this.callbacks.onAnalysis?.(this.latestAnalysis);
    }

    private async placeTrade() {
        if (!this.running || this.busy || this.currentContractId) return;
        this.busy = true;

        const isRecovery = this.lossesInCycle > 0;
        const barrier = this.config.direction === 'OVER'
            ? (isRecovery ? 3 : 2)
            : (isRecovery ? 6 : 7);
        const contractType = this.config.direction === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER';
        const balance = this.latestBalance;

        if (!Number.isFinite(balance) || balance <= 0) {
            this.busy = false;
            this.running = false;
            this.forgetTickSubscription();
            this.cleanup();
            this.setStatus('Safety stop: account balance could not be verified or is zero.');
            this.callbacks.onStopped?.();
            return;
        }

        if (this.currentStake > balance) {
            this.busy = false;
            this.running = false;
            this.forgetTickSubscription();
            this.cleanup();
            this.setStatus('Safety stop: next stake is greater than the available account balance.');
            this.callbacks.onStopped?.();
            return;
        }

        this.setStatus(`Entry digit ${this.config.entryDigit} detected. Requesting ${contractType} ${barrier}…`);

        try {
            const proposalResponse = await this.api.send({
                proposal: 1,
                amount: this.currentStake,
                basis: 'stake',
                contract_type: contractType,
                currency: this.config.currency,
                duration: 1,
                duration_unit: 't',
                barrier,
                underlying_symbol: this.config.symbol,
            });

            if (proposalResponse?.error) throw new Error(proposalResponse.error.message || 'Proposal request failed.');
            const proposal = proposalResponse?.proposal;
            if (!proposal?.id || !Number.isFinite(Number(proposal.ask_price))) {
                throw new Error('Deriv did not return a valid trade proposal.');
            }

            if (!this.running) {
                this.busy = false;
                this.cleanup();
                this.setStatus('Bot stopped before purchase. No new contract was opened.');
                this.callbacks.onStopped?.();
                return;
            }

            const buyResponse = await this.api.send({
                buy: proposal.id,
                price: Number(proposal.ask_price),
            });

            if (buyResponse?.error) throw new Error(buyResponse.error.message || 'Contract purchase failed.');
            const buy = buyResponse?.buy;
            if (!buy?.contract_id) throw new Error('Deriv did not return a contract ID.');

            this.currentContractId = String(buy.contract_id);
            this.openContractSubscriptionId = '';
            this.callbacks.onTrade?.({
                contractId: this.currentContractId,
                direction: this.config.direction,
                contractType,
                barrier,
                entryDigit: this.config.entryDigit,
                stake: this.currentStake,
                recovery: isRecovery,
            });
            this.setStatus(`Trade opened: ${contractType} ${barrier} · stake ${this.currentStake.toFixed(2)} ${this.config.currency}`);

            const openResponse = await this.api.send({
                proposal_open_contract: 1,
                contract_id: buy.contract_id,
                subscribe: 1,
            });

            if (openResponse?.error) throw new Error(openResponse.error.message || 'Unable to monitor the open contract.');
            if (openResponse?.subscription?.id) this.openContractSubscriptionId = openResponse.subscription.id;
            if (openResponse?.proposal_open_contract) {
                this.handleContractUpdate(openResponse.proposal_open_contract);
            }
            if (this.currentContractId !== String(buy.contract_id)) {
                this.forgetOpenContractSubscription();
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Trade request failed.';
            this.callbacks.onError?.(message);

            if (this.currentContractId) {
                this.setStatus('A contract was purchased; reconnecting its result monitor…');
                try {
                    const recoveryResponse = await this.api.send({
                        proposal_open_contract: 1,
                        contract_id: this.currentContractId,
                        subscribe: 1,
                    });
                    if (recoveryResponse?.subscription?.id) {
                        this.openContractSubscriptionId = recoveryResponse.subscription.id;
                    }
                    if (recoveryResponse?.proposal_open_contract) {
                        this.handleContractUpdate(recoveryResponse.proposal_open_contract);
                    }
                } catch {
                    this.setStatus('A contract was purchased but its live monitor could not be restored. Check the Deriv Portfolio before restarting.');
                }
            } else {
                this.busy = false;
                this.running = false;
                this.forgetTickSubscription();
                this.cleanup();
                this.setStatus(`Trade not completed; bot stopped for safety: ${message}`);
                this.callbacks.onStopped?.();
            }
        }
    }

    private handleContractUpdate(contract: any) {
        if (!contract || !this.currentContractId || String(contract.contract_id) !== this.currentContractId) return;
        if (!contract.is_sold && !['won', 'lost', 'sold'].includes(String(contract.status))) return;
        if (this.settledContractIds.has(this.currentContractId)) return;

        const settledId = this.currentContractId;
        const profit = Number(contract.profit ?? (Number(contract.sell_price) - Number(contract.buy_price)));
        if (!Number.isFinite(profit)) {
            this.callbacks.onError?.('Deriv returned an invalid contract profit. The open contract remains under monitoring.');
            return;
        }
        this.settledContractIds.add(settledId);

        this.sessionProfit += profit;
        const won = profit > 0;
        if (won) {
            this.lossesInCycle = 0;
            this.currentStake = this.config.stake;
        } else {
            this.lossesInCycle += 1;
            this.currentStake = this.config.stake * Math.pow(this.config.martingale, this.lossesInCycle);
        }

        this.callbacks.onProfit?.(this.sessionProfit);
        this.callbacks.onResult?.({
            contractId: settledId,
            result: won ? 'WIN' : 'LOSS',
            profit,
            sessionProfit: this.sessionProfit,
            lossesInCycle: this.lossesInCycle,
            nextStake: this.currentStake,
            nextBarrier: this.config.direction === 'OVER'
                ? (this.lossesInCycle > 0 ? 3 : 2)
                : (this.lossesInCycle > 0 ? 6 : 7),
        });

        this.currentContractId = '';
        this.busy = false;
        this.forgetOpenContractSubscription();

        if (this.sessionProfit >= this.config.takeProfit) {
            this.running = false;
            this.forgetTickSubscription();
            this.cleanup();
            this.setStatus('Take Profit reached. Bot stopped.');
            this.callbacks.onStopped?.();
            return;
        }

        if (this.sessionProfit <= -this.config.stopLoss) {
            this.running = false;
            this.forgetTickSubscription();
            this.cleanup();
            this.setStatus('Stop Loss reached. Bot stopped.');
            this.callbacks.onStopped?.();
            return;
        }

        const balance = this.latestBalance;
        if (!won && balance > 0 && this.currentStake > balance) {
            this.running = false;
            this.forgetTickSubscription();
            this.cleanup();
            this.setStatus('Safety stop: the next Martingale stake exceeds the available balance.');
            this.callbacks.onStopped?.();
            return;
        }

        if (!this.running) {
            this.cleanup();
            this.setStatus('Open contract settled. Bot stopped.');
            this.callbacks.onStopped?.();
            return;
        }

        this.setStatus(won
            ? 'Trade won. Recovery reset; waiting for the next entry digit.'
            : `Trade lost. Recovery ${this.lossesInCycle} armed; waiting for the next entry digit.`);
    }

    private forgetTickSubscription() {
        if (this.tickSubscriptionId && this.api) {
            void this.api.send({ forget: this.tickSubscriptionId }).catch(() => undefined);
            this.tickSubscriptionId = '';
        }
    }

    private forgetOpenContractSubscription() {
        if (this.openContractSubscriptionId && this.api) {
            void this.api.send({ forget: this.openContractSubscriptionId }).catch(() => undefined);
            this.openContractSubscriptionId = '';
        }
    }

    private cleanup() {
        this.forgetTickSubscription();
        if (!this.currentContractId) this.forgetOpenContractSubscription();
        this.messageSubscription?.unsubscribe();
        this.messageSubscription = null;
    }

    private setStatus(message: string) {
        this.callbacks.onStatus?.(message);
    }
}
