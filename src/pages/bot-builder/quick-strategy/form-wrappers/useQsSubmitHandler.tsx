
import { useFormikContext } from 'formik';
import { useStore } from '@/hooks/useStore';
import { TFormData } from '../types';

const useQsSubmitHandler = () => {
    const { client, quick_strategy, run_panel } = useStore();
    const { currency, balance, is_logged_in } = client;

    const {
        submitForm,
        setFieldValue,
        values,
        validateForm,
    } = useFormikContext<TFormData>();

    const {
        toggleStopBotDialog,
        setLossThresholdWarningData,
        loss_threshold_warning_data,
        onSubmit,
    } = quick_strategy;

    const handleSubmit = async () => {
        const loss_amount = Number(values?.loss ?? 0);
        const profit_threshold = Number(values?.profit ?? 0);

        let dont_show_warning = false;

        try {
            dont_show_warning = JSON.parse(
                localStorage.getItem('qs-dont-show-loss-threshold-warning') ?? 'false'
            );
        } catch {
            dont_show_warning = false;
        }

        if (
            !loss_threshold_warning_data.already_shown &&
            (
                loss_amount > 0.5 * Number(balance ?? 0) ||
                loss_amount > 2 * profit_threshold
            ) &&
            is_logged_in &&
            !dont_show_warning
        ) {
            setLossThresholdWarningData({
                show: true,
                loss_amount,
                currency,
                already_shown: true,
            });
            return;
        }

        await proceedFormSubmission();
    };

    const proceedFormSubmission = async () => {
        const is_running = run_panel.is_running;
        const next_action = is_running ? 'EDIT' : 'RUN';

        const submission_values = {
            ...values,
            action: next_action,
        };

        await setFieldValue('action', next_action, false);

        const errors = await validateForm(submission_values);

        if (Object.keys(errors).length > 0) {
            return;
        }

        await submitForm();

        if (is_running) {
            toggleStopBotDialog();
            return;
        }

        await onSubmit(submission_values);
    };

    return {
        handleSubmit,
        proceedFormSubmission,
    };
};

export default useQsSubmitHandler;
