
type ChunkLoaderProps = {
    message?: string;
    progress?: number;
    isConnected?: boolean;
};

const startupStages = [
    { icon: '▣', label: 'Core Application', threshold: 15 },
    { icon: '☁', label: 'Deriv Connection', threshold: 30 },
    { icon: '◉', label: 'Market Scanner', threshold: 45 },
    { icon: '▥', label: 'Signal Engine', threshold: 60 },
    { icon: '◆', label: 'AI Intelligence', threshold: 75 },
    { icon: '◎', label: 'Blockly Workspace', threshold: 92 },
    { icon: '▣', label: 'Dashboard Ready', threshold: 100 },
];

export default function ChunkLoader({
    message = 'Initializing GTraders Super...',
    progress = 0,
    isConnected = false,
}: ChunkLoaderProps) {
    const percentage = Math.max(0, Math.min(100, Math.round(progress)));

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
                        <img
                            src='data:image/jpeg;base64,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'
                            alt='G - T Pioneer royal eagle'
                            style={{ width: '100%', height: '100%', objectFit: 'contain', mixBlendMode: 'screen' }}
                        />
                    </div>
                </div>

                <div className='gtraders-loader__brand'>
                    <h1>
                        G - T <span>Pioneer</span>
                    </h1>
                    <p>PROFESSIONAL AI TRADING INTELLIGENCE</p>
                </div>

                <div className='gtraders-loader__status-list'>
                    {startupStages.map((stage, index) => {
                        const isConnectionStage = index === 1;

                        const completed = isConnectionStage
                            ? isConnected
                            : percentage >= stage.threshold &&
                              !(connectionInterrupted && index > 1);

                        const previousThreshold =
                            index === 0
                                ? 0
                                : startupStages[index - 1].threshold;

                        const active =
                            !completed &&
                            percentage >= previousThreshold &&
                            !(connectionInterrupted && index > 1);

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
