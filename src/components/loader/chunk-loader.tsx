
type ChunkLoaderProps = {
    message?: string;
    progress?: number;
    isConnected?: boolean;
};

const startupStages = [
    { icon: '▣', label: 'AI Engine', threshold: 15 },
    { icon: '☁', label: 'Deriv Connection', threshold: 30 },
    { icon: '◉', label: 'Scanner Engine', threshold: 45 },
    { icon: '▥', label: 'Signal Engine', threshold: 60 },
    { icon: '◆', label: 'AI Coach', threshold: 75 },
    { icon: '◎', label: 'Live Market Data', threshold: 90 },
    { icon: '▣', label: 'Dashboard Ready', threshold: 100 },
];

export default function ChunkLoader({
    message = 'Initializing GTraders Super...',
    progress = 0,
    isConnected = false,
}: ChunkLoaderProps) {
    const percentage = Math.max(
        0,
        Math.min(100, Math.round(progress))
    );

    const connectionInterrupted =
        message.toLowerCase().includes('interrupted') ||
        message.toLowerCase().includes('unavailable');

    return (
        <div className='app-root gtraders-loader'>
            <div className='gtraders-loader__background'>
                <div className='gtraders-loader__world-map' />

                <div className='gtraders-loader__chart gtraders-loader__chart--left'>
                    <svg viewBox='0 0 180 100' aria-hidden='true'>
                        <path
                            d='M0 75 L20 62 L38 70 L55 38 L75 48 L95 22 L115 40 L135 15 L155 25 L180 5'
                            fill='none'
                            stroke='#16baff'
                            strokeWidth='2'
                        />
                    </svg>
                </div>

                <div className='gtraders-loader__chart gtraders-loader__chart--right'>
                    <svg viewBox='0 0 180 120' aria-hidden='true'>
                        {Array.from({ length: 10 }, (_, i) => (
                            <g key={i}>
                                <line
                                    x1={12 + i * 17}
                                    y1={15 + (i % 4) * 8}
                                    x2={12 + i * 17}
                                    y2={85 + (i % 3) * 5}
                                    stroke='#16baff'
                                    strokeWidth='2'
                                />
                                <rect
                                    x={7 + i * 17}
                                    y={35 + (i % 4) * 8}
                                    width='10'
                                    height='28'
                                    rx='2'
                                    fill={i % 2 === 0 ? '#00e5ff' : '#16baff'}
                                />
                            </g>
                        ))}
                    </svg>
                </div>

                <div className='gtraders-loader__phone gtraders-loader__phone--left'>
                    <span>LIVE MARKET</span>
                    <div className='gtraders-loader__phone-line' />
                    <div className='gtraders-loader__phone-line' />
                    <div className='gtraders-loader__phone-chart'>
                        ╱╲___╱╲__
                    </div>
                    <span>AI ANALYSIS</span>
                    <strong>ACTIVE</strong>
                </div>

                <div className='gtraders-loader__phone gtraders-loader__phone--right'>
                    <span>MARKET SCANNER</span>
                    <div className='gtraders-loader__phone-line' />
                    <div className='gtraders-loader__phone-line' />
                    <div className='gtraders-loader__phone-chart'>
                        __╱╲__╱╲
                    </div>
                    <span>TRADING DATA</span>
                    <strong>CONNECTED</strong>
                </div>
            </div>

            <div className='gtraders-loader__content'>
                <div className='gtraders-loader__emblem'>
                    <div className='gtraders-loader__ring gtraders-loader__ring--outer' />
                    <div className='gtraders-loader__ring gtraders-loader__ring--middle' />
                    <div className='gtraders-loader__ring gtraders-loader__ring--inner' />

                    <div className='gtraders-loader__emblem-core'>
                        <span>GTS</span>
                    </div>
                </div>

                <div className='gtraders-loader__brand'>
                    <h1>GTraders <span>Super</span></h1>
                    <p>PROFESSIONAL AI TRADING INTELLIGENCE</p>
                </div>

                <div className='gtraders-loader__status-list'>
                    {startupStages.map((stage, index) => {
                        const completed =
                            index === 1
                                ? isConnected
                                : percentage >= stage.threshold &&
                                  !(connectionInterrupted && index > 1);

                        const active =
                            !completed &&
                            percentage >= (index === 0 ? 0 : startupStages[index - 1].threshold);

                        return (
                            <div
                                className='gtraders-loader__status-row'
                                key={stage.label}
                            >
                                <span className='gtraders-loader__status-icon'>
                                    {stage.icon}
                                </span>

                                <span className='gtraders-loader__status-label'>
                                    {stage.label}
                                </span>

                                <span className='gtraders-loader__status-check'>
                                    {completed ? '✓' : active ? '◌' : '○'}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <div className='gtraders-loader__loading'>
                    <div
                        className='gtraders-loader__progress'
                        role='progressbar'
                        aria-label='GTraders Super startup progress'
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percentage}
                    >
                        <span style={{ width: `${percentage}%` }} />
                    </div>

                    <div className='gtraders-loader__percentage'>
                        {percentage}%
                    </div>

                    <p className='gtraders-loader__message' role='status'>
                        {message}
                    </p>
                </div>

                <div className='gtraders-loader__footer'>
                    GTRADERS SUPER · PROFESSIONAL TRADING INTELLIGENCE
                </div>
            </div>
        </div>
    );
}
