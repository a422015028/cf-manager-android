"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listTunnelAccounts = listTunnelAccounts;
exports.getTunnelAccount = getTunnelAccount;
exports.listTunnels = listTunnels;
exports.createTunnel = createTunnel;
exports.deleteTunnel = deleteTunnel;
exports.getTunnelToken = getTunnelToken;
exports.getTunnelConnections = getTunnelConnections;
exports.getTunnelConfig = getTunnelConfig;
exports.updateTunnelConfig = updateTunnelConfig;
exports.listZonesForAccount = listZonesForAccount;
exports.listTunnelHostnames = listTunnelHostnames;
const account_1 = require("../models/account");
const cfFactory_1 = require("./cfFactory");
function listTunnelAccounts() {
    return (0, account_1.getAllAccounts)()
        .filter((a) => !!a.account_id)
        .map((a) => ({ id: a.id, name: a.name, account_id: a.account_id }));
}
function getTunnelAccount(id) {
    const account = (0, account_1.getAccountById)(id);
    if (!account) {
        const err = new Error('Account not found');
        err.statusCode = 404;
        throw err;
    }
    if (!account.account_id) {
        const err = new Error('该账户未配置 Cloudflare account_id，无法管理隧道');
        err.statusCode = 400;
        throw err;
    }
    return account;
}
async function listTunnels(account) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const tunnels = [];
    for await (const t of cf.zeroTrust.tunnels.cloudflared.list({ account_id: account.account_id })) {
        tunnels.push(t);
    }
    return tunnels;
}
async function createTunnel(account, name) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.zeroTrust.tunnels.cloudflared.create({ account_id: account.account_id, name });
}
async function deleteTunnel(account, tunnelId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.zeroTrust.tunnels.cloudflared.delete(tunnelId, { account_id: account.account_id });
}
async function getTunnelToken(account, tunnelId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.zeroTrust.tunnels.cloudflared.token.get(tunnelId, { account_id: account.account_id });
}
async function getTunnelConnections(account, tunnelId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const res = await cf.zeroTrust.tunnels.cloudflared.connections.get(tunnelId, { account_id: account.account_id });
    return res.result ?? res;
}
async function getTunnelConfig(account, tunnelId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const res = await cf.zeroTrust.tunnels.cloudflared.configurations.get(tunnelId, { account_id: account.account_id });
    // SDK 可能返回解包后的 { config: { ingress: [...] } } 或原始 { result: { config: { ingress: [...] } } }
    const config = res?.config ?? res?.result?.config;
    return config?.ingress ?? [];
}
async function updateTunnelConfig(account, tunnelId, ingress) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.zeroTrust.tunnels.cloudflared.configurations.update(tunnelId, {
        account_id: account.account_id,
        config: { ingress },
    });
}
async function listZonesForAccount(account) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const zones = [];
    for await (const z of cf.zones.list({ per_page: 100 })) {
        zones.push({ id: z.id, name: z.name });
    }
    return zones;
}
/**
 * 获取隧道绑定的域名列表：扫描账户下所有 zone 的 CNAME 记录，
 * 找到 content 为 {tunnelId}.cfargotunnel.com 的记录，返回其 name（hostname）。
 */
async function listTunnelHostnames(account, tunnelId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const target = `${tunnelId}.cfargotunnel.com`;
    const zones = await listZonesForAccount(account);
    const hostnames = [];
    for (const zone of zones) {
        try {
            for await (const record of cf.dns.records.list({ zone_id: zone.id, type: 'CNAME', per_page: 100 })) {
                if (record.content === target) {
                    hostnames.push(record.name);
                }
            }
        }
        catch {
            // 某些 zone 可能无权限，跳过
        }
    }
    return hostnames;
}
//# sourceMappingURL=tunnelService.js.map