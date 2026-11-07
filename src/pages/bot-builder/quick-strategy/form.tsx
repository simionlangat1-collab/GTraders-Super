/* eslint-disable no-unsafe-optional-chaining /
/ eslint-disable simple-import-sort/imports */
import React from 'react';
import { useStore } from '@/hooks/useStore';
import { observer } from 'mobx-react-lite';
import './quick-strategy.scss';
import SymbolSelect from './selects/symbol';
import TradeTypeSelect from './selects/trade-type';
import ContractTypeSelect from './selects/contract-type';
import DurationTypeSelect from './selects/duration-type';
import QSInput from './inputs/qs-input';
import QSCheckbox from './inputs/qs-toggle-switch';
import QSInputLabel from './inputs/qs-input-label';
import { STRATEGIES } from './config';
import { TConfigItem, TFormData, TShouldHave } from './types';
import { useFormikContext } from 'formik';
import { useDevice } from '@deriv-com/ui';
import { localize } from '@deriv-com/translations';
import GrowthRateSelect from './selects/growth-rate-type';
import SellConditions from './selects/sell-conditions';

const QuickStrategyForm = observer(() => {
const { quick_strategy } = useStore();
const { selected_strategy, setValue, form_data, is_gk_pioneer_mode } = quick_strategy;
const config: TConfigItem[][] =
STRATEGIES()[selected_strategy]?.fields ?? [];

const { isDesktop } = useDevice();
const { values, setFieldTouched, setFieldValue } =
    useFormikContext<TFormData>();

const { current_duration_min_max, additional_data } = quick_strategy;

const [isEnabledToggleSwitch, setIsEnabledToggleSwitch] =
    React.useState(values?.boolean_max_stake ?? false);

const handleEnter = React.useCallback((event: KeyboardEvent) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
    }
}, []);

React.useEffect(() => {
    window.addEventListener('keydown', handleEnter);

    let data: TFormData | null = null;

    try {
        data = JSON.parse(localStorage.getItem('qs-fields') ?? '{}');
    } catch {
        data = null;
    }

    setIsEnabledToggleSwitch(!!data?.boolean_max_stake);

    return () => {
        window.removeEventListener('keydown', handleEnter);
    };
}, [handleEnter]);

React.useEffect(() => {
    if (values?.boolean_max_stake !== undefined) {
        setIsEnabledToggleSwitch(!!values.boolean_max_stake);
    }
}, [values?.boolean_max_stake]);

React.useEffect(() => {
    if (!isEnabledToggleSwitch && values?.max_stake) {
        setFieldValue('max_stake', 0);
    }
}, [isEnabledToggleSwitch, values?.max_stake, setFieldValue]);

const onChange = async (
    key: string,
    value: string | number | boolean
) => {
    setValue(key, value);

    await setFieldTouched(key, true, true);
    await setFieldValue(key, value, true);

    if (key === 'stake' || key === 'max_stake') {
        void setFieldTouched('stake', true, true);
        void setFieldTouched('max_stake', true, true);

        const target_name =
            key === 'stake' ? 'max_stake' : 'stake';

        const input_element = document.querySelector(
            `input[name="${target_name}"]`
        );

        if (input_element) {
            input_element.dispatchEvent(
                new Event('keyup', { bubbles: true })
            );
        }
    }
};

const shouldEnable = (should_have: TShouldHave[]) =>
    should_have.every(item => {
        const item_value = values?.[item.key]?.toString();

        if (item.multiple) {
            return item.multiple.includes(item_value ?? '');
        }

        return values[item.key as keyof TFormData] === item.value;
    });

const toggleSwitch = () => {
    setIsEnabledToggleSwitch(previous => !previous);
};

