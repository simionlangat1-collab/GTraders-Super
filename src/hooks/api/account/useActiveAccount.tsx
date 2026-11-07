import { useMemo } from 'react';
/* [AI] - Analytics removed - utility functions moved to @/utils/account-helpers */
import { isVirtualAccount } from '@/utils/account-helpers';
/* [/AI] */
import { CurrencyIcon } from '@/components/currency/currency-icon';
import { addComma, getDecimalPlaces } from '@/components/shared';
import { useApiBase } from '@/hooks/useApiBase';
import { Balance } from '@deriv/api-types';

/** A custom hook that returns the account object for the current active account. */
const useActiveAccount = ({
    allBalanceData,
    directBalance,
}: {
    allBalanceData: Balance | null;
    directBalance?: string;
}) => {
    const { accountList, activeLoginid } = useApiBase();

    const activeAccount = useMemo(
        () => accountList?.find(account => account.loginid === activeLoginid),
        [activeLoginid, accountList]
    );

    const currentBalanceData = allBalanceData?.accounts?.[activeAccount?.loginid ?? ''];

    const modifiedAccount = useMemo(() => {
        if (!activeAccount) return undefined;

        // Use centralized utility to determine if demo account
        const isVirtual = isVirtualAccount(activeAccount.loginid);
        const directBalanceValue = directBalance === undefined || directBalance.trim() === '' ? NaN : Number(directBalance);
        const balanceValue =
            typeof currentBalanceData?.balance === 'number'
                ? currentBalanceData.balance
                : Number.isFinite(directBalanceValue)
                  ? directBalanceValue
                  : activeAccount.balance;
        const formattedBalance =
            typeof balanceValue === 'number' && Number.isFinite(balanceValue)
                ? addComma(balanceValue.toFixed(getDecimalPlaces(activeAccount.currency)))
                : typeof balanceValue === 'string' &&
                    balanceValue.trim() !== '' &&
                    Number.isFinite(Number(balanceValue))
                  ? addComma(Number(balanceValue).toFixed(getDecimalPlaces(activeAccount.currency)))
                  : undefined;

        return {
            ...activeAccount,
            balance: formattedBalance,
            currencyLabel: isVirtual ? 'Demo' : activeAccount?.currency,
            icon: <CurrencyIcon currency={activeAccount?.currency?.toLowerCase()} isVirtual={isVirtual} />,
            isVirtual: isVirtual,
            isActive: activeAccount?.loginid === activeLoginid,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeAccount, activeLoginid, allBalanceData, directBalance]);

    return {
        /** User's current active account. */
        data: modifiedAccount,
    };
};

export default useActiveAccount;
