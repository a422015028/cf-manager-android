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
 * 演示账户「毁灭性操作」保护中间件。
 * 拦截所有针对演示账户的销毁/删除类操作，返回 403 DEMO_PROTECTED：
 *  - 所有 DELETE 请求（删 KV 命名空间/键、删 D1 库、删 R2 桶/对象、删 Worker/Pages、删 Secret/Domain/Route、删 DNS 记录等）
 *  - 批量删除类 POST 请求（KV/R2 的 bulk-delete）
 * 注：D1 写查询（INSERT/UPDATE/DELETE/DROP/ALTER 等）在 storage 路由的 query handler 内单独拦截。
 */
function demoDestructiveGuard(req, res, next) {
    const method = req.method.toUpperCase();
    const isDestructive = method === 'DELETE' ||
        (method === 'POST' && /\/bulk-delete$/.test(req.path || ''));
    if (isDestructive) {
        const accountId = parseInt(req.params.accountId, 10);
        if (!isNaN(accountId) && isDemoAccountId(accountId)) {
            res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可执行删除/销毁操作' } });
            return;
        }
    }
    next();
}
//# sourceMappingURL=routeUtils.js.map