"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const accountRouter_1 = require("../services/accountRouter");
const dnsService_1 = require("../services/dnsService");
const zoneService_1 = require("../services/zoneService");
const account_1 = require("../models/account");
const auditLog_1 = require("../models/auditLog");
const routeUtils_1 = require("./routeUtils");
const rulesetService_1 = require("../services/rulesetService");
const router = (0, express_1.Router)();
router.get('/domains', async (_req, res, next) => {
    try {
        const zones = await (0, accountRouter_1.getAllZones)();
        res.json(zones);
    }
    catch (err) {
        next(err);
    }
});
router.get('/domains/:domain/records', async (req, res, next) => {
    try {
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(req.params.domain);
        const records = await (0, dnsService_1.listDnsRecords)(account, zoneId);
        res.json(records);
    }
    catch (err) {
        next(err);
    }
});
router.post('/domains/:domain/records', async (req, res, next) => {
    try {
        const domain = req.params.domain;
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(domain);
        const record = await (0, dnsService_1.createDnsRecord)(account, zoneId, req.body);
        (0, auditLog_1.createAuditLog)(account.id, 'create_dns', domain, `${req.body.type} ${req.body.name} → ${req.body.content}`, 'success');
        res.status(201).json(record);
    }
    catch (err) {
        next(err);
    }
});
router.put('/domains/:domain/records/:id', async (req, res, next) => {
    try {
        const domain = req.params.domain;
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(domain);
        const record = await (0, dnsService_1.updateDnsRecord)(account, zoneId, req.params.id, req.body);
        (0, auditLog_1.createAuditLog)(account.id, 'update_dns', domain, `${req.body.type || ''} ${req.body.name || ''} → ${req.body.content || ''}`, 'success');
        res.json(record);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/domains/:domain/records/:id', async (req, res, next) => {
    try {
        const domain = req.params.domain;
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(domain);
        if ((0, routeUtils_1.isDemoAccountId)(account.id)) {
            res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可删除 DNS 记录' } });
            return;
        }
        await (0, dnsService_1.deleteDnsRecord)(account, zoneId, req.params.id);
        (0, auditLog_1.createAuditLog)(account.id, 'delete_dns', domain, `record_id=${req.params.id}`, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.get('/domains/:domain/settings', async (req, res, next) => {
    try {
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(req.params.domain);
        const settings = await (0, zoneService_1.getZoneSettings)(account, zoneId);
        res.json(settings);
    }
    catch (err) {
        next(err);
    }
});
router.patch('/domains/:domain/proxy', async (req, res, next) => {
    try {
        if (!req.body.record_id || typeof req.body.proxied !== 'boolean') {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'record_id and proxied (boolean) are required' } });
            return;
        }
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(req.params.domain);
        await (0, zoneService_1.updateProxyStatus)(account, zoneId, req.body.record_id, req.body.proxied);
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// ============ Zone 管理 ============
/** 批量并发处理辅助函数 */
async function batchProcess(items, fn, concurrency = 3) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const settled = await Promise.allSettled(batch.map(fn));
        results.push(...settled.map((s, j) => ({
            item: batch[j],
            result: s.status === 'fulfilled' ? s.value : undefined,
            error: s.status === 'rejected' ? String(s.reason) : undefined,
        })));
    }
    return results;
}
// 批量创建 Zone
router.post('/domains', async (req, res, next) => {
    try {
        const { names, account_id, type } = req.body;
        if (!Array.isArray(names) || !names.length || !account_id) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'names (string[]) and account_id are required' } });
            return;
        }
        const account = (0, account_1.getAccountById)(parseInt(account_id, 10));
        if (!account) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
            return;
        }
        if ((0, routeUtils_1.isDemoAccountId)(account.id)) {
            res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可创建 Zone' } });
            return;
        }
        const zoneType = type === 'partial' ? 'partial' : 'full';
        const results = await batchProcess(names, (name) => (0, zoneService_1.createZone)(account, name.trim(), zoneType));
        const formatted = results.map(r => ({
            name: r.item,
            success: !r.error,
            ...(r.result ? { zone_id: r.result.zone_id, name_servers: r.result.name_servers } : {}),
            ...(r.error ? { error: r.error } : {}),
        }));
        (0, zoneService_1.invalidateZonesCache)();
        (0, auditLog_1.createAuditLog)(account.id, 'batch_create_zone', `accounts/${account_id}`, `created ${formatted.filter(r => r.success).length}/${names.length} zones: ${names.join(', ')}`, 'success');
        res.status(201).json({
            total: names.length,
            succeeded: formatted.filter(r => r.success).length,
            failed: formatted.filter(r => !r.success).length,
            results: formatted,
        });
    }
    catch (err) {
        next(err);
    }
});
// 批量删除 Zone
router.delete('/domains', async (req, res, next) => {
    try {
        const { domains } = req.body;
        if (!Array.isArray(domains) || !domains.length) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'domains (string[]) is required' } });
            return;
        }
        const results = await batchProcess(domains, async (domain) => {
            const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(domain);
            if ((0, routeUtils_1.isDemoAccountId)(account.id)) {
                throw new Error('DEMO_PROTECTED: 演示账户不可删除 Zone');
            }
            await (0, zoneService_1.deleteZone)(account, zoneId);
            return { domain, account };
        });
        const formatted = results.map(r => ({
            name: r.item,
            success: !r.error,
            ...(r.error ? { error: r.error } : {}),
        }));
        (0, zoneService_1.invalidateZonesCache)();
        const succeeded = results.filter(r => !r.error);
        if (succeeded.length > 0) {
            const firstAccount = succeeded[0].result.account;
            (0, auditLog_1.createAuditLog)(firstAccount.id, 'batch_delete_zone', 'multiple', `deleted ${succeeded.length}/${domains.length} zones: ${domains.join(', ')}`, 'success');
        }
        res.json({
            total: domains.length,
            succeeded: formatted.filter(r => r.success).length,
            failed: formatted.filter(r => !r.success).length,
            results: formatted,
        });
    }
    catch (err) {
        next(err);
    }
});
// 更新 Zone 设置
router.patch('/domains/:domain/settings', async (req, res, next) => {
    try {
        const domain = req.params.domain;
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(domain);
        const result = await (0, zoneService_1.updateZoneSettings)(account, zoneId, req.body);
        (0, auditLog_1.createAuditLog)(account.id, 'update_zone_settings', domain, `updated: ${result.updated.join(', ') || 'none'}${result.failed.length ? `, failed: ${result.failed.join(', ')}` : ''}`, 'success');
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// 清除 Zone 缓存
router.post('/domains/:domain/purge-cache', async (req, res, next) => {
    try {
        const domain = req.params.domain;
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(domain);
        const result = await (0, zoneService_1.purgeZoneCache)(account, zoneId, req.body);
        (0, auditLog_1.createAuditLog)(account.id, 'purge_cache', domain, req.body.purge_everything ? 'purge_everything' : `purge ${(req.body.files || []).length} URLs`, 'success');
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// 暂停/激活 Zone
router.patch('/domains/:domain/status', async (req, res, next) => {
    try {
        const domain = req.params.domain;
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(domain);
        if (typeof req.body.paused !== 'boolean') {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'paused (boolean) is required' } });
            return;
        }
        await (0, zoneService_1.setZoneStatus)(account, zoneId, req.body.paused);
        (0, auditLog_1.createAuditLog)(account.id, 'update_zone_status', domain, `paused=${req.body.paused}`, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// ============ 通用规则引擎 ============
router.get('/domains/:domain/rules/:phase', async (req, res, next) => {
    try {
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(req.params.domain);
        res.json(await (0, rulesetService_1.listRules)(account, zoneId, req.params.phase));
    }
    catch (err) {
        next(err);
    }
});
router.post('/domains/:domain/rules/:phase', async (req, res, next) => {
    try {
        const { description, expression, action, action_parameters, enabled } = req.body;
        if (!expression || !action) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'expression and action are required' } });
            return;
        }
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(req.params.domain);
        const rule = await (0, rulesetService_1.createRule)(account, zoneId, req.params.phase, { description, expression, action, action_parameters, enabled });
        (0, auditLog_1.createAuditLog)(account.id, 'create_rule', req.params.domain, `phase=${req.params.phase} action=${action}`, 'success');
        res.status(201).json(rule);
    }
    catch (err) {
        next(err);
    }
});
router.put('/domains/:domain/rules/:phase/:ruleId', async (req, res, next) => {
    try {
        const { description, expression, action, action_parameters, enabled } = req.body;
        if (!expression || !action) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'expression and action are required' } });
            return;
        }
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(req.params.domain);
        const rule = await (0, rulesetService_1.updateRule)(account, zoneId, req.params.phase, req.params.ruleId, { description, expression, action, action_parameters, enabled });
        (0, auditLog_1.createAuditLog)(account.id, 'update_rule', req.params.domain, `phase=${req.params.phase} rule_id=${req.params.ruleId}`, 'success');
        res.json(rule);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/domains/:domain/rules/:phase/:ruleId', async (req, res, next) => {
    try {
        const { account, zoneId } = await (0, accountRouter_1.findAccountByDomain)(req.params.domain);
        if ((0, routeUtils_1.isDemoAccountId)(account.id)) {
            res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可删除规则' } });
            return;
        }
        await (0, rulesetService_1.deleteRule)(account, zoneId, req.params.phase, req.params.ruleId);
        (0, auditLog_1.createAuditLog)(account.id, 'delete_rule', req.params.domain, `phase=${req.params.phase} rule_id=${req.params.ruleId}`, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=dns.js.map