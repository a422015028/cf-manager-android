"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markAccountExhausted = markAccountExhausted;
exports.initBrowserRateLimiter = initBrowserRateLimiter;
exports.getBrowserRenderStatus = getBrowserRenderStatus;
exports.acquireToken = acquireToken;
const account_1 = require("../models/account");
const accountRouter_1 = require("./accountRouter");
const logger_1 = require("./logger");
const quotaUsage_1 = require("../models/quotaUsage");
const TOKEN_INTERVAL_MS = 10_000;
const buckets = new Map();
let dailyResetTimer = null;
function ensureBuckets() {
    const accounts = (0, account_1.getActiveAccountsByFeature)('browser_render');
    for (const acct of accounts) {
        if (!buckets.has(acct.id)) {
            buckets.set(acct.id, { accountId: acct.id, lastUsedAt: 0, exhausted: false });
        }
    }
    for (const [id] of buckets) {
        if (!accounts.find(a => a.id === id)) {
            buckets.delete(id);
        }
    }
}
function markAccountExhausted(accountId) {
    const bucket = buckets.get(accountId);
    if (bucket)
        bucket.exhausted = true;
    // 同步持久化到数据库，使 /quota 接口与前端仪表盘能正确反映耗尽状态
    (0, quotaUsage_1.setExhausted)(accountId, 'browser_render_seconds');
    (0, accountRouter_1.clearCache)();
    logger_1.appLogger.info(`[BrowserRL] Account ${accountId} marked as exhausted (CF daily limit)`);
}
function resetAllExhausted() {
    let count = 0;
    for (const bucket of buckets.values()) {
        if (bucket.exhausted) {
            bucket.exhausted = false;
            count++;
        }
    }
    if (count > 0) {
        (0, accountRouter_1.clearCache)();
        logger_1.appLogger.info(`[BrowserRL] Daily reset: cleared exhausted flag on ${count} account(s)`);
    }
}
function msUntilNextUTCMidnight() {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return tomorrow.getTime() - now.getTime();
}
function scheduleDailyReset() {
    if (dailyResetTimer)
        clearTimeout(dailyResetTimer);
    const ms = msUntilNextUTCMidnight();
    dailyResetTimer = setTimeout(() => {
        resetAllExhausted();
        scheduleDailyReset();
    }, ms);
    const resetAt = new Date(Date.now() + ms);
    logger_1.appLogger.info(`[BrowserRL] Next daily reset scheduled at ${resetAt.toISOString()} (in ${Math.round(ms / 60000)} min)`);
}
function initBrowserRateLimiter() {
    scheduleDailyReset();
}
function getBrowserRenderStatus() {
    ensureBuckets();
    const accounts = (0, account_1.getActiveAccountsByFeature)('browser_render');
    let available = 0;
    for (const account of accounts) {
        const bucket = buckets.get(account.id);
        if (bucket && !bucket.exhausted)
            available++;
    }
    return { available_accounts: available, total_accounts: accounts.length, token_interval_ms: TOKEN_INTERVAL_MS };
}
function acquireToken() {
    ensureBuckets();
    const accounts = (0, account_1.getActiveAccountsByFeature)('browser_render');
    const now = Date.now();
    let shortestWait = Infinity;
    let hasAvailableAccount = false;
    for (const account of accounts) {
        const bucket = buckets.get(account.id);
        if (!bucket || bucket.exhausted)
            continue;
        hasAvailableAccount = true;
        const elapsed = now - bucket.lastUsedAt;
        if (elapsed >= TOKEN_INTERVAL_MS) {
            // 立即消费令牌，设置 lastUsedAt = now（不堆叠，不管空闲了多久都只给1个）
            bucket.lastUsedAt = now;
            return { type: 'ok', account };
        }
        const waitMs = TOKEN_INTERVAL_MS - elapsed;
        if (waitMs < shortestWait) {
            shortestWait = waitMs;
        }
    }
    if (!hasAvailableAccount) {
        return { type: 'all_exhausted' };
    }
    return { type: 'rate_limited', waitMs: shortestWait };
}
//# sourceMappingURL=browserRateLimiter.js.map