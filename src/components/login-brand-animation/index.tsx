import { useEffect } from 'react';
import './login-brand-animation.scss';

type LoginBrandAnimationProps = {
    onComplete: () => void;
};

const cards = ['Welcome', 'To', 'G - T', 'Pioneer'];

const LoginBrandAnimation = ({ onComplete }: LoginBrandAnimationProps) => {
    useEffect(() => {
        const timer = window.setTimeout(onComplete, 2800);
        return () => window.clearTimeout(timer);
    }, [onComplete]);

    return (
        <div className='gk-login-animation' role='status' aria-label='Welcome to G - T Pioneer'>
            <div className='gk-login-animation__ambient gk-login-animation__ambient--top' />
            <div className='gk-login-animation__ambient gk-login-animation__ambient--bottom' />
            <div className='gk-login-animation__digital-dust' />
            <div className='gk-login-animation__stack'>
                {cards.map((label, index) => (
                    <div
                        className={`gk-login-animation__card gk-login-animation__card--${index + 1}`}
                        key={label}
                    >
                        <span>{label}</span>
                        <i aria-hidden='true' />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default LoginBrandAnimation;
