import { getFormattedText } from '@/components/shared';
import DBotStore from '../../../scratch/dbot-store';
import { api_base } from '../../api/api-base';
import { setAccountList as publishAccountList } from '../../api/observables/connection-status-stream';
import { info } from '../utils/broadcast';

let balance_string = '';

export default Engine =>
    class Balance extends Engine {
        observeBalance() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data?.msg_type !== 'balance' || !data?.balance) return;

                const { balance: currentBalance, currency, loginid } = data.balance;
                if (typeof currentBalance !== 'number' || !loginid) return;

                balance_string = getFormattedText(currentBalance, currency);

                // Keep the selected account's MobX balance and the account-switcher
                // observable in sync with Deriv's authoritative balance response.
                const client = DBotStore.instance?.client;
                if (client) {
                    if (client.loginid === loginid) {
                        client.setBalance(String(currentBalance));
                        if (currency) client.setCurrency(currency);
                    }

                    const currentAccounts = client.account_list ?? [];
                    const accountExists = currentAccounts.some(account => account.loginid === loginid);
                    if (accountExists) {
                        const updatedAccounts = currentAccounts.map(account =>
                            account.loginid === loginid
                                ? { ...account, balance: currentBalance, currency: currency || account.currency }
                                : account
                        );
                        client.setAccountList(updatedAccounts);
                        publishAccountList(updatedAccounts);
                    }
                }

                if (this.accountInfo?.loginid === loginid) {
                    info({ accountID: loginid, balance: balance_string });
                }
            });
            api_base.pushSubscription(subscription);
        }

        // eslint-disable-next-line class-methods-use-this
        getBalance(type) {
            const { client } = DBotStore.instance;
            const balance = (client && client.balance) || 0;

            balance_string = getFormattedText(balance, client.currency, false);
            return type === 'STR' ? balance_string : balance;
        }
    };
