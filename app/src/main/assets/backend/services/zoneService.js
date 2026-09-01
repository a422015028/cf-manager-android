"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZoneSettings = getZoneSettings;
exports.createZone = createZone;
exports.deleteZone = deleteZone;
exports.updateZoneSettings = updateZoneSettings;
exports.purgeZoneCache = purgeZoneCache;
exports.setZoneStatus = setZoneStatus;
exports.invalidateZonesCache = invalidateZonesCache;
exports.updateProxyStatus = updateProxyStatus;
const cfFactory_1 = require("./cfFactory");
const accountRouter_1 = require("./accountRouter");
const logger_1 = require("./logger");
const proxyService_1 = require("./proxyService");
/** 支持的 Zone 设置项映射 */
const SETTING_PATHS = {
    ssl: 'ssl',
    always_use_https: 'always_use_https',
    security_level: 'security_level',
    automatic_https_rewrites: 'automatic_https_rewrites',
    cache_level: 'cache_level',
    browser_cache_ttl: 'browser_cache_ttl',
    development_mode: 'development_mode',
    minify: 'minify',
    brotli: 'brotli',
    zero_rtt: '0rtt',
};
/** CF REST API 基地址 */
const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
/** 直接调用 CF REST API 的辅助函数 */
async function cfZoneApi(account, method, path, body) {
    const headers = (0, cfFactory_1.getAuthHeaders)(account);
    const httpAgent = (0, proxyService_1.getHttpAgentForAccount)(account);
    const resp = await fetch(`${CF_API_BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(httpAgent ? { agent: httpAgent } : {}),
    });
    if (!resp.ok) {
        const respBody = await resp.text();
        throw new Error(`CF API error ${resp.status}: ${respBody}`);
    }
    const data = await resp.json();
    return data?.result ?? data;
}
/**
 * 获取 Zone 设置（修复版）。
 * 一次性调用 GET /zones/:zoneId/settings 获取全部设置，再过滤出需要的字段。
 */
async function getZoneSettings(account, zoneId) {
    try {
        const allSettings = await cfZoneApi(account, 'GET', `/zones/${zoneId}/settings`);
        // allSettings 是一个数组，每项 { id, value, ... }
        const settingsMap = {};
        if (Array.isArray(allSettings)) {
            for (const item of allSettings) {
                if (item.id && item.id in SETTING_PATHS) {
                    settingsMap[item.id] = item.value;
                }
            }
        }
        return settingsMap;
    }
    catch (err) {
        logger_1.appLogger.warn(`Failed to fetch zone settings for zone ${zoneId}: ${err}`);
        return {};
    }
}
/** 创建 Zone */
async function createZone(account, name, type) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    if (!account.account_id)
        throw new Error(`Account ${account.id} is missing account_id`);
    const zone = await cf.zones.create({
        name,
        account: { id: account.account_id },
        type,
    });
    return {
        zone_id: zone.id,
        name_servers: zone.name_servers || [],
    };
}
/** 删除 Zone */
async function deleteZone(account, zoneId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.zones.delete({ zone_id: zoneId });
}
/** 更新 Zone 设置（批量，best-effort） */
async function updateZoneSettings(account, zoneId, settings) {
    const updated = [];
    const failed = [];
    for (const [key, value] of Object.entries(settings)) {
        const path = SETTING_PATHS[key];
        if (!path) {
            failed.push(key);
            continue;
        }
        try {
            await cfZoneApi(account, 'PATCH', `/zones/${zoneId}/settings/${path}`, { value });
            updated.push(key);
        }
        catch (err) {
            logger_1.appLogger.warn(`Failed to update zone setting ${key} for zone ${zoneId}: ${err}`);
            failed.push(key);
        }
    }
    return { updated, failed };
}
/** 清除 Zone 缓存 */
async function purgeZoneCache(account, zoneId, options) {
    const result = await cfZoneApi(account, 'POST', `/zones/${zoneId}/purge_cache`, options);
    return { id: result?.id || '' };
}
/** 暂停/激活 Zone */
async function setZoneStatus(account, zoneId, paused) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.zones.edit({ zone_id: zoneId, paused });
}
/** 清除 zones 缓存（创建/删除后调用） */
function invalidateZonesCache() {
    (0, accountRouter_1.clearCache)();
}
/** 更新 DNS 记录代理状态（保留现有功能） */
async function updateProxyStatus(account, zoneId, recordId, proxied) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.dns.records.edit(recordId, { zone_id: zoneId, proxied });
}
//# sourceMappingURL=zoneService.js.map