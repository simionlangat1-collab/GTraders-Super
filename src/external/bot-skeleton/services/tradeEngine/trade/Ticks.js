/* eslint-disable no-promise-executor-return */
import debounce from 'lodash.debounce';
import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { localize } from '@deriv-com/translations';
import { getLast } from '../../../utils/binary-utils';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { getDirection, getLastDigit } from '../utils/helpers';
import { expectPositiveInteger } from '../utils/sanitize';
import * as constants from './state/constants';

let tickListenerKey;

export default Engine =>
    class Ticks extends Engine {
        async watchTicks(symbol) {
            if (symbol && this.symbol !== symbol) {
                this.symbol = symbol;
                const { ticksService } = this.$scope;

                await ticksService.stopMonitor({
                    symbol,
                    key: tickListenerKey,
                });
                const callback = ticks => {
                    if (this.is_proposal_subscription_required) {
                        this.checkProposalReady();
                    }
                    const lastTick = ticks.slice(-1)[0];
                    const { epoch } = lastTick;
                    this.store.dispatch({ type: constants.NEW_TICK, payload: epoch });
                };

                const key = await ticksService.monitor({ symbol, callback });
                tickListenerKey = key;
            }
        }

        checkTicksPromiseExists() {
            return this.$scope.ticksService.ticks_history_promise;
        }

        getTicks(toString = false) {
            return new Promise(resolve => {
                this.$scope.ticksService.request({ symbol: this.symbol }).then(ticks => {
                    const ticks_list = ticks.map(tick => {
                        if (toString) {
                            return tick.quote.toFixed(this.getPipSize());
                        }
                        return tick.quote;
                    });

                    resolve(ticks_list);
                });
            });
        }

        getLastTick(raw, toString = false) {
            return new Promise((resolve, reject) =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol })
                    .then(ticks => {
                        try {
                            let last_tick = raw ? getLast(ticks) : getLast(ticks).quote;
                            if (!raw && toString) {
                                last_tick = last_tick.toFixed(this.getPipSize());
                            }
                            resolve(last_tick);
                        } catch (error) {
                            reject(error);
                        }
                    })
                    .catch(e => {
                        if (e.code === 'MarketIsClosed') {
                            const localizedError = {
                                ...e,
                                message: getLocalizedErrorMessage(e.code, e.details),
                            };
                            globalObserver.emit('Error', localizedError);
                            resolve(e.code);
                        }
                    })
            );
        }

        getLastDigit() {
            return new Promise(resolve => this.getLastTick(false, true).then(tick => resolve(getLastDigit(tick))));
        }

        getLastDigitList(count = 1000) {
            const limit = Number.isFinite(Number(count)) ? Math.max(1, Math.min(1000, Math.floor(Number(count)))) : 1000;
            return new Promise(resolve =>
                this.getTicks().then(ticks => resolve(this.getLastDigitsFromList(ticks.slice(-limit))))
            );
        }


        async startXvtTrade({
            direction = 'OVER',
            searchNumber = 0,
            initialStake = 1,
            martingaleMultiplier = 2,
            targetProfit = 0,
            targetLoss = 0,
            duration = 1,
            durationUnit = 't',
        } = {}) {
            const normalizedDirection = String(direction).toUpperCase() === 'UNDER' ? 'UNDER' : 'OVER';
            const searchDigit = Math.max(0, Math.min(9, Math.floor(Number(searchNumber))));
            const baseStake = Number(initialStake);
            const multiplier = Number(martingaleMultiplier);

            if (!Number.isFinite(baseStake) || baseStake <= 0) {
                throw new Error('XVT initial stake must be greater than 0.');
            }
            if (!Number.isFinite(multiplier) || multiplier < 1) {
                throw new Error('XVT Martingale multiplier must be at least 1.');
            }

            if (!this.xvtState || this.xvtState.direction !== normalizedDirection) {
                this.xvtState = {
                    direction: normalizedDirection,
                    initialStake: baseStake,
                    multiplier,
                    currentStake: baseStake,
                    recovery: false,
                    lastProcessedContractId: null,
                    stopped: false,
                    targetProfit: Math.max(0, Number(targetProfit) || 0),
                    targetLoss: Math.max(0, Number(targetLoss) || 0),
                };
            } else {
                this.xvtState.initialStake = baseStake;
                this.xvtState.multiplier = multiplier;
                this.xvtState.targetProfit = Math.max(0, Number(targetProfit) || 0);
                this.xvtState.targetLoss = Math.max(0, Number(targetLoss) || 0);
            }

            const state = this.xvtState;
            const previousContract = this.data?.contract;
            const previousContractId = previousContract?.contract_id;

            if (
                previousContractId &&
                previousContractId !== state.lastProcessedContractId &&
                previousContract?.status !== 'open' &&
                previousContract?.is_sold
            ) {
                const profit = Number(previousContract.sell_price) - Number(previousContract.buy_price);
                state.lastProcessedContractId = previousContractId;

                if (profit > 0) {
                    state.currentStake = state.initialStake;
                    state.recovery = false;
                } else if (profit < 0) {
                    state.currentStake = Number(
                        (state.currentStake * state.multiplier).toFixed(8)
                    );
                    state.recovery = true;
                }
            }

            const sessionProfit = Number(this.sessionProfit || 0);
            if (
                (state.targetProfit > 0 && sessionProfit >= state.targetProfit) ||
                (state.targetLoss > 0 && sessionProfit <= -state.targetLoss)
            ) {
                state.stopped = true;
                return false;
            }

            if (state.stopped) return false;

            const lastDigit = Number(await this.getLastDigit());
            if (lastDigit !== searchDigit) return false;

            const barrier = normalizedDirection === 'OVER'
                ? (state.recovery ? 3 : 2)
                : (state.recovery ? 6 : 7);

            const digits = await this.getLastDigitList(100);
            if (!Array.isArray(digits) || digits.length < 100) return false;

            const favourable = digits.filter(digit =>
                normalizedDirection === 'OVER'
                    ? Number(digit) > barrier
                    : Number(digit) < barrier
            ).length;

            if ((favourable / digits.length) * 100 < 75) return false;

            state.prediction = barrier;
            state.searchNumber = searchDigit;
            state.lastPrediction = barrier;
            globalObserver.emit('xvt.prediction', {
                direction: normalizedDirection,
                barrier,
                searchNumber: searchDigit,
                recovery: state.recovery,
                stake: state.currentStake,
                sessionProfit,
            });

            this.start({
                duration: Number(duration),
                duration_unit: String(durationUnit || 't'),
                currency: this.options?.currency || this.accountInfo?.currency || 'USD',
                amount: state.currentStake,
                prediction: barrier,
                basis: 'stake',
                contractTypes: [normalizedDirection === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER'],
            });

            return true;
        }

        getXvtPrediction() {
            return this.xvtState?.lastPrediction ?? null;
        }

        getXvtStopRequested() {
            return Boolean(this.xvtState?.stopped);
        }

        async getXvtMomentumReady(direction = 'OVER', recovery = false) {
            const digits = await this.getLastDigitList(100);
            if (!Array.isArray(digits) || digits.length < 100) return false;

            const isOver = String(direction).toUpperCase() === 'OVER';
            const barrier = isOver
                ? (recovery ? 3 : 2)
                : (recovery ? 6 : 7);
            const favourable = digits.filter(digit =>
                isOver ? Number(digit) > barrier : Number(digit) < barrier
            ).length;

            return (favourable / digits.length) * 100 >= 75;
        }

        getLastDigitsFromList(ticks) {
            const digits = ticks.map(tick => {
                return getLastDigit(tick.toFixed(this.getPipSize()));
            });
            return digits;
        }

        checkDirection(dir) {
            return new Promise(resolve =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol })
                    .then(ticks => resolve(getDirection(ticks) === dir))
            );
        }

        getOhlc(args) {
            const { granularity = this.options.candleInterval || 60, field } = args || {};

            return new Promise(resolve =>
                this.$scope.ticksService
                    .request({ symbol: this.symbol, granularity })
                    .then(ohlc => resolve(field ? ohlc.map(o => o[field]) : ohlc))
            );
        }

        getOhlcFromEnd(args) {
            const { index: i = 1 } = args || {};

            const index = expectPositiveInteger(Number(i), localize('Index must be a positive integer'));

            return new Promise(resolve => this.getOhlc(args).then(ohlc => resolve(ohlc.slice(-index)[0])));
        }

        getPipSize() {
            return this.$scope.ticksService.pipSizes[this.symbol];
        }

        async requestAccumulatorStats() {
            const subscription_id = this.subscription_id_for_accumulators;
            const is_proposal_requested = this.is_proposal_requested_for_accumulators;
            const proposal_request = {
                ...window.Blockly.accumulators_request,
                amount: this?.tradeOptions?.amount,
                basis: this?.tradeOptions?.basis,
                contract_type: 'ACCU',
                currency: this?.tradeOptions?.currency,
                growth_rate: this?.tradeOptions?.growth_rate,
                proposal: 1,
                subscribe: 1,
                underlying_symbol: this?.tradeOptions?.symbol,
            };
            if (!subscription_id && !is_proposal_requested) {
                this.is_proposal_requested_for_accumulators = true;
                if (proposal_request) {
                    await api_base?.api?.send(proposal_request);
                }
            }
        }

        async handleOnMessageForAccumulators() {
            let ticks_stayed_in_list = [];
            return new Promise(resolve => {
                const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                    if (data.msg_type === 'proposal') {
                        try {
                            this.subscription_id_for_accumulators = data.subscription.id;
                            // this was done because we can multile arrays in the respone and the list comes in reverse order
                            const stat_list = (data.proposal.contract_details.ticks_stayed_in || []).flat().reverse();
                            ticks_stayed_in_list = [...stat_list, ...ticks_stayed_in_list];
                            if (ticks_stayed_in_list.length > 0) resolve(ticks_stayed_in_list);
                        } catch (error) {
                            globalObserver.emit('Unexpected message type or no proposal found:', error);
                        }
                    }
                });
                api_base.pushSubscription(subscription);
            });
        }

        async fetchStatsForAccumulators() {
            try {
                // request stats for accumulators
                const debouncedAccumulatorsRequest = debounce(() => this.requestAccumulatorStats(), 300);
                debouncedAccumulatorsRequest();
                // wait for proposal response
                const ticks_stayed_in_list = await this.handleOnMessageForAccumulators();
                return ticks_stayed_in_list;
            } catch (error) {
                globalObserver.emit('Error in subscription promise:', error);
                throw error;
            } finally {
                // forget all proposal subscriptions so we can fetch new stats data on new call
                await api_base?.api?.send({ forget_all: 'proposal' });
                this.is_proposal_requested_for_accumulators = false;
                this.subscription_id_for_accumulators = null;
            }
        }

        async getCurrentStat() {
            try {
                const ticks_stayed_in = await this.fetchStatsForAccumulators();
                return ticks_stayed_in?.[0];
            } catch (error) {
                globalObserver.emit('Error fetching current stat:', error);
            }
        }

        async getStatList() {
            try {
                const ticks_stayed_in = await this.fetchStatsForAccumulators();
                // we need to send only lastest 100 ticks
                return ticks_stayed_in?.slice(0, 100);
            } catch (error) {
                globalObserver.emit('Error fetching current stat:', error);
            }
        }

        async getDelayTickValue(tick_value) {
            return new Promise((resolve, reject) => {
                try {
                    const ticks = [];
                    const symbol = this.symbol;

                    const resolveAndExit = () => {
                        this.$scope.ticksService.stopMonitor({
                            symbol,
                            key: '',
                        });
                        resolve(ticks);
                        ticks.length = 0;
                    };

                    const watchTicks = tick_list => {
                        ticks.push(tick_list);
                        const current_tick = ticks.length;
                        if (current_tick === tick_value) {
                            resolveAndExit();
                        }
                    };

                    const delayExecution = tick_list => watchTicks(tick_list);

                    if (Number(tick_value) <= 0) resolveAndExit();
                    this.$scope.ticksService.monitor({ symbol, callback: delayExecution });
                } catch (error) {
                    reject(new Error(`Failed to start tick monitoring: ${error.message}`));
                }
            });
        }
    };
