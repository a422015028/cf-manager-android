"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CATALOG_NAME = exports.DEFAULT_CATALOG_URL = void 0;
exports.refreshCatalogSource = refreshSource;
const express_1 = require("express");
const catalogSource_1 = require("../models/catalogSource");
const catalogValidator_1 = require("../services/catalogValidator");
const catalogDeploy_1 = require("../services/catalogDeploy");
const account_1 = require("../models/account");
const logger_1 = require("../services/logger");
const ssrfGuard_1 = require("../services/ssrfGuard");
// 主源用 surge.sh：Surge 静态托管，更新即时生效，避免 jsDelivr 缓存 GitHub 主分支导致更新延迟。
// 兜底顺序：surge.sh → jsDelivr → GitHub raw（GitHub raw 放最后，作为最终兜底）。
const DEFAULT_CATALOG_URL = 'https://cf-store.surge.sh/catalog.json';
exports.DEFAULT_CATALOG_URL = DEFAULT_CATALOG_URL;
const DEFAULT_CATALOG_FALLBACK_URLS = [
    'https://cdn.jsdelivr.net/gh/hefy2027/cf-store@main/catalog.json',
    'https://raw.githubusercontent.com/hefy2027/cf-store/main/catalog.json',
];
const DEFAULT_CATALOG_URLS = [DEFAULT_CATALOG_URL, ...DEFAULT_CATALOG_FALLBACK_URLS];
const DEFAULT_CATALOG_NAME = '官方源';
exports.DEFAULT_CATALOG_NAME = DEFAULT_CATALOG_NAME;
const router = (0, express_1.Router)();
// In-memory catalog cache for Docker version
const catalogCache = new Map();
async function testCatalogUrl(url) {
    const isLocal = url?.startsWith('http://localhost:') || url?.startsWith('http://127.0.0.1:');
    if (!url || (!url.startsWith('https://') && !isLocal)) {
        return { ok: false, errorCode: 'VALIDATION_ERROR', error: 'url must be a valid HTTPS URL' };
    }
    let resp;
    try {
        await (0, ssrfGuard_1.assertUrlSafe)(url);
        resp = await fetch(url);
    }
    catch (e) {
        return { ok: false, errorCode: 'SSRF_BLOCKED', error: e.message || `无法连接: ${e.message}` };
    }
    if (!resp.ok) {
        return { ok: false, status: resp.status, errorCode: 'FETCH_ERROR', error: `URL 不可达: HTTP ${resp.status}` };
    }
    let json;
    try {
        json = await resp.json();
    }
    catch (e) {
        return { ok: false, errorCode: 'PARSE_ERROR', error: `不是合法 JSON: ${e.message}` };
    }
    const result = (0, catalogValidator_1.validateCatalog)(json);
    if (!result.valid) {
        return { ok: false, errorCode: 'INVALID_CATALOG', error: `不是有效的 catalog: ${result.errors.join('; ')}` };
    }
    return { ok: true, templateCount: Array.isArray(json.templates) ? json.templates.length : 0, etag: resp.headers.get('etag'), json };
}
router.get('/sources', (_req, res, next) => {
    try {
        res.json((0, catalogSource_1.getCatalogSources)());
    }
    catch (err) {
        next(err);
    }
});
// 独立测试接口：验证 URL 是否可拉取且符合 catalog 格式（不落库）
router.post('/sources/test', async (req, res, next) => {
    try {
        const { url } = req.body;
        const result = await testCatalogUrl(url);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/sources', async (req, res, next) => {
    try {
        const { url, name } = req.body;
        if (!name) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
            return;
        }
        const test = await testCatalogUrl(url);
        if (!test.ok) {
            res.status(400).json({ error: { code: test.errorCode || 'FETCH_ERROR', message: test.error } });
            return;
        }
        const id = (0, catalogSource_1.createCatalogSource)({ url, name });
        catalogCache.set(id, test.json);
        if (test.etag)
            (0, catalogSource_1.updateCatalogSource)(id, { etag: test.etag, last_synced: new Date().toISOString(), last_status: 'ok', last_error: null });
        res.status(201).json({ id });
    }
    catch (err) {
        next(err);
    }
});
router.put('/sources/:id', async (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        const source = (0, catalogSource_1.getCatalogSourceById)(id);
        if (!source) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Source not found' } });
            return;
        }
        const body = req.body;
        if (source.is_default && body.url && body.url !== source.url) {
            res.status(403).json({ error: { code: 'FORBIDDEN', message: '默认源的 URL 不可修改' } });
            return;
        }
        if (body.url && body.url !== source.url) {
            try {
                await (0, ssrfGuard_1.assertUrlSafe)(body.url);
            }
            catch (e) {
                res.status(e.statusCode || 403).json({ error: { code: 'SSRF_BLOCKED', message: e.message } });
                return;
            }
            const resp = await fetch(body.url);
            if (!resp.ok) {
                res.status(400).json({ error: { code: 'FETCH_ERROR', message: `URL 不可达: ${resp.status}` } });
                return;
            }
            const json = await resp.json();
            const result = (0, catalogValidator_1.validateCatalog)(json);
            if (!result.valid) {
                res.status(400).json({ error: { code: 'INVALID_CATALOG', message: `不是有效的 catalog: ${result.errors.join('; ')}` } });
                return;
            }
            catalogCache.set(id, json);
            const etag = resp.headers.get('etag');
            (0, catalogSource_1.updateCatalogSource)(id, { ...body, etag: etag || null, last_synced: new Date().toISOString(), last_status: 'ok', last_error: null });
        }
        else {
            (0, catalogSource_1.updateCatalogSource)(id, body);
        }
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/sources/:id', (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        (0, catalogSource_1.deleteCatalogSource)(id);
        catalogCache.delete(id);
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// ============ Catalog Fetch ============
async function fetchSourceCatalog(source) {
    // Check cache
    const cached = catalogCache.get(source.id);
    // 空目录（无模板）不视为有效命中：用户看到空白时应立即重新拉取，
    // 而不是长期返回缓存中的空结果导致页面一直空白。
    if (cached && cached.templates && cached.templates.length > 0) {
        // Try refresh in background
        refreshSourceInBackground(source).catch(e => logger_1.appLogger.error(`[Store] refresh ${source.id}: ${e}`));
        return cached;
    }
    return refreshSource(source);
}
// 官方默认源启用 fallback 链；用户自定义源只使用自己的 url
function candidateUrls(source) {
    return source.is_default ? DEFAULT_CATALOG_URLS : [source.url];
}
async function refreshSource(source) {
    const urls = candidateUrls(source);
    let lastError = '';
    for (const url of urls) {
        try {
            await (0, ssrfGuard_1.assertUrlSafe)(url);
            const headers = {};
            // etag 仅对主记录 url 携带，避免跨地址 etag 误判
            if (url === source.url && source.etag)
                headers['If-None-Match'] = source.etag;
            const resp = await fetch(url, { headers });
            if (resp.status === 304) {
                (0, catalogSource_1.updateCatalogSource)(source.id, { last_synced: new Date().toISOString(), last_status: 'ok', last_error: null });
                return catalogCache.get(source.id) || null;
            }
            if (!resp.ok) {
                lastError = `HTTP ${resp.status} (${url})`;
                continue;
            }
            const json = await resp.json();
            const result = (0, catalogValidator_1.validateCatalog)(json);
            if (!result.valid) {
                lastError = `Schema invalid: ${result.errors.slice(0, 3).join('; ')} (${url})`;
                continue;
            }
            catalogCache.set(source.id, json);
            const etag = resp.headers.get('etag');
            (0, catalogSource_1.updateCatalogSource)(source.id, { etag: etag || null, last_synced: new Date().toISOString(), last_status: 'ok', last_error: null });
            return json;
        }
        catch (e) {
            lastError = `${e.message} (${url})`;
            continue;
        }
    }
    (0, catalogSource_1.updateCatalogSource)(source.id, { last_status: 'error', last_error: lastError });
    return catalogCache.get(source.id) || null;
}
async function refreshSourceInBackground(source) {
    // Only refresh if last sync was > 5 minutes ago
    if (source.last_synced) {
        const age = Date.now() - new Date(source.last_synced).getTime();
        if (age < 5 * 60 * 1000)
            return;
    }
    await refreshSource(source);
}
// ============ Template List ============
router.get('/templates', async (_req, res, next) => {
    try {
        const sources = (0, catalogSource_1.getEnabledCatalogSources)();
        const results = await Promise.all(sources.map(s => fetchSourceCatalog(s)));
        const seen = new Map();
        const idSources = new Map();
        for (let i = 0; i < sources.length; i++) {
            const source = sources[i];
            const catalog = results[i];
            if (!catalog?.templates)
                continue;
            for (const template of catalog.templates) {
                const count = idSources.get(template.id) || 0;
                idSources.set(template.id, count + 1);
                if (!seen.has(template.id)) {
                    seen.set(template.id, { template, sourceId: source.id, sourceName: source.name, sourceCount: 0 });
                }
            }
        }
        for (const entry of seen.values()) {
            entry.sourceCount = idSources.get(entry.template.id) || 1;
        }
        res.json({ templates: Array.from(seen.values()), sources });
    }
    catch (err) {
        next(err);
    }
});
// ============ Refresh ============
router.post('/refresh', async (_req, res, next) => {
    try {
        const sources = (0, catalogSource_1.getEnabledCatalogSources)();
        const results = await Promise.all(sources.map(async (s) => {
            if (s.etag)
                (0, catalogSource_1.updateCatalogSource)(s.id, { etag: null });
            const cat = await refreshSource(s);
            return { id: s.id, name: s.name, success: !!cat };
        }));
        res.json(results);
    }
    catch (err) {
        next(err);
    }
});
// ============ Init ============
router.get('/init', (_req, res) => {
    (0, catalogSource_1.ensureDefaultCatalogSource)(DEFAULT_CATALOG_URL, DEFAULT_CATALOG_NAME);
    res.json({ success: true });
});
// ============ Shared helper: find template from enabled sources ============
async function findTemplate(templateId) {
    const sources = (0, catalogSource_1.getEnabledCatalogSources)();
    for (const source of sources) {
        const catalog = await fetchSourceCatalog(source);
        if (catalog?.templates) {
            const found = catalog.templates.find(t => t.id === templateId) || null;
            if (found)
                return found;
        }
    }
    return null;
}
// ============ Preflight (两阶段部署: 预检) ============
router.post('/preflight', async (req, res, next) => {
    try {
        const { accountId, templateId, name, bindingSelections, secretValues, deployType } = req.body;
        if (!accountId || !templateId || !name) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'accountId, templateId, name are required' } });
            return;
        }
        const account = (0, account_1.getAccountById)(parseInt(accountId, 10));
        if (!account) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
            return;
        }
        const template = await findTemplate(templateId);
        if (!template) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Template not found' } });
            return;
        }
        const result = await (0, catalogDeploy_1.preflightDeploy)({
            account, template, name,
            bindingSelections: bindingSelections || {},
            secretValues: secretValues || {},
            deployType: deployType || undefined,
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// ============ Deploy (两阶段部署: 确认执行) ============
router.post('/deploy', async (req, res, next) => {
    try {
        const { accountId, templateId, name, bindingSelections, secretValues, deployType, traces, logs } = req.body;
        if (!accountId || !templateId || !name) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'accountId, templateId, name are required' } });
            return;
        }
        const account = (0, account_1.getAccountById)(parseInt(accountId, 10));
        if (!account) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } });
            return;
        }
        const template = await findTemplate(templateId);
        if (!template) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Template not found' } });
            return;
        }
        logger_1.appLogger.info(`[Store] deploy: deploying for account ${account.name} (DB id=${account.id}, CF=${account.account_id})`);
        const result = await (0, catalogDeploy_1.deployTemplate)({
            account, template, name,
            bindingSelections: bindingSelections || {},
            secretValues: secretValues || {},
            deployType: deployType || undefined,
            traces: traces !== false,
            logs: logs !== false,
        });
        if (result.success) {
            res.json(result);
        }
        else {
            // 使用标准 error 格式，避免 responseWrapper 将 success:false 体的其余字段包装为 error 对象
            res.status(500).json({
                error: {
                    code: 'DEPLOY_FAILED',
                    message: result.error || '部署失败',
                    rolledBack: result.rolledBack,
                    rollbackErrors: result.rollbackErrors,
                    warnings: result.warnings,
                },
            });
        }
    }
    catch (err) {
        next(err);
    }
});
// ============ Batch Deploy (多账户批量部署) ============
router.post('/deploy-batch', async (req, res, next) => {
    try {
        const { deployments } = req.body;
        if (!Array.isArray(deployments) || deployments.length === 0) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'deployments must be a non-empty array' } });
            return;
        }
        const firstDeployment = deployments[0];
        const template = await findTemplate(firstDeployment.templateId);
        if (!template) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Template not found' } });
            return;
        }
        const results = await Promise.allSettled(deployments.map(async (d) => {
            const account = (0, account_1.getAccountById)(parseInt(d.accountId, 10));
            if (!account)
                return { accountId: d.accountId, name: d.name, success: false, error: 'Account not found' };
            // Preflight
            const pfResult = await (0, catalogDeploy_1.preflightDeploy)({
                account, template, name: d.name,
                bindingSelections: d.bindingSelections || {},
                secretValues: d.secretValues || {},
                deployType: d.deployType || undefined,
            });
            if (!pfResult.canProceed) {
                const pfErrors = pfResult.warnings?.join('; ') || '预检未通过';
                return { accountId: d.accountId, name: d.name, success: false, error: pfErrors };
            }
            // Deploy
            logger_1.appLogger.info(`[Store] deploy-batch: deploying for account ${account.name} (DB id=${account.id}, CF=${account.account_id})`);
            const result = await (0, catalogDeploy_1.deployTemplate)({
                account, template, name: d.name,
                bindingSelections: d.bindingSelections || {},
                secretValues: d.secretValues || {},
                deployType: d.deployType || undefined,
                traces: d.traces !== false,
                logs: d.logs !== false,
            });
            return {
                accountId: d.accountId,
                accountName: account.name,
                cfAccountId: account.account_id,
                name: d.name,
                success: result.success,
                error: result.success ? undefined : (result.error || '部署失败'),
                warnings: result.warnings,
            };
        }));
        const output = results.map((r) => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message || '未知错误' });
        res.json(output);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=store.js.map