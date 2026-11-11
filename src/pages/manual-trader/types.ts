export type ManualContractType =
    | 'DIGITOVER'
    | 'DIGITUNDER'
    | 'DIGITMATCH'
    | 'DIGITDIFF'
    | 'DIGITEVEN'
    | 'DIGITODD';

export type ManualMarketSymbol = {
    symbol: string;
    display_name: string;
    market: string;
    exchange_is_open?: boolean;
    is_trading_suspended?: boolean;
};

export type ManualTradeRecord = {
    contract_id: number;
    contract_type: ManualContractType;
    symbol: string;
    symbol_name: string;
    buy_price: number;
    payout: number;
    currency: string;
    status: 'open' | 'won' | 'lost' | 'sold';
    profit?: number;
    entry_tick?: string | number;
    exit_tick?: string | number;
    purchase_time: number;
};