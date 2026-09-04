"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const account_1 = require("../models/account");
const auditLog_1 = require("../models/auditLog");
const logger_1 = require("../services/logger");
const concurrent_1 = require("../utils/concurrent");
const routeUtils_1 = require("./routeUtils");
const workerService_1 = require("../services/workerService");
const bindings_1 = require("../services/bindings");
const workerService_2 = require("../services/workerService");
const pagesDeploy_1 = require("../services/deploy/pagesDeploy");
const accountRouter_1 = require("../services/accountRouter");
// 手动/批量 Worker 部署：script 可为单个 .js（单模块）或 .zip（多模块包）+ 可选 assets（zip 较大放宽到 50MB，与 Pages 一致）
const uploadWorkerAssets = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, fields: 10 },
});
// Pages 部署：单文件 50MB，最多 100 个文件，总上传限制 200MB
const uploadPages = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 100, fields: 10, fieldSize: 1024 * 1024 },
});
const router = (0, express_1.Router)();
// 由上传的 assets 文件构造 deployWorker 的 assets 选项（默认 ASSETS 绑定、无 config）。
// 单文件当 raw 处理，.zip 当压缩包解包处理。
function toAssetsOptions(file) {
    if (!file)
        return undefined;
    const isZip = file.originalname.toLowerCase().endsWith('.zip');
    return {
        assets: { source: { kind: isZip ? 'zip' : 'raw', url: file.originalname } },
        assetsBuffer: file.buffer,
    };
}
// 从 multipart 表单中解析 JSON 字符串字段；空/非法返回空数组
function parseJsonField(raw, _field) {
    if (raw === undefined || raw === null || raw === '')
        return [];
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    return raw;
}
// 演示账户：拦截所有销毁/删除类操作（DELETE 等）
router.use(routeUtils_1.demoDestructiveGuard);
// ============ List all ============
// 支持 ?accountId= 仅返回该账户的 Worker/Pages（按需加载）；不带参数返回全部（批量部署/环境同步用）
router.get('/', async (req, res, next) => {
    try {
        const accountIdFilter = req.query.accountId ? Number(req.query.accountId) : null;
        let accounts;
        if (accountIdFilter) {
            const acc = (0, account_1.getAccountById)(accountIdFilter);
            accounts = acc ? [acc] : [];
        }
        else {
            accounts = (0, account_1.getActiveAccountsByFeature)('workers');
        }
        const results = await Promise.all(accounts.map(async (account) => {
            const items = [];
            const [workers, pages] = await Promise.allSettled([
                (0, workerService_1.listWorkers)(account),
                (0, workerService_1.listPages)(account),
            ]);
            if (workers.status === 'fulfilled') {
                items.push(...workers.value.map(w => ({ ...w, name: w.id, status: 'deployed', type: 'worker', cfAccountId: account.id, accountName: account.name })));
            }
            else {
                logger_1.appLogger.error(`[Workers] Failed to list workers for ${account.name}: ${workers.reason}`);
            }
            if (pages.status === 'fulfilled') {
                items.push(...pages.value.map(p => ({ ...p, name: p.name ?? p.id, type: 'pages', cfAccountId: account.id, accountName: account.name })));
            }
            else {
                logger_1.appLogger.error(`[Pages] Failed to list pages for ${account.name}: ${pages.reason}`);
            }
            return items;
        }));
        res.json(results.flat());
    }
    catch (err) {
        next(err);
    }
});
// ============ Delete ============
router.delete('/:accountId/workers/:name', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const workerName = req.params.name;
        await (0, workerService_1.deleteWorker)(account, workerName);
        (0, auditLog_1.createAuditLog)(account.id, 'delete_worker', workerName, null, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:accountId/pages/:name', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const pagesName = req.params.name;
        await (0, workerService_1.deletePagesProject)(account, pagesName);
        (0, auditLog_1.createAuditLog)(account.id, 'delete_pages', pagesName, null, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/workers/:name/logs', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const logs = await (0, workerService_1.getWorkerLogs)(account, req.params.name);
        res.json(logs);
    }
    catch (err) {
        next(err);
    }
});
// ============ Secrets ============
router.get('/:accountId/workers/:name/secrets', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const secrets = await (0, workerService_1.listSecrets)(account, req.params.name);
        res.json(secrets);
    }
    catch (err) {
        next(err);
    }
});
router.put('/:accountId/workers/:name/secrets', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { name, type, text, key_base64 } = req.body;
        if (!name || !type) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name and type are required' } });
            return;
        }
        const result = await (0, workerService_1.updateSecret)(account, req.params.name, name, type, text, key_base64);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:accountId/workers/:name/secrets/:secretName', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        await (0, workerService_1.deleteSecret)(account, req.params.name, req.params.secretName);
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// ============ Schedules (Cron Triggers) ============
router.get('/:accountId/workers/:name/schedules', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.getSchedules)(account, req.params.name);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.put('/:accountId/workers/:name/schedules', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { crons } = req.body;
        if (!Array.isArray(crons)) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'crons must be an array' } });
            return;
        }
        const result = await (0, workerService_1.updateSchedules)(account, req.params.name, crons);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// ============ Custom Domains ============
