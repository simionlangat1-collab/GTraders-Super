type TBrandLogoProps = {
    width?: number;
    height?: number;
    fill?: string;
    className?: string;
};

export const BrandLogo = ({
    width = 148,
    height = 40,
    className = '',
}: TBrandLogoProps) => (
    <svg
        width={width}
        height={height}
        viewBox='0 0 300 64'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        className={className}
        role='img'
        aria-label='G-K Pioneer'
        preserveAspectRatio='xMinYMid meet'
    >
        <defs>
            <linearGradient id='gk-blue' x1='12' y1='8' x2='105' y2='58' gradientUnits='userSpaceOnUse'>
                <stop stopColor='#42E8FF' />
                <stop offset='0.52' stopColor='#168BFF' />
                <stop offset='1' stopColor='#0753D8' />
            </linearGradient>
            <linearGradient id='gk-silver' x1='20' y1='20' x2='83' y2='58' gradientUnits='userSpaceOnUse'>
                <stop stopColor='#FFFFFF' />
                <stop offset='1' stopColor='#AFC7E8' />
            </linearGradient>
        </defs>

        {/* Royal crown above the GK monogram */}
        <path
            d='M29 17L19 7L17 19L7 13L13 28H79L85 13L75 19L73 7L63 17L51 3L46 18L41 3L29 17Z'
            fill='#F8D66D'
            stroke='#D99A25'
            strokeWidth='1.5'
            strokeLinejoin='round'
        />
        <path d='M13 28H79V33H13V28Z' fill='#D99A25' />

        {/* Bold GK monogram */}
        <text x='5' y='57' fontFamily='Arial, Helvetica, sans-serif' fontSize='49' fontWeight='800' letterSpacing='-5' fill='url(#gk-silver)'>G</text>
        <text x='48' y='57' fontFamily='Arial, Helvetica, sans-serif' fontSize='49' fontWeight='800' letterSpacing='-4' fill='url(#gk-blue)'>K</text>

        {/* Electric-blue forward slash */}
        <path d='M2 58L104 18' stroke='#35DFFF' strokeWidth='4' strokeLinecap='round' />
        <path d='M2 58L104 18' stroke='#087BFF' strokeWidth='1.5' strokeLinecap='round' />

        {/* G-K Pioneer wordmark */}
        <text x='119' y='34' fontFamily='Arial, Helvetica, sans-serif' fontSize='27' fontWeight='800' letterSpacing='0.3' fill='#F4F8FF'>G-K</text>
        <text x='119' y='57' fontFamily='Arial, Helvetica, sans-serif' fontSize='22' fontWeight='800' letterSpacing='1.2' fill='#20A8FF'>PIONEER</text>
    </svg>
);
