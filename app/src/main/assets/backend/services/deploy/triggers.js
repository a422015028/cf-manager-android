"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deployTriggers = deployTriggers;
const cfFactory_1 = require("../cfFactory");
const logger_1 = require("../logger");
/**
 * 部署触发器 — Cron Schedules + Custom Routes。
 * 所有操作均为软失败（失败仅记录 warning，不中断部署）。
 */
async function deployTriggers(account, scriptName, crons, routes) {
    const warnings = [];
    const accountId = account.account_id;
    // 1. Cron Schedules（仅 Worker 脚本支持）
    if (crons && crons.length > 0) {
        try {
            const cf = (0, cfFactory_1.getCfClient)(account);
            const res = await cf.workers.scripts.schedules.update(scriptName, {
                account_id: accountId,
                body: crons.map(c => ({ cron: c })),
            });
            const ok = res?.success === true || Array.isArray(res?.schedules) || Array.isArray(res?.result?.schedules);
            if (!ok) {
                warnings.push(`定时任务注册失败: ${JSON.stringify(res?.errors || res)}`);
            }
            else {
                logger_1.appLogger.info(`[Triggers] Cron triggers set for ${scriptName}: ${crons.join(', ')}`);
            }
        }
        catch (e) {
            warnings.push(`定时任务注册失败: ${e.message}`);
        }
    }
    // 2. Custom Routes
    if (routes && routes.length > 0) {
        const cf = (0, cfFactory_1.getCfClient)(account);
        for (const pattern of routes) {
            try {
                const hostname = pattern.split('/')[0];
                const zones = [];
                for await (const z of cf.zones.list({ account_id: accountId })) {
                    zones.push(z);
                }
                const zone = zones.find(z => z.name === hostname || hostname.endsWith('.' + z.name));
                if (!zone) {
                    warnings.push(`路由 ${pattern} 创建失败: 未找到 zone`);
                    continue;
                }
                await cf.workers.routes.create({ zone_id: zone.id, pattern, script: scriptName });
            }
            catch (e) {
                warnings.push(`路由 ${pattern} 创建失败: ${e.message}`);
            }
        }
    }
    return { warnings };
}
//# sourceMappingURL=triggers.js.map