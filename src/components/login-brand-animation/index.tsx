import { useCallback, useEffect, useState } from 'react';
import './login-brand-animation.scss';

type LoginBrandAnimationProps = {
    onComplete: () => void;
};

const cards = ['Welcome', 'To', 'G - T', 'Pioneer'];
const cardNotes = [392, 493.88, 587.33, 783.99];
const cardDelays = [0.12, 0.76, 1.4, 2.04];

const LoginBrandAnimation = ({ onComplete }: LoginBrandAnimationProps) => {
    const [soundNeedsTap, setSoundNeedsTap] = useState(false);

    const playBrandSound = useCallback(async () => {
        try {
            const AudioContextConstructor = window.AudioContext;
            if (!AudioContextConstructor) {
                setSoundNeedsTap(true);
                return;
            }

            const audioContext = new AudioContextConstructor();
            await audioContext.resume();

            if (audioContext.state !== 'running') {
                setSoundNeedsTap(true);
                await audioContext.close();
                return;
            }

            setSoundNeedsTap(false);
            const startAt = audioContext.currentTime + 0.06;

            // A soft, warm cinematic pad under four ascending glassy chimes.
            const pad = audioContext.createOscillator();
            const padGain = audioContext.createGain();
            pad.type = 'sine';
            pad.frequency.setValueAtTime(130.81, startAt);
            padGain.gain.setValueAtTime(0.0001, startAt);
            padGain.gain.exponentialRampToValueAtTime(0.012, startAt + 0.35);
            padGain.gain.setValueAtTime(0.012, startAt + 2.5);
            padGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 3.1);
            pad.connect(padGain);
            padGain.connect(audioContext.destination);
            pad.start(startAt);
            pad.stop(startAt + 3.15);

            cardNotes.forEach((frequency, index) => {
                const noteAt = startAt + cardDelays[index];

                const chime = audioContext.createOscillator();
                const chimeGain = audioContext.createGain();
                chime.type = 'sine';
                chime.frequency.setValueAtTime(frequency, noteAt);
                chimeGain.gain.setValueAtTime(0.0001, noteAt);
                chimeGain.gain.exponentialRampToValueAtTime(0.085, noteAt + 0.035);
                chimeGain.gain.exponentialRampToValueAtTime(0.0001, noteAt + 0.62);
                chime.connect(chimeGain);
                chimeGain.connect(audioContext.destination);
                chime.start(noteAt);
                chime.stop(noteAt + 0.66);

                const shimmer = audioContext.createOscillator();
                const shimmerGain = audioContext.createGain();
                shimmer.type = 'triangle';
                shimmer.frequency.setValueAtTime(frequency * 2, noteAt);
                shimmerGain.gain.setValueAtTime(0.0001, noteAt);
                shimmerGain.gain.exponentialRampToValueAtTime(0.018, noteAt + 0.025);
                shimmerGain.gain.exponentialRampToValueAtTime(0.0001, noteAt + 0.38);
                shimmer.connect(shimmerGain);
                shimmerGain.connect(audioContext.destination);
                shimmer.start(noteAt);
                shimmer.stop(noteAt + 0.42);
            });

            window.setTimeout(() => {
                void audioContext.close();
            }, 3700);
        } catch {
            // Some mobile browsers require a direct tap before allowing audio.
            setSoundNeedsTap(true);
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(onComplete, 3300);
        void playBrandSound();

        return () => window.clearTimeout(timer);
    }, [onComplete, playBrandSound]);

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
            {soundNeedsTap && (
                <button
                    type='button'
                    className='gk-login-animation__sound-button'
                    onClick={() => void playBrandSound()}
                >
                    <span aria-hidden='true'>♫</span> Tap for sound
                </button>
            )}
        </div>
    );
};

export default LoginBrandAnimation;
