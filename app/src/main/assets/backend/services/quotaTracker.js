"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackUsage = trackUsage;
exports.syncUsageFromCloudflare = syncUsageFromCloudflare;
exports.getQuotaSummary = getQuotaSummary;
exports.getAccountQuota = getAccountQuota;
const quotaUsage_1 = require("../models/quotaUsage");
const account_1 = require("../models/account");
const aiService_1 = require("./aiService");
const workerService_1 = require("./workerService");
const logger_1 = require("./logger");
const concurrent_1 = require("../utils/concurrent");
const LIMITS = {
    workers_requests: 100000,
    ai_neurons: 10000,
    browser_render_seconds: 600,
};
function trackUsage(accountId, resource, amount = 1) {
    (0, quotaUsage_1.incrementQuota)(accountId, resource, amount);
}
const RESOURCE_FEATURE = {
    workers_requests: 'workers',
    ai_neurons: 'ai',
    browser_render_seconds: 'browser_render',
};
/** 并发同步最大并发数 */
const SYNC_CONCURRENCY = 6;
/** 正在执行中的同步 Promise，用于防重入与并发请求去重 */
let inFlightSyncPromise = null;
async function syncUsageFromCloudflare() {
    if (inFlightSyncPromise) {
        return inFlightSyncPromise;
    }
    inFlightSyncPromise = executeSyncFromCloudflare().finally(() => {
        inFlightSyncPromise = null;
    });
    return inFlightSyncPromise;
}
async function executeSyncFromCloudflare() {
    const accounts = (0, account_1.getActiveAccounts)();
    await (0, concurrent_1.mapConcurrent)(accounts, SYNC_CONCURRENCY, async (account) => {
        if ((0, account_1.hasFeature)(account, 'ai')) {
            try {
                const aiUsage = await (0, aiService_1.getAiUsageToday)(account);
                // 只有当 CF 返回非零值才更新（避免覆盖本地估算数据）
                if (aiUsage.totalNeurons > 0) {
                    (0, quotaUsage_1.setQuota)(account.id, 'ai_neurons', Math.round(aiUsage.totalNeurons));
                    // 不清除 exhausted 标记：exhausted 是 CF 返回 4006 时设置的，
                    // 表示当天免费额度已用完。即使 CF 使用量查询返回了 > 0 的值
                    // （今天用了多少 neurons），也不代表额度没用完。
                    // exhausted 标记只应通过日期变化（第二天自动消失）或手动清除。
                }
                else {
                    logger_1.appLogger.warn(`[Sync] AI usage returned 0 for ${account.name}, keeping local estimate`);
                }
            }
            catch (e) {
                logger_1.appLogger.error(`[Sync] AI usage failed for ${account.name}: ${e}`);
            }
        }
        if ((0, account_1.hasFeature)(account, 'workers')) {
            try {
                const workersUsage = await (0, workerService_1.getWorkersUsageToday)(account);
                // 只有当 CF 返回非零值才更新
                if (workersUsage.requests > 0) {
                    (0, quotaUsage_1.setQuota)(account.id, 'workers_requests', workersUsage.requests);
                }
                else {
                    logger_1.appLogger.warn(`[Sync] Workers usage returned 0 for ${account.name}, keeping local estimate`);
                }
            }
            catch (e) {
                logger_1.appLogger.error(`[Sync] Workers usage failed for ${account.name}: ${e}`);
            }
        }
    });
}
function getQuotaSummary() {
    const accounts = (0, account_1.getActiveAccounts)();
    const usage = (0, quotaUsage_1.getAllQuotaToday)();
    const resourceTypes = Object.keys(LIMITS);
    return accounts.map(account => {
        const resources = resourceTypes
            .filter(resource => (0, account_1.hasFeature)(account, RESOURCE_FEATURE[resource]))
            .map(resource => {
            const row = usage.find(u => u.account_id === account.id && u.resource === resource);
            const count = row?.count || 0;
            const limit = LIMITS[resource];
            const exhausted = row?.exhausted === 1;
            return { resource, count, limit, remaining: Math.max(0, limit - count), exhausted };
        });
        return { accountId: account.id, accountName: account.name, resources };
    });
}
function getAccountQuota(accountId, resource) {
    const today = new Date().toISOString().split('T')[0];
    const usage = (0, quotaUsage_1.getQuotaByAccount)(accountId, resource, today);
    const used = usage?.count || 0;
    const limit = LIMITS[resource] || 0;
    return { used, remaining: Math.max(0, limit - used) };
}
//# sourceMappingURL=quotaTracker.js.map