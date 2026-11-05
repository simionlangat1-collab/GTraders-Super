import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Field, FieldProps, useFormikContext } from 'formik';
import Autocomplete from '@/components/shared_ui/autocomplete';
import { TItem } from '@/components/shared_ui/dropdown-list';
import { ApiHelpers } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import {
TApiHelpersInstance,
TDurationUnitItem,
TFormData,
} from '../types';

type TDurationUnit = {
attached?: boolean;
};

const DurationUnit: React.FC<TDurationUnit> = ({ attached }) => {
const [list, setList] = useState<TDurationUnitItem[]>([]);

const { quick_strategy } = useStore();

const {
    setValue,
    setCurrentDurationMinMax,
    current_duration_min_max,
} = quick_strategy;

const {
    setFieldValue,
    validateForm,
    values,
} = useFormikContext<TFormData>();

const { symbol, tradetype } = values;

const requestSequence = useRef(0);
const mounted = useRef(true);

const previousSelection = useRef({
    symbol: '',
    tradetype: '',
});

useEffect(() => {
    mounted.current = true;

    return () => {
        mounted.current = false;
        requestSequence.current += 1;
    };
}, []);

// Load duration units whenever the market or trade type changes.
useEffect(() => {
    let isActive = true;
    const sequence = ++requestSequence.current;

    const loadDurationUnits = async () => {
        if (!symbol || !tradetype) {
            setList([]);
            setCurrentDurationMinMax(undefined, undefined);
            previousSelection.current = {
                symbol: '',
                tradetype: '',
            };
            return;
        }

        try {
            const helpers = ApiHelpers?.instance as unknown as
                | TApiHelpersInstance
                | undefined;

            const durations =
                await helpers?.contracts_for?.getDurations?.(
                    String(symbol),
                    String(tradetype)
                );

            if (
                !isActive ||
                !mounted.current ||
                sequence !== requestSequence.current
            ) {
                return;
            }

            const availableDurations: TDurationUnitItem[] =
                Array.isArray(durations)
                    ? durations
                          .filter(
                              duration =>
                                  duration?.unit &&
                                  Number.isFinite(Number(duration.min)) &&
                                  Number.isFinite(Number(duration.max))
                          )
                          .map(duration => ({
                              text: duration.display || duration.unit,
                              value: duration.unit,
                              min: Number(duration.min),
                              max: Number(duration.max),
                          }))
                    : [];

            setList(availableDurations);

            const selectionChanged =
                previousSelection.current.symbol !== symbol ||
                previousSelection.current.tradetype !== tradetype;

            const selectedDuration = String(
                values.durationtype ?? ''
            );

            const existingSelection = availableDurations.find(
                duration => duration.value === selectedDuration
            );

            if (
                selectionChanged ||
                !existingSelection
            ) {
                const firstDuration = availableDurations[0];

                if (firstDuration) {
                    setCurrentDurationMinMax(
                        firstDuration.min,
                        firstDuration.max
                    );

                    setFieldValue(
                        'durationtype',
                        firstDuration.value,
                        true
                    );

                    setFieldValue(
                        'duration',
                        firstDuration.min,
                        true
                    );

                    setValue(
                        'durationtype',
                        firstDuration.value
                    );

                    setValue(
                        'duration',
                        firstDuration.min
                    );
                } else {
                    setCurrentDurationMinMax(undefined, undefined);
                    setFieldValue('durationtype', '', true);
                    setFieldValue('duration', '', true);
                    setValue('durationtype', '');
                    setValue('duration', '');
                }
            } else {
                setCurrentDurationMinMax(
                    existingSelection.min,
                    existingSelection.max
                );
            }

            previousSelection.current = {
                symbol: String(symbol),
                tradetype: String(tradetype),
            };
        } catch (error) {
            if (
                !isActive ||
                !mounted.current ||
                sequence !== requestSequence.current
            ) {
                return;
            }

            console.error(
                'GTraders Super: Failed to load duration units:',
                error
            );

            setList([]);
            setCurrentDurationMinMax(undefined, undefined);
        }
    };

    void loadDurationUnits();

    return () => {
        isActive = false;
    };
}, [
    symbol,
    tradetype,
    setFieldValue,
    setValue,
    setCurrentDurationMinMax,
]);

// Revalidate the form when duration limits change.
useEffect(() => {
    if (values.duration !== '' && values.duration !== undefined) {
        void validateForm();
    }
}, [
    current_duration_min_max,
    values.duration,
    validateForm,
]);

const handleDurationChange = async (item: TItem) => {
    const selected = item as TDurationUnitItem;

    if (
        !selected?.value ||
        !mounted.current
    ) {
        return;
    }

    setCurrentDurationMinMax(
        selected.min,
        selected.max
    );

    await setFieldValue(
        'durationtype',
        selected.value,
        true
    );

    setValue('durationtype', selected.value);

    await setFieldValue(
        'duration',
        selected.min,
        true
    );

    setValue('duration', selected.min);

    await validateForm();
};

return (
    <div
        className={classNames(
            'qs__form__field qs__form__field__input',
            {
                'no-top-border-radius': attached,
            }
        )}
    >
        <Field
            name='durationtype'
            key='durationtype'
            id='durationtype'
        >
            {({ field }: FieldProps) => {
                const selectedItem = list.find(
                    item => item.value === field.value
                );

                return (
                    <Autocomplete
                        {...field}
                        readOnly
                        inputMode='none'
                        data-testid='dt_qs_durationtype'
                        autoComplete='off'
                        className='qs__select'
                        value={selectedItem?.text || ''}
                        list_items={list}
                        onItemSelection={handleDurationChange}
                    />
                );
            }}
        </Field>
    </div>
);

};

export default DurationUnit;
