import React from 'react';
import classNames from 'classnames';
import { Field, FieldProps, useFormikContext } from 'formik';
import { observer } from 'mobx-react-lite';
import Autocomplete from '@/components/shared_ui/autocomplete';
import { TItem } from '@/components/shared_ui/dropdown-list';
import Text from '@/components/shared_ui/text';
import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { api_base } from '@/external/bot-skeleton';
import { requestProposalForQS } from '@/external/bot-skeleton/scratch/accumulators-proposal-handler';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { TDropdownItems, TFormData } from '../types';

const GROWTH_RATES: TDropdownItems[] = [
{ text: '1%', value: '0.01' },
{ text: '2%', value: '0.02' },
{ text: '3%', value: '0.03' },
{ text: '4%', value: '0.04' },
{ text: '5%', value: '0.05' },
];

type TContractTypes = {
name: string;
attached?: boolean;
};

type TErrorResponse = {
code?: string;
subcode?: string;
message?: string;
details?: {
field?: string;
};
error?: {
code?: string;
subcode?: string;
message?: string;
details?: {
field?: string;
};
};
};

const getLocalizedError = (error: TErrorResponse): string => {
const details = error?.error ?? error;

if (details?.subcode) {
    return getLocalizedErrorMessage(details.subcode, details);
}

if (details?.code) {
    return getLocalizedErrorMessage(details.code, details);
}

return details?.message || error?.message || '';

};

