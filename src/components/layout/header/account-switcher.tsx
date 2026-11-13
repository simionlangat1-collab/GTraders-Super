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
import './account-switcher.scss';

const AccountSwitcher = observer(({ activeAccount }: TAccountSwitcher) => {
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { accountList, activeLoginid } = useApiBase();
    const { client, run_panel } = useStore() ?? {};

    const is_bot_running = run_panel?.is_running || api_base.is_running;
    const isSingleAccount = !accountList || accountList.length <= 1;

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

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

    // Keep one selectable account for each account type, preferring the active one.
    const realAccount = formattedAccounts.find(account => !account.isVirtual);
    const demoAccount = formattedAccounts.find(account => account.isVirtual);

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
                    aria-haspopup={showChevron ? 'listbox' : undefined}
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
                    <div className='acc-info__content'>
                        <div className='acc-info__account-type-header'>
                            <span className='acc-info__flag' role='img' aria-label='United States flag'>🇺🇸</span>
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
                                        `${balance} ${getCurrencyDisplayCode(currency)}`
                                    )}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </AccountInfoWrapper>
            {isOpen && (
                <div className='acc-switcher-modal-overlay' onClick={() => setIsOpen(false)}>
                    <div
                        className='acc-switcher-modal'
                        role='dialog'
                        aria-modal='true'
                        aria-label='Switch Deriv account'
                        onClick={e => e.stopPropagation()}
                    >
                        <div className='acc-switcher-modal__header'>
                            <div className='acc-switcher-modal__title'>SWITCH ACCOUNT</div>
                            <button
                                type='button'
                                className='acc-switcher-modal__close'
                                aria-label='Close account switcher'
                                onClick={() => setIsOpen(false)}
                            >
                                ×
                            </button>
                        </div>
                        <div className='acc-switcher-modal__accounts' role='listbox' aria-label='Available accounts'>
                            {realAccount && (
                                <div
                                    key={realAccount.loginid}
                                    role='option'
                                    aria-selected={realAccount.isActive}
                                    tabIndex={0}
                                    className={classNames('acc-switcher-modal__account', {
                                        'acc-switcher-modal__account--selected': realAccount.isActive,
                                    })}
                                    onClick={() => !realAccount.isActive && handleAccountSelect(realAccount.loginid)}
                                    onKeyDown={e => {
                                        if (!realAccount.isActive && (e.key === 'Enter' || e.key === ' ')) {
                                            e.preventDefault();
                                            handleAccountSelect(realAccount.loginid);
                                        }
                                    }}
                                >
                                    <span className='acc-switcher-modal__account-type'>REAL</span>
                                    <span className='acc-switcher-modal__account-label'>Deriv account</span>
                                    <span className='acc-switcher-modal__balance'>
                                        {realAccount.currency
                                            ? `${realAccount.balance} ${getCurrencyDisplayCode(realAccount.currency)}`
                                            : 'No currency assigned'}
                                    </span>
                                    {realAccount.isActive && (
                                        <span className='acc-switcher-modal__selected-label'>SELECTED</span>
                                    )}
                                </div>
                            )}
                            {demoAccount && (
                                <div
                                    key={demoAccount.loginid}
                                    role='option'
                                    aria-selected={demoAccount.isActive}
                                    tabIndex={0}
                                    className={classNames('acc-switcher-modal__account', {
                                        'acc-switcher-modal__account--selected': demoAccount.isActive,
                                        'acc-switcher-modal__account--demo': true,
                                    })}
                                    onClick={() => !demoAccount.isActive && handleAccountSelect(demoAccount.loginid)}
                                    onKeyDown={e => {
                                        if (!demoAccount.isActive && (e.key === 'Enter' || e.key === ' ')) {
                                            e.preventDefault();
                                            handleAccountSelect(demoAccount.loginid);
                                        }
                                    }}
                                >
                                    <span className='acc-switcher-modal__account-type'>DEMO</span>
                                    <span className='acc-switcher-modal__account-label'>Deriv account</span>
                                    <span className='acc-switcher-modal__balance'>
                                        {demoAccount.currency
                                            ? `${demoAccount.balance} ${getCurrencyDisplayCode(demoAccount.currency)}`
                                            : 'No currency assigned'}
                                    </span>
                                    {demoAccount.isActive && (
                                        <span className='acc-switcher-modal__selected-label'>SELECTED</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default AccountSwitcher;
