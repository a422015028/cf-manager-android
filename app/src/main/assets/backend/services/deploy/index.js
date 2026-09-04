"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preflightDeploy = preflightDeploy;
exports.deployTemplate = deployTemplate;
const cfFactory_1 = require("../cfFactory");
const proxyService_1 = require("../proxyService");
const auditLog_1 = require("../../models/auditLog");
const logger_1 = require("../logger");
const workerService_1 = require("../workerService");
const preflight_1 = require("./preflight");
const workerDeploy_1 = require("./workerDeploy");
const pagesDeploy_1 = require("./pagesDeploy");
const triggers_1 = require("./triggers");
// ---- Helpers ----
const MAX_DOWNLOAD = 50 * 1024 * 1024;
async function downloadArtifact(url, type) {
    const resp = await (0, proxyService_1.proxyFetch)(url, {}, 30000);
    if (!resp.ok)
        throw new Error(`产物下载失败: ${resp.status} ${url}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length > MAX_DOWNLOAD)
        throw new Error('产物超过 50MB 限制');
    if (type === 'pages' && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
        throw new Error('Pages 产物应是 zip，但下载内容不是 zip');
    }
    return buffer;
}
async function resolveBinding(account, binding, selection, templateId) {
    const title = binding.resourceName || `${templateId}-${binding.name.toLowerCase()}`;
    const sel = selection || { mode: 'auto' };
    const cf = (0, cfFactory_1.getCfClient)(account);
    const accountId = account.account_id;
    if (binding.type === 'ai') {
        return { type: 'ai', name: binding.name, cfBinding: { type: 'ai', name: binding.name }, created: false };
    }
    if (binding.type === 'var') {
        const isSecret = binding.secret !== false;
        const text = binding.value || '';
        return {
            type: 'var',
            name: binding.name,
            cfBinding: isSecret
                ? { type: 'secret_text', name: binding.name, text }
                : { type: 'plain_text', name: binding.name, text },
            created: false,
        };
    }
    // New binding types: durable_object, service, queue — declare only, no resource creation
    if (binding.type === 'durable_object') {
        const cfBinding = {
            type: 'durable_object_namespace',
            name: binding.name,
            class_name: binding.className,
        };
        if (binding.scriptName)
            cfBinding.script_name = binding.scriptName;
        if (binding.environment)
            cfBinding.environment = binding.environment;
        return { type: 'durable_object', name: binding.name, cfBinding, created: false };
    }
    if (binding.type === 'service') {
        const cfBinding = {
            type: 'service',
            name: binding.name,
            service: binding.service,
        };
        if (binding.environment)
            cfBinding.environment = binding.environment;
        if (binding.entrypoint)
            cfBinding.entrypoint = binding.entrypoint;
        return { type: 'service', name: binding.name, cfBinding, created: false };
    }
    if (binding.type === 'queue') {
        const cfBinding = {
            type: 'queue',
            name: binding.name,
            queue_name: binding.queueName,
        };
        if (binding.deliveryDelay !== undefined)
            cfBinding.delivery_delay = binding.deliveryDelay;
        return { type: 'queue', name: binding.name, cfBinding, created: false };
    }
    if (binding.type === 'kv') {
        if (sel.mode === 'existing' && sel.existingId) {
            return { type: 'kv', name: binding.name, cfBinding: { type: 'kv_namespace', name: binding.name, namespace_id: sel.existingId }, created: false, resourceType: 'kv', resourceId: sel.existingId };
        }
        const items = [];
        for await (const ns of cf.kv.namespaces.list({ account_id: accountId }))
            items.push(ns);
        const found = items.find(ns => ns.title === title);
        if (found) {
            return { type: 'kv', name: binding.name, cfBinding: { type: 'kv_namespace', name: binding.name, namespace_id: found.id }, created: false, resourceType: 'kv', resourceId: found.id };
        }
        const created = await cf.kv.namespaces.create({ account_id: accountId, title });
        return { type: 'kv', name: binding.name, cfBinding: { type: 'kv_namespace', name: binding.name, namespace_id: created.id }, created: true, resourceType: 'kv', resourceId: created.id };
    }
    if (binding.type === 'd1') {
        if (sel.mode === 'existing' && sel.existingId) {
            if (sel.runInitSql && (binding.initSqlUrl || binding.initSql)) {
                await executeInitSql(account, sel.existingId, binding);
            }
            return { type: 'd1', name: binding.name, cfBinding: { type: 'd1', name: binding.name, id: sel.existingId }, created: false, resourceType: 'd1', resourceId: sel.existingId };
        }
        const items = [];
        for await (const db of cf.d1.database.list({ account_id: accountId }))
            items.push(db);
        const found = items.find(db => db.name === title);
        if (found) {
            if (sel.runInitSql && (binding.initSqlUrl || binding.initSql)) {
                await executeInitSql(account, found.uuid, binding);
            }
            return { type: 'd1', name: binding.name, cfBinding: { type: 'd1', name: binding.name, id: found.uuid }, created: false, resourceType: 'd1', resourceId: found.uuid };
        }
        const created = await cf.d1.database.create({ account_id: accountId, name: title });
        if (sel.runInitSql !== false && (binding.initSqlUrl || binding.initSql)) {
            await executeInitSql(account, created.uuid, binding);
        }
        return { type: 'd1', name: binding.name, cfBinding: { type: 'd1', name: binding.name, id: created.uuid }, created: true, resourceType: 'd1', resourceId: created.uuid };
    }
    if (binding.type === 'r2') {
        if (sel.mode === 'existing' && sel.existingId) {
            return { type: 'r2', name: binding.name, cfBinding: { type: 'r2_bucket', name: binding.name, bucket_name: sel.existingId }, created: false, resourceType: 'r2', resourceId: sel.existingId };
        }
        let buckets = [];
        try {
            const resp = await cf.r2.buckets.list({ account_id: accountId });
            buckets = resp?.buckets || [];
        }
        catch { }
        const found = buckets.find(b => b.name === title);
        if (found) {
            return { type: 'r2', name: binding.name, cfBinding: { type: 'r2_bucket', name: binding.name, bucket_name: found.name }, created: false, resourceType: 'r2', resourceId: found.name };
        }
        await cf.r2.buckets.create({ account_id: accountId, name: title });
        return { type: 'r2', name: binding.name, cfBinding: { type: 'r2_bucket', name: binding.name, bucket_name: title }, created: true, resourceType: 'r2', resourceId: title };
    }
    throw new Error(`Unknown binding type: ${binding.type}`);
}
async function executeInitSql(account, dbId, binding) {
    let sql = binding.initSql;
    if (!sql && binding.initSqlUrl) {
        const resp = await (0, proxyService_1.proxyFetch)(binding.initSqlUrl, {}, 30000);
        if (!resp.ok)
            throw new Error(`initSqlUrl 下载失败: ${resp.status}`);
        sql = await resp.text();
    }
    if (!sql)
        return;
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.d1.database.query(dbId, { account_id: account.account_id, sql });
}
async function rollback(account, bindings, workerName, deleteWorker = true) {
    const errors = [];
    const cf = (0, cfFactory_1.getCfClient)(account);
    const accountId = account.account_id;
    for (const b of [...bindings].reverse()) {
        if (!b.created || !b.resourceType || !b.resourceId)
            continue;
        try {
            if (b.resourceType === 'kv')
                await cf.kv.namespaces.delete(b.resourceId, { account_id: accountId });
            else if (b.resourceType === 'd1')
                await cf.d1.database.delete(b.resourceId, { account_id: accountId });
            else if (b.resourceType === 'r2')
                await cf.r2.buckets.delete(b.resourceId, { account_id: accountId });
        }
        catch (e) {
            errors.push(`${b.resourceType}:${b.resourceId} - ${e.message}`);
        }
    }
    if (workerName && deleteWorker) {
        try {
            await cf.workers.scripts.delete(workerName, { account_id: accountId });
        }
        catch { }
    }
    return errors;
}
// ---- Pages deployment configs builder ----
function buildPagesDeploymentConfigs(template, resolvedBindings) {
    const prodConfigs = {};
    const previewConfigs = {};
    // Pages Functions 需要 compatibility_date / compatibility_flags 才能运行
    // 否则 functions/ 下的代码不会被 Cloudflare 识别，请求直接落到静态文件（返回 HTML）
    prodConfigs.compatibility_date = template.compatibility_date || '2024-11-01';
    previewConfigs.compatibility_date = template.compatibility_date || '2024-11-01';
    const flags = template.compatibility_flags || [];
    // 自动检测是否包含 functions/ 目录（repo-archive 部署通常都有 functions/），
    // 存在时追加 nodejs_compat 确保 Node.js 互操作正常工作
    if (flags.length > 0) {
        prodConfigs.compatibility_flags = [...flags];
        previewConfigs.compatibility_flags = [...flags];
    }
    if (template.env && Object.keys(template.env).length > 0) {
        prodConfigs.env_vars = {};
        previewConfigs.env_vars = {};
        for (const [k, v] of Object.entries(template.env)) {
            prodConfigs.env_vars[k] = { value: v };
            previewConfigs.env_vars[k] = { value: v };
        }
    }
    // CF Pages PATCH 部署配置的字段格式（来自 wrangler 源码确认）：
    //   kv_namespaces: Record<string, { namespace_id: string }>
    //   d1_databases:   Record<string, { id: string }>
    //   r2_buckets:     Record<string, { name: string }>
    // 全部是 Map/对象形式，不是数组；字段名也是 id / name（不是 database_id / bucket_name）
    for (const rb of resolvedBindings) {
        const b = rb.cfBinding;
        switch (rb.type) {
            case 'kv': {
                if (!prodConfigs.kv_namespaces) {
                    prodConfigs.kv_namespaces = {};
                    previewConfigs.kv_namespaces = {};
                }
                const entry = { namespace_id: b.namespace_id };
                prodConfigs.kv_namespaces[b.name] = entry;
                previewConfigs.kv_namespaces[b.name] = entry;
                break;
            }
            case 'd1': {
                if (!prodConfigs.d1_databases) {
                    prodConfigs.d1_databases = {};
                    previewConfigs.d1_databases = {};
                }
                const entry = { id: b.id };
                prodConfigs.d1_databases[b.name] = entry;
                previewConfigs.d1_databases[b.name] = entry;
                break;
            }
            case 'r2': {
                if (!prodConfigs.r2_buckets) {
                    prodConfigs.r2_buckets = {};
                    previewConfigs.r2_buckets = {};
                }
                const entry = { name: b.bucket_name };
                prodConfigs.r2_buckets[b.name] = entry;
                previewConfigs.r2_buckets[b.name] = entry;
                break;
            }
            case 'var': {
                if (!prodConfigs.env_vars)
                    prodConfigs.env_vars = {};
                if (!previewConfigs.env_vars)
                    previewConfigs.env_vars = {};
                // 跳过空值（CF Pages PATCH 含空值 env_var 会整批 reject，导致所有 env_vars 都不写入）
                if (!b.text || b.text.length === 0)
                    break;
                prodConfigs.env_vars[b.name] = { value: b.text, type: b.type };
                previewConfigs.env_vars[b.name] = { value: b.text, type: b.type };
                break;
            }
            case 'ai': {
                prodConfigs.ai = { binding: b.name };
                previewConfigs.ai = { binding: b.name };
                break;
            }
        }
    }
    const hasConfigs = Object.keys(prodConfigs).length > 0;
    return hasConfigs ? { production: prodConfigs, preview: previewConfigs } : undefined;
}
// ---- Preflight wrapper ----
async function preflightDeploy(opts) {
    const params = {
        templateId: opts.template.id,
        accountId: opts.account.id,
        name: opts.name,
        bindingSelections: opts.bindingSelections,
        secretValues: opts.secretValues,
        deployType: opts.deployType,
    };
    return (0, preflight_1.preflight)(opts.account, opts.template, params);
}
// ---- Main deploy ----
async function deployTemplate(opts) {
    const { account, template, name, bindingSelections, secretValues, deployType, traces, logs } = opts;
    if (!(0, workerService_1.validatePagesProjectName)(name)) {
        return { success: false, error: '项目名只能包含小写字母、数字和连字符，且以字母或数字开头', warnings: [], bindings: [] };
    }
    const warnings = [];
    const resolvedBindings = [];
    const urls = [];
    let workerDeployed = false;
    try {
        const doWorker = template.type === 'worker'
            || (template.type === 'hybrid' && (deployType === 'worker' || deployType === 'both' || !deployType));
        const doPages = template.type === 'pages'
            || (template.type === 'hybrid' && (deployType === 'pages' || deployType === 'both'));
        // Step 1: Resolve bindings
        for (const binding of (template.bindings || [])) {
            const selection = bindingSelections[binding.name];
            const resolved = await resolveBinding(account, binding, selection, template.id);
            if (binding.type === 'var' && binding.action === 'prompt') {
                const val = secretValues[binding.name] || binding.value || '';
                if (binding.required && !val)
                    throw new Error(`必填项 ${binding.name} 未填写`);
                resolved.cfBinding.text = val;
            }
            resolvedBindings.push(resolved);
        }
        // Step 2: Deploy worker
        if (doWorker) {
            const src = template.type === 'hybrid' ? template.sources?.worker : template.source;
            if (!src)
                throw new Error('No worker source configured');
            const content = await downloadArtifact(src.url, 'worker');
            const isZip = content[0] === 0x50 && content[1] === 0x4b;
            // Build CfWorkerInit from template
            const workerInit = {
                compatibility_date: template.compatibility_date || '2024-11-01',
                compatibility_flags: template.compatibility_flags || [],
                migrations: template.migrations,
                keepVars: template.keep_vars ?? true,
                keepSecrets: template.keep_secrets ?? true,
                keepBindings: template.keep_bindings ?? true,
                placement: template.placement,
                tail_consumers: template.tail_consumers,
                limits: template.limits,
                logpush: template.logpush,
            };
            // ZIP 多模块：解压出每个文件作为 Worker 模块上传（与 wrangler 本地解包一致）
            if (isZip) {
                const moduleFiles = (0, workerService_1.extractZipFiles)(content);
                const mainName = (0, workerService_1.resolveMainModule)(moduleFiles, src.mainModule);
                const mainFile = moduleFiles.find(m => m.path === mainName);
                if (!mainFile) {
                    throw new Error(`main_module "${mainName}" not found in zip (available: ${moduleFiles.map(m => m.path).join(', ')})`);
                }
                logger_1.appLogger.info(`[Deploy] ZIP extracted: ${moduleFiles.length} files, main=${mainName} (${mainFile.buffer.length} bytes)`);
                workerInit.main = {
                    name: mainName,
                    content: mainFile.buffer,
                    type: 'esm',
                };
                workerInit.modules = moduleFiles
                    .filter(m => m.path !== mainName)
                    .map(m => ({
                    name: m.path,
                    content: m.buffer,
                    type: /\.(m?js|cjs)$/i.test(m.path) ? 'esm' : 'text',
                }));
            }
            // Handle assets
            let assetsOpts;
            if (template.assets) {
                const assetContent = template.assets.source.url
                    ? await downloadArtifact(template.assets.source.url, 'worker')
                    : undefined;
                if (assetContent) {
                    const assetFiles = template.assets.source.kind === 'raw'
                        ? [{ path: template.assets.source.url.split('/').pop() || 'asset', buffer: assetContent }]
                        : (0, workerService_1.extractZipFiles)(assetContent);
                    assetsOpts = {
                        files: assetFiles,
                        binding: template.assets.binding,
                        config: template.assets.config,
                    };
                }
            }
            const result = await (0, workerDeploy_1.deployWorker)(account, name, isZip ? null : content, workerInit, {
                bindings: resolvedBindings.map(b => b.cfBinding),
                traces: traces !== false,
                logs: logs !== false,
                createDeployment: true,
                enableSubdomain: true,
                assets: assetsOpts,
                useVersionsApi: true, // 对标 wrangler：默认使用 Versions API（首次部署时内部会回退到 PUT）
            });
            urls.push(result.subdomain ? `https://${name}.${result.subdomain}.workers.dev` : `https://${name}.workers.dev`);
            logger_1.appLogger.info(`[Store] Worker deployed: ${name}`);
            workerDeployed = true;
            // Step 2.5: Deploy triggers (cron + routes)
            const triggerResult = await (0, triggers_1.deployTriggers)(account, name, template.crons || [], template.routes || []);
            warnings.push(...triggerResult.warnings);
        }
        // Step 3: Deploy pages
        if (doPages) {
            const src = template.type === 'hybrid' ? template.sources?.pages : template.source;
            if (!src)
                throw new Error('No pages source configured');
            const content = await downloadArtifact(src.url, 'pages');
            const files = (0, workerService_1.extractZipFiles)(content);
            // Build deployment_configs
            const deploymentConfigs = buildPagesDeploymentConfigs(template, resolvedBindings);
            await (0, pagesDeploy_1.deployPages)(account, name, files, {
                skipCreateProject: false,
                deploymentConfigs,
                branch: 'main',
                commitMessage: '',
            });
            // Get subdomain
            const cf = (0, cfFactory_1.getCfClient)(account);
            try {
                const project = await cf.pages.projects.get(name, { account_id: account.account_id });
                const subdomain = project?.subdomain || `${name}.pages.dev`;
                urls.push(`https://${subdomain}`);
            }
            catch {
                urls.push(`https://${name}.pages.dev`);
            }
            logger_1.appLogger.info(`[Store] Pages deployed: ${name}`);
        }
        (0, auditLog_1.createAuditLog)(account.id, 'store_deploy', name, `template: ${template.id}`, 'success');
        const url = urls.join(' | ') || (template.type === 'pages' ? `https://${name}.pages.dev` : `https://${name}.workers.dev`);
        return { success: true, warnings, bindings: resolvedBindings, url, accountName: account.name, accountId: account.account_id || undefined };
    }
    catch (e) {
        let cur = e;
        const chain = [];
        const seen = new Set();
        while (cur && !seen.has(cur)) {
            seen.add(cur);
            const seg = [cur.code, cur.message].filter(Boolean).join(' ');
            if (seg && !chain.includes(seg))
                chain.push(seg);
            cur = cur.cause;
        }
        const detail = chain.join(' <- ') || String(e);
        logger_1.appLogger.error(`[Store] Deploy failed for ${name} (${template.id}): ${detail}`);
        logger_1.appLogger.error((e && e.stack) ? e.stack : String(e));
        const rollbackErrors = await rollback(account, resolvedBindings, name, !workerDeployed);
        (0, auditLog_1.createAuditLog)(account.id, 'store_deploy', name, `error: ${detail}`, 'error');
        return {
            success: false, error: detail, warnings, bindings: resolvedBindings,
            rolledBack: true, rollbackErrors: rollbackErrors.length > 0 ? rollbackErrors : undefined,
        };
    }
}
//# sourceMappingURL=index.js.map