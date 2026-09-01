"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeAvailableFeatures = probeAvailableFeatures;
const cfFactory_1 = require("./cfFactory");
const logger_1 = require("./logger");
/**
 * 探测账户可用的付费功能（首期仅 R2）。
 * 返回逗号分隔字符串：r2=支持，-r2=不支持，空串=未探测。
 */
async function probeAvailableFeatures(account) {
    if (!account.account_id)
        return '';
    const results = [];
    // R2 探测
    try {
        const cf = (0, cfFactory_1.getCfClient)(account);
        await cf.r2.buckets.list({ account_id: account.account_id });
        results.push('r2');
    }
    catch (e) {
        const msg = e?.message || '';
        if (msg.includes('10042') || msg.includes('enable R2') || msg.includes('Please enable R2')) {
            results.push('-r2');
        }
        else {
            logger_1.appLogger.warn(`[Probe] R2 check failed for account ${account.id}: ${e}`);
        }
    }
    return results.join(',');
}
//# sourceMappingURL=accountProbe.js.map