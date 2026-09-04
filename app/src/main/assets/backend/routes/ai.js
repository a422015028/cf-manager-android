"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const account_1 = require("../models/account");
const aiService_1 = require("../services/aiService");
const quotaUsage_1 = require("../models/quotaUsage");
const accountRouter_1 = require("../services/accountRouter");
const concurrent_1 = require("../utils/concurrent");
const router = (0, express_1.Router)();
/**
 * GET /api/ai/usage
 * 获取所有活跃账户的 AI 使用量统计（同步路径，CF 权威校准）
 *
 * - 并发 getAiUsageToday(每个活跃账户)
 * - 成功的账户：setQuota(CF 权威值) + invalidateAiCache（不清除 exhausted 标记）
 * - 失败的账户：跳过（不更新，保留本地估算）
 */
router.get('/usage', async (_req, res, next) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const accounts = (0, account_1.getActiveAccounts)().filter(a => a.account_id);
        const result = await (0, concurrent_1.mapConcurrent)(accounts, 6, async (account) => {
            try {
                const usage = await (0, aiService_1.getAiUsageToday)(account);
                // 当 CF 返回非零值：使用 CF 数据更新本地计数
                if (usage.totalNeurons > 0) {
                    (0, quotaUsage_1.setQuota)(account.id, 'ai_neurons', usage.totalNeurons);
                    // 不清除 exhausted 标记：exhausted 是 CF 返回 4006 时设置的，
                    // 表示当天免费额度已用完。使用量 > 0 只代表今天用了多少 neurons，
                    // 不代表额度没用完。标记只应通过日期变化或手动清除。
                    return {
                        accountId: account.account_id,
                        accountName: account.name,
                        totalNeurons: usage.totalNeurons,
                        models: usage.models,
                    };
                }
                else {
                    // CF 返回 0 或负数：回退到本地数据库的值
                    console.warn(`[AI Usage] CF returned 0 for ${account.name}, using local estimate`);
                    const localQuota = (0, quotaUsage_1.getQuotaByAccount)(account.id, 'ai_neurons', today);
                    return {
                        accountId: account.account_id,
                        accountName: account.name,
                        totalNeurons: localQuota?.count || 0,
                        models: [],
                        warning: 'CF returned 0, using local estimate'
                    };
                }
            }
            catch (err) {
                console.error(`[AI Usage] Failed for ${account.name}:`, err.message);
                // CF 调用失败：返回本地数据库的值
                const localQuota = (0, quotaUsage_1.getQuotaByAccount)(account.id, 'ai_neurons', today);
                return {
                    accountId: account.account_id,
                    accountName: account.name,
                    totalNeurons: localQuota?.count || 0,
                    models: [],
                    warning: 'Failed to fetch from CF, using local estimate'
                };
            }
        });
        // 同步完成后全量刷新内存缓存
        (0, accountRouter_1.invalidateAiCache)();
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=ai.js.map