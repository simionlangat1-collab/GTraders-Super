
import React, { useEffect, useMemo, useState } from 'react';
import { Field, FieldProps, useFormikContext } from 'formik';
import { MarketIcon } from '@/components/market/market-icon';
import Autocomplete from '@/components/shared_ui/autocomplete';
import { TItem } from '@/components/shared_ui/dropdown-list';
import Text from '@/components/shared_ui/text';
import { ApiHelpers } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { useDevice } from '@deriv-com/ui';
import { TFormData } from '../types';
import { V2_QS_STRATEGIES } from '../utils';

type TSymbol = {
    component?: React.ReactNode;
    text: string;
    value: string;
    group?: string;
    submarket?: string;
};

type TMarketOption = {
    symbol: TSymbol;
};

const MarketOption: React.FC<TMarketOption> = ({ symbol }) => (
    <div key={symbol.value} className='qs__select__option'>
        <MarketIcon type={symbol.value} size='sm' />
        <Text className='qs__select__option__text' size='xs' color='prominent'>
            {symbol.text}
        </Text>
    </div>
);

const SymbolSelect: React.FC = () => {
    const { quick_strategy } = useStore();
    const { isDesktop } = useDevice();
    const { setValue, selected_strategy } = quick_strategy;

    const [active_symbols, setActiveSymbols] = useState<TSymbol[]>([]);
    const [is_input_started, setIsInputStarted] = useState(false);
    const [input_value, setInputValue] = useState({
        text: '',
        value: '',
    });
    const [last_selected_symbol, setLastSelectedSymbol] = useState({
        text: '',
        value: '',
    });

    const { setFieldValue, values } = useFormikContext<TFormData>();

    const is_strategy_accumulator =
        V2_QS_STRATEGIES.includes(selected_strategy);

    const symbols = useMemo(
        () =>
            active_symbols
                .filter(
                    symbol =>
                        !is_strategy_accumulator ||
                        symbol.submarket === 'random_index'
                )
                .map(symbol => ({
                    component: (
                        <MarketOption
                            key={symbol.value}
                            symbol={symbol}
                        />
                    ),
                    ...symbol,
                })),
        [active_symbols, is_strategy_accumulator]
    );

    useEffect(() => {
        let isMounted = true;

        const loadSymbols = () => {
            const helpers = ApiHelpers?.instance as unknown as {
                active_symbols?: {
                    getSymbolsForBot?: () => TSymbol[];
                };
            };

            const available_symbols =
                helpers?.active_symbols?.getSymbolsForBot?.() ?? [];

            if (!isMounted) return;

            setActiveSymbols(available_symbols);

            const available_for_strategy = available_symbols.filter(
                symbol =>
                    !is_strategy_accumulator ||
                    symbol.submarket === 'random_index'
            );

            const has_symbol = available_for_strategy.some(
                symbol => symbol.value === values?.symbol
            );

            if (!has_symbol && available_for_strategy.length > 0) {
                const first_symbol = available_for_strategy[0];

                setFieldValue('symbol', first_symbol.value);
                setValue('symbol', first_symbol.value);
            }
        };

        loadSymbols();

        return () => {
            isMounted = false;
        };
    }, [
        is_strategy_accumulator,
        setFieldValue,
        setValue,
        values?.symbol,
    ]);

    useEffect(() => {
        const selected_symbol = symbols.find(
            symbol => symbol.value === values.symbol
        );

        if (selected_symbol) {
            setInputValue({
                text: selected_symbol.text,
                value: selected_symbol.value,
            });

            setLastSelectedSymbol({
                text: selected_symbol.text,
                value: selected_symbol.value,
            });
        }
    }, [symbols, values.symbol]);

    const handleFocus = () => {
        if (isDesktop && !is_input_started) {
            setIsInputStarted(true);
        }
    };

    const handleInputChange = (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        setInputValue({
            ...input_value,
            text: event.target.value,
        });
    };

    const handleItemSelection = (item: TItem) => {
        if (!item?.value) return;

        const selected = item as TSymbol;

        setFieldValue('symbol', selected.value);
        setValue('symbol', selected.value);

        setInputValue({
            text: selected.text,
            value: selected.value,
        });

        setLastSelectedSymbol({
            text: selected.text,
            value: selected.value,
        });

        setIsInputStarted(false);
    };

    const handleHideDropdownList = () => {
        if (!isDesktop) return;

        const selected_symbol = symbols.find(
            symbol => symbol.value === values.symbol
        );

        if (selected_symbol) {
            setInputValue({
                text: selected_symbol.text,
                value: selected_symbol.value,
            });

            setLastSelectedSymbol({
                text: selected_symbol.text,
                value: selected_symbol.value,
            });
        } else {
            setInputValue({
                text: last_selected_symbol.text,
                value: last_selected_symbol.value,
            });
        }

        setIsInputStarted(false);
    };

    return (
        <div className='qs__form__field qs__form__field__input'>
            <Field name='symbol' key='asset' id='asset'>
                {({ field: { ...rest_field } }: FieldProps) => (
                    <Autocomplete
                        {...rest_field}
                        readOnly={!isDesktop}
                        inputMode='none'
                        data-testid='dt_qs_symbol'
                        autoComplete='off'
                        className='qs__autocomplete'
                        value={input_value.text}
                        list_items={symbols}
                        onItemSelection={handleItemSelection}
                        onChange={handleInputChange}
                        onFocus={handleFocus}
                        onHideDropdownList={handleHideDropdownList}
                        leading_icon={
                            <MarketIcon
                                type={input_value.value}
                                size='sm'
                            />
                        }
                    />
                )}
            </Field>
        </div>
    );
};

export default SymbolSelect;
