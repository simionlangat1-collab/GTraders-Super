import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { addComma, getCurrencyDisplayCode, getDecimalPlaces } from '@/components/shared';
import Text from '@/components/shared_ui/text';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { isDemoAccount } from '@/utils/account-helpers';
import { Localize } from '@deriv-com/translations';
import { TAccountSwitcher } from './common/types';
import AccountInfoWrapper from './account-info-wrapper';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import brandConfig from '../../../../brand.config.json';
import { isProduction } from '@/components/shared';
import { setAccountList } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import './account-switcher.scss';

const AccountSwitcher = observer(({ activeAccount }: TAccountSwitcher) => {
    const [isOpen, setIsOpen] = useState(false);
    const [resettingAccount, setResettingAccount] = useState<string | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { accountList, activeLoginid } = useApiBase();
    const { client, run_panel } = useStore() ?? {};

    const is_bot_running = run_panel?.is_running || api_base.is_running;
    const isSingleAccount = !accountList || accountList.length <= 1;

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isOpen]);

    const toggleDropdown = useCallback(() => {
        if (is_bot_running || isSingleAccount) return;
        setIsOpen(prev => !prev);
    }, [is_bot_running, isSingleAccount]);

    const handleAccountSelect = useCallback(
        (loginid: string) => {
            localStorage.setItem('active_loginid', loginid);
            client?.checkAndRegenerateWebSocket();
            setIsOpen(false);
        },
        [client]
    );

    const handleResetDemoBalance = useCallback(
        async (loginid: string) => {
            if (resettingAccount || is_bot_running) return;
            const confirmed = window.confirm('Reset this demo account balance to 10,000 USD?');
            if (!confirmed) return;

            setResettingAccount(loginid);
            try {
                const accessToken = OAuthTokenExchangeService.getAccessToken();
                if (typeof accessToken !== 'string' || !accessToken) {
                    throw new Error('Your Deriv session token could not be found. Please log in again.');
                }

                const environment = isProduction() ? 'production' : 'staging';
                const baseURL = brandConfig.platform.derivws.url[environment];
                const optionsDir = brandConfig.platform.derivws.directories.options;
                const response = await fetch(
                    `${baseURL}${optionsDir}accounts/${encodeURIComponent(loginid)}/reset-demo-balance`,
                    {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${accessToken}` },
                    }
                );

                if (!response.ok) {
                    let message = 'Deriv could not reset this demo balance. Please try again.';
                    try {
                        const body = await response.json();
                        message = body?.errors?.[0]?.message || message;
                    } catch {
                        // Keep the friendly fallback message.
                    }
                    throw new Error(message);
                }

                const refreshedAccounts = await DerivWSAccountsService.fetchAccountsList(accessToken);
                const updatedList = refreshedAccounts
                    .filter(account => !account.status || account.status === 'active')
                    .map(account => ({
                        balance: Number(account.balance) || 0,
                        currency: account.currency || 'USD',
                        is_virtual: account.account_type === 'demo' ? 1 : 0,
                        loginid: account.account_id,
                    }));
                setAccountList(updatedList);
                localStorage.setItem('client_account_details', JSON.stringify(updatedList));
            } catch (error) {
                window.alert(error instanceof Error ? error.message : 'Unable to reset demo balance.');
            } finally {
                setResettingAccount(null);
            }
        },
        [is_bot_running, resettingAccount]
    );

    const formattedAccounts = useMemo(() => {
        if (!accountList) return [];
        return accountList
            .map(account => ({
                loginid: account.loginid,
                currency: account.currency,
                balance: addComma(Number(account.balance ?? 0).toFixed(getDecimalPlaces(account.currency))),
                isVirtual: isDemoAccount(account.loginid),
                isActive: account.loginid === activeLoginid,
            }))
            .sort((a, b) => (a.isActive ? -1 : b.isActive ? 1 : 0));
    }, [accountList, activeLoginid]);

    if (!activeAccount) return null;

    const { currency, isVirtual, balance } = activeAccount;
    const showChevron = !isSingleAccount && !is_bot_running;

    return (
        <div className='acc-info__wrapper' ref={wrapperRef}>
            <AccountInfoWrapper>
                <div
                    data-testid='dt_acc_info'
                    id='dt_core_account-info_acc-info'
                    role={showChevron ? 'button' : undefined}
                    tabIndex={showChevron ? 0 : -1}
                    aria-expanded={showChevron ? isOpen : undefined}
                    aria-haspopup={showChevron ? 'dialog' : undefined}
                    className={classNames('acc-info', {
                        'acc-info--is-virtual': isVirtual,
                        'acc-info--interactive': showChevron,
                    })}
                    onClick={toggleDropdown}
                    onKeyDown={e => {
                        if (showChevron && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            toggleDropdown();
                        }
                    }}
                >
                    <span className='acc-info__id' aria-hidden='true'></span>
                    <span className='acc-info__flag' role='img' aria-label='United States flag'>
                        🇺🇸
                    </span>
                    <div className='acc-info__content'>
                        <div className='acc-info__account-type-header'>
                            <Text as='p' size='xs' className='acc-info__account-type'>
                                {isVirtual ? (
                                    <Localize i18n_default_text='Demo account' />
                                ) : (
                                    <Localize i18n_default_text='Real account' />
                                )}
                            </Text>
                            {showChevron && (
                                <span
                                    className={classNames('acc-info__select-arrow', {
                                        'acc-info__select-arrow--invert': isOpen,
                                    })}
                                >
                                    <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
                                        <path
                                            d='M2 4L6 8L10 4'
                                            stroke='currentColor'
                                            strokeWidth='1.5'
                                            strokeLinecap='round'
                                            strokeLinejoin='round'
                                        />
                                    </svg>
                                </span>
                            )}
                        </div>
                        {(typeof balance !== 'undefined' || !currency) && (
                            <div className='acc-info__balance-section'>
                                <p
                                    data-testid='dt_balance'
                                    className={classNames('acc-info__balance', {
                                        'acc-info__balance--no-currency': !currency && !isVirtual,
                                    })}
                                >
                                    {!currency ? (
                                        <Localize i18n_default_text='No currency assigned' />
                                    ) : (
                                        balance + ' ' + getCurrencyDisplayCode(currency)
                                    )}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </AccountInfoWrapper>

            {isOpen && (
                <div
                    className='acc-modal'
                    role='dialog'
                    aria-modal='true'
                    aria-label='Switch account'
                    onMouseDown={e => {
                        if (e.target === e.currentTarget) setIsOpen(false);
                    }}
                >
                    <div className='acc-modal__card'>
                        <div className='acc-modal__header'>
                            <div>
                                <p className='acc-modal__eyebrow'>ACCOUNT</p>
                                <h2>Switch account</h2>
                            </div>
                            <button
                                type='button'
                                className='acc-modal__close'
                                aria-label='Close account switcher'
                                onClick={() => setIsOpen(false)}
                            >
                                ×
                            </button>
                        </div>

                        <div className='acc-modal__accounts'>
                            {formattedAccounts.map(account => (
                                <div
                                    key={account.loginid}
                                    role='option'
                                    aria-selected={account.isActive}
                                    tabIndex={0}
                                    className={classNames('acc-modal__account', {
                                        'acc-modal__account--selected': account.isActive,
                                        'acc-modal__account--virtual': account.isVirtual,
                                    })}
                                    onClick={() => !account.isActive && handleAccountSelect(account.loginid)}
                                    onKeyDown={e => {
                                        if (!account.isActive && (e.key === 'Enter' || e.key === ' ')) {
                                            e.preventDefault();
                                            handleAccountSelect(account.loginid);
                                        }
                                    }}
                                >
                                    <span className='acc-modal__flag' aria-hidden='true'>
                                        🇺🇸
                                    </span>
                                    <div className='acc-modal__account-info'>
                                        <span className='acc-modal__account-type'>
                                            {account.isVirtual ? 'Demo account' : 'Real account'}
                                        </span>
                                        <span className='acc-modal__balance'>
                                            {account.currency
                                                ? account.balance + ' ' + getCurrencyDisplayCode(account.currency)
                                                : 'No currency assigned'}
                                        </span>
                                    </div>
                                    {account.isVirtual && (
                                        <button
                                            type='button'
                                            className='acc-modal__reset'
                                            disabled={!!resettingAccount || is_bot_running}
                                            onClick={event => {
                                                event.stopPropagation();
                                                void handleResetDemoBalance(account.loginid);
                                            }}
                                        >
                                            {resettingAccount === account.loginid ? 'Resetting…' : 'Reset Balance'}
                                        </button>
                                    )}
                                    {account.isActive && <span className='acc-modal__check'>✓</span>}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default AccountSwitcher;
