import { observer } from 'mobx-react-lite';
import './analysis-tool.scss';

const DTIDE_ANALYZER_URL = 'https://dtide.co.ke/digitanalysistool';

const AnalysisTool = observer(() => (
    <main className='analysis-tool'>
        <header className='analysis-tool__header'>
            <div>
                <span className='analysis-tool__eyebrow'>GTRADERS SUPER · MARKET INTELLIGENCE</span>
                <h1>Live Digit Analyzer</h1>
                <p>Live digit frequency, rolling samples and contract-specific market analysis.</p>
            </div>
            <a
                className='analysis-tool__open-link'
                href={DTIDE_ANALYZER_URL}
                target='_blank'
                rel='noopener noreferrer'
            >
                Open analyzer in new tab
            </a>
        </header>

        <section className='analysis-tool__notice'>
            <strong>DTide Live Analyzer</strong>
            <span>
                This analysis service is independently operated by DTide. Its market data, analysis and availability
                are provided by DTide, not by GTraders Super or Deriv.
            </span>
        </section>

        <section className='analysis-tool__frame-wrap' aria-label='DTide live digit analyzer'>
            <iframe
                className='analysis-tool__frame'
                src={DTIDE_ANALYZER_URL}
                title='DTide Live Deriv Digit Analyzer'
                loading='eager'
                referrerPolicy='strict-origin-when-cross-origin'
                allow='fullscreen; clipboard-read; clipboard-write'
                allowFullScreen
            />
        </section>

        <p className='analysis-tool__disclaimer'>
            Analysis is statistical context, not a guarantee of the next outcome. Confirm the market, contract,
            stake and session limits before trading.
        </p>
    </main>
));

export default AnalysisTool;
