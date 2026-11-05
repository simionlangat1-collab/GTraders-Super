
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ErrorBoundary from '@/components/error-component/error-boundary';
import ErrorComponent from '@/components/error-component/error-component';
import ChunkLoader from '@/components/loader/chunk-loader';
import { api_base } from '@/external/bot-skeleton';
import { connectionStatus$, CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import './app-root.scss';

const AppContent = lazy(() => import('./app-content'));

const AppRootLoader = ({
    progress,
    message,
}: {
    progress: number;
    message: string;
}) => <ChunkLoader progress={progress} message={message} />;

const ErrorComponentWrapper = observer(() => {
    const { common } = useStore();

    if (!common.error) return null;

    return (
        <ErrorComponent
            header={common.error?.header}
            message={common.error?.message}
            redirect_label={common.error?.redirect_label}
            redirectOnClick={common.error?.redirectOnClick}
            should_clear_error_on_click={common.error?.should_clear_error_on_click}
            setError={common.setError}
            redirect_to={common.error?.redirect_to}
            should_redirect={common.error?.should_redirect}
        />
    );
});

const AppRoot = () => {
    const store = useStore();
    const api_base_initialized = useRef(false);

    const [is_api_initialized, setIsApiInitialized] = useState(false);
    const [startupProgress, setStartupProgress] = useState(0);
    const [startupMessage, setStartupMessage] = useState('Preparing GTraders Super...');

    useEffect(() => {
        let isMounted = true;

        const connectionSubscription = connectionStatus$.subscribe(status => {
            if (!isMounted) return;

            if (status === CONNECTION_STATUS.OPENED) {
                setStartupProgress(50);
                setStartupMessage('Deriv connection established...');
            } else if (status === CONNECTION_STATUS.CLOSED) {
                setStartupMessage('Connection interrupted. Reconnecting...');
            }
        });

        const initializeApi = async () => {
            try {
                setStartupProgress(10);
                setStartupMessage('Initializing GTraders Super...');

                if (!api_base_initialized.current) {
                    setStartupProgress(20);
                    setStartupMessage('Preparing Deriv API...');

                    await api_base.init();
                    api_base_initialized.current = true;
                }

                if (isMounted) {
                    setStartupProgress(30);
                    setStartupMessage('Deriv API initialized. Waiting for connection...');
                }

                if (connectionStatus$.getValue() === CONNECTION_STATUS.OPENED) {
                    setStartupProgress(50);
                    setStartupMessage('Deriv connection established...');
                }
            } catch (error) {
                console.error('GTraders Super API initialization failed:', error);

                if (isMounted) {
                    setStartupMessage('Deriv connection unavailable. Retrying...');
                }
            } finally {
                if (isMounted) {
                    setIsApiInitialized(true);
                }
            }
        };

        initializeApi();

        return () => {
            isMounted = false;
            connectionSubscription.unsubscribe();
        };
    }, []);

    if (!store || !is_api_initialized) {
        return (
            <AppRootLoader
                progress={startupProgress}
                message={startupMessage}
            />
        );
    }

    return (
        <Suspense
            fallback={
                <AppRootLoader
                    progress={startupProgress}
                    message={localize('Loading GTraders Super dashboard...')}
                />
            }
        >
            <ErrorBoundary root_store={store}>
                <ErrorComponentWrapper />
                <AppContent />
            </ErrorBoundary>
        </Suspense>
    );
};

export default AppRoot;
