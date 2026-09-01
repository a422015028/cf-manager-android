"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractZipFiles = void 0;
exports.validatePagesProjectName = validatePagesProjectName;
exports.buildAssetsManifest = buildAssetsManifest;
exports.listWorkers = listWorkers;
exports.listPages = listPages;
exports.resolveMainModule = resolveMainModule;
exports.deployWorker = deployWorker;
exports.deployWorkerFromUrl = deployWorkerFromUrl;
exports.deleteWorker = deleteWorker;
exports.deletePagesProject = deletePagesProject;
exports.getWorkerLogs = getWorkerLogs;
exports.listSecrets = listSecrets;
exports.updateSecret = updateSecret;
exports.deleteSecret = deleteSecret;
exports.getSchedules = getSchedules;
exports.updateSchedules = updateSchedules;
exports.listDomains = listDomains;
exports.createDomain = createDomain;
exports.deleteDomain = deleteDomain;
exports.getSubdomain = getSubdomain;
exports.setSubdomain = setSubdomain;
exports.getScriptSettings = getScriptSettings;
exports.updateScriptSettings = updateScriptSettings;
exports.listRoutes = listRoutes;
exports.createRoute = createRoute;
exports.deleteRoute = deleteRoute;
exports.getScriptContent = getScriptContent;
exports.listDeployments = listDeployments;
exports.getPagesProject = getPagesProject;
exports.editPagesProject = editPagesProject;
exports.listPagesDomains = listPagesDomains;
exports.addPagesDomain = addPagesDomain;
exports.removePagesDomain = removePagesDomain;
exports.listPagesDeployments = listPagesDeployments;
exports.deletePagesDeployment = deletePagesDeployment;
exports.batchDeletePagesDeployments = batchDeletePagesDeployments;
exports.listKvNamespaces = listKvNamespaces;
exports.listD1Databases = listD1Databases;
exports.listR2Buckets = listR2Buckets;
exports.updatePagesBindings = updatePagesBindings;
exports.getWorkersUsageToday = getWorkersUsageToday;
exports.ensurePagesProject = ensurePagesProject;
exports.getWorkerConfig = getWorkerConfig;
exports.getPagesConfig = getPagesConfig;
exports.applyWorkerConfigDiff = applyWorkerConfigDiff;
const cfFactory_1 = require("./cfFactory");
const proxyService_1 = require("./proxyService");
const ssrfGuard_1 = require("./ssrfGuard");
const accountRouter_1 = require("./accountRouter");
const logger_1 = require("./logger");
const staticAssets_1 = require("./staticAssets");
Object.defineProperty(exports, "extractZipFiles", { enumerable: true, get: function () { return staticAssets_1.extractZipFiles; } });
// Node `Buffer` is not directly assignable to the DOM `BlobPart` type under strict mode
// (its backing store is typed as `ArrayBufferLike`, which may be a `SharedArrayBuffer`).
// Copy into an ArrayBuffer-backed Uint8Array so it serializes cleanly as a binary multipart field.
function bufferToBlobPart(buf) {
    const view = new Uint8Array(buf.byteLength);
    view.set(buf);
    return view;
}
// Pages 项目名称校验：Cloudflare 要求 ^[a-z0-9][a-z0-9-]*$
function validatePagesProjectName(name) {
    return /^[a-z0-9][a-z0-9-]*$/.test(name);
}
// 构造 Workers Assets manifest：路径以 "/" 开头，hash 与后端/Worker 资产算法一致。
async function buildAssetsManifest(files) {
    const manifest = {};
    for (const f of files) {
        const key = '/' + f.path.replace(/\\/g, '/').replace(/^\/+/, '');
        manifest[key] = { hash: await (0, staticAssets_1.computeStaticAssetHash)(f.buffer, f.path), size: f.buffer.length };
    }
    return manifest;
}
async function listWorkers(account) {
    const accountId = account.account_id;
    if (!accountId)
        return [];
    const cf = (0, cfFactory_1.getCfClient)(account);
    const scripts = [];
    for await (const script of cf.workers.scripts.list({ account_id: accountId })) {
        scripts.push(script);
    }
    return scripts;
}
async function listPages(account) {
    const accountId = account.account_id;
    if (!accountId)
        return [];
    const cf = (0, cfFactory_1.getCfClient)(account);
    const projects = [];
    for await (const project of cf.pages.projects.list({ account_id: accountId })) {
        projects.push(project);
    }
    return projects;
}
const CF_BASE = 'https://api.cloudflare.com/client/v4';
async function getAccountSubdomain(account) {
    const headers = (0, cfFactory_1.getAuthHeaders)(account);
    try {
        const resp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${account.account_id}/workers/subdomain`, {
            headers: { 'Content-Type': 'application/json', ...headers },
        }, 30000, undefined, account);
        if (!resp.ok)
            return '';
        const json = await resp.json();
        return json?.result?.subdomain || '';
    }
    catch {
        return '';
    }
}
// 三阶段上传 Worker 静态资源（与 wrangler 同款）：
//   1) POST .../assets-upload-session 提交 manifest → 返回 { jwt, buckets }
//      - buckets 非空：jwt 是 upload token，需按 buckets 分批上传缺失文件
//      - buckets 为空：所有资源已存在，jwt 直接就是 completion token，跳过阶段 2
//   2) POST .../workers/assets/upload?base64=true 按 bucket 分批 multipart 上传（field=hash, value=base64）
//   3) 返回 completion jwt，挂到 metadata.assets.jwt
async function deployWorkerAssets(account, scriptName, files) {
    const authHeaders = (0, cfFactory_1.getAuthHeaders)(account);
    const accountId = account.account_id;
    // 预计算 hash → buffer 映射，用于按 buckets 选择性上传
    const manifest = await buildAssetsManifest(files);
    const hashToBuffer = new Map();
    const hashToPath = new Map();
    for (const f of files) {
        const hash = await (0, staticAssets_1.computeStaticAssetHash)(f.buffer, f.path);
        if (!hashToBuffer.has(hash)) {
            hashToBuffer.set(hash, f.buffer);
            hashToPath.set(hash, f.path);
        }
    }
    const sessionResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${scriptName}/assets-upload-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders, 'User-Agent': 'wrangler/4.112.0' },
        body: JSON.stringify({ manifest }),
    }, 300000, undefined, account);
    const sessionJson = await sessionResp.json();
    const sessionJwt = sessionJson?.result?.jwt;
    const buckets = sessionJson?.result?.buckets || [];
    if (!sessionResp.ok || !sessionJson?.success || !sessionJwt) {
        throw new Error(`assets-upload-session failed: status=${sessionResp.status} success=${sessionJson?.success} ` +
            `hasJwt=${!!sessionJwt} errors=${JSON.stringify(sessionJson?.errors || sessionJson?.messages || '').slice(0, 400)}`);
    }
    // buckets 为空 → 所有资源已存在，sessionJwt 即为 completion token，直接返回（跳过上传）
    if (buckets.length === 0) {
        logger_1.appLogger.info(`[Worker Assets] All ${files.length} assets already uploaded, using completion JWT directly`);
        return { jwt: sessionJwt };
    }
    // 按 buckets 分批上传：每个 bucket 是一批需要一起上传的 hash 列表
    // 每批次上传后 CF 返回新的 JWT，下一批次必须用新 JWT（对标 wrangler syncAssets）
    const totalHashes = buckets.reduce((n, b) => n + b.length, 0);
    logger_1.appLogger.info(`[Worker Assets] Uploading ${totalHashes} assets in ${buckets.length} bucket(s)`);
    let completionJwt = sessionJwt;
    for (let bi = 0; bi < buckets.length; bi++) {
        const bucket = buckets[bi];
        const upForm = new FormData();
        for (const hash of bucket) {
            const buf = hashToBuffer.get(hash);
            if (!buf) {
                logger_1.appLogger.warn(`[Worker Assets] Hash ${hash} not found in local files, skipping`);
                continue;
            }
            upForm.append(hash, new Blob([buf.toString('base64')], { type: (0, staticAssets_1.getContentType)(hashToPath.get(hash) || '') }), hash);
        }
        const upResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/assets/upload?base64=true`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${completionJwt}`, 'User-Agent': 'wrangler/4.112.0' },
            body: upForm,
        }, 300000, undefined, account);
        if (!upResp.ok) {
            const txt = await upResp.text();
            throw new Error(`assets upload failed (bucket ${bi + 1}/${buckets.length}): ${upResp.status} ${txt} (jwtLen=${completionJwt.length})`);
        }
        const upJson = await upResp.json();
        if (upJson.result?.jwt)
            completionJwt = upJson.result.jwt;
    }
    if (!completionJwt)
        throw new Error(`assets upload response missing completion jwt`);
    return { jwt: completionJwt };
}
// 下载 assets 产物（zip 或 raw 单文件），与 catalogDeploy 的 downloadArtifact 同源。
async function downloadArtifactForAssets(src) {
    const resp = await (0, proxyService_1.proxyFetch)(src.url, {}, 30000);
    if (!resp.ok)
        throw new Error(`assets 产物下载失败: ${resp.status} ${src.url}`);
    return Buffer.from(await resp.arrayBuffer());
}
// 推断多模块入口文件名：优先显式 mainModule；其次 wrangler.toml/jsonc 的 main 字段；
// 仅 1 个模块时直接用；多模块时按常见入口名优先级（worker.js → index.js/index.mjs → 根目录首个 JS）查找；最后回退 'worker.js'。
function resolveMainModule(modules, explicit) {
    if (explicit)
        return explicit;
    if (!modules || modules.length === 0)
        return 'worker.js';
    const conf = modules.find(m => /^wrangler\.(toml|jsonc|json)$/i.test(m.path));
    if (conf) {
        const txt = conf.buffer.toString('utf-8');
        const m = txt.match(/^\s*main\s*=\s*"([^"]+)"/m) || txt.match(/"main"\s*:\s*"([^"]+)"/m);
        if (m)
            return m[1].replace(/^\.\//, '');
    }
    if (modules.length === 1)
        return modules[0].path;
    const candidates = ['worker.js', 'index.js', 'index.mjs', 'worker.mjs', 'index.cjs', 'worker.cjs'];
    for (const c of candidates) {
        if (modules.some(m => m.path === c))
            return c;
    }
    const root = modules.find(m => /^[^/\\]+\.(m?js|cjs)$/i.test(m.path));
    if (root)
        return root.path;
    return 'worker.js';
}
async function deployWorker(account, name, scriptContent, options) {
    const accountId = account.account_id;
    if (!accountId)
        throw new Error('Account ID is required');
    const cf = (0, cfFactory_1.getCfClient)(account);
    const authHeaders = (0, cfFactory_1.getAuthHeaders)(account);
    // 多模块：若提供 packageZip，本地解压为多个模块文件（与 wrangler 行为一致）。
    const moduleParts = options?.packageZip ? (0, staticAssets_1.extractZipFiles)(options.packageZip) : null;
    const mainModule = resolveMainModule(moduleParts, options?.mainModule);
    // 推断需要的兼容性标志：含 CJS 互操作（__commonJS/require）或访问 process/Buffer/node:
    // 构建产物（如 React Router v7 on Workers）必须开启 nodejs_compat，否则运行时抛异常（Error 1101）。
    const flags = new Set(options?.compatibilityFlags || []);
    const probe = (buf) => {
        const s = typeof buf === 'string' ? buf : Buffer.from(buf).toString('latin1');
        // process\. 捕获 process.env / process.platform / process.versions 等所有 process 访问；
        // global\.process 捕获打包器生成的 global.process 互操作。这些在未开启 nodejs_compat 时会抛 ReferenceError。
        return /__commonJS|function __require|\brequire\(|from ["']node:|\bprocess\.|globalThis\.process|global\.process|\bBuffer\.|node:async_hooks/.test(s);
    };
    let needsNodeCompat = false;
    if (moduleParts && moduleParts.length > 0) {
        needsNodeCompat = moduleParts.some(m => probe(m.buffer));
    }
    else if (scriptContent) {
        needsNodeCompat = probe(scriptContent);
    }
    if (needsNodeCompat)
        flags.add('nodejs_compat');
    // Build metadata with optional bindings and env vars
    const metadata = {
        main_module: moduleParts && moduleParts.length > 0 ? mainModule : 'worker.js',
        compatibility_date: options?.compatibilityDate || '2024-11-01',
    };
    if (flags.size > 0)
        metadata.compatibility_flags = [...flags];
    // Workers 跟踪 / 日志开关（缺省均开启，与 store 部署一致）。
    // 注意：Cloudflare 不会从上传脚本的 metadata 读取 observability，必须等脚本上传成功后
    // 通过独立的 settings/observability 端点设置（见下方提交上传后的 applyObservability）。
    const tracesEnabled = options?.traces !== false; // Workers 跟踪
    const logsEnabled = options?.logs !== false; // Workers 日志
    if (options?.bindings?.length) {
        metadata.bindings = options.bindings;
    }
    if (options?.env) {
        metadata.bindings = [
            ...(metadata.bindings || []),
            ...Object.entries(options.env).map(([k, v]) => ({ type: 'plain_text', name: k, text: v })),
        ];
    }
    // Worker with Assets：可选静态资源三阶段上传，并注入 ASSETS 绑定（默认 ASSETS，可覆盖）。
    if (options?.assets) {
        const assetContent = options.assetsBuffer
            ? options.assetsBuffer
            : await downloadArtifactForAssets(options.assets.source);
        const assetFiles = options.assets.source.kind === 'raw'
            ? [{ path: options.assets.source.url.split('/').pop() || 'asset', buffer: assetContent }]
            : (0, staticAssets_1.extractZipFiles)(assetContent);
        const { jwt } = await deployWorkerAssets(account, name, assetFiles);
        metadata.assets = { jwt, config: options.assets.config || undefined };
        metadata.bindings = [...(metadata.bindings || []), { name: options.assets.binding || 'ASSETS', type: 'assets' }];
    }
    // 多模块 zip（如 React Router on Workers）解压出的每个文件都要作为 Worker 模块上传：
    // index.js 入口会 import assets/*.js 等代码分片，它们必须随脚本一起上传，否则 CF 报
    // "No such module"。注意：静态资源（assets 绑定）由下面的 deployWorkerAssets 单独上传，
    // 与这里的模块上传是两条独立通道，不要在此排除 assets/。
    const moduleFiles = moduleParts;
    // Use raw fetch + FormData (same as Cloudflare wrangler does)
    // The SDK's scripts.update can mangle the multipart form in some versions
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    if (moduleFiles && moduleFiles.length > 0) {
        // 多模块：zip 解压出的每个文件一个 files= part，main_module 指向入口文件
        if (!moduleFiles.some(m => m.path === mainModule)) {
            throw new Error(`main_module "${mainModule}" 未在 zip 模块中找到（已包含: ${moduleFiles.map(m => m.path).join(', ')}）`);
        }
        for (const m of moduleFiles) {
            const isJs = /\.(m?js|cjs)$/i.test(m.path);
            form.append(m.path, new Blob([bufferToBlobPart(m.buffer)], { type: isJs ? 'application/javascript+module' : (0, staticAssets_1.getContentType)(m.path) }), m.path);
        }
    }
    else {
        // 单模块（默认）：兼容旧路径，脚本内容即 worker.js
        const contentBytes = typeof scriptContent === 'string'
            ? new TextEncoder().encode(scriptContent)
            : new Uint8Array(scriptContent);
        form.append('worker.js', new Blob([contentBytes], { type: 'application/javascript+module' }), 'worker.js');
    }
    // 版本化优先（对齐 Store 部署通道 workerDeploy.ts）：
    // 版本化 worker 下传统 PUT 的 metadata.bindings 会被 CF 忽略，必须用 Versions API 提交才能让 vars/bindings 生效。
    // - script 已存在 → POST /versions?bindings_inherit=strict（创建带 bindings 的新版本）+ POST /deployments
    // - script 不存在 → 传统 PUT 创建（首次部署，自动上线）
    const checkResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}`, {
        headers: { ...authHeaders, 'User-Agent': 'wrangler/4.112.0' },
    }, 30000, undefined, account);
    let respJson;
    if (checkResp.status === 404) {
        const createResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}`, {
            method: 'PUT',
            headers: { ...authHeaders, 'User-Agent': 'wrangler/4.112.0' },
            body: form,
        }, 300000, undefined, account);
        respJson = await createResp.json();
        if (!createResp.ok || !respJson.success) {
            throw new Error(`Script creation failed: ${createResp.status} ${JSON.stringify(respJson)}`);
        }
    }
    else if (!checkResp.ok) {
        const errBody = await checkResp.text();
        throw new Error(`Script existence check failed: ${checkResp.status} ${errBody.slice(0, 300)}`);
    }
    else {
        // 已存在：优先 Versions API（版本化 worker 下 bindings 才能生效）
        const versionResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}/versions?bindings_inherit=strict`, {
            method: 'POST',
            headers: { ...authHeaders, 'User-Agent': 'wrangler/4.112.0' },
            body: form,
        }, 300000, undefined, account);
        const versionJson = await versionResp.json();
        if (versionResp.ok && versionJson.success) {
            respJson = versionJson;
        }
        else {
            // 非版本化 worker：versions API 不可用，fallback 传统 PUT（PUT 自动部署）
            logger_1.appLogger.warn(`[Worker Deploy] Versions API unavailable for ${name} (${versionResp.status}), falling back to PUT`);
            const putResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}`, {
                method: 'PUT',
                headers: { ...authHeaders, 'User-Agent': 'wrangler/4.112.0' },
                body: form,
            }, 300000, undefined, account);
            respJson = await putResp.json();
            if (!putResp.ok || !respJson.success) {
                throw new Error(`${putResp.status} ${JSON.stringify(respJson)}`);
            }
        }
    }
    console.log(`[DBG] deployWorker upload status=ok success=${respJson.success} versionId=${respJson?.result?.version_id || respJson?.result?.id || respJson?.result?.version?.id}`);
    // 设置可观测性（Workers 跟踪 + 日志）。Cloudflare 不读取上传 metadata 中的 observability，
    // 必须通过独立的 PATCH script-settings 端点设置（observability 作为嵌套字段）；脚本上传成功后再调用。
    // 两者都关闭时跳过调用，避免无谓的 API 请求（及账户无权限时的报错）。
    if (tracesEnabled || logsEnabled) {
        // 顶层 enabled 是总开关，任一子项开启都必须为 true；traces/logs 需作为独立子对象发送。
        const obsBody = { enabled: true, head_sampling_rate: 1 };
        if (tracesEnabled)
            obsBody.traces = { enabled: true, persist: true, head_sampling_rate: 1 };
        if (logsEnabled)
            obsBody.logs = { enabled: true, persist: true, invocation_logs: true, head_sampling_rate: 1 };
        const obsResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}/script-settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeaders, 'User-Agent': 'wrangler/4.112.0' },
            body: JSON.stringify({ observability: obsBody }),
        }, 30000, undefined, account);
        if (!obsResp.ok) {
            const obsErr = await obsResp.text();
            throw new Error(`设置 Workers 可观测性失败 (${obsResp.status}): ${obsErr}`);
        }
    }
    // 从上传响应中提取 version_id（版本化 API 下需要用它创建 deployment）
    // 注意：传统 PUT 的 result.id 是脚本名（如 "smail"），不能用作回退；POST /versions 的 result.id 才是版本 ID
    let versionId = respJson?.result?.version_id ||
        respJson?.result?.version?.id ||
        respJson?.result?.id;
    // Enable workers.dev subdomain so the Worker is accessible immediately
    let subdomain;
    const shouldEnableSubdomain = options?.enableSubdomain !== false; // default true
    if (shouldEnableSubdomain) {
        try {
            await cf.workers.scripts.subdomain.create(name, { account_id: accountId, enabled: true, previews_enabled: true });
        }
        catch (_) {
            // Soft fail: user can still enable manually from settings drawer
        }
        // Get account-level subdomain for URL construction
        subdomain = await getAccountSubdomain(account);
    }
    // Create deployment：版本化 API 下 PUT 只创建版本不部署，必须显式创建 deployment 才能上线。
    // 经典 API 下 PUT 已直接部署，createDeployment 仅用于版本追踪（非必需）。
    // 必须有 version_id 才能创建 deployment，否则 API 报 versions:[] 无效。
    if (options?.createDeployment) {
        try {
            // 若 PUT 响应未携带 version_id，查询版本列表获取最新版本 ID
            if (!versionId) {
                try {
                    const versionsResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}/versions`, {
                        headers: { ...authHeaders, 'User-Agent': 'wrangler/4.112.0' },
                    }, 30000, undefined, account);
                    if (versionsResp.ok) {
                        const versionsJson = await versionsResp.json();
                        const versions = versionsJson?.result || [];
                        if (versions.length > 0) {
                            versionId = versions[0]?.id; // 版本列表按 created_on 降序，首个即最新
                        }
                    }
                }
                catch {
                    // 经典模式：versions 端点不可用，PUT 已直接部署
                }
            }
            // 有 version_id 才发 deployment 请求；没有则跳过（PUT 已部署，createDeployment 非必需）
            if (versionId) {
                const depResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}/deployments`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders, 'User-Agent': 'wrangler/4.112.0' },
                    body: JSON.stringify({
                        strategy: 'percentage',
                        versions: [{ percentage: 100, version_id: versionId }],
                        annotations: options.deploymentAnnotation || {},
                    }),
                }, 30000, undefined, account);
                if (!depResp.ok) {
                    const depTxt = await depResp.text();
                    // 失败必须抛错：否则 batch-deploy 会误判为 success，前端乐观显示「保存成功」但实际版本未上线
                    throw new Error(`[Worker Deploy] Deployment creation failed for ${name}: ${depResp.status} ${depTxt.slice(0, 500)}`);
                }
            }
        }
        catch (e) {
            logger_1.appLogger.warn(`[Worker Deploy] Deployment creation warning for ${name}: ${e.message}`);
        }
    }
    return { script: respJson.result, subdomain };
}
// Deploy worker from URL: fetch JS from remote URL then upload
async function deployWorkerFromUrl(account, name, url, options) {
    const scriptContent = await (0, ssrfGuard_1.fetchScriptSafely)(url);
    return deployWorker(account, name, scriptContent, options);
}
async function deleteWorker(account, name) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.workers.scripts.delete(name, { account_id: accountId });
}
async function deletePagesProject(account, name) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.pages.projects.delete(name, { account_id: accountId });
}
async function getWorkerLogs(account, name) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const result = await cf.workers.scripts.tail.get(name, { account_id: accountId });
    return result;
}
// ============ Worker Settings ============
// --- Secrets ---
async function listSecrets(account, scriptName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const secrets = [];
    for await (const s of cf.workers.scripts.secrets.list(scriptName, { account_id: accountId })) {
        secrets.push(s);
    }
    return secrets;
}
async function updateSecret(account, scriptName, secretName, type, text, keyBase64) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const params = { account_id: accountId, name: secretName, type };
    if (type === 'secret_text')
        params.text = text;
    if (type === 'secret_key')
        params.key_base64 = keyBase64;
    return await cf.workers.scripts.secrets.update(scriptName, params);
}
async function deleteSecret(account, scriptName, secretName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.workers.scripts.secrets.delete(scriptName, secretName, { account_id: accountId });
}
// --- Cron Schedules ---
async function getSchedules(account, scriptName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.workers.scripts.schedules.get(scriptName, { account_id: accountId });
}
async function updateSchedules(account, scriptName, crons) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.workers.scripts.schedules.update(scriptName, {
        account_id: accountId,
        body: crons.map(c => ({ cron: c })),
    });
}
// --- Custom Domains ---
async function listDomains(account, serviceName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const domains = [];
    const params = { account_id: accountId };
    if (serviceName)
        params.service = serviceName;
    for await (const d of cf.workers.domains.list(params)) {
        domains.push(d);
    }
    return domains;
}
async function createDomain(account, hostname, service, environment) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const params = { account_id: accountId, hostname, service };
    if (environment)
        params.environment = environment;
    return await cf.workers.domains.update(params);
}
async function deleteDomain(account, domainId) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.workers.domains.delete(domainId, { account_id: accountId });
}
// --- Subdomain (workers.dev) ---
async function getSubdomain(account, scriptName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const raw = await cf.workers.scripts.subdomain.get(scriptName, { account_id: accountId });
    // 额外拉取账户级 workers.dev 子域名，供前端拼出完整 URL：https://<script>.<accountSubdomain>.workers.dev
    const accountSubdomain = await getAccountSubdomain(account);
    const enabled = raw?.enabled;
    const previews_enabled = raw?.previews_enabled;
    const url = accountSubdomain ? `https://${scriptName}.${accountSubdomain}.workers.dev` : '';
    return { enabled, previews_enabled, accountSubdomain, url };
}
async function setSubdomain(account, scriptName, enabled) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.workers.scripts.subdomain.create(scriptName, { account_id: accountId, enabled });
}
// --- Script Settings ---
async function getScriptSettings(account, scriptName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.workers.scripts.settings.get(scriptName, { account_id: accountId });
}
async function updateScriptSettings(account, scriptName, settings) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.workers.scripts.settings.edit(scriptName, { account_id: accountId, ...settings });
}
// --- Routes ---
async function listRoutes(account, zoneId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const routes = [];
    for await (const r of cf.workers.routes.list({ zone_id: zoneId })) {
        routes.push(r);
    }
    return routes;
}
async function createRoute(account, zoneId, pattern, script) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.workers.routes.create({ zone_id: zoneId, pattern, script });
}
async function deleteRoute(account, zoneId, routeId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.workers.routes.delete(routeId, { zone_id: zoneId });
}
// --- Script Content ---
// Cloudflare GET /accounts/{id}/workers/scripts/{name} 返回 multipart/form-data，
// 真正的脚本内容在 `worker.js` 字段里。SDK 拿到的就是原始 multipart body，
// 这里用原生 fetch + 自写解析器抠出 worker.js。
async function getScriptContent(account, scriptName) {
    const accountId = account.account_id;
    if (!accountId)
        throw new Error('Account ID is required');
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}`;
    const resp = await (0, proxyService_1.proxyFetch)(url, { headers: { ...(0, cfFactory_1.getAuthHeaders)(account), Accept: '*/*' } }, 30000, undefined, account);
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Failed to fetch script content: ${resp.status} ${text.slice(0, 200)}`);
    }
    const contentType = resp.headers.get('content-type') || '';
    const buf = Buffer.from(await resp.arrayBuffer());
    // 如果不是 multipart，直接当文本返回（兼容未来 CF 改为纯文本的情况）
    if (!/multipart\/form-data/i.test(contentType)) {
        return buf.toString('utf-8');
    }
    // 解析 multipart：取 boundary，按 boundary 切片，每段查找 Content-Disposition 含 worker.js 的
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
    if (!boundary)
        return buf.toString('utf-8');
    const delim = Buffer.from(`--${boundary}`);
    const start = buf.indexOf(delim);
    if (start < 0)
        return buf.toString('utf-8');
    const parts = [];
    let pos = start;
    while (pos < buf.length) {
        const next = buf.indexOf(delim, pos + delim.length);
        const seg = next < 0 ? buf.subarray(pos + delim.length) : buf.subarray(pos + delim.length, next);
        if (seg.length > 0)
            parts.push(seg);
        if (next < 0)
            break;
        pos = next;
    }
    for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd < 0)
            continue;
        const headers = part.subarray(0, headerEnd).toString('utf-8');
        if (!/name="worker\.js"/i.test(headers))
            continue;
        // body 是 headerEnd+4 到末尾，去掉尾部 \r\n
        let body = part.subarray(headerEnd + 4);
        if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
            body = body.subarray(0, body.length - 2);
        }
        return body.toString('utf-8');
    }
    return buf.toString('utf-8');
}
// --- Deployments ---
async function listDeployments(account, scriptName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.workers.scripts.deployments.list(scriptName, { account_id: accountId });
}
// ============ Pages Settings ============
async function getPagesProject(account, projectName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    return await cf.pages.projects.get(projectName, { account_id: accountId });
}
async function editPagesProject(account, projectName, params) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const envVarsDebug = JSON.stringify(params?.deployment_configs?.production?.env_vars || params?.deployment_configs?.production?.env_vars);
    console.log(`[DBG] editPagesProject ${projectName} productionEnvVars=${envVarsDebug}`);
    console.log(`[DBG] editPagesProject ${projectName} fullParams=${JSON.stringify(params)}`);
    const res = await cf.pages.projects.edit(projectName, { account_id: accountId, ...params });
    console.log(`[DBG] editPagesProject resultEnvVars=${JSON.stringify(res?.deployment_configs?.production?.env_vars)}`);
    return res;
}
async function listPagesDomains(account, projectName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const domains = [];
    for await (const d of cf.pages.projects.domains.list(projectName, { account_id: accountId })) {
        domains.push(d);
    }
    return domains;
}
async function addPagesDomain(account, projectName, hostname) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    // 1. Get Pages project info to find the real subdomain
    let pagesSubdomain;
    try {
        const projectInfo = await cf.pages.projects.get(projectName, { account_id: accountId });
        // Real subdomain format: {projectName}.{accountSubdomain}.pages.dev
        pagesSubdomain = projectInfo.subdomain || `${projectName}.pages.dev`;
        logger_1.appLogger.info(`[Pages Domain] Real subdomain: ${pagesSubdomain}`);
    }
    catch (e) {
        // Fallback to old format if API fails
        pagesSubdomain = `${projectName}.pages.dev`;
        logger_1.appLogger.warn(`[Pages Domain] Failed to get project info, using fallback: ${pagesSubdomain}`);
    }
    // 2. Create the Pages domain association
    const result = await cf.pages.projects.domains.create(projectName, { account_id: accountId, name: hostname });
    // 3. Automatically create CNAME DNS record if zone is in the same account
    try {
        const allZones = await (0, accountRouter_1.getAllZones)();
        const accountZones = allZones.filter(z => z.cfAccountId === account.id);
        const matchingZone = accountZones.find((z) => hostname.endsWith('.' + z.name) || hostname === z.name);
        if (matchingZone) {
            const existing = [];
            for await (const r of cf.dns.records.list({ zone_id: matchingZone.id, type: 'CNAME', name: { exact: hostname } })) {
                existing.push(r);
            }
            if (existing.length === 0) {
                await cf.dns.records.create({
                    zone_id: matchingZone.id,
                    type: 'CNAME',
                    name: hostname,
                    content: pagesSubdomain,
                    proxied: true,
                    ttl: 1,
                });
                logger_1.appLogger.info(`[Pages Domain] Created CNAME: ${hostname} → ${pagesSubdomain} (proxied)`);
            }
            else {
                logger_1.appLogger.info(`[Pages Domain] CNAME already exists for ${hostname}, skipping`);
            }
        }
        else {
            logger_1.appLogger.warn(`[Pages Domain] No matching zone found for ${hostname}, DNS record not created`);
        }
    }
    catch (dnsErr) {
        logger_1.appLogger.error(`[Pages Domain] Failed to create DNS record: ${dnsErr}`);
    }
    return result;
}
async function removePagesDomain(account, projectName, hostname) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    // 1. Remove the Pages domain association
    const result = await cf.pages.projects.domains.delete(projectName, hostname, { account_id: accountId });
    // 2. Clean up CNAME DNS record
    try {
        const allZones = await (0, accountRouter_1.getAllZones)();
        const accountZones = allZones.filter(z => z.cfAccountId === account.id);
        const matchingZone = accountZones.find((z) => hostname.endsWith('.' + z.name) || hostname === z.name);
        if (matchingZone) {
            const records = [];
            for await (const r of cf.dns.records.list({ zone_id: matchingZone.id, type: 'CNAME', name: { exact: hostname } })) {
                records.push(r);
            }
            for (const r of records) {
                if (r.content?.endsWith('.pages.dev')) {
                    await cf.dns.records.delete(r.id, { zone_id: matchingZone.id });
                    logger_1.appLogger.info(`[Pages Domain] Deleted CNAME: ${hostname} → ${r.content}`);
                }
            }
        }
    }
    catch (dnsErr) {
        logger_1.appLogger.error(`[Pages Domain] Failed to delete DNS record: ${dnsErr}`);
    }
    return result;
}
async function listPagesDeployments(account, projectName) {
    const accountId = account.account_id;
    const cf = (0, cfFactory_1.getCfClient)(account);
    const deps = [];
    for await (const d of cf.pages.projects.deployments.list(projectName, { account_id: accountId })) {
        deps.push(d);
    }
    return deps;
}
async function deletePagesDeployment(account, projectName, deploymentId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    try {
        await cf.pages.projects.deployments.delete(projectName, deploymentId, {
            account_id: account.account_id,
        });
        return { success: true };
    }
    catch (err) {
        logger_1.appLogger.error(`[Pages Deployment] Delete failed: ${deploymentId} — ${err?.message || err}`);
        return { success: false, error: err?.message || String(err) };
    }
}
/**
 * 批量删除 Pages 部署记录（受控并发，最多 3 条并行）
 */
