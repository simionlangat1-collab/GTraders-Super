import React, { useMemo } from 'react';
import classNames from 'classnames';
import { Field, FieldProps, useFormikContext } from 'formik';
import Autocomplete from '@/components/shared_ui/autocomplete';
import { TItem } from '@/components/shared_ui/dropdown-list';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { TFormData } from '../types';

type TSellConditionsProps = {
attached?: boolean;
};

const SellConditions: React.FC<TSellConditionsProps> = ({ attached }) => {
const { quick_strategy } = useStore();
const { setValue } = quick_strategy;
const { setFieldValue, values } = useFormikContext<TFormData>();

const list_options = useMemo(
    () => [
        {
            text: localize('Take Profit'),
            value: 'take_profit',
        },
        {
            text: localize('Tick Count'),
            value: 'tick_count',
        },
    ],
    []
);

const selected_value = values.boolean_tick_count
    ? 'tick_count'
    : 'take_profit';

const selected_option =
    list_options.find(option => option.value === selected_value) ??
    list_options[0];

const handleItemSelection = (item: TItem) => {
    const selected = list_options.find(
        option => option.value === item?.value
    );

    if (!selected) return;

    const is_tick_count = selected.value === 'tick_count';

    setValue('boolean_tick_count', is_tick_count);
    void setFieldValue('boolean_tick_count', is_tick_count, true);
};

return (
    <div
        className={classNames('qs__form__field qs__form__field__input', {
            'no-top-border-radius': attached,
        })}
    >
        <Field
            name='sell_conditions'
            key='sell_conditions'
            id='sell_conditions'
        >
            {({ field }: FieldProps) => (
                <Autocomplete
                    {...field}
                    readOnly
                    data-testid='dt_qs_sell_conditions'
                    autoComplete='off'
                    className='qs__select'
                    value={selected_option.text}
                    list_items={list_options}
                    onItemSelection={handleItemSelection}
                />
            )}
        </Field>
    </div>
);

};

export default SellConditions;
