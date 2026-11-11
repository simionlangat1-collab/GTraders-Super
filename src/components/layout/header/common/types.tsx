import useActiveAccount from '@/hooks/api/account/useActiveAccount';

export type TAccountSwitcher = {
    activeAccount: ReturnType<typeof useActiveAccount>['data'];
    balanceDisplayCurrency?: 'USD' | 'KES';
    usdKesRate?: number | null;
};
