export type TTradingSessionOwner = 'Bot Builder' | 'G-K Pioneer' | 'G-T Sniper XVT';

class TradingSessionLock {
    private activeOwner: TTradingSessionOwner | null = null;

    get owner(): TTradingSessionOwner | null {
        return this.activeOwner;
    }

    acquire(owner: TTradingSessionOwner): boolean {
        if (this.activeOwner && this.activeOwner !== owner) return false;
        this.activeOwner = owner;
        return true;
    }

    release(owner: TTradingSessionOwner): void {
        if (this.activeOwner === owner) this.activeOwner = null;
    }

    isOwnedBy(owner: TTradingSessionOwner): boolean {
        return this.activeOwner === owner;
    }
}

export const tradingSessionLock = new TradingSessionLock();
