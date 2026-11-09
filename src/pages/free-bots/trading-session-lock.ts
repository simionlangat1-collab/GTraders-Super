/**
 * Single-owner guard for the shared Deriv trading interpreter.
 *
 * Free Bots and G-K Pioneer must never start competing execution sessions.
 * This is deliberately in-memory: it coordinates the live app session and
 * does not persist a stale lock across reloads.
 */
export type TTradingSessionOwner = 'G-T Sniper XVT' | 'G-K Pioneer';

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
        if (this.activeOwner === owner) {
            this.activeOwner = null;
        }
    }

    isOwnedBy(owner: TTradingSessionOwner): boolean {
        return this.activeOwner === owner;
    }
}

export const tradingSessionLock = new TradingSessionLock();
