
import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Field, FieldProps, useFormikContext } from 'formik';
import { observer } from 'mobx-react-lite';
import Autocomplete from '@/components/shared_ui/autocomplete';
import { TItem } from '@/components/shared_ui/dropdown-list';
import Text from '@/components/shared_ui/text';
import { ApiHelpers, api_base } from '@/external/bot-skeleton';
import { requestOptionsProposalForQS } from '@/external/bot-skeleton/scratch/options-proposal-handler';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import { TApiHelpersInstance, TDropdownItems, TFormData } from '../types';

type TContractTypes = {
    name: string;
    attached?: boolean;
};

type TProposalRequest = {
    amount: number;
    currency: string | undefined;
    underlying_symbol: string;
    contract_type: string;
    duration_unit: string;
    duration: number;
    basis: string;
};

const ContractTypes: React.FC<TContractTypes> = observer(({ name }) => {
    const { isDesktop } = useDevice();
    const [list, setList] = useState<TDropdownItems[]>([]);
    const [is_loading, setIsLoading] = useState(false);

    const { quick_strategy, client } = useStore();
    const { setValue } = quick_strategy;

    const {
        setFieldValue,
        values,
        setFieldError,
    } = useFormikContext<TFormData>();

    const { symbol, tradetype } = values;

    const requestSequence = useRef(0);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
            requestSequence.current += 1;
            quick_strategy.setOptionsLoading(false);
        };
    }, [quick_strategy]);

    // Load contract types whenever the symbol or trade type changes.
    useEffect(() => {
        let isActive = true;

        const loadContractTypes = async () => {
            if (!tradetype || !symbol) {
                setList([]);
                return;
            }

            try {
                const helpers = ApiHelpers?.instance as unknown as
                    | TApiHelpersInstance
                    | undefined;

                const categories =
                    await helpers?.contracts_for?.getContractTypes?.(
                        tradetype
                    );

                if (!isActive || !mounted.current) return;

                const available_categories = Array.isArray(categories)
                    ? categories
                    : [];

                setList(available_categories);

                const selected = String(values?.type ?? '');

                const has_selected = available_categories.some(
                    item => item.value === selected
                );

                if (!has_selected) {
                    const first_value =
                        available_categories[0]?.value ?? '';

                    setFieldValue(name, first_value);
                    setValue(name, first_value);
                }
            } catch (error) {
                if (!isActive || !mounted.current) return;

                console.error(
                    'GTraders Super: Failed to load contract types:',
                    error
                );

                setList([]);
            }
        };

        void loadContractTypes();

        return () => {
            isActive = false;
        };
    }, [
        symbol,
        tradetype,
        name,
        setFieldValue,
        setValue,
        values?.type,
    ]);

    // Validate stake and contract options with protection against stale requests.
    useEffect(() => {
        const {
            type,
            symbol: selected_symbol,
            durationtype,
            duration,
            stake,
        } = values;

        if (
            !type ||
            !selected_symbol ||
            !durationtype ||
            !duration
        ) {
            quick_strategy.setOptionsLoading(false);
            return;
        }

        const sequence = ++requestSequence.current;

        const timer = setTimeout(async () => {
            if (!mounted.current || sequence !== requestSequence.current) {
                return;
            }

            setIsLoading(true);
            quick_strategy.setOptionsLoading(true);

            const request_proposal: TProposalRequest = {
                amount: Number(stake) || 0,
                currency: client?.currency,
                underlying_symbol: String(selected_symbol),
                contract_type: String(type),
                duration_unit: String(durationtype),
                duration: Number(duration) || 0,
                basis: 'stake',
            };

            try {
                await requestOptionsProposalForQS(
                    request_proposal,
                    api_base.api
                );

                if (
                    !mounted.current ||
                    sequence !== requestSequence.current
                ) {
                    return;
                }

                setFieldError('stake', undefined);
            } catch (error_response: any) {
                if (
                    !mounted.current ||
                    sequence !== requestSequence.current
                ) {
                    return;
                }

                let error_message =
                    'An error occurred while validating your input';

                if (error_response?.message) {
                    error_message = error_response.message;
                } else if (error_response?.error?.message) {
                    error_message = error_response.error.message;
                }

                const error_code =
                    error_response?.code ??
                    error_response?.error?.code;

                let should_show_error = false;

                if (error_code === 'ContractBuyValidationError') {
                    should_show_error =
                        stake !== '' &&
                        stake !== undefined &&
                        stake !== null;
                } else if (error_code === 'MarketIsClosed') {
                    should_show_error = false;
                } else if (
                    [
                        'InvalidSymbol',
                        'InvalidContractType',
                        'InvalidDuration',
                    ].includes(error_code)
                ) {
                    should_show_error = true;
                } else if (
                    /connection|network|timeout/i.test(error_message)
                ) {
                    should_show_error = false;
                    console.warn(
                        'GTraders Super: Temporary network issue during proposal validation:',
                        error_message
                    );
                } else {
                    should_show_error =
                        stake !== '' &&
                        stake !== undefined &&
                        stake !== null;
                }

                if (!should_show_error) return;

                let translated_error_message = error_message;

                if (
                    error_message.includes(
                        "Please enter a stake amount that's at least"
                    )
                ) {
                    const match = error_message.match(
                        /at least (\d+\.?\d*)/
                    );

                    translated_error_message = match?.[1]
                        ? localize(
                              "Please enter a stake amount that's at least {{param1}}.",
                              { param1: match[1] }
                          )
                        : localize(error_message);
                } else if (
                    error_message.includes('Minimum stake of') &&
                    error_message.includes('maximum payout of')
                ) {
                    const min_match = error_message.match(
                        /Minimum stake of (\d+\.?\d*)/
                    );
                    const max_match = error_message.match(
                        /maximum payout of (\d+\.?\d*)/
                    );
                    const current_match = error_message.match(
                        /Current payout is (\d+\.?\d*)/
                    );

                    translated_error_message =
                        min_match && max_match && current_match
                            ? localize(
                                  'Minimum stake of {{param1}} and maximum payout of {{param2}}. Current payout is {{param3}}.',
                                  {
                                      param1: min_match[1],
                                      param2: max_match[1],
                                      param3: current_match[1],
                                  }
                              )
                            : localize(error_message);
                } else if (
                    error_message.includes(
                        "Please enter a stake amount that's at most"
                    )
                ) {
                    const match = error_message.match(
                        /at most (\d+\.?\d*)/
                    );

                    translated_error_message = match?.[1]
                        ? localize(
                              "Please enter a stake amount that's at most {{param1}}.",
                              { param1: match[1] }
                          )
                        : localize(error_message);
                } else {
                    translated_error_message = localize(error_message);
                }

                setFieldError('stake', translated_error_message);
            } finally {
                if (
                    mounted.current &&
                    sequence === requestSequence.current
                ) {
                    setIsLoading(false);
                    quick_strategy.setOptionsLoading(false);
                }
            }
        }, 1000);

        return () => {
            clearTimeout(timer);

            if (sequence === requestSequence.current) {
                requestSequence.current += 1;
                setIsLoading(false);
                quick_strategy.setOptionsLoading(false);
            }
        };
    }, [
        values.stake,
        values.type,
        values.symbol,
        values.durationtype,
        values.duration,
        client?.currency,
        quick_strategy,
        setFieldError,
    ]);

    useEffect(() => {
        setFieldError('stake', undefined);
    }, [values.stake, setFieldError]);

    const handleChange = (value: string) => {
        setFieldValue(name, value);
        setValue(name, value);
    };

    const key = `qs-contract-type-${name}`;

    return (
        <div className='qs__form__field qs__form__field__input no-top-spacing'>
            <Field name={name} key={key} id={key}>
                {({ field }: FieldProps) => {
                    const selected_item = list.find(
                        item => item?.value === field?.value
                    );

                    if (!isDesktop) {
                        return (
                            <ul
                                className='qs__form__field__list'
                                data-testid='dt_qs_contract_types'
                            >
                                {list.map(item => {
                                    const is_active =
                                        selected_item?.value === item?.value;

                                    return (
                                        <li
                                            key={item.value}
                                            className={classNames(
                                                'qs__form__field__list__item',
                                                {
                                                    'qs__form__field__list__item--active':
                                                        is_active,
                                                }
                                            )}
                                            onClick={() =>
                                                handleChange(item.value)
                                            }
                                        >
                                            <Text
                                                size='xs'
                                                color='prominent'
                                                weight={
                                                    is_active
                                                        ? 'bold'
                                                        : 'normal'
                                                }
                                            >
                                                {item.text}
                                            </Text>
                                        </li>
                                    );
                                })}
                            </ul>
                        );
                    }

                    return (
                        <Autocomplete
                            {...field}
                            readOnly
                            data-testid='dt_qs_contract_type'
                            autoComplete='off'
                            className='qs__select contract-type'
                            value={selected_item?.text || ''}
                            list_items={list}
                            onItemSelection={(item: TItem) => {
                                const selected = item as TDropdownItems;

                                if (selected?.value) {
                                    handleChange(selected.value);
                                }
                            }}
                        />
                    );
                }}
            </Field>
            {is_loading ? null : null}
        </div>
    );
});

export default ContractTypes;
