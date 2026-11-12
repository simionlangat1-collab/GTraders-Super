import { useCallback, useEffect, useRef, useState } from 'react';
import './login-brand-animation.scss';

type LoginBrandAnimationProps = {
    onComplete: () => void;
};

const cards = ['Welcome', 'To', 'G - T', 'Pioneer'];
const cardNotes = [392, 493.88, 587.33, 783.99];
const cardDelays = [0.12, 0.76, 1.4, 2.04];

const LoginBrandAnimation = ({ onComplete }: LoginBrandAnimationProps) => {
    const [hasStarted, setHasStarted] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const completionTimerRef = useRef<number | null>(null);

    const playBrandSound = useCallback(async () => {
        const AudioContextConstructor = window.AudioContext;
        if (!AudioContextConstructor) return;

        const audioContext = new AudioContextConstructor();
        audioContextRef.current = audioContext;
        await audioContext.resume();

        if (audioContext.state !== 'running') {
            await audioContext.close();
            audioContextRef.current = null;
            return;
        }

        const startAt = audioContext.currentTime + 0.04;

        // Original G - T Pioneer cinematic sound: warm sustained pad and four glass chimes.
        const pad = audioContext.createOscillator();
        const padGain = audioContext.createGain();
        pad.type = 'sine';
        pad.frequency.setValueAtTime(130.81, startAt);
        padGain.gain.setValueAtTime(0.0001, startAt);
        padGain.gain.exponentialRampToValueAtTime(0.016, startAt + 0.38);
        padGain.gain.setValueAtTime(0.016, startAt + 2.75);
        padGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 3.25);
        pad.connect(padGain);
        padGain.connect(audioContext.destination);
        pad.start(startAt);
        pad.stop(startAt + 3.3);

        cardNotes.forEach((frequency, index) => {
            const noteAt = startAt + cardDelays[index];

            const chime = audioContext.createOscillator();
            const chimeGain = audioContext.createGain();
            chime.type = 'sine';
            chime.frequency.setValueAtTime(frequency, noteAt);
            chimeGain.gain.setValueAtTime(0.0001, noteAt);
            chimeGain.gain.exponentialRampToValueAtTime(0.105, noteAt + 0.04);
            chimeGain.gain.exponentialRampToValueAtTime(0.0001, noteAt + 0.72);
            chime.connect(chimeGain);
            chimeGain.connect(audioContext.destination);
            chime.start(noteAt);
            chime.stop(noteAt + 0.76);

            const shimmer = audioContext.createOscillator();
            const shimmerGain = audioContext.createGain();
            shimmer.type = 'triangle';
            shimmer.frequency.setValueAtTime(frequency * 2, noteAt);
            shimmerGain.gain.setValueAtTime(0.0001, noteAt);
            shimmerGain.gain.exponentialRampToValueAtTime(0.024, noteAt + 0.03);
            shimmerGain.gain.exponentialRampToValueAtTime(0.0001, noteAt + 0.44);
            shimmer.connect(shimmerGain);
            shimmerGain.connect(audioContext.destination);
            shimmer.start(noteAt);
            shimmer.stop(noteAt + 0.48);
        });

        window.setTimeout(() => {
            void audioContext.close();
            if (audioContextRef.current === audioContext) audioContextRef.current = null;
        }, 3900);
    }, []);

    const startAnimation = useCallback(() => {
        // A direct user tap allows Android Chrome to start the synchronized audio.
        void playBrandSound();
        setHasStarted(true);
    }, [playBrandSound]);

    useEffect(() => {
        if (!hasStarted) return;

        completionTimerRef.current = window.setTimeout(onComplete, 3300);
        return () => {
            if (completionTimerRef.current !== null) {
                window.clearTimeout(completionTimerRef.current);
            }
        };
    }, [hasStarted, onComplete]);

    useEffect(() => () => {
        if (audioContextRef.current) void audioContextRef.current.close();
    }, []);

    return (
        <div className={'gk-login-animation' + (hasStarted ? ' gk-login-animation--started' : '')} role='status' aria-label='Welcome to G - T Pioneer'>
            <div className='gk-login-animation__ambient gk-login-animation__ambient--top' />
            <div className='gk-login-animation__ambient gk-login-animation__ambient--bottom' />
            <div className='gk-login-animation__digital-dust' />
            <div className='gk-login-animation__stack'>
                {cards.map((label, index) => (
                    <div
                        className={'gk-login-animation__card gk-login-animation__card--' + (index + 1)}
                        key={label}
                    >
                        <span>{label}</span>
                        <i aria-hidden='true' />
                    </div>
                ))}
            </div>
            {!hasStarted && (
                <button
                    type='button'
                    className='gk-login-animation__sound-button'
                    onClick={startAnimation}
                >
                    <span aria-hidden='true'>♫</span> Tap to begin with sound
                </button>
            )}
        </div>
    );
};

export default LoginBrandAnimation;