const renderForm = () =>
    config.map((group, group_index) => {
        if (!group?.length) return null;

        return (
            <div
                className='qs__body__content__form__group'
                key={group_index}
            >
                {group.map((field, field_index) => {
                    const key = `${field.name || field.type} + ${field_index}`;

                    if (
                        (!isDesktop && field.hide?.includes('mobile')) ||
                        (isDesktop && field.hide?.includes('desktop'))
                    ) {
                        return null;
                    }

                    switch (field.type) {
                        case 'number': {
                            if (!field.name) return null;

                            const {
                                should_have = [],
                                hide_without_should_have = false,
                                has_currency_unit = false,
                            } = field;

                            const should_enable =
                                shouldEnable(should_have);

                            const initial_stake = 1;
                            let min = 1;
                            let max: number | undefined;

                            if (
                                field.name === 'duration' &&
                                current_duration_min_max
                            ) {
                                min = current_duration_min_max.min;
                                max = current_duration_min_max.max;
                            }

                            if (
                                field.should_have &&
                                field.name === 'max_stake'
                            ) {
                                min = Number(form_data?.stake);

                                if (isNaN(min)) {
                                    min = initial_stake;
                                }
                            }

                            if (
                                field.should_have &&
                                field.name === 'last_digit_prediction'
                            ) {
                                const prediction = Number(
                                    form_data?.last_digit_prediction
                                );

                                if (
                                    isNaN(prediction) ||
                                    prediction === 1
                                ) {
                                    min = 0;
                                }

                                if (prediction > 0) {
                                    min = prediction - 1;
                                }

                                max = 9;
                            }

                            if (should_have.length) {
                                if (
                                    !should_enable &&
                                    (!isDesktop || hide_without_should_have)
                                ) {
                                    return null;
                                }

                                return (
                                    <QSInput
                                        {...field}
                                        key={key}
                                        name={field.name}
                                        disabled={!should_enable}
                                        onChange={onChange}
                                        min={min}
                                        max={max}
                                        has_currency_unit={has_currency_unit}
                                        step={field.step}
                                    />
                                );
                            }

                            return (
                                <QSInput
                                    {...field}
                                    key={key}
                                    name={field.name}
                                    onChange={onChange}
                                    min={min}
                                    max={max}
                                    has_currency_unit={has_currency_unit}
                                    step={field.step}
                                />
                            );
                        }

                        case 'label': {
                            if (!field.label) return null;

                            const {
                                should_have = [],
                                hide_without_should_have = false,
                            } = field;

                            const should_enable =
                                shouldEnable(should_have);

                            if (
                                !should_enable &&
                                hide_without_should_have
                            ) {
                                return null;
                            }

                            return (
                                <QSInputLabel
                                    key={key}
                                    label={
                                        is_gk_pioneer_mode && selected_strategy === 'MARTINGALE' && field.label === localize('Size')
                                            ? localize('Martingale Multiplier')
                                            : field.label
                                    }
                                    description={
                                        field.description
                                            ? typeof field.description ===
                                              'function'
                                                ? () => {
                                                      const descriptionFn =
                                                          field.description as (
                                                              additional_data?: Record<
                                                                  string,
                                                                  unknown
                                                              >
                                                          ) => React.ReactNode;

                                                      return descriptionFn(
                                                          additional_data
                                                      );
                                                  }
                                                : String(
                                                      field.description || ''
                                                  )
                                            : ''
                                    }
                                    additional_data={additional_data}
                                />
                            );
                        }

                        case 'checkbox':
                            return (
                                <QSCheckbox
                                    key={key}
                                    name={field.name as string}
                                    label={field.label as string}
                                    description={
                                        field.description
                                            ? String(field.description)
                                            : undefined
                                    }
                                    isEnabledToggleSwitch={
                                        !!isEnabledToggleSwitch
                                    }
                                    setIsEnabledToggleSwitch={toggleSwitch}
                                />
                            );

                        case 'symbol':
                            return <SymbolSelect {...field} key={key} />;

                        case 'tradetype':
                            return (
                                <TradeTypeSelect {...field} key={key} />
                            );

                        case 'durationtype':
                            return (
                                <DurationTypeSelect {...field} key={key} />
                            );

                        case 'contract_type':
                            return (
                                <ContractTypeSelect
                                    {...field}
                                    key={key}
                                    name={field.name as string}
                                />
                            );

                        case 'growth_rate':
                            return (
                                <GrowthRateSelect
                                    {...field}
                                    key={key}
                                    name={field.name as string}
                                />
                            );

                        case 'sell_conditions':
                            return <SellConditions {...field} key={key} />;

                        default:
                            return null;
                    }
                })}
            </div>
        );
    });

return <div>{renderForm()}</div>;

});

export default QuickStrategyForm;