async function batchDeletePagesDeployments(account, projectName, ids) {
    const CONCURRENCY = 3;
    const results = [];
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const batch = ids.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(batch.map(id => deletePagesDeployment(account, projectName, id)));
        batchResults.forEach((r, j) => {
            if (r.status === 'fulfilled') {
                results.push({ id: batch[j], ...r.value });
            }
            else {
                results.push({ id: batch[j], success: false, error: String(r.reason) });
            }
        });
    }
    const succeeded = results.filter(r => r.success).length;
    return { total: ids.length, succeeded, failed: ids.length - succeeded, results };
}
// ============ Cloudflare Resources (for Pages bindings) ============
async function listKvNamespaces(account) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const items = [];
    for await (const ns of cf.kv.namespaces.list({ account_id: account.account_id })) {
        items.push(ns);
    }
    return items;
}
async function listD1Databases(account) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const items = [];
    for await (const db of cf.d1.database.list({ account_id: account.account_id })) {
        items.push(db);
    }
    return items;
}
async function listR2Buckets(account) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const resp = await cf.r2.buckets.list({ account_id: account.account_id });
    return resp?.buckets || [];
}
// Update Pages project bindings via deployment_configs
async function updatePagesBindings(account, projectName, deploymentConfigs) {
    return await editPagesProject(account, projectName, { deployment_configs: deploymentConfigs });
}
function getTodayMidnightUTC() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
async function getWorkersUsageToday(account) {
    const accountId = account.account_id;
    if (!accountId)
        return { requests: 0, errors: 0, subrequests: 0, cpuTimeMs: 0 };
    const now = new Date();
    const todayDate = now.toISOString().substring(0, 10);
    const datetimeStart = getTodayMidnightUTC();
    const datetimeEnd = now.toISOString();
    const query = `
    query CfWorkersUsage($accountTag: string!, $datetimeStart: Time!, $datetimeEnd: Time!, $todayDate: Date!) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          workers: workersInvocationsAdaptive(
            filter: {
              datetime_geq: $datetimeStart,
              datetime_leq: $datetimeEnd
            }
            limit: 10000
          ) {
            sum {
              requests
              errors
              subrequests
              cpuTimeUs
            }
          }
          pages: pagesFunctionsInvocationsAdaptiveGroups(
            filter: {
              date: $todayDate
            }
            limit: 1
          ) {
            sum {
              requests
              errors
            }
          }
        }
      }
    }
  `;
    const headers = (0, cfFactory_1.getAuthHeaders)(account);
    const fetchUrl = 'https://api.cloudflare.com/client/v4/graphql';
    const fetchInit = {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query,
            variables: { accountTag: accountId, datetimeStart, datetimeEnd, todayDate },
        }),
    };
    let resp;
    try {
        resp = await (0, proxyService_1.proxyFetch)(fetchUrl, fetchInit, 300000, undefined, account);
    }
    catch (e) {
        logger_1.appLogger.error(`[Workers Usage] Fetch failed for ${account.name}: ${e}\n[DEBUG curl] ${(0, proxyService_1.buildCurlCommand)(fetchUrl, fetchInit)}`);
        return { requests: 0, errors: 0, subrequests: 0, cpuTimeMs: 0 };
    }
    if (!resp.ok) {
        const text = await resp.text();
        logger_1.appLogger.error(`[GraphQL] Workers usage query failed: ${resp.status} ${text}\n[DEBUG curl] ${(0, proxyService_1.buildCurlCommand)(fetchUrl, fetchInit)}`);
        return { requests: 0, errors: 0, subrequests: 0, cpuTimeMs: 0 };
    }
    const json = await resp.json();
    if (json.errors) {
        logger_1.appLogger.error(`[GraphQL] Errors: ${JSON.stringify(json.errors)}`);
        return { requests: 0, errors: 0, subrequests: 0, cpuTimeMs: 0 };
    }
    const acct = json?.data?.viewer?.accounts?.[0];
    const workerRecords = acct?.workers || [];
    const pagesRecords = acct?.pages || [];
    let totalRequests = 0, totalErrors = 0, totalSubrequests = 0, totalCpuUs = 0;
    for (const rec of workerRecords) {
        const s = rec.sum || {};
        totalRequests += s.requests || 0;
        totalErrors += s.errors || 0;
        totalSubrequests += s.subrequests || 0;
        totalCpuUs += s.cpuTimeUs || 0;
    }
    for (const rec of pagesRecords) {
        const s = rec.sum || {};
        totalRequests += s.requests || 0;
        totalErrors += s.errors || 0;
    }
    return {
        requests: totalRequests,
        errors: totalErrors,
        subrequests: totalSubrequests,
        cpuTimeMs: Math.round(totalCpuUs / 1000),
    };
}
// 确保 Pages 项目存在，已存在时忽略 409 错误
async function ensurePagesProject(account, projectName) {
    const accountId = account.account_id;
    if (!accountId)
        throw new Error('Account ID is required');
    const cf = (0, cfFactory_1.getCfClient)(account);
    try {
        await cf.pages.projects.create({ account_id: accountId, name: projectName, production_branch: 'main' });
    }
    catch (e) {
        if (e?.status !== 409)
            throw e; // 409 = already exists, ignore
    }
}
async function getWorkerConfig(account, name) {
    const authHeaders = (0, cfFactory_1.getAuthHeaders)(account);
    const resp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${account.account_id}/workers/scripts/${name}`, { headers: authHeaders }, 30000, undefined, account);
    const buf = Buffer.from(await resp.arrayBuffer());
    const contentType = (resp.headers.get('content-type') || '');
    const vars = [];
    const bindings = [];
    const mapBinding = (b) => {
        if (b.type === 'plain_text')
            vars.push({ name: b.name, value: b.text ?? '', secret: false });
        else if (b.type === 'secret_text')
            vars.push({ name: b.name, value: null, secret: true });
        else {
            // 归一化为前端意图类型，并保留高级绑定的参数字段供重部署预填回填
            const intentType = b.type === 'durable_object_namespace' ? 'durable_object' :
                b.type === 'kv_namespace' ? 'kv' :
                    b.type === 'r2_bucket' ? 'r2' : b.type;
            bindings.push({
                type: intentType, name: b.name, mode: 'existing',
                resourceName: b.namespace_id || b.id || b.bucket_name || undefined,
                ...(intentType === 'durable_object' ? { className: b.class_name, scriptName: b.script_name } : {}),
                ...(intentType === 'service' ? { service: b.service, environment: b.environment } : {}),
                ...(intentType === 'queue' ? { queueName: b.queue_name } : {}),
            });
        }
    };
    // 1) multipart metadata part（非版本化 worker 的 GET /scripts/:name 返回 bindings）
    if (/multipart\/form-data/i.test(contentType)) {
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
        if (boundary) {
            const delim = Buffer.from(`--${boundary}`);
            const findIndex = (hay, needle, from = 0) => {
                outer: for (let i = from; i <= hay.length - needle.length; i++) {
                    for (let j = 0; j < needle.length; j++)
                        if (hay[i + j] !== needle[j])
                            continue outer;
                    return i;
                }
                return -1;
            };
            let pos = findIndex(buf, delim);
            while (pos >= 0 && pos < buf.length) {
                const next = findIndex(buf, delim, pos + delim.length);
                const seg = next < 0 ? buf.subarray(pos + delim.length) : buf.subarray(pos + delim.length, next);
                if (seg.length > 0) {
                    const headerEnd = findIndex(seg, Buffer.from('\r\n\r\n'));
                    if (headerEnd >= 0 && /name="metadata"/i.test(seg.subarray(0, headerEnd).toString())) {
                        let body = seg.subarray(headerEnd + 4);
                        if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a)
                            body = body.subarray(0, body.length - 2);
                        try {
                            const meta = JSON.parse(body.toString());
                            for (const b of (meta.bindings || []))
                                mapBinding(b);
                        }
                        catch { /* metadata 解析失败忽略，走版本化 fallback */ }
                    }
                }
                if (next < 0)
                    break;
                pos = next;
            }
        }
    }
    // 2) 版本化 fallback：版本化 worker 的 GET /scripts/:name 不返回 bindings，
    //    必须查 Versions API（当前部署版本的 resources.bindings）
    if (vars.length === 0 && bindings.length === 0) {
        try {
            const cf = (0, cfFactory_1.getCfClient)(account);
            const deps = await cf.workers.scripts.deployments.list(name, { account_id: account.account_id });
            const latest = (deps?.deployments || deps?.result?.deployments || [])[0];
            const vid = latest?.versions?.[0]?.version_id;
            if (vid) {
                const v = await cf.workers.scripts.versions.get(name, vid, { account_id: account.account_id });
                const raw = (v?.resources?.bindings || v?.result?.resources?.bindings || []);
                for (const b of raw)
                    mapBinding(b);
            }
        }
        catch { /* 读回失败静默，前端有降级提示 */ }
    }
    return { vars, bindings };
}
async function getPagesConfig(account, name) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const project = await cf.pages.projects.get(name, { account_id: account.account_id });
    const cfg = project?.deployment_configs?.production || {};
    const vars = [];
    const bindings = [];
    for (const [k, v] of Object.entries(cfg.env_vars || {})) {
        const isSecret = v?.type === 'secret_text';
        vars.push({ name: k, value: isSecret ? null : (v?.value ?? ''), secret: isSecret });
    }
    for (const [name, v] of Object.entries(cfg.kv_namespaces || {}))
        bindings.push({ type: 'kv', name, resourceName: v?.namespace_id, mode: 'existing' });
    for (const [name, v] of Object.entries(cfg.d1_databases || {}))
        bindings.push({ type: 'd1', name, resourceName: v?.id, mode: 'existing' });
    for (const [name, v] of Object.entries(cfg.r2_buckets || {}))
        bindings.push({ type: 'r2', name, resourceName: v?.name, mode: 'existing' });
    if (cfg.ai?.binding)
        bindings.push({ type: 'ai', name: cfg.ai.binding, mode: 'existing' });
    return { vars, bindings };
}
// 全量覆盖 + diff：
// - plain/资源绑定有变化 → 用 scriptContent（或拉取现有代码）重传 deployWorker
// - 仅 secrets 变化 → 只调 updateSecret/deleteSecret，不重传代码
async function applyWorkerConfigDiff(account, name, opts) {
    const current = await getWorkerConfig(account, name);
    const currentPlain = new Map(current.vars.filter(v => !v.secret).map(v => [v.name, v.value || '']));
    const currentSecretNames = new Set(current.vars.filter(v => v.secret).map(v => v.name));
    const targetPlain = new Map((opts.vars || []).filter(v => !v.secret && !v.keep).map(v => [v.name, v.value || '']));
    const targetSecretNames = new Set((opts.vars || []).filter(v => v.secret).map(v => v.name));
    const plainChanged = targetPlain.size !== currentPlain.size
        || [...targetPlain.entries()].some(([k, val]) => currentPlain.get(k) !== val);
    // 指纹只比较（类型:名称）集合——current.bindings 不含资源 id，opts.bindings 含 id，比较语义集合即可
    // secret 由 secrets API 独立管理：剔除 secret_text，避免新增/修改 secret 误触发代码重传
    // 写入侧为 CF 原始类型（kv_namespace 等），比较前统一归一化为前端意图类型（与读取侧 getWorkerConfig 一致）
    const toIntentType = (type) => type === 'durable_object_namespace' ? 'durable_object' :
        type === 'kv_namespace' ? 'kv' :
            type === 'r2_bucket' ? 'r2' : type;
    const bindingFingerprint = (arr) => JSON.stringify((arr || []).filter((b) => b.type !== 'secret_text').map((b) => `${toIntentType(b.type)}:${b.name}`).sort());
    const bindingsChanged = bindingFingerprint(opts.bindings) !== bindingFingerprint(current.bindings);
    console.log(`[DBG] applyWorkerConfigDiff name=${name} vars=${JSON.stringify((opts.vars || []).map((v) => `${v.name}:${v.secret ? 'S' : 'P'}${v.keep ? '(keep)' : ''}`))} plainChanged=${plainChanged} bindingsChanged=${bindingsChanged}`);
    // 删除：现有 secret 不在目标集合
    for (const s of currentSecretNames) {
        if (!targetSecretNames.has(s)) {
            try {
                await deleteSecret(account, name, s);
            }
            catch { /* 删除失败不阻塞 */ }
        }
    }
    if (plainChanged || bindingsChanged) {
        let content;
        if (opts.scriptContent !== undefined && opts.scriptContent !== null)
            content = opts.scriptContent;
        else if (opts.packageZip)
            content = '';
        else
            content = await getScriptContent(account, name); // 复用现有代码
        console.log(`[DBG] redeploy content type=${typeof content} length=${Buffer.isBuffer(content) ? content.length : content.length}`);
        await deployWorker(account, name, content, {
            bindings: opts.bindings,
            // 版本化 worker 下 PUT 只创建版本不部署，必须显式创建 deployment 才会上线（否则重部署的 vars/bindings 不生效）
            createDeployment: true,
            ...(opts.packageZip ? { packageZip: opts.packageZip, mainModule: opts.mainModule } : {}),
        });
        const after = await getWorkerConfig(account, name);
        console.log(`[DBG] redeploy after vars=${JSON.stringify(after.vars)} bindings=${JSON.stringify(after.bindings)}`);
    }
    // 新增/更新 secrets（keep=true 或值为空则跳过）
    for (const v of opts.vars || []) {
        if (!v.secret || !v.name || v.keep)
            continue;
        if (v.value)
            await updateSecret(account, name, v.name, 'secret_text', v.value);
    }
}
//# sourceMappingURL=workerService.js.map