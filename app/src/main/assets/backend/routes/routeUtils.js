"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccountOr404 = getAccountOr404;
exports.isDemoAccountId = isDemoAccountId;
exports.demoDestructiveGuard = demoDestructiveGuard;
const account_1 = require("../models/account");
const config_1 = require("../config");
function getAccountOr404(req, res) {
    const account = (0, account_1.getAccountById)(parseInt(req.params.accountId, 10));
    if (!account) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
        return null;
    }
    return account;
}
// 判断某个账户是否为演示（Demo）保护账户
function isDemoAccountId(id) {
    if (!config_1.config.demoAccountIds)
        return false;
    return config_1.config.demoAccountIds.split(',').map(s => parseInt(s.trim(), 10)).includes(id);
}
/**
 * 演示账户「只读」保护中间件。
 * 演示账户应保持只读：拦截除 GET/HEAD/OPTIONS 外的所有写操作（含 PUT/PATCH/POST/DELETE），
 * 命中即返回 403 DEMO_PROTECTED。
 * 例外：D1 查询接口（POST .../d1/:dbId/query）属于只读 SELECT，允许执行；其写 SQL（INSERT/UPDATE/DELETE 等）
 * 已在 storage 路由的 query handler 内单独拦截。
 */
function demoDestructiveGuard(req, res, next) {
    const method = req.method.toUpperCase();
    const path = req.path || '';
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const isD1Query = method === 'POST' && /\/d1\/[^/]+\/query$/.test(path);
    const isDestructive = isWrite && !isD1Query;
    if (isDestructive) {
        const accountId = parseInt(req.params.accountId, 10);
        if (!isNaN(accountId) && isDemoAccountId(accountId)) {
            res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可被修改或删除' } });
            return;
        }
    }
    next();
}
//# sourceMappingURL=routeUtils.js.map