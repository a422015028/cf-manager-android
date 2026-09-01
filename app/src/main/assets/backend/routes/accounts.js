"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const cloudflare_1 = __importDefault(require("cloudflare"));
const account_1 = require("../models/account");
const account_2 = require("../models/account");
const encryptionService_1 = require("../services/encryptionService");
const encryptionService_2 = require("../services/encryptionService");
const cfFactory_1 = require("../services/cfFactory");
const quotaTracker_1 = require("../services/quotaTracker");
const accountRouter_1 = require("../services/accountRouter");
const logger_1 = require("../services/logger");
const auditLog_1 = require("../models/auditLog");
const proxyService_1 = require("../services/proxyService");
const quotaUsage_1 = require("../models/quotaUsage");
const routeUtils_1 = require("./routeUtils");
const accountProbe_1 = require("../services/accountProbe");
const router = (0, express_1.Router)();
const uploadCsv = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.get('/', (req, res, next) => {
    try {
        // 分页模式：当传入 page 或 pageSize 时启用；不传则保持原全量行为（向后兼容）
        const wantsPaged = req.query.page !== undefined || req.query.pageSize !== undefined;
        const quota = (0, quotaTracker_1.getQuotaSummary)();
        if (wantsPaged) {
            const filter = req.query.filter;
            const validFilters = ['all', 'active', 'unverified'];
            const safeFilter = validFilters.includes(filter) ? filter : 'all';
            const paged = (0, account_2.listAccountsPaged)({
                page: parseInt(req.query.page, 10) || 1,
                pageSize: parseInt(req.query.pageSize, 10) || 20,
                filter: safeFilter,
                search: req.query.search || '',
            });
            const accounts = paged.accounts.map(a => ({
                ...a,
                api_token: a.api_token ? '***encrypted***' : null,
                api_key: a.api_key ? '***encrypted***' : null,
                is_demo: (0, routeUtils_1.isDemoAccountId)(a.id),
            }));
            res.json({ accounts, quota, total: paged.total, counts: paged.counts });
        }
        else {
            const accounts = (0, account_1.getAllAccounts)().map(a => ({
                ...a,
                api_token: a.api_token ? '***encrypted***' : null,
                api_key: a.api_key ? '***encrypted***' : null,
                is_demo: (0, routeUtils_1.isDemoAccountId)(a.id),
            }));
            res.json({ accounts, quota });
        }
    }
    catch (err) {
        next(err);
    }
});
router.post('/', async (req, res, next) => {
    try {
        const { name, auth_type, account_id, api_token, api_key, email } = req.body;
        if (!name || !auth_type) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name and auth_type are required' } });
            return;
        }
        if (auth_type !== 'token' && auth_type !== 'global_key') {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'auth_type must be "token" or "global_key"' } });
            return;
        }
        if (auth_type === 'token' && !api_token) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'api_token is required for token auth' } });
            return;
        }
        if (auth_type === 'global_key' && (!api_key || !email)) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'api_key and email are required for global_key auth' } });
            return;
        }
        // Verify credentials before saving
        try {
            const httpAgent = (0, proxyService_1.getHttpAgent)();
            const opts = {};
            if (httpAgent)
                opts.httpAgent = httpAgent;
            let tempCf;
            if (auth_type === 'token') {
                tempCf = new cloudflare_1.default({ apiToken: api_token, ...opts });
            }
            else {
                tempCf = new cloudflare_1.default({ apiEmail: email, apiKey: api_key, ...opts });
            }
            await tempCf.user.get();
        }
        catch (e) {
            res.status(400).json({ error: { code: 'CREDENTIAL_INVALID', message: `Cloudflare API 凭证验证失败: ${e.message || e}` } });
            return;
        }
        const input = { name, auth_type, account_id, enabled_features: req.body.enabled_features, proxy_url: req.body.proxy_url, proxy_enabled: req.body.proxy_enabled };
        if (auth_type === 'token') {
            input.api_token = (0, encryptionService_1.encrypt)(api_token);
        }
        else {
            input.api_key = (0, encryptionService_1.encrypt)(api_key);
            input.email = email;
        }
        const id = (0, account_1.createAccount)(input);
        if (!account_id) {
            try {
                const saved = (0, account_1.getAccountById)(id);
                if (saved) {
                    const cf = (0, cfFactory_1.getCfClient)(saved);
                    const accts = [];
                    for await (const acct of cf.accounts.list()) {
                        accts.push(acct);
                    }
                    if (accts.length > 0) {
                        (0, account_1.updateAccountId)(id, accts[0].id);
                        logger_1.appLogger.info(`[Account] Auto-fetched account_id=${accts[0].id} for "${name}"`);
                    }
                    (0, account_1.updateAccountStatus)(id, true);
                }
            }
            catch (e) {
                logger_1.appLogger.warn(`[Account] Failed to auto-fetch account_id for "${name}": ${e}`);
            }
        }
        // 探测 R2 可用性（重新获取，account_id 可能刚被更新）
        try {
            const fresh = (0, account_1.getAccountById)(id);
            if (fresh) {
                const features = await (0, accountProbe_1.probeAvailableFeatures)(fresh);
                if (features)
                    (0, account_1.updateAccount)(id, { available_features: features });
            }
        }
        catch (e) {
            logger_1.appLogger.warn(`[Account] Failed to probe features for "${name}": ${e}`);
        }
        (0, auditLog_1.createAuditLog)(id, 'create_account', name, `auth_type=${auth_type}`, 'success');
        res.status(201).json({ id, ...input, api_token: '***', api_key: '***' });
    }
    catch (err) {
        next(err);
    }
});
router.put('/:id', async (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        if ((0, routeUtils_1.isDemoAccountId)(id)) {
            res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可编辑' } });
            return;
        }
        const existing = (0, account_1.getAccountById)(id);
        if (!existing) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
            return;
        }
        const { name, auth_type, api_token, api_key, email } = req.body;
        if (!name || !auth_type) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name and auth_type are required' } });
            return;
        }
        if (auth_type !== 'token' && auth_type !== 'global_key') {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'auth_type must be "token" or "global_key"' } });
            return;
        }
        const input = { name, auth_type };
        const switching = existing.auth_type !== auth_type;
        // 处理 proxy_url / proxy_enabled（无论是否切换认证类型都允许设置）
        if (req.body.proxy_url !== undefined) {
            input.proxy_url = req.body.proxy_url;
        }
        if (req.body.proxy_enabled !== undefined) {
            input.proxy_enabled = req.body.proxy_enabled;
        }
        if (auth_type === 'token') {
            if (switching && !api_token) {
                res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '切换至 token 认证需提供 api_token' } });
                return;
            }
            if (api_token) {
                try {
                    const tempCf = new cloudflare_1.default({ apiToken: api_token, ...((0, proxyService_1.getHttpAgent)() ? { httpAgent: (0, proxyService_1.getHttpAgent)() } : {}) });
                    await tempCf.user.get();
                }
                catch (e) {
                    res.status(400).json({ error: { code: 'CREDENTIAL_INVALID', message: `Cloudflare API 凭证验证失败: ${e.message || e}` } });
                    return;
                }
                input.api_token = (0, encryptionService_1.encrypt)(api_token);
            }
            if (switching) {
                input.api_key = null;
                input.email = null;
            }
        }
        else {
            const hasEmail = !!email, hasKey = !!api_key;
            if (switching && (!hasEmail || !hasKey)) {
                res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '切换至 global_key 认证需同时提供 email 和 api_key' } });
                return;
            }
            if (hasEmail !== hasKey) {
                res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'email 与 api_key 需同时填写' } });
                return;
            }
            if (hasEmail && hasKey) {
                try {
                    const tempCf = new cloudflare_1.default({ apiEmail: email, apiKey: api_key, ...((0, proxyService_1.getHttpAgent)() ? { httpAgent: (0, proxyService_1.getHttpAgent)() } : {}) });
                    await tempCf.user.get();
                }
                catch (e) {
                    res.status(400).json({ error: { code: 'CREDENTIAL_INVALID', message: `Cloudflare API 凭证验证失败: ${e.message || e}` } });
                    return;
                }
                input.api_key = (0, encryptionService_1.encrypt)(api_key);
                input.email = email;
            }
            if (switching) {
                input.api_token = null;
            }
        }
        // 先保存，再重取 saved（确保用新凭证刷新 account_id 和探测）
        (0, account_1.updateAccount)(id, input);
        const saved = (0, account_1.getAccountById)(id);
        if (!saved) {
            res.status(500).json({ error: { code: 'INTERNAL', message: '保存后账户消失' } });
            return;
        }
        // 自动刷新 account_id（触发条件：无 account_id 或提供了新凭证）
        if (!saved.account_id || input.api_token || input.api_key) {
            try {
                const cf = (0, cfFactory_1.getCfClient)(saved);
                const accts = [];
                for await (const acct of cf.accounts.list())
                    accts.push(acct);
                if (accts.length > 0) {
                    (0, account_1.updateAccountId)(id, accts[0].id);
                    logger_1.appLogger.info(`[Account] Auto-fetched account_id=${accts[0].id} for "${name}"`);
                }
                (0, account_1.updateAccountStatus)(id, true);
            }
            catch (e) {
                logger_1.appLogger.warn(`[Account] Failed to auto-fetch account_id for "${name}": ${e}`);
            }
        }
        (0, accountRouter_1.clearCache)();
        (0, auditLog_1.createAuditLog)(id, 'update_account', name, `auth_type=${auth_type}`, 'success');
        // 若提供了新凭证，探测可用付费功能（R2...），失败不阻断
        if (input.api_token || input.api_key) {
            try {
                const probed = (0, account_1.getAccountById)(id);
                if (probed) {
                    const features = await (0, accountProbe_1.probeAvailableFeatures)(probed);
                    (0, account_1.updateAccount)(id, { available_features: features });
                    logger_1.appLogger.info(`[Account] Probed features for "${name}": ${features}`);
                }
            }
            catch (e) {
                logger_1.appLogger.warn(`[Account] Failed to probe features for "${name}": ${e}`);
            }
        }
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.patch('/:id/features', (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        if ((0, routeUtils_1.isDemoAccountId)(id)) {
            res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可修改' } });
            return;
        }
        const account = (0, account_1.getAccountById)(id);
        if (!account) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
            return;
        }
        const { enabled_features } = req.body;
        if (typeof enabled_features !== 'string') {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'enabled_features is required' } });
            return;
        }
        (0, account_1.updateAccountFeatures)(id, enabled_features);
        (0, accountRouter_1.clearCache)();
        (0, auditLog_1.createAuditLog)(id, 'update_features', account.name, enabled_features, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id', (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        if ((0, routeUtils_1.isDemoAccountId)(id)) {
            res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可删除' } });
            return;
        }
        const account = (0, account_1.getAccountById)(id);
        if (!account) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
            return;
        }
        (0, auditLog_1.createAuditLog)(id, 'delete_account', account.name, null, 'success');
        (0, account_1.deleteAccount)(id);
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// ============ 查看账号凭证（解密后的 apiKey / apiToken） ============
router.get('/:id/credentials', (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        if ((0, routeUtils_1.isDemoAccountId)(id)) {
            res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可查看凭证' } });
            return;
        }
        const account = (0, account_1.getAccountById)(id);
        if (!account) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
            return;
        }
        let api_token = null;
        let api_key = null;
        let password = null;
        try {
            if (account.api_token)
                api_token = (0, encryptionService_2.decrypt)(account.api_token);
            if (account.api_key)
                api_key = (0, encryptionService_2.decrypt)(account.api_key);
            if (account.password)
                password = (0, encryptionService_2.decrypt)(account.password);
        }
        catch (e) {
            logger_1.appLogger.error(`[Account] 解密凭证失败 id=${id}: ${e}`);
            res.status(500).json({ error: { code: 'DECRYPT_ERROR', message: '凭证解密失败' } });
            return;
        }
        (0, auditLog_1.createAuditLog)(id, 'view_credentials', account.name, account.auth_type, 'success');
        res.json({
            id: account.id,
            name: account.name,
            auth_type: account.auth_type,
            email: account.email,
            api_token,
            api_key,
            password,
            account_id: account.account_id,
            proxy_url: account.proxy_url || '',
            proxy_enabled: account.proxy_enabled || 0,
        });
    }
    catch (err) {
        next(err);
    }
});
router.post('/:id/test', async (req, res, next) => {
    try {
        const accountId = parseInt(req.params.id, 10);
        const account = (0, account_1.getAccountById)(accountId);
        if (!account) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
            return;
        }
        const cf = (0, cfFactory_1.getCfClient)(account);
        const user = await cf.user.get();
        // 自动获取并存储 Cloudflare Account ID
        if (!account.account_id) {
            try {
                const accounts = [];
                for await (const acct of cf.accounts.list()) {
                    accounts.push(acct);
                }
                if (accounts.length > 0) {
                    (0, account_1.updateAccountId)(accountId, accounts[0].id);
                }
            }
            catch (e) {
                // 获取账号列表失败不是致命错误，继续返回测试结果
                logger_1.appLogger.warn(`Failed to fetch account list: ${e}`);
            }
        }
        // 测试成功，更新状态为活跃
        (0, account_1.updateAccountStatus)(accountId, true);
        // 探测 R2 可用性（重新获取，account_id 可能刚被更新）
        try {
            const fresh = (0, account_1.getAccountById)(accountId);
            if (fresh) {
                const features = await (0, accountProbe_1.probeAvailableFeatures)(fresh);
                if (features)
                    (0, account_1.updateAccount)(accountId, { available_features: features });
            }
        }
        catch (e) {
            logger_1.appLogger.warn(`[Account] Failed to probe features for account ${accountId}: ${e}`);
        }
        res.json({ success: true, user });
    }
    catch (err) {
        next(err);
    }
});
// ============ 清除 AI 配额耗尽标记 ============
router.post('/:id/clear-exhausted', (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        if ((0, routeUtils_1.isDemoAccountId)(id)) {
            res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可操作' } });
            return;
        }
        const account = (0, account_1.getAccountById)(id);
        if (!account) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
            return;
        }
        (0, quotaUsage_1.clearExhausted)(id, 'ai_neurons');
        (0, auditLog_1.createAuditLog)(id, 'clear_exhausted', account.name, 'ai_neurons', 'success');
        res.json({ success: true, message: '已清除 AI 配额耗尽标记' });
    }
    catch (err) {
        next(err);
    }
});
// ============ 批量测试 ============
// body: { ids?: number[], onlyUnverified?: boolean }
// 不传 ids 且 onlyUnverified=true 时，测试所有 is_active=0 的账户
router.post('/test-batch', async (req, res, next) => {
    try {
        const onlyUnverified = req.body?.onlyUnverified === true || req.body?.onlyUnverified === 'true';
        const ids = Array.isArray(req.body?.ids)
            ? req.body.ids.map((x) => parseInt(x, 10)).filter((n) => !isNaN(n))
            : undefined;
        let targets = (0, account_1.getAllAccounts)();
        if (ids && ids.length > 0) {
            const idSet = new Set(ids);
            targets = targets.filter(a => idSet.has(a.id));
        }
        else if (onlyUnverified) {
            targets = targets.filter(a => a.is_active === 0);
        }
        // 跳过演示账户
        targets = targets.filter(a => !(0, routeUtils_1.isDemoAccountId)(a.id));
        const results = [];
        async function testOne(account) {
            try {
                const cf = (0, cfFactory_1.getCfClient)((0, account_1.getAccountById)(account.id));
                await cf.user.get();
                // 自动获取 account_id
                const saved = (0, account_1.getAccountById)(account.id);
                if (saved && !saved.account_id) {
                    try {
                        const accts = [];
                        for await (const acct of cf.accounts.list()) {
                            accts.push(acct);
                        }
                        if (accts.length > 0) {
                            (0, account_1.updateAccountId)(account.id, accts[0].id);
                        }
                    }
                    catch (e) {
                        logger_1.appLogger.warn(`[Account:TestBatch] Failed to fetch account_id for "${account.name}": ${e}`);
                    }
                }
                (0, account_1.updateAccountStatus)(account.id, true);
                // 探测 R2 可用性（重新获取，account_id 可能刚被更新）
                try {
                    const fresh = (0, account_1.getAccountById)(account.id);
                    if (fresh) {
                        const features = await (0, accountProbe_1.probeAvailableFeatures)(fresh);
                        if (features)
                            (0, account_1.updateAccount)(account.id, { available_features: features });
                    }
                }
                catch (e) {
                    logger_1.appLogger.warn(`[Account:TestBatch] Failed to probe features for "${account.name}": ${e}`);
                }
                (0, auditLog_1.createAuditLog)(account.id, 'test_account', account.name, 'batch', 'success');
                results.push({ id: account.id, name: account.name, status: 'success' });
            }
            catch (e) {
                // 测试失败：标记为未活跃
                (0, account_1.updateAccountStatus)(account.id, false);
                (0, auditLog_1.createAuditLog)(account.id, 'test_account', account.name, `batch: ${e.message || e}`, 'error');
                results.push({ id: account.id, name: account.name, status: 'error', message: e.message || String(e) });
            }
        }
        // 并发批处理：每批 5 条并发
        const BATCH_CONCURRENCY = 5;
        for (let i = 0; i < targets.length; i += BATCH_CONCURRENCY) {
            const batch = targets.slice(i, i + BATCH_CONCURRENCY);
            await Promise.all(batch.map(t => testOne(t)));
        }
        (0, accountRouter_1.clearCache)();
        const summary = {
            total: results.length,
            success: results.filter(r => r.status === 'success').length,
            error: results.filter(r => r.status === 'error').length,
        };
        logger_1.appLogger.info(`[Account:TestBatch] 批量测试完成: 共 ${summary.total}，成功 ${summary.success}，失败 ${summary.error}`);
        res.json({ summary, results });
    }
    catch (err) {
        next(err);
    }
});
// ============ 批量设置功能开关 ============
router.post('/batch/features', (req, res, next) => {
    try {
        const { ids, enabled_features } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ids 必须是非空数组' } });
            return;
        }
        if (typeof enabled_features !== 'string') {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'enabled_features 是必填字符串' } });
            return;
        }
        const results = [];
        for (const rawId of ids) {
            const id = parseInt(rawId, 10);
            if (isNaN(id)) {
                results.push({ id: rawId, name: '', status: 'error', message: '无效 ID' });
                continue;
            }
            if ((0, routeUtils_1.isDemoAccountId)(id)) {
                results.push({ id, name: '', status: 'skipped', message: '演示账户不可修改' });
                continue;
            }
            const account = (0, account_1.getAccountById)(id);
            if (!account) {
                results.push({ id, name: '', status: 'error', message: '账户不存在' });
                continue;
            }
            try {
                (0, account_1.updateAccountFeatures)(id, enabled_features);
                (0, auditLog_1.createAuditLog)(id, 'batch_update_features', account.name, enabled_features, 'success');
                results.push({ id, name: account.name, status: 'success' });
            }
            catch (e) {
                results.push({ id, name: account.name, status: 'error', message: e.message || String(e) });
            }
        }
        (0, accountRouter_1.clearCache)();
        res.json({ summary: { total: results.length, success: results.filter(r => r.status === 'success').length, skipped: results.filter(r => r.status === 'skipped').length, error: results.filter(r => r.status === 'error').length }, results });
    }
    catch (err) {
        next(err);
    }
});
// ============ 批量删除 ============
router.post('/batch/delete', (req, res, next) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ids 必须是非空数组' } });
            return;
        }
        const results = [];
        for (const rawId of ids) {
            const id = parseInt(rawId, 10);
            if (isNaN(id)) {
                results.push({ id: rawId, name: '', status: 'error', message: '无效 ID' });
                continue;
            }
            if ((0, routeUtils_1.isDemoAccountId)(id)) {
                results.push({ id, name: '', status: 'skipped', message: '演示账户不可删除' });
                continue;
            }
            const account = (0, account_1.getAccountById)(id);
            if (!account) {
                results.push({ id, name: '', status: 'error', message: '账户不存在' });
                continue;
            }
            try {
                (0, auditLog_1.createAuditLog)(id, 'batch_delete_account', account.name, null, 'success');
                (0, account_1.deleteAccount)(id);
                results.push({ id, name: account.name, status: 'success' });
            }
            catch (e) {
                results.push({ id, name: account.name, status: 'error', message: e.message || String(e) });
            }
        }
        (0, accountRouter_1.clearCache)();
        res.json({ summary: { total: results.length, success: results.filter(r => r.status === 'success').length, skipped: results.filter(r => r.status === 'skipped').length, error: results.filter(r => r.status === 'error').length }, results });
    }
    catch (err) {
        next(err);
    }
});
// ============ 批量设置代理 ============
router.post('/batch/proxy', (req, res, next) => {
    try {
        const { ids, proxy_url, proxy_enabled } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ids 必须是非空数组' } });
            return;
        }
        const updateData = {};
        if (proxy_url !== undefined)
            updateData.proxy_url = proxy_url;
        if (proxy_enabled !== undefined)
            updateData.proxy_enabled = proxy_enabled ? 1 : 0;
        if (Object.keys(updateData).length === 0) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '至少需要提供 proxy_url 或 proxy_enabled' } });
            return;
        }
        const results = [];
        for (const rawId of ids) {
            const id = parseInt(rawId, 10);
            if (isNaN(id)) {
                results.push({ id: rawId, name: '', status: 'error', message: '无效 ID' });
                continue;
            }
            if ((0, routeUtils_1.isDemoAccountId)(id)) {
                results.push({ id, name: '', status: 'skipped', message: '演示账户不可修改' });
                continue;
            }
            const account = (0, account_1.getAccountById)(id);
            if (!account) {
                results.push({ id, name: '', status: 'error', message: '账户不存在' });
                continue;
            }
            try {
                (0, account_1.updateAccount)(id, updateData);
                (0, auditLog_1.createAuditLog)(id, 'batch_update_proxy', account.name, JSON.stringify(updateData), 'success');
                results.push({ id, name: account.name, status: 'success' });
            }
            catch (e) {
                results.push({ id, name: account.name, status: 'error', message: e.message || String(e) });
            }
        }
        (0, accountRouter_1.clearCache)();
        res.json({ summary: { total: results.length, success: results.filter(r => r.status === 'success').length, skipped: results.filter(r => r.status === 'skipped').length, error: results.filter(r => r.status === 'error').length }, results });
    }
    catch (err) {
        next(err);
    }
});
// ============ 批量导入 CSV ============
// CSV 表头: email,password,apiKey
// 按邮箱去重；账户名按规则从邮箱提取；单个账户错误不影响批量导入
router.post('/import-csv', uploadCsv.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '未提供 CSV 文件' } });
            return;
        }
        const raw = req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''); // 去除 BOM
        const rows = parseCsv(raw);
        if (rows.length === 0) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'CSV 文件为空或无有效数据行' } });
            return;
        }
        const header = rows[0].map(h => h.trim().toLowerCase());
        const emailIdx = header.findIndex(h => h === 'email');
        const apiKeyIdx = header.findIndex(h => h === 'apikey' || h === 'api_key');
        const passwordIdx = header.findIndex(h => h === 'password');
        if (emailIdx === -1 || apiKeyIdx === -1) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'CSV 必须包含 email 和 apiKey 列' } });
            return;
        }
        // skipVerify=1 跳过凭证验证（秒级完成），适合大批量导入 + 后续手动测试
        const skipVerify = req.body?.skipVerify === '1' || req.body?.skipVerify === 'true' || req.query.skipVerify === '1';
        const dataRows = rows.slice(1);
        const results = [];
        const seenEmails = new Set(); // 同批次内去重
        const pendingTasks = [];
        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            const email = (row[emailIdx] || '').trim();
            const apiKey = (row[apiKeyIdx] || '').trim();
            const password = passwordIdx !== -1 ? (row[passwordIdx] || '').trim() : '';
            if (!email || !apiKey) {
                results.push({ email: email || '(空)', name: '', status: 'error', message: '邮箱或 apiKey 为空' });
                continue;
            }
            // 同批次内去重
            if (seenEmails.has(email)) {
                results.push({ email, name: (0, account_1.nameFromEmail)(email), status: 'skipped', message: 'CSV 内重复邮箱' });
                continue;
            }
            seenEmails.add(email);
            // 数据库去重
            if ((0, account_1.getAccountByEmail)(email)) {
                results.push({ email, name: (0, account_1.nameFromEmail)(email), status: 'skipped', message: '数据库已存在该邮箱' });
                continue;
            }
            pendingTasks.push({
                email, apiKey, password, name: (0, account_1.nameFromEmail)(email),
                result: { email, name: (0, account_1.nameFromEmail)(email), status: 'success' },
            });
        }
        // 处理单个任务：验证凭证 + 入库 + 自动获取 account_id
        async function processTask(task) {
            const { email, apiKey, password, name } = task;
            try {
                // 验证 Cloudflare 凭证（可跳过）
                if (!skipVerify) {
                    try {
                        const httpAgent = (0, proxyService_1.getHttpAgent)();
                        const opts = {};
                        if (httpAgent)
                            opts.httpAgent = httpAgent;
                        const tempCf = new cloudflare_1.default({ apiEmail: email, apiKey, ...opts });
                        await tempCf.user.get();
                    }
                    catch (e) {
                        task.result = { email, name, status: 'error', message: `凭证验证失败: ${e.message || e}` };
                        return;
                    }
                }
                // 保存到数据库
                const input = {
                    name,
                    auth_type: 'global_key',
                    email,
                    api_key: (0, encryptionService_1.encrypt)(apiKey),
                    password: password ? (0, encryptionService_1.encrypt)(password) : undefined,
                };
                const id = (0, account_1.createAccount)(input);
                // 自动获取 account_id（跳过验证模式下也尝试获取，失败不阻断）
                if (!skipVerify) {
                    try {
                        const saved = (0, account_1.getAccountById)(id);
                        if (saved) {
                            const cf = (0, cfFactory_1.getCfClient)(saved);
                            const accts = [];
                            for await (const acct of cf.accounts.list()) {
                                accts.push(acct);
                            }
                            if (accts.length > 0) {
                                (0, account_1.updateAccountId)(id, accts[0].id);
                                logger_1.appLogger.info(`[Account:Import] Auto-fetched account_id=${accts[0].id} for "${name}"`);
                            }
                            (0, account_1.updateAccountStatus)(id, true);
                        }
                    }
                    catch (e) {
                        logger_1.appLogger.warn(`[Account:Import] Failed to auto-fetch account_id for "${name}": ${e}`);
                    }
                }
                else {
                    // 跳过验证模式：标记为未验证，后续通过「测试」按钮激活
                    (0, account_1.updateAccountStatus)(id, false);
                }
                (0, auditLog_1.createAuditLog)(id, 'import_account', name, `email=${email}${skipVerify ? ' (skipVerify)' : ''}`, 'success');
                task.result = { email, name, status: 'success' };
            }
            catch (e) {
                task.result = { email, name, status: 'error', message: `保存失败: ${e.message || e}` };
            }
        }
        // 并发批处理：每批 5 条并发，批与批之间顺序执行
        const BATCH_CONCURRENCY = skipVerify ? 20 : 5; // 跳过验证时无需控制 CF API 并发，可大幅提高
        for (let i = 0; i < pendingTasks.length; i += BATCH_CONCURRENCY) {
            const batch = pendingTasks.slice(i, i + BATCH_CONCURRENCY);
            await Promise.all(batch.map(t => processTask(t)));
            batch.forEach(t => results.push(t.result));
        }
        (0, accountRouter_1.clearCache)();
        const summary = {
            total: results.length,
            success: results.filter(r => r.status === 'success').length,
            skipped: results.filter(r => r.status === 'skipped').length,
            error: results.filter(r => r.status === 'error').length,
        };
        logger_1.appLogger.info(`[Account:Import] CSV 批量导入完成${skipVerify ? ' (skipVerify)' : ''}: 共 ${summary.total}，成功 ${summary.success}，跳过 ${summary.skipped}，失败 ${summary.error}`);
        res.json({ summary, results });
    }
    catch (err) {
        next(err);
    }
});
/**
* 简单 CSV 解析器：支持双引号包裹的字段和字段内的逗号/换行/双引号转义
 */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    while (i < normalized.length) {
        const ch = normalized[i];
        if (inQuotes) {
            if (ch === '"') {
                if (normalized[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            field += ch;
            i++;
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
            i++;
            continue;
        }
        if (ch === ',') {
            row.push(field);
            field = '';
            i++;
            continue;
        }
        if (ch === '\n') {
            row.push(field);
            field = '';
            if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
                rows.push(row);
            }
            row = [];
            i++;
            continue;
        }
        field += ch;
        i++;
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
            rows.push(row);
        }
    }
    return rows;
}
exports.default = router;
//# sourceMappingURL=accounts.js.map