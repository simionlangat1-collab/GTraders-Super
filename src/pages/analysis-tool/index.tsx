import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import './analysis-tool.scss';

const AnalysisTool = observer(() => {
    const { connectionStatus, isAuthorized } = useApiBase();

    const marketCount = useMemo(
        () => (api_base.active_symbols || []).length,
        [connectionStatus, isAuthorized]
    );

    const isConnected = connectionStatus === CONNECTION_STATUS.OPENED;

    return (
        <main className='analysis-tool'>
            <header className='analysis-tool__header'>
                <div>
                    <span className='analysis-tool__eyebrow'>GTRADERS SUPER · MARKET INTELLIGENCE</span>
                    <h1>Analysis Tool</h1>
                    <p>Live market statistics and digit behaviour across Deriv Synthetic Indices.</p>
                </div>
                <div className={`analysis-tool__connection ${isConnected ? 'analysis-tool__connection--online' : ''}`}>
                    <span />
                    {isConnected ? 'Deriv connection online' : 'Waiting for Deriv connection'}
                </div>
            </header>

            <section className='analysis-tool__overview'>
                <article className='analysis-tool__card analysis-tool__card--primary'>
                    <span className='analysis-tool__card-label'>ANALYSIS ENGINE</span>
                    <h2>Last Digit Intelligence</h2>
                    <p>Frequency, distribution, streaks and Over / Under statistics from live tick data.</p>
                    <span className='analysis-tool__status'>Engine interface ready · Live analysis is the next build stage</span>
                </article>
                <article className='analysis-tool__metric'>
                    <span>Deriv connection</span>
                    <strong>{isConnected ? 'Connected' : 'Offline'}</strong>
                    <small>{isAuthorized ? 'Account authorized' : 'Public market data connection'}</small>
                </article>
                <article className='analysis-tool__metric'>
                    <span>Symbols loaded</span>
                    <strong>{marketCount}</strong>
                    <small>Available symbols detected by the app</small>
                </article>
            </section>

            <section className='analysis-tool__workspace'>
                <div className='analysis-tool__section-heading'>
                    <div>
                        <h2>Live digit analysis</h2>
                        <p>Select a Synthetic Index and inspect its live last-digit behaviour.</p>
                    </div>
                    <span className='analysis-tool__coming-soon'>ENGINE BUILD IN PROGRESS</span>
                </div>
                <div className='analysis-tool__empty'>
                    <div className='analysis-tool__pulse' />
                    <h3>Your analysis workspace is ready</h3>
                    <p>The next stage connects live tick history and streaming data to calculate digit frequencies, percentages, streaks and Over / Under comparisons for all supported Synthetic Indices.</p>
                </div>
            </section>
            <p className='analysis-tool__disclaimer'>Analysis displays observed market data and statistical estimates. It cannot guarantee future outcomes.</p>
        </main>
    );
});

export default AnalysisTool;
