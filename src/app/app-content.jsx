
import React, { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ToastContainer } from 'react-toastify';
import AuthLoadingWrapper from '@/components/auth-loading-wrapper';
import useLiveChat from '@/components/chat/useLiveChat';
import ChunkLoader from '@/components/loader/chunk-loader';
import { getUrlBase } from '@/components/shared';
import TransactionDetailsModal from '@/components/transaction-details';
import { api_base, ApiHelpers, ServerTime } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import useDevMode from '@/hooks/useDevMode';
import { useStore } from '@/hooks/useStore';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { ThemeProvider } from '@deriv-com/quill-ui';
import { setSmartChartsPublicPath } from '@deriv-com/smartcharts-champion';
import { localize } from '@deriv-com/translations';
import Audio from '../components/audio';
import BlocklyLoading from '../components/blockly-loading';
import BotStopped from '../components/bot-stopped';
import BotBuilder from '../pages/bot-builder';
import Main from '../pages/main';
import './app.scss';
import 'react-toastify/dist/ReactToastify.css';
import '../components/bot-notification/bot-notification.scss';

const AppContent = observer(({
    onStartupProgress,
    onStartupMessage,
}) => {
    const [is_api_initialized, setIsApiInitialized] = React.useState(false);
    const [is_loading, setIsLoading] = React.useState(true);
    const isPioneerLoginReturn = React.useRef(
        sessionStorage.getItem('gk_pioneer_login_return_active') === '1'
    );
    const [loadingMessage, setLoadingMessage] = React.useState(
        'Preparing live market data...'
    );

    const store = useStore();
    const { app, transactions, common, client } = store;
    const { is_dark_mode_on } = useThemeSwitcher();

    const { recovered_transactions, recoverPendingContracts } = transactions;
    const is_subscribed_to_msg_listener = React.useRef(false);
    const msg_listener = React.useRef(null);
    const has_initialized = React.useRef(false);

    const { connectionStatus } = useApiBase();

    useDevMode();

    const livechat_client_information = {
        is_client_store_initialized: client?.is_logged_in ? true : !!client,
        is_logged_in: client?.is_logged_in,
        loginid: client?.loginid,
        currency: client?.currency,
        residence: client?.residence,
        email: '',
        first_name: '',
        last_name: '',
    };

    useLiveChat(livechat_client_information);

    useEffect(() => {
        if (connectionStatus === CONNECTION_STATUS.OPENED) {
            setIsApiInitialized(true);
            common.setSocketOpened(true);

            onStartupProgress?.(55);
            onStartupMessage?.('Deriv connection established...');
            setLoadingMessage('Preparing live market data...');
        } else {
            common.setSocketOpened(false);

            if (connectionStatus === CONNECTION_STATUS.CLOSED) {
                onStartupMessage?.('Connection interrupted. Reconnecting...');
                setLoadingMessage('Waiting for market connection...');
            }
        }
    }, [
        common,
        connectionStatus,
        onStartupProgress,
        onStartupMessage,
    ]);

    const { current_language } = common;
    const html = document.documentElement;

    useEffect(() => {
        html?.setAttribute('lang', current_language.toLowerCase());
        html?.setAttribute(
            'dir',
            current_language.toLowerCase() === 'ar' ? 'rtl' : 'ltr'
        );
    }, [current_language, html]);

    const handleMessage = React.useCallback(
        ({ data }) => {
            if (data?.msg_type === 'proposal_open_contract' && !data?.error) {
                const { proposal_open_contract } = data;

                if (
                    proposal_open_contract?.status !== 'open' &&
                    !recovered_transactions?.includes(
                        proposal_open_contract?.contract_id
                    )
                ) {
                    recoverPendingContracts(proposal_open_contract);
                }
            }
        },
        [recovered_transactions, recoverPendingContracts]
    );

    useEffect(() => {
        setSmartChartsPublicPath(getUrlBase('/js/smartcharts/'));
    }, []);

    useEffect(() => {
        if (
            !is_subscribed_to_msg_listener.current &&
            client.is_logged_in &&
            is_api_initialized &&
            api_base?.api
        ) {
            is_subscribed_to_msg_listener.current = true;
            msg_listener.current = api_base.api.onMessage()?.subscribe(handleMessage);
        }

        return () => {
            if (is_subscribed_to_msg_listener.current && msg_listener.current) {
                is_subscribed_to_msg_listener.current = false;
                msg_listener.current.unsubscribe?.();
                msg_listener.current = null;
            }
        };
    }, [
        is_api_initialized,
        client.is_logged_in,
        client.loginid,
        handleMessage,
        connectionStatus,
    ]);

    const init = () => {
        ServerTime.init(common);
        app.setDBotEngineStores();
        ApiHelpers.setInstance(app.api_helpers_store);

        import('@/utils/gtm')
            .then(({ default: GTM }) => {
                GTM.init(store);
            })
            .catch(error => {
                console.error(
                    'GTraders Super analytics initialization failed:',
                    error
                );
            });
    };

    useEffect(() => {
        if (!is_api_initialized) return;

        if (!has_initialized.current) {
            init();
            has_initialized.current = true;
        }

        setIsLoading(true);
        setLoadingMessage('Loading live market data...');

        onStartupProgress?.(60);
        onStartupMessage?.('Loading live market data...');

        let intervalId;
        let cancelled = false;

        const retrieveActiveSymbols = () => {
            const active_symbols = ApiHelpers?.instance?.active_symbols;

            if (!active_symbols) return;

            if (intervalId) {
                clearInterval(intervalId);
                intervalId = undefined;
            }

            onStartupProgress?.(65);
            onStartupMessage?.('Initializing market scanner...');

            setLoadingMessage('Initializing market scanner...');

            Promise.resolve(active_symbols.retrieveActiveSymbols(true))
                .then(() => {
                    if (!cancelled) {
                        onStartupProgress?.(75);
                        onStartupMessage?.(
                            'Market data loaded. Preparing workspace...'
                        );

                        setLoadingMessage(
                            'Market data loaded. Preparing workspace...'
                        );

                        setIsLoading(false);
                    }
                })
                .catch(error => {
                    console.error(
                        'GTraders Super active symbols initialization failed:',
                        error
                    );

                    if (!cancelled) {
                        onStartupProgress?.(75);
                        onStartupMessage?.(
                            'Market data unavailable. Continuing safely...'
                        );

                        setLoadingMessage(
                            'Market data unavailable. Continuing safely...'
                        );

                        setIsLoading(false);
                    }
                });
        };

        retrieveActiveSymbols();

        if (!ApiHelpers?.instance?.active_symbols) {
            intervalId = setInterval(retrieveActiveSymbols, 1000);
        }

        return () => {
            cancelled = true;

            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [
        is_api_initialized,
        onStartupProgress,
        onStartupMessage,
    ]);

    if (common?.error) return null;

    return is_loading ? (
        isPioneerLoginReturn.current ? (
            <div
                className='gtraders-login-return'
                aria-label='Preparing your G - T Pioneer dashboard'
            />
        ) : (
            <ChunkLoader
                progress={75}
                isConnected={connectionStatus === CONNECTION_STATUS.OPENED}
                message={localize(loadingMessage)}
            />
        )
    ) : (
        <AuthLoadingWrapper>
            <ThemeProvider theme={is_dark_mode_on ? 'dark' : 'light'}>
                <BlocklyLoading />

                <div
                    className='bot-dashboard bot'
                    data-testid='dt_bot_dashboard'
                >
                    <Audio />
                    <Main />
                    <BotBuilder />
                    <BotStopped />
                    <TransactionDetailsModal />
                    <ToastContainer limit={3} draggable={false} />
                </div>
            </ThemeProvider>
        </AuthLoadingWrapper>
    );
});

export default AppContent;