const GrowthRateSelect: React.FC<TContractTypes> = observer(({ name }) => {
const { ui, client, quick_strategy } = useStore();

const { is_desktop } = ui;

const { setValue, setAdditionalData } = quick_strategy;

const {
    setFieldValue,
    values,
    setFieldError,
} = useFormikContext<TFormData>();

const requestSequence = React.useRef(0);
const mounted = React.useRef(true);

const previousErrors = React.useRef<{
    tick_count: string | null;
    take_profit: string | null;
}>({
    tick_count: null,
    take_profit: null,
});

const maxPayout = React.useRef<unknown>(null);

React.useEffect(() => {
    mounted.current = true;

    setFieldValue('tradetype', 'accumulator');
    setValue('tradetype', 'accumulator');

    return () => {
        mounted.current = false;
        requestSequence.current += 1;
    };
}, [setFieldValue, setValue]);

// Keep mutually exclusive accumulator validation fields synchronized.
React.useEffect(() => {
    if (values.boolean_tick_count) {
        void setFieldValue('take_profit', 0);
        setFieldError(
            'tick_count',
            previousErrors.current.tick_count ?? undefined
        );
        setFieldError('take_profit', undefined);
    } else {
        void setFieldValue('tick_count', 0);
        setFieldError(
            'take_profit',
            previousErrors.current.take_profit ?? undefined
        );
        setFieldError('tick_count', undefined);
    }
}, [
    values.boolean_tick_count,
    setFieldValue,
    setFieldError,
]);

// Validate accumulator proposals with stale-response protection.
React.useEffect(() => {
    const sequence = ++requestSequence.current;

    const {
        stake,
        symbol,
        growth_rate,
        take_profit,
        boolean_tick_count,
        tick_count,
    } = values;

    if (
        !symbol ||
        !growth_rate ||
        !client?.currency ||
        !mounted.current
    ) {
        return;
    }

    const timer = setTimeout(async () => {
        if (
            !mounted.current ||
            sequence !== requestSequence.current
        ) {
            return;
        }

        const requestProposal = {
            amount: Number(stake) || 0,
            currency: client.currency,
            growth_rate: Number(growth_rate),
            symbol: String(symbol),
            limit_order: {
                ...(!boolean_tick_count && {
                    take_profit: Number(take_profit) || 0,
                }),
            },
        };

        try {
            const response = await requestProposalForQS(
                requestProposal,
                api_base.api
            );

            if (
                !mounted.current ||
                sequence !== requestSequence.current
            ) {
                return;
            }

            const proposal = response?.proposal;

            const validationParams = proposal?.validation_params;
            const contractDetails = proposal?.contract_details;

            const maxTicks = Number(validationParams?.max_ticks);
            const maxStake = Number(contractDetails?.maximum_stake);
            const minStake = Number(contractDetails?.minimum_stake);

            setAdditionalData({
                max_payout: maxPayout.current,
                max_ticks: Number.isFinite(maxTicks)
                    ? maxTicks
                    : undefined,
                max_stake: Number.isFinite(maxStake)
                    ? maxStake
                    : 1000,
                min_stake: Number.isFinite(minStake)
                    ? minStake
                    : 1,
            });

            maxPayout.current = validationParams?.max_payout ?? null;

            // Validate tick count only when that option is active.
            if (boolean_tick_count) {
                const currentTickCount = Number(tick_count);

                if (
                    Number.isFinite(maxTicks) &&
                    currentTickCount > maxTicks
                ) {
                    const message = localize(
                        'Maximum tick count allowed is {{ max }}',
                        { max: maxTicks }
                    );

                    previousErrors.current.tick_count = message;
                    setFieldError('tick_count', message);
                } else if (
                    currentTickCount < 1
                ) {
                    const message = localize(
                        'Minimum tick count allowed is {{ min }}',
                        { min: 1 }
                    );

                    previousErrors.current.tick_count = message;
                    setFieldError('tick_count', message);
                } else {
                    previousErrors.current.tick_count = null;
                    setFieldError('tick_count', undefined);
                }
            } else {
                previousErrors.current.take_profit = null;
                setFieldError('take_profit', undefined);
            }

            setFieldError('stake', undefined);
        } catch (error_response) {
            if (
                !mounted.current ||
                sequence !== requestSequence.current
            ) {
                return;
            }

            const error = error_response as TErrorResponse;

            const errorDetails = error?.error ?? error;

            const errorMessage =
                getLocalizedError(error) ||
                'An error occurred while validating your input';

            if (
                /connection|network|timeout/i.test(errorMessage)
            ) {
                console.warn(
                    'GTraders Super: Temporary accumulator validation issue:',
                    errorMessage
                );
                return;
            }

            const errorField = errorDetails?.details?.field;

            if (
                errorField === 'stake' ||
                errorField === 'amount'
            ) {
                if (
                    errorField === 'stake' ||
                    (stake !== '' &&
                        stake !== undefined &&
                        stake !== null)
                ) {
                    setFieldError('stake', errorMessage);
                }

                return;
            }

            if (errorField === 'take_profit') {
                let message = errorMessage;

                if (
                    Number(take_profit) > 0 &&
                    Number(stake) > 0 &&
                    maxPayout.current !== null
                ) {
                    const totalPayout =
                        Number(take_profit) + Number(stake);

                    message = localize(
                        'Your total payout is {{total}}. Enter amount less than {{max}}.',
                        {
                            total: totalPayout,
                            max: maxPayout.current,
                        }
                    );

                    message += ` ${localize(
                        'By changing your initial stake and/or take profit.'
                    )}`;
                }

                previousErrors.current.take_profit = message;
                setFieldError('take_profit', message);
                return;
            }

            if (boolean_tick_count) {
                previousErrors.current.tick_count = errorMessage;
                setFieldError('tick_count', errorMessage);

                const currentValue = Number(tick_count);

                if (currentValue > 1000) {
                    void setFieldValue('tick_count', 1000);
                } else if (
                    !Number.isNaN(currentValue) &&
                    currentValue < 1
                ) {
                    void setFieldValue('tick_count', 1);
                }
            } else {
                previousErrors.current.take_profit = errorMessage;
                setFieldError('take_profit', errorMessage);
            }
        }
    }, 1000);

    return () => {
        clearTimeout(timer);

        if (sequence === requestSequence.current) {
            requestSequence.current += 1;
        }
    };
}, [
    values.symbol,
    values.stake,
    values.growth_rate,
    values.take_profit,
    values.tick_count,
    values.boolean_tick_count,
    client?.currency,
    setAdditionalData,
    setFieldError,
    setFieldValue,
]);

const handleChange = (value: string) => {
    setFieldValue(name, value);
    setValue(name, value);
};

const key = `qs-growth-rate-${name}`;

return (
    <div className='qs__form__field qs__form__field__input no-top-spacing'>
        <Field name={name} key={key} id={key}>
            {({ field }: FieldProps) => {
                const selectedItem = GROWTH_RATES.find(
                    item => item.value === field.value
                );

                if (!is_desktop) {
                    return (
                        <ul
                            className='qs__form__field__list'
                            data-testid='dt_qs_growth_rates'
                        >
                            {GROWTH_RATES.map(item => {
                                const isActive =
                                    selectedItem?.value === item.value;

                                return (
                                    <li
                                        key={item.value}
                                        className={classNames(
                                            'qs__form__field__list__item',
                                            {
                                                'qs__form__field__list__item--active':
                                                    isActive,
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
                                                isActive
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
                        inputMode='none'
                        data-testid='dt_qs_growth_rate'
                        autoComplete='off'
                        className='qs__select contract-type'
                        value={selectedItem?.text || ''}
                        list_items={GROWTH_RATES}
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
    </div>
);

});

export default GrowthRateSelect;
