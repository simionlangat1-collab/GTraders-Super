
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import ErrorBoundary from '@/components/error-component/error-boundary';
import ErrorComponent from '@/components/error-component/error-component';
import ChunkLoader from '@/components/loader/chunk-loader';
import { api_base } from '@/external/bot-skeleton';
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
}) => {
    return <ChunkLoader progress={progress} message={message} />;
};

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

        const initializeApi = async () => {
            if (api_base_initialized.current) {
                setStartupProgress(100);
                setStartupMessage('GTraders Super is ready');
                setIsApiInitialized(true);
                return;
            }

            try {
                if (isMounted) {
                    setStartupProgress(20);
                    setStartupMessage('Initializing AI Engine...');
                }

                await new Promise(resolve => setTimeout(resolve, 250));

                if (isMounted) {
                    setStartupProgress(35);
                    setStartupMessage('Preparing Deriv Connection...');
                }

                await api_base.init();
                api_base_initialized.current = true;

                if (isMounted) {
                    setStartupProgress(75);
                    setStartupMessage('Loading trading dashboard...');
                }

                await new Promise(resolve => setTimeout(resolve, 250));

                if (isMounted) {
                    setStartupProgress(100);
                    setStartupMessage('GTraders Super is ready');
                }
            } catch (error) {
                console.error('API initialization failed:', error);

                if (isMounted) {
                    setStartupProgress(100);
                    setStartupMessage('Starting in offline mode...');
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
                    progress={100}
                    message={localize('Loading dashboard...')}
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
