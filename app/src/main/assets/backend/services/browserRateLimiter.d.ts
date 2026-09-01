import { Account } from '../models/account';
export declare function markAccountExhausted(accountId: number): void;
export declare function initBrowserRateLimiter(): void;
export type AcquireResult = {
    type: 'ok';
    account: Account;
} | {
    type: 'rate_limited';
    waitMs: number;
} | {
    type: 'all_exhausted';
};
export interface BrowserRenderStatus {
    available_accounts: number;
    total_accounts: number;
    token_interval_ms: number;
}
export declare function getBrowserRenderStatus(): BrowserRenderStatus;
export declare function acquireToken(): AcquireResult;
//# sourceMappingURL=browserRateLimiter.d.ts.map