router.get('/:accountId/workers/:name/domains', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const domains = await (0, workerService_1.listDomains)(account, req.params.name);
        res.json(domains);
    }
    catch (err) {
        next(err);
    }
});
router.post('/:accountId/workers/:name/domains', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { hostname, environment } = req.body;
        if (!hostname) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'hostname is required' } });
            return;
        }
        const result = await (0, workerService_1.createDomain)(account, hostname, req.params.name, environment);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:accountId/workers/:name/domains/:domainId', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        await (0, workerService_1.deleteDomain)(account, req.params.domainId);
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// ============ Subdomain (workers.dev) ============
router.get('/:accountId/workers/:name/subdomain', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.getSubdomain)(account, req.params.name);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.put('/:accountId/workers/:name/subdomain', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'enabled must be boolean' } });
            return;
        }
        const result = await (0, workerService_1.setSubdomain)(account, req.params.name, enabled);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// ============ Script Settings ============
router.get('/:accountId/workers/:name/settings', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.getScriptSettings)(account, req.params.name);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.patch('/:accountId/workers/:name/settings', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.updateScriptSettings)(account, req.params.name, req.body);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// ============ Routes ============
router.get('/:accountId/workers/:name/routes', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { zone_id } = req.query;
        if (!zone_id) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'zone_id is required' } });
            return;
        }
        const routes = await (0, workerService_1.listRoutes)(account, zone_id);
        res.json(routes);
    }
    catch (err) {
        next(err);
    }
});
router.post('/:accountId/workers/:name/routes', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { zone_id, pattern, script } = req.body;
        if (!zone_id || !pattern) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'zone_id and pattern are required' } });
            return;
        }
        const result = await (0, workerService_1.createRoute)(account, zone_id, pattern, script || req.params.name);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:accountId/workers/:name/routes/:routeId', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { zone_id } = req.query;
        if (!zone_id) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'zone_id is required' } });
            return;
        }
        await (0, workerService_1.deleteRoute)(account, zone_id, req.params.routeId);
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// ============ Script Content ============
router.get('/:accountId/workers/:name/content', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const content = await (0, workerService_1.getScriptContent)(account, req.params.name);
        res.type('text/plain').send(content);
    }
    catch (err) {
        next(err);
    }
});
// ============ Deployments ============
router.get('/:accountId/workers/:name/deployments', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.listDeployments)(account, req.params.name);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// ============ Pages Settings ============
router.get('/:accountId/pages/:name/project', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.getPagesProject)(account, req.params.name);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.patch('/:accountId/pages/:name/project', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.editPagesProject)(account, req.params.name, req.body);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/pages/:name/domains', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const domains = await (0, workerService_1.listPagesDomains)(account, req.params.name);
        res.json(domains);
    }
    catch (err) {
        next(err);
    }
});
router.post('/:accountId/pages/:name/domains', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { hostname } = req.body;
        if (!hostname) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'hostname is required' } });
            return;
        }
        const result = await (0, workerService_1.addPagesDomain)(account, req.params.name, hostname);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:accountId/pages/:name/domains/:hostname', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        await (0, workerService_1.removePagesDomain)(account, req.params.name, req.params.hostname);
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/pages/:name/deployments', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.listPagesDeployments)(account, req.params.name);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// 单条删除 Pages 部署记录
router.delete('/:accountId/pages/:name/deployments/:deploymentId', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.deletePagesDeployment)(account, req.params.name, req.params.deploymentId);
        if (!result.success) {
            res.status(400).json({ error: { code: 'DELETE_FAILED', message: result.error } });
            return;
        }
        (0, auditLog_1.createAuditLog)(account.id, 'delete_pages_deployment', `${req.params.name}/${req.params.deploymentId}`, null, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// 批量删除 Pages 部署记录
router.delete('/:accountId/pages/:name/deployments', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ids array is required' } });
            return;
        }
        const result = await (0, workerService_1.batchDeletePagesDeployments)(account, req.params.name, ids);
        (0, auditLog_1.createAuditLog)(account.id, 'batch_delete_pages_deployments', req.params.name, `deleted ${result.succeeded}/${result.total} deployments`, 'success');
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// ============ Cloudflare Resources (for Pages bindings) ============
router.get('/:accountId/resources/kv', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.listKvNamespaces)(account);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/resources/d1', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.listD1Databases)(account);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/resources/r2', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        // 短路：缓存显示 R2 不可用则直接返回
        const r2Features = (account.available_features || '').split(',');
        if (r2Features.includes('-r2')) {
            res.json({ r2_not_enabled: true, buckets: [] });
            return;
        }
        const result = await (0, workerService_1.listR2Buckets)(account);
        res.json(result);
    }
    catch (err) {
        const msg = `${err?.message || ''} ${err?.status || ''} ${err?.error?.code || ''}`;
        if (msg.includes('10042') || msg.includes('enable R2') || msg.includes('Please enable R2')) {
            res.json({ r2_not_enabled: true, buckets: [] });
            return;
        }
        next(err);
    }
});
router.get('/:accountId/resources/zones', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const allZones = await (0, accountRouter_1.getAllZones)();
        res.json(allZones.filter(z => z.cfAccountId === account.id));
    }
    catch (err) {
        next(err);
    }
});
router.put('/:accountId/pages/:name/bindings', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.updatePagesBindings)(account, req.params.name, req.body.deployment_configs);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// ============ Summary (用量 + 已部署数量) ============
router.get('/summary', async (_req, res, next) => {
    try {
        const accounts = (0, account_1.getActiveAccountsByFeature)('workers');
        const results = await (0, concurrent_1.mapConcurrent)(accounts, 6, async (account) => {
            try {
                const [usageRes, workersRes, pagesRes] = await Promise.allSettled([
                    (0, workerService_1.getWorkersUsageToday)(account),
                    (0, workerService_1.listWorkers)(account),
                    (0, workerService_1.listPages)(account),
                ]);
                const usage = usageRes.status === 'fulfilled'
                    ? usageRes.value
                    : { requests: 0, errors: 0, subrequests: 0, cpuTimeMs: 0 };
                const workerCount = workersRes.status === 'fulfilled' ? workersRes.value.length : 0;
                const pagesCount = pagesRes.status === 'fulfilled' ? pagesRes.value.length : 0;
                return { accountId: account.id, accountName: account.name, ...usage, workerCount, pagesCount };
            }
            catch (err) {
                logger_1.appLogger.error(`[Summary] Failed for ${account.name}: ${err}`);
                return { accountId: account.id, accountName: account.name, requests: 0, errors: 0, subrequests: 0, cpuTimeMs: 0, workerCount: 0, pagesCount: 0 };
            }
        });
        res.json(results);
    }
    catch (err) {
        next(err);
    }
});
// ============ Pages Config (重部署预填) ============
router.get('/:accountId/pages/:name/config', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        res.set('Cache-Control', 'no-store'); // 防浏览器缓存旧配置
        const config = await (0, workerService_2.getPagesConfig)(account, req.params.name);
        res.json(config);
    }
    catch (err) {
        next(err);
    }
});
// ============ Workers Usage (GraphQL) ============
router.get('/usage', async (_req, res, next) => {
    try {
        const accounts = (0, account_1.getActiveAccountsByFeature)('workers');
        const results = await Promise.all(accounts.map(async (account) => {
            try {
                const usage = await (0, workerService_1.getWorkersUsageToday)(account);
                return { accountId: account.id, accountName: account.name, ...usage };
            }
            catch (err) {
                logger_1.appLogger.error(`[Usage] Failed for account ${account.name}: ${err}`);
                return { accountId: account.id, accountName: account.name, requests: 0, errors: 0, subrequests: 0, cpuTimeMs: 0 };
            }
        }));
        res.json(results);
    }
    catch (err) {
        next(err);
    }
});
// ============ Batch Deploy ============
router.post('/batch-deploy', uploadWorkerAssets.fields([{ name: 'script' }, { name: 'assets' }]), async (req, res, next) => {
    try {
        const { url: scriptUrl } = req.body;
        const files = req.files;
        const assetsOpts = toAssetsOptions(files.assets?.[0]);
        const scriptFile = files.script?.[0];
        const scriptContent = scriptFile ? scriptFile.buffer.toString('utf-8') : null;
        const isZip = !!scriptFile && scriptFile.originalname.toLowerCase().endsWith('.zip');
        const mainModule = req.body.mainModule || undefined;
        // 版本化 worker 下 PUT 只创建版本不部署，必须显式创建 deployment 才会上线
        const baseOpts = { ...assetsOpts, mainModule, createDeployment: true };
        const parsedTargets = parseJsonField(req.body.targets, 'targets');
        if (!Array.isArray(parsedTargets) || parsedTargets.length === 0) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'targets must be a non-empty array' } });
            return;
        }
        const vars = parseJsonField(req.body.vars, 'vars');
        const bindingsInput = parseJsonField(req.body.bindings, 'bindings');
        const isRedeploy = req.body.isRedeploy === 'true' || req.body.isRedeploy === true;
        // 重部署可不带代码（只更新配置）；新建部署必须提供代码源
        if (!isRedeploy && !scriptContent && !scriptUrl && !isZip) {
            res.status(400).json({ error: { code: 'NO_FILE', message: 'Script file or URL is required' } });
            return;
        }
        console.log(`[DBG] batch-deploy targets=${parsedTargets.length} isRedeploy=${isRedeploy} isZip=${isZip} vars=${JSON.stringify(vars.map((v) => `${v.name}:${v.secret ? 'S' : 'P'}${v.keep ? '(keep)' : ''}`))} bindings=${JSON.stringify(bindingsInput.map((b) => b.type + ':' + b.name))}`);
        const results = [];
        await (0, concurrent_1.mapConcurrent)(parsedTargets, 3, async (t) => {
            try {
                const account = (0, account_1.getAccountById)(t.accountId);
                if (!account) {
                    results.push({ ...t, success: false, error: 'Account not found' });
                    return;
                }
                const resolved = await (0, bindings_1.resolveManualBindings)(account, bindingsInput);
                const allBindings = [...(0, bindings_1.varsToBindings)(vars), ...resolved];
                if (isRedeploy && !isZip) {
                    // 重部署未更换代码：走 diff（secrets 独立 API 保持 / 代码复用重传）
                    await (0, workerService_2.applyWorkerConfigDiff)(account, t.workerName, {
                        vars, bindings: allBindings,
                        scriptContent: scriptContent ?? undefined,
                    });
                    (0, auditLog_1.createAuditLog)(account.id, 'batch_deploy', t.workerName, 'redeploy_config', 'success');
                    results.push({ ...t, success: true });
                    return;
                }
                if (scriptUrl) {
                    await (0, workerService_1.deployWorkerFromUrl)(account, t.workerName, scriptUrl, { ...baseOpts, bindings: allBindings });
                }
                else if (isZip) {
                    await (0, workerService_1.deployWorker)(account, t.workerName, '', { ...baseOpts, packageZip: scriptFile.buffer, bindings: allBindings });
                }
                else {
                    await (0, workerService_1.deployWorker)(account, t.workerName, scriptContent, { ...baseOpts, bindings: allBindings });
                }
                (0, auditLog_1.createAuditLog)(account.id, 'batch_deploy', t.workerName, null, 'success');
                results.push({ ...t, success: true });
            }
            catch (err) {
                results.push({ ...t, success: false, error: err.message });
            }
        });
        res.json(results);
    }
    catch (err) {
        next(err);
    }
});
// ============ Batch Deploy Pages ============
router.post('/batch-deploy-pages', uploadPages.single('zipFile'), async (req, res, next) => {
    try {
        const parsedTargets = parseJsonField(req.body.targets, 'targets');
        if (!Array.isArray(parsedTargets) || parsedTargets.length === 0) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'targets must be a non-empty array' } });
            return;
        }
        const vars = parseJsonField(req.body.vars, 'vars');
        const bindingsInput = parseJsonField(req.body.bindings, 'bindings');
        const isRedeploy = req.body.isRedeploy === 'true' || req.body.isRedeploy === true;
        let files = [];
        if (req.file) {
            files = (0, workerService_1.extractZipFiles)(req.file.buffer);
            if (files.length === 0) {
                res.status(400).json({ error: { code: 'EMPTY_ZIP', message: 'Zip file contains no files' } });
                return;
            }
        }
        if (!isRedeploy && !req.file) {
            res.status(400).json({ error: { code: 'NO_FILE', message: 'Zip file is required for new deploy' } });
            return;
        }
        const results = [];
        await (0, concurrent_1.mapConcurrent)(parsedTargets, 3, async (t) => {
            try {
                const account = (0, account_1.getAccountById)(t.accountId);
                if (!account) {
                    results.push({ ...t, success: false, error: 'Account not found' });
                    return;
                }
                if (!(0, workerService_1.validatePagesProjectName)(t.workerName)) {
                    results.push({ ...t, success: false, error: '项目名只能包含小写字母、数字和连字符' });
                    return;
                }
                if (isRedeploy && !req.file) {
                    // 只更新配置：PATCH project deployment_configs
                    const resolved = await (0, bindings_1.resolveManualBindings)(account, bindingsInput);
                    const configs = (0, bindings_1.buildPagesConfigsFromInput)(vars, resolved);
                    if (configs)
                        await (0, workerService_1.updatePagesBindings)(account, t.workerName, configs);
                    (0, auditLog_1.createAuditLog)(account.id, 'redeploy_pages_config', t.workerName, null, 'success');
                    results.push({ ...t, success: true });
                    return;
                }
                const resolved = await (0, bindings_1.resolveManualBindings)(account, bindingsInput);
                const configs = (0, bindings_1.buildPagesConfigsFromInput)(vars, resolved);
                await (0, pagesDeploy_1.deployPages)(account, t.workerName, files, configs ? { deploymentConfigs: configs } : {});
                (0, auditLog_1.createAuditLog)(account.id, 'batch_deploy_pages', t.workerName, `${files.length} files`, 'success');
                results.push({ ...t, success: true });
            }
            catch (err) {
                results.push({ ...t, success: false, error: err.message });
            }
        });
        res.json(results);
    }
    catch (err) {
        next(err);
    }
});
// ============ Config (重部署预填) ============
router.get('/:accountId/workers/:name/config', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        res.set('Cache-Control', 'no-store'); // 防浏览器缓存旧配置（部署后重开预填必须拿到最新）
        const config = await (0, workerService_2.getWorkerConfig)(account, req.params.name);
        res.json(config);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/pages/:name/config', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        res.set('Cache-Control', 'no-store'); // 防浏览器缓存旧配置
        const config = await (0, workerService_2.getPagesConfig)(account, req.params.name);
        res.json(config);
    }
    catch (err) {
        next(err);
    }
});
// ============ Environment Sync ============
router.post('/env-sync/preview', async (req, res, next) => {
    try {
        const { source, targets, syncTypes } = req.body;
        if (!source?.accountId || !source?.workerName || !Array.isArray(targets)) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'source and targets are required' } });
            return;
        }
        const sourceAccount = (0, account_1.getAccountById)(source.accountId);
        if (!sourceAccount) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Source account not found' } });
            return;
        }
        const doSecrets = !syncTypes || syncTypes.includes('secrets');
        const sourceSecrets = doSecrets ? await (0, workerService_1.listSecrets)(sourceAccount, source.workerName) : [];
        const diffs = [];
        for (const t of targets) {
            const tAccount = (0, account_1.getAccountById)(t.accountId);
            if (!tAccount)
                continue;
            const tSecrets = doSecrets ? await (0, workerService_1.listSecrets)(tAccount, t.workerName) : [];
            const tNames = new Set(tSecrets.map((s) => s.name));
            const added = sourceSecrets.filter((s) => !tNames.has(s.name)).map((s) => s.name);
            const existing = sourceSecrets.filter((s) => tNames.has(s.name)).map((s) => s.name);
            diffs.push({ accountId: t.accountId, workerName: t.workerName, secrets: { added, existing } });
        }
        res.json(diffs);
    }
    catch (err) {
        next(err);
    }
});
router.post('/env-sync/execute', async (req, res, next) => {
    try {
        const { source, targets, syncTypes, secretValues } = req.body;
        if (!source?.accountId || !source?.workerName || !Array.isArray(targets)) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'source and targets are required' } });
            return;
        }
        if (!secretValues || typeof secretValues !== 'object') {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'secretValues is required (map of name → value)' } });
            return;
        }
        const doSecrets = !syncTypes || syncTypes.includes('secrets');
        const sourceAccount = (0, account_1.getAccountById)(source.accountId);
        if (!sourceAccount) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Source account not found' } });
            return;
        }
        const sourceSecretsList = doSecrets ? await (0, workerService_1.listSecrets)(sourceAccount, source.workerName) : [];
        const results = [];
        for (const t of targets) {
            try {
                const tAccount = (0, account_1.getAccountById)(t.accountId);
                if (!tAccount) {
                    results.push({ ...t, success: false, synced: 0, error: 'Account not found' });
                    continue;
                }
                let synced = 0;
                if (doSecrets) {
                    for (const s of sourceSecretsList) {
                        const val = secretValues[s.name];
                        if (val !== undefined) {
                            await (0, workerService_1.updateSecret)(tAccount, t.workerName, s.name, s.type || 'secret_text', val);
                            synced++;
                        }
                    }
                }
                (0, auditLog_1.createAuditLog)(tAccount.id, 'env_sync', t.workerName, `from ${source.workerName}, ${synced} secrets`, 'success');
                results.push({ ...t, success: true, synced });
            }
            catch (err) {
                results.push({ ...t, success: false, synced: 0, error: err.message });
            }
        }
        res.json(results);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=workers.js.map