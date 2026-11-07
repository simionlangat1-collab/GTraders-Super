import React from 'react';
import classNames from 'classnames';
import { Field, FieldProps, useFormikContext } from 'formik';
import { observer } from 'mobx-react-lite';
import Input from '@/components/shared_ui/input';
import Popover from '@/components/shared_ui/popover';
import { useStore } from '@/hooks/useStore';

type TQSInput = {
    name: string;
    onChange: (key: string, value: string | number | boolean) => void;
    type?: string;
    attached?: boolean;
    should_have?: { key: string; value: string | number | boolean }[];
    disabled?: boolean;
    min?: number;
    max?: number;
    has_currency_unit?: boolean;
    step?: number;
};

type TFormValues = {
    stake?: string | number;
    max_stake?: string | number;
    [key: string]: string | number | boolean | undefined;
};

const QSInput: React.FC<TQSInput> = observer(
    ({
        name,
        onChange,
        type = 'text',
        attached = false,
        disabled = false,
        min,
        max,
        has_currency_unit = false,
        step,
    }) => {
        const {
            client: { currency },
            quick_strategy,
        } = useStore();

        const { loss_threshold_warning_data } = quick_strategy;
        const { values } = useFormikContext<TFormValues>();

        const is_number = type === 'number';
        const max_value = 999999999999;
        const additional_data = quick_strategy?.additional_data as
            | { min_stake?: number; max_stake?: number }
            | undefined;

        const min_stake = additional_data?.min_stake ?? 0.35;
        const max_stake = additional_data?.max_stake ?? 1000;

        const getErrorMessage = (
            value: string | number | undefined,
            current_values: TFormValues
        ): string | undefined => {
            if (name !== 'stake' && name !== 'max_stake') return undefined;

            if (
                value === undefined ||
                value === '' ||
                Number(value) === 0
            ) {
                return `Minimum stake allowed is ${min_stake}`;
            }

            const numeric_value = Number(value);

            if (!Number.isFinite(numeric_value)) {
                return 'Please enter a valid number';
            }

            if (numeric_value < min_stake) {
                return `Minimum stake allowed is ${min_stake}`;
            }

            if (numeric_value > max_stake) {
                return `Maximum stake allowed is ${max_stake}`;
            }

            if (
                name === 'max_stake' &&
                current_values.stake !== undefined &&
                current_values.stake !== '' &&
                Number(current_values.stake) > numeric_value
            ) {
                return 'Initial stake cannot be greater than max stake';
            }

            return undefined;
        };

        const handleButtonInputChange = (
            event: React.MouseEvent<HTMLButtonElement>,
            raw_value: string
        ) => {
            event.preventDefault();

            let value: string | number = raw_value;

            if (name === 'tick_count' || name === 'duration') {
                value = String(Math.floor(Number(raw_value)));
            }

            if (name === 'stake') {
                const numeric_value = Math.min(
                    max_stake,
                    Math.max(min_stake, Number(raw_value))
                );

                value = String(
                    Number.isInteger(numeric_value)
                        ? numeric_value
                        : Number(numeric_value.toFixed(2))
                );
            }

            onChange(name, value);
        };

        const handleOnChange = (
            event: React.ChangeEvent<HTMLInputElement>
        ) => {
            const input_value = event.target.value;

            if (input_value === '') {
                onChange(name, '');
                return;
            }

            let value: string | number = is_number
                ? Number(input_value)
                : input_value;

            if (is_number && !Number.isFinite(Number(value))) return;

            if (
                is_number &&
                (name === 'tick_count' || name === 'duration')
            ) {
                value = Math.floor(Number(value));
            }

            if (
                is_number &&
                typeof value === 'number' &&
                value < 1 &&
                name !== 'stake' &&
                name !== 'max_stake' &&
                name !== 'take_profit'
            ) {
                value = 1;
            }

            onChange(name, value);
        };

        return (
            <Field name={name} key={name} id={name}>
                {({ field, meta }: FieldProps) => {
                    const custom_error = getErrorMessage(
                        field.value,
                        values
                    );

                    const error_message =
                        meta.error ||
                        (meta.touched ? custom_error : undefined);

                    const show_error = Boolean(error_message);
                    const current_value = Number(field.value);

                    const is_exclusive_field = has_currency_unit;

                    const decrease = (
                        event: React.MouseEvent<HTMLButtonElement>
                    ) => {
                        const field_min =
                            name === 'stake' ? min_stake : min ?? 1;

                        if (!Number.isFinite(current_value)) return;

                        if (current_value <= field_min) return;

                        const decrement = step ?? 1;
                        const next_value =
                            current_value - decrement >= field_min
                                ? current_value - decrement
                                : field_min;

                        handleButtonInputChange(
                            event,
                            String(
                                Number.isInteger(next_value)
                                    ? next_value
                                    : Number(next_value.toFixed(2))
                            )
                        );
                    };

                    const increase = (
                        event: React.MouseEvent<HTMLButtonElement>
                    ) => {
                        if (!Number.isFinite(current_value)) return;

                        const increment = step ?? 1;
                        let next_value = current_value + increment;

                        if (name === 'stake') {
                            next_value = Math.min(next_value, max_stake);
                        }

                        if (max !== undefined) {
                            next_value = Math.min(next_value, max);
                        }

                        if (next_value > max_value) {
                            next_value = max_value;
                        }

                        handleButtonInputChange(
                            event,
                            String(
                                Number.isInteger(next_value)
                                    ? next_value
                                    : Number(next_value.toFixed(2))
                            )
                        );
                    };

                    return (
                        <div
                            className={classNames(
                                'qs__form__field qs__form__field__input',
                                {
                                    'no-top-spacing': attached,
                                    'no-border-top': attached,
                                }
                            )}
                        >
                            <div data-testid='qs-input-container'>
                                <Popover
                                    alignment='bottom'
                                    message={error_message}
                                    is_open={show_error}
                                    zIndex='9999'
                                    classNameBubble='qs__warning-bubble'
                                    has_error
                                    should_disable_pointer_events
                                    data-testid={`${name}-popover`}
                                    relative_render
                                    arrow_styles={{ left: '50%' }}
                                >
                                    <Input
                                        {...field}
                                        data_testId='qs-input'
                                        className={classNames('qs__input', {
                                            error: show_error,
                                            highlight:
                                                loss_threshold_warning_data?.highlight_field?.includes(
                                                    name
                                                ),
                                        })}
                                        type={type}
                                        step={step}
                                        disabled={disabled}
                                        onChange={handleOnChange}
                                        onWheel={event => {
                                            event.currentTarget.blur();
                                            event.preventDefault();
                                        }}
                                        onBlur={field.onBlur}
                                        leading_icon={
                                            is_number ? (
                                                <button
                                                    type='button'
                                                    disabled={
                                                        disabled ||
                                                        !Number.isFinite(
                                                            current_value
                                                        ) ||
                                                        current_value <=
                                                            (name === 'stake'
                                                                ? min_stake
                                                                : min ?? 1)
                                                    }
                                                    data-testid='qs-input-decrease'
                                                    onClick={decrease}
                                                >
                                                    -
                                                </button>
                                            ) : undefined
                                        }
                                        trailing_icon={
                                            is_number ? (
                                                <button
                                                    type='button'
                                                    disabled={
                                                        disabled ||
                                                        current_value >=
                                                            (name === 'stake'
                                                                ? max_stake
                                                                : max ?? max_value)
                                                    }
                                                    data-testid='qs-input-increase'
                                                    onClick={increase}
                                                >
                                                    +
                                                </button>
                                            ) : undefined
                                        }
                                        placeholder={
                                            is_exclusive_field ? '0.00' : ''
                                        }
                                        bottom_label={
                                            is_exclusive_field ? currency : ''
                                        }
                                        max_characters={12}
                                        maxLength={12}
                                        inputMode={
                                            name === 'tick_count' ||
                                            name === 'duration'
                                                ? 'numeric'
                                                : undefined
                                        }
                                        pattern={
                                            name === 'tick_count' ||
                                            name === 'duration'
                                                ? '[0-9]*'
                                                : undefined
                                        }
                                        onKeyDown={
                                            name === 'tick_count' ||
                                            name === 'duration'
                                                ? event => {
                                                      if (
                                                          event.key === '.' ||
                                                          event.key === ','
                                                      ) {
                                                          event.preventDefault();
                                                      }
                                                  }
                                                : undefined
                                        }
                                    />
                                </Popover>
                            </div>
                        </div>
                    );
                }}
            </Field>
        );
    }
);

export default QSInput;
