
export default function ChunkLoader({ message }: { message: string }) {
    return (
        <div className='app-root gtraders-loader'>
            <div className='gtraders-loader__content'>
                <div className='gtraders-loader__logo'>
                    <div className='gtraders-loader__logo-ring'>
                        <span className='gtraders-loader__logo-letter'>G</span>
                    </div>

                    <div className='gtraders-loader__brand'>
                        <span className='gtraders-loader__brand-name'>
                            GTRADERS
                        </span>
                        <span className='gtraders-loader__brand-subtitle'>
                            SUPER
                        </span>
                    </div>
                </div>

                <div className='gtraders-loader__status'>
                    <div className='gtraders-loader__progress'>
                        <span />
                    </div>

                    <p className='gtraders-loader__message'>
                        {message || 'Initializing GTraders Super...'}
                    </p>
                </div>

                <div className='gtraders-loader__footer'>
                    PROFESSIONAL TRADING INTELLIGENCE
                </div>
            </div>
        </div>
    );
}
