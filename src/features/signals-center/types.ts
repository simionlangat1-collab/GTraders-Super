export type SignalTick = {
    symbol: string;
    quote: number;
    epoch: number;
    digit: number;
};

export type OverTwoSignalStatus = 'BUY_OVER_2' | 'WAIT';

export type OverTwoAnalysis = {
    status: OverTwoSignalStatus;
    sampleSize: number;
    qualifyingDigits: number;
    qualifyingPercentage: number;
    thresholdPercentage: number;
    digitFrequencies: Record<number, number>;
};

export type SignalCenterSnapshot = {
    selectedSymbol: string | null;
    ticks: SignalTick[];
};
