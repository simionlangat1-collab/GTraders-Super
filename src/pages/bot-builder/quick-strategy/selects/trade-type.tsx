import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Field, FieldProps, useFormikContext } from 'formik';
import Autocomplete from '@/components/shared_ui/autocomplete';
import { TItem } from '@/components/shared_ui/dropdown-list';
import Text from '@/components/shared_ui/text';
import { TradeTypeIcon } from '@/components/trade-type/trade-type-icon';
import { ApiHelpers } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { TFormData, TTradeType } from '../types';
import { V2_QS_STRATEGIES } from '../utils';

type TTradeTypeOption = {
trade_type: TTradeType;
};

type TContractsForHelper = {
getTradeTypesForQuickStrategy?: (
symbol: string,
accumulator?: string
) => Promise<TTradeType[] | undefined>;
};

const TradeTypeOption: React.FC<TTradeTypeOption> = ({
trade_type: { value, icon, text },
}) => (
<div className='qs__select__option'>
{icon?.length
? icon.map((ic, idx) => (
<TradeTypeIcon
type={ic}
className='qs__select__option__icon'
key={"${ic}-id-${idx}"}
size='sm'
/>
))
: null}

    <Text
        className='qs__select__option__text'
        size='xs'
        color='prominent'
    >
        {text}
    </Text>
</div>

);

const TradeTypeSelect: React.FC = () => {
const [trade_types, setTradeTypes] = useState<TTradeType[]>([]);
const requestSequence = useRef(0);

const { setFieldValue, values } = useFormikContext<TFormData>();

const { quick_strategy } = useStore();
const { setValue, selected_strategy } = quick_strategy;

const is_strategy_accumulator =
    V2_QS_STRATEGIES.includes(selected_strategy);

useEffect(() => {
    let isActive = true;
    const sequence = ++requestSequence.current;

    const loadTradeTypes = async () => {
        const symbol = String(values?.symbol ?? '');

        if (!symbol) {
            setTradeTypes([]);
            setFieldValue('tradetype', '');
            setValue('tradetype', '');
            return;
        }

        try {
            const helpers = ApiHelpers?.instance as unknown as {
                contracts_for?: TContractsForHelper;
            };

            const getTradeTypes =
                helpers?.contracts_for?.getTradeTypesForQuickStrategy;

            if (!getTradeTypes) {
                if (isActive && sequence === requestSequence.current) {
                    setTradeTypes([]);
                }
                return;
            }

            // Call through contracts_for to preserve the helper's context.
            const result = await helpers.contracts_for!.getTradeTypesForQuickStrategy!(
                symbol,
                is_strategy_accumulator ? 'ACCU' : ''
            );

            if (!isActive || sequence !== requestSequence.current) return;

            const available_trade_types = Array.isArray(result)
                ? result.filter(item => item?.value)
                : [];

            setTradeTypes(available_trade_types);

            const current_value = String(values?.tradetype ?? '');

            const selection_is_valid = available_trade_types.some(
                item => item.value === current_value
            );

            if (!selection_is_valid) {
                const first_trade_type =
                    available_trade_types[0]?.value ?? '';

                setFieldValue('tradetype', first_trade_type);
                setValue('tradetype', first_trade_type);
            }
        } catch (error) {
            if (!isActive || sequence !== requestSequence.current) return;

            console.error(
                'GTraders Super: Failed to load trade types:',
                error
            );

            setTradeTypes([]);
            setFieldValue('tradetype', '');
            setValue('tradetype', '');
        }
    };

    void loadTradeTypes();

    return () => {
        isActive = false;
        if (requestSequence.current === sequence) {
            requestSequence.current += 1;
        }
    };
}, [
    values?.symbol,
    is_strategy_accumulator,
    setFieldValue,
    setValue,
]);

const trade_type_dropdown_options = useMemo(
    () =>
        trade_types.map(trade_type => ({
            component: (
                <TradeTypeOption
                    key={trade_type.value}
                    trade_type={trade_type}
                />
            ),
            ...trade_type,
        })),
    [trade_types]
);

return (
    <div className='qs__form__field qs__form__field__input qs__form__field__group-icons'>
        <Field name='tradetype' key='tradetype' id='tradetype'>
            {({ field }: FieldProps) => {
                const selected_trade_type =
                    trade_type_dropdown_options.find(
                        item => item.value === field.value
                    );

                const display_value = is_strategy_accumulator
                    ? 'Buy'
                    : selected_trade_type?.text ?? '';

                return (
                    <Autocomplete
                        {...field}
                        readOnly
                        inputMode='none'
                        data-testid='dt_qs_tradetype'
                        autoComplete='off'
                        className='qs__autocomplete'
                        value={display_value}
                        list_items={trade_type_dropdown_options}
                        onItemSelection={(item: TItem) => {
                            const selected = item as TTradeType;

                            if (!selected?.value) return;

                            setFieldValue('tradetype', selected.value);
                            setValue('tradetype', selected.value);
                        }}
                        leading_icon={
                            <Text>
                                <TradeTypeIcon
                                    type={
                                        selected_trade_type?.icon?.[0] ||
                                        'CALL'
                                    }
                                    size='sm'
                                />

                                <TradeTypeIcon
                                    type={
                                        selected_trade_type?.icon?.[1] ||
                                        'PUT'
                                    }
                                    size='sm'
                                />
                            </Text>
                        }
                    />
                );
            }}
        </Field>
    </div>
);

};

export default TradeTypeSelect;
