"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllZones = getAllZones;
exports.findAccountByDomain = findAccountByDomain;
exports.selectBestAccount = selectBestAccount;
exports.invalidateAiCache = invalidateAiCache;
exports.updateAiCacheAfterUsage = updateAiCacheAfterUsage;
exports.removeAccountFromAiCache = removeAccountFromAiCache;
exports.clearCache = clearCache;
const node_cache_1 = __importDefault(require("node-cache"));
const account_1 = require("../models/account");
const cfFactory_1 = require("./cfFactory");
const quotaTracker_1 = require("./quotaTracker");
const quotaUsage_1 = require("../models/quotaUsage");
const logger_1 = require("./logger");
const model_pricing_json_1 = __importDefault(require("../data/model-pricing.json"));
const ZONES_CACHE_TTL = 300; // 5 minutes
const QUOTA_CACHE_TTL = 60; // 1 minute
const AI_CACHE_KEY = 'ai_neuron_snapshot';
const AI_CACHE_TTL = 600; // 10 min
/** Threshold for cache affinity: prefer last-used account if it's within this many neurons of the best. */
const CACHE_AFFINITY_THRESHOLD = 10000;
/** Track the last successfully used AI account for cache-affine routing. */
let lastUsedAiAccount = null;
/** Check if a model supports prompt caching (has cachedInput in pricing). */
function modelSupportsCaching(model) {
    return !!model_pricing_json_1.default.models[model]?.cachedInput;
}
const zonesCache = new node_cache_1.default({ stdTTL: ZONES_CACHE_TTL });
const quotaCache = new node_cache_1.default({ stdTTL: QUOTA_CACHE_TTL });
async function getAllZones() {
    const cacheKey = 'all_zones';
    const cached = zonesCache.get(cacheKey);
    if (cached)
        return cached;
    const accounts = (0, account_1.getActiveAccountsByFeature)('dns');
    const results = await Promise.all(accounts.map(async (account) => {
        try {
            const cf = (0, cfFactory_1.getCfClient)(account);
            const zones = [];
            for await (const zone of cf.zones.list({ per_page: 100 })) {
                zones.push(zone);
            }
            return zones.map(zone => ({ ...zone, cfAccountId: account.id, accountName: account.name }));
        }
        catch (err) {
            logger_1.appLogger.error(`Failed to fetch zones for account ${account.name}: ${err}`);
            return [];
        }
    }));
    const allZones = results.flat();
    zonesCache.set(cacheKey, allZones);
    return allZones;
}
async function findAccountByDomain(domain) {
    const zones = await getAllZones();
    const zone = zones.find(z => z.name === domain);
    if (!zone) {
        throw Object.assign(new Error(`Domain ${domain} not found in any account`), { statusCode: 404, code: 'DOMAIN_NOT_FOUND' });
    }
    const account = (0, account_1.getActiveAccounts)().find(a => a.id === zone.cfAccountId);
    if (!account) {
        throw Object.assign(new Error('Account not found'), { statusCode: 500, code: 'ACCOUNT_NOT_FOUND' });
    }
    return { account, zoneId: zone.id };
}
const RESOURCE_FEATURE_MAP = {
    ai_neurons: 'ai',
    workers_requests: 'workers',
    browser_render_seconds: 'browser_render',
};
function getAiAccountSnapshot() {
    const cached = quotaCache.get(AI_CACHE_KEY);
    if (cached && cached.length > 0) {
        logger_1.appLogger.debug(`[AccountRouter] Using cached AI snapshot: ${cached.length} accounts, first=${cached[0]?.account.name}, used=${cached[0]?.used}`);
        return cached;
    }
    const accounts = (0, account_1.getActiveAccountsByFeature)('ai');
    logger_1.appLogger.info(`[AccountRouter] Found ${accounts.length} active accounts with AI feature`);
    const usageRows = (0, quotaUsage_1.getQuotaTodayByResource)('ai_neurons');
    const usageMap = new Map(usageRows.map(r => [r.account_id, r]));
    const ranked = accounts
        .map(account => {
        const usage = usageMap.get(account.id);
        const used = usage?.count || 0;
        const exhausted = usage?.exhausted === 1;
        logger_1.appLogger.debug(`[AccountRouter] Account ${account.name}: used=${used}, exhausted=${exhausted}`);
        return { account, used, exhausted };
    })
        .filter(r => !r.exhausted)
        .sort((a, b) => a.used - b.used)
        .map(r => ({ account: r.account, used: r.used }));
    logger_1.appLogger.info(`[AccountRouter] Final ranked list: ${ranked.map(r => `${r.account.name}(${r.used})`).join(', ')}`);
    quotaCache.set(AI_CACHE_KEY, ranked, AI_CACHE_TTL);
    return ranked;
}
async function selectBestAccount(resource, excludeIds, model) {
    if (resource === 'ai_neurons') {
        const list = getAiAccountSnapshot();
        // 按实际用量 + 乐观预估量排序，避免并发选中同一账户
        list.sort((a, b) => (a.used + (a._optimistic || 0)) - (b.used + (b._optimistic || 0)));
        const best = list.find(r => !excludeIds?.has(r.account.id));
        if (!best)
            return null;
        const supportsCaching = model ? modelSupportsCaching(model) : false;
        // 缓存模型：优先复用最近使用的账户（软粘性），提升缓存命中率
        if (supportsCaching && lastUsedAiAccount) {
            const recent = list.find(r => r.account.id === lastUsedAiAccount.id && !excludeIds?.has(r.account.id));
            if (recent && recent !== best) {
                const bestScore = best.used + (best._optimistic || 0);
                const recentScore = (recent.used || 0) + (recent._optimistic || 0);
                if (recentScore - bestScore <= CACHE_AFFINITY_THRESHOLD) {
                    // 粘性：recent 没比 best 贵太多，值得为了缓存命中复用
                    logger_1.appLogger.debug(`[AccountRouter] Cache affinity: reusing ${recent.account.name} (gap=${recentScore - bestScore} <= ${CACHE_AFFINITY_THRESHOLD})`);
                    recent._optimistic = (recent._optimistic || 0) + 1000;
                    lastUsedAiAccount = { id: recent.account.id, time: Date.now() };
                    return recent.account;
                }
            }
        }
        // 选 best（无缓存 或 缓存模型但粘性不划算）
        const selected = best;
        selected._optimistic = (selected._optimistic || 0) + 1000;
        if (supportsCaching) {
            lastUsedAiAccount = { id: selected.account.id, time: Date.now() };
        }
        logger_1.appLogger.debug(`[AccountRouter] Selected account: ${selected.account.name} (optimistic +1000, total optimistic: ${selected._optimistic})`);
        return selected.account;
    }
    // 非 ai_neurons 分支保持原逻辑
    const cacheKey = `best_account_${resource}`;
    const cached = quotaCache.get(cacheKey);
    if (cached)
        return cached.account;
    const feature = RESOURCE_FEATURE_MAP[resource];
    const accounts = feature ? (0, account_1.getActiveAccountsByFeature)(feature) : (0, account_1.getActiveAccounts)();
    if (accounts.length === 0)
        return null;
    let best = accounts[0];
    let bestRemaining = -1;
    for (const account of accounts) {
        const { remaining } = (0, quotaTracker_1.getAccountQuota)(account.id, resource);
        if (remaining > bestRemaining) {
            bestRemaining = remaining;
            best = account;
        }
    }
    quotaCache.set(cacheKey, { account: best });
    return best;
}
function invalidateAiCache() {
    quotaCache.del(AI_CACHE_KEY);
}
function updateAiCacheAfterUsage(accountId, neurons) {
    const list = quotaCache.get(AI_CACHE_KEY);
    if (!list) {
        logger_1.appLogger.warn(`[AccountRouter] updateAiCacheAfterUsage: cache not found for account ${accountId}`);
        return;
    }
    const item = list.find(r => r.account.id === accountId);
    if (item) {
        const oldUsed = item.used;
        const oldOptimistic = item._optimistic || 0;
        // 加固用量，清除乐观预估
        item.used += neurons;
        delete item._optimistic;
        // 重新按实际用量 + 剩余乐观预估排序
        list.sort((a, b) => (a.used + (a._optimistic || 0)) - (b.used + (b._optimistic || 0)));
        logger_1.appLogger.info(`[AccountRouter] Updated cache: ${item.account.name} ${oldUsed} → ${item.used} (+${neurons} real, cleared ${oldOptimistic} optimistic), new order: ${list.map(r => `${r.account.name}(${r.used}+${r._optimistic || 0})`).join(', ')}`);
    }
    else {
        logger_1.appLogger.warn(`[AccountRouter] updateAiCacheAfterUsage: account ${accountId} not found in cache`);
    }
}
function removeAccountFromAiCache(accountId) {
    const list = quotaCache.get(AI_CACHE_KEY);
    if (list) {
        const idx = list.findIndex(r => r.account.id === accountId);
        if (idx >= 0) {
            const removed = list.splice(idx, 1)[0];
            if (list.length === 0) {
                quotaCache.del(AI_CACHE_KEY);
            }
            logger_1.appLogger.info(`[AccountRouter] Removed account ${accountId} (${removed.account.name}) from AI cache, ${list.length} remaining`);
        }
        else {
            logger_1.appLogger.debug(`[AccountRouter] removeAccountFromAiCache: account ${accountId} not in cache`);
        }
    }
    else {
        logger_1.appLogger.debug(`[AccountRouter] removeAccountFromAiCache: cache not found`);
    }
}
function clearCache(resource) {
    if (resource) {
        if (resource === 'ai_neurons') {
            invalidateAiCache();
        }
        else {
            const cacheKey = `best_account_${resource}`;
            quotaCache.del(cacheKey);
        }
    }
    else {
        // Clear all caches (backward compatibility)
        zonesCache.flushAll();
        quotaCache.flushAll();
    }
}
//# sourceMappingURL=accountRouter.js.map