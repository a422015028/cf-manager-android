"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deployPages = deployPages;
const headers_1 = require("./headers");
const staticAssets_1 = require("../staticAssets");
const logger_1 = require("../logger");
const proxyService_1 = require("../proxyService");
const CF_BASE = 'https://api.cloudflare.com/client/v4';
const MAX_RETRIES = 3;
const MAX_JWT_RETRIES = 2;
// ---- JWT 工具 ----
function decodeJwtPayload(jwt) {
    try {
        const parts = jwt.split('.');
        if (parts.length !== 3)
            return null;
        const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
        return payload;
    }
    catch {
        return null;
    }
}
function isJwtExpired(jwt) {
    const payload = decodeJwtPayload(jwt);
    if (!payload?.exp)
        return false; // 无 exp 字段时不判定过期
    // 提前 30 秒判定过期，避免边界竞态
    return Date.now() / 1000 > payload.exp - 30;
}
// ---- 重试工具 ----
async function withRetry(fn, maxAttempts = MAX_RETRIES) {
    let lastErr;
    for (let i = 0; i < maxAttempts; i++) {
        try {
            return await fn();
        }
        catch (e) {
            lastErr = e;
            if (i < maxAttempts - 1)
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        }
    }
    throw lastErr;
}
// ---- 特殊文件 ----
const SPECIAL_FILES = new Set([
    '_worker.js', '_worker.bundle', '_headers', '_redirects',
    '_routes.json', 'functions-filepath-routing-config.json',
]);
// wrangler 对这些文本配置文件：读为 UTF-8 字符串 → new File([string])
// _worker.bundle / _worker.js 走 FormData 包装（二进制）
const TEXT_SPECIAL_FILES = new Set([
    '_routes.json', '_headers', '_redirects', 'functions-filepath-routing-config.json',
]);
// ---- 部署状态轮询 ----
async function pollDeploymentStatus(account, projectName, deploymentId) {
    const deployHeaders = (0, headers_1.getDeployHeaders)(account);
    let delay = 2000;
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, delay));
        const resp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${account.account_id}/pages/projects/${projectName}/deployments/${deploymentId}`, {
            headers: { ...deployHeaders },
        }, 300000, undefined, account);
        if (resp.ok) {
            const json = await resp.json();
            const stage = json?.result?.latest_stage;
            if (stage?.status === 'success')
                return { status: 'success' };
            if (stage?.status === 'failure') {
                const stages = json?.result?.stages || [];
                const failed = stages.filter((s) => s.status === 'failure');
                const info = failed.map((s) => `${s.name}: ${s.error || s.message || 'unknown'}`).join(' | ')
                    || `${stage.name || 'deploy'} (no error message)`;
                return { status: 'failure', logs: info };
            }
        }
        delay = Math.min(delay * 1.5, 10000);
    }
    return { status: 'failure', logs: 'Polling timeout' };
}
// ---- 确保项目存在 ----
async function ensurePagesProject(account, name) {
    const deployHeaders = (0, headers_1.getDeployHeaders)(account);
    try {
        await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${account.account_id}/pages/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...deployHeaders },
            body: JSON.stringify({ name, production_branch: 'main' }),
        }, 30000, undefined, account);
    }
    catch (e) {
        if (!e.body?.includes('already exists') && e.status !== 409)
            throw e;
    }
}
// ---- 主部署函数 ----
async function deployPages(account, name, files, opts = {}) {
    const accountId = account.account_id;
    if (!accountId)
        throw new Error('Account ID is required');
    const deployHeaders = (0, headers_1.getDeployHeaders)(account);
    // Step 0: 确保项目存在
    if (!opts.skipCreateProject) {
        await ensurePagesProject(account, name);
    }
    // 如果包含 Functions bundle（_worker.bundle / _worker.js）且调用方没传 deploymentConfigs，
    // 自动补上 compatibility_date，否则 CF build 阶段直接 failure 且无具体错误信息
    if (!opts.deploymentConfigs && files && files.some(f => {
        const p = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
        return p === '_worker.bundle' || p === '_worker.js';
    })) {
        logger_1.appLogger.info(`[Pages Deploy] Auto-detected Functions bundle, setting compatibility_date`);
        opts.deploymentConfigs = {
            production: { compatibility_date: '2024-11-01' },
            preview: { compatibility_date: '2024-11-01' },
        };
    }
    // Step 0.5: 设置 deployment_configs（bindings + env）— 修复双端不对称
    if (opts.deploymentConfigs) {
        logger_1.appLogger.info(`[Pages Deploy] PATCH deployment_configs: ${JSON.stringify(opts.deploymentConfigs).slice(0, 500)}`);
        try {
            const patchResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/pages/projects/${name}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...deployHeaders },
                body: JSON.stringify({ deployment_configs: opts.deploymentConfigs }),
            }, 30000, undefined, account);
            if (!patchResp.ok) {
                const errText = await patchResp.text().catch(() => '');
                logger_1.appLogger.error(`[Pages Deploy] PATCH deployment_configs FAILED: ${patchResp.status} ${errText.slice(0, 1000)}`);
            }
            else {
                logger_1.appLogger.info(`[Pages Deploy] PATCH deployment_configs OK`);
            }
        }
        catch (e) {
            logger_1.appLogger.warn(`[Pages Deploy] Failed to set deployment_configs: ${e.message}`);
        }
    }
    // 空文件时返回 project 对象
    if (!files || files.length === 0) {
        const resp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/pages/projects/${name}`, {
            headers: { ...deployHeaders },
        }, 30000, undefined, account);
        const json = await resp.json();
        return json.result || json;
    }
    // 分类文件
    const specialFiles = [];
    const assetFiles = [];
    for (const f of files) {
        const cleanPath = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
        const basename = cleanPath.split('/').pop() || cleanPath;
        if (!cleanPath.includes('/') && SPECIAL_FILES.has(basename)) {
            specialFiles.push({ name: basename, buffer: f.buffer, contentType: (0, staticAssets_1.getContentType)(basename) });
        }
        else {
            assetFiles.push({ path: cleanPath, buffer: f.buffer, contentType: (0, staticAssets_1.getContentType)(cleanPath) });
        }
    }
    // Step 1: 获取 upload JWT
    const fetchJwt = async () => {
        const resp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/pages/projects/${name}/upload-token`, {
            headers: { ...deployHeaders },
        }, 30000, undefined, account);
        if (!resp.ok)
            throw new Error(`Failed to get upload token: ${resp.status}`);
        const json = await resp.json();
        if (!json?.result?.jwt)
            throw new Error(`Upload token response missing jwt: ${JSON.stringify(json)}`);
        return json.result.jwt;
    };
    const jwt = await fetchJwt();
    // Step 2: 计算 hash + check-missing
    const manifest = {};
    const hashToFile = new Map();
    for (const f of assetFiles) {
        const manifestKey = '/' + f.path;
        const hash = await (0, staticAssets_1.computeStaticAssetHash)(f.buffer, f.path);
        manifest[manifestKey] = hash;
        if (!hashToFile.has(hash)) {
            hashToFile.set(hash, { buffer: f.buffer, contentType: f.contentType });
        }
    }
    const allHashes = [...hashToFile.keys()];
    // check-missing with JWT refresh
    const checkMissing = async (currentJwt) => {
        const resp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/pages/assets/check-missing`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentJwt}`,
                'User-Agent': 'wrangler/4.112.0',
            },
            body: JSON.stringify({ hashes: allHashes }),
        }, 30000, undefined, account);
        if (!resp.ok)
            throw new Error(`check-missing failed: ${resp.status}`);
        const json = await resp.json();
        return json.result || [];
    };
    let missingHashes = [];
    let currentJwt = jwt;
    for (let attempt = 0; attempt <= MAX_JWT_RETRIES; attempt++) {
        try {
            missingHashes = await withRetry(() => checkMissing(currentJwt));
            break;
        }
        catch (e) {
            if (attempt < MAX_JWT_RETRIES && isJwtExpired(currentJwt)) {
                logger_1.appLogger.info(`[Pages Deploy] JWT expired during check-missing, refreshing...`);
                currentJwt = await fetchJwt();
            }
            else {
                throw e;
            }
        }
    }
    logger_1.appLogger.info(`[Pages Deploy] Missing assets: ${missingHashes.length}/${allHashes.length}`);
    // Step 3: 上传缺失的资源
    if (missingHashes.length > 0) {
        const BATCH_SIZE = 50;
        for (let i = 0; i < missingHashes.length; i += BATCH_SIZE) {
            const batch = missingHashes.slice(i, i + BATCH_SIZE);
            const payload = [];
            for (const hash of batch) {
                const fileInfo = hashToFile.get(hash);
                if (!fileInfo)
                    continue;
                payload.push({
                    key: hash,
                    value: fileInfo.buffer.toString('base64'),
                    metadata: { contentType: fileInfo.contentType },
                    base64: true,
                });
            }
            // Upload with retry + JWT refresh
            const uploadBatch = async (jwtToUse) => {
                const resp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/pages/assets/upload`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${jwtToUse}`,
                        'User-Agent': 'wrangler/4.112.0',
                    },
                    body: JSON.stringify(payload),
                }, 300000, undefined, account);
                if (!resp.ok) {
                    const text = await resp.text();
                    throw new Error(`Asset upload failed (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${resp.status} ${text}`);
                }
            };
            for (let attempt = 0; attempt <= MAX_JWT_RETRIES; attempt++) {
                try {
                    await withRetry(() => uploadBatch(currentJwt));
                    break;
                }
                catch (e) {
                    if (attempt < MAX_JWT_RETRIES && isJwtExpired(currentJwt)) {
                        logger_1.appLogger.info(`[Pages Deploy] JWT expired during upload, refreshing...`);
                        currentJwt = await fetchJwt();
                    }
                    else {
                        throw e;
                    }
                }
            }
        }
        // upsert-hashes (non-fatal)
        try {
            await (0, proxyService_1.proxyFetch)(`${CF_BASE}/pages/assets/upsert-hashes`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${currentJwt}`,
                    'User-Agent': 'wrangler/4.112.0',
                },
                body: JSON.stringify({ hashes: allHashes }),
            }, 30000, undefined, account);
        }
        catch (e) {
            logger_1.appLogger.warn(`[Pages Deploy] upsert-hashes failed (non-fatal): ${e.message}`);
        }
    }
    // Step 4: 创建 deployment（与 wrangler 保持一致：可选字段仅在存在时添加）
    const formData = new FormData();
    formData.append('manifest', JSON.stringify(manifest));
    if (opts.branch) {
        formData.append('branch', opts.branch);
    }
    if (opts.commitMessage) {
        formData.append('commit_message', opts.commitMessage.length > 384
            ? opts.commitMessage.slice(0, 384)
            : opts.commitMessage);
    }
    if (opts.commitHash) {
        formData.append('commit_hash', opts.commitHash);
    }
    if (opts.commitDirty !== undefined) {
        formData.append('commit_dirty', String(opts.commitDirty));
    }
    for (const sf of specialFiles) {
        if (sf.name === '_worker.bundle') {
            // _worker.bundle 文件本身就是 wrangler 预先序列化好的 multipart/form-data 二进制
            // 直接作为 Blob 原样上传，不要重新包装！
            const view = new Uint8Array(sf.buffer.byteLength);
            view.set(sf.buffer);
            formData.append(sf.name, new Blob([view], { type: 'application/octet-stream' }), sf.name);
        }
        else if (sf.name === '_worker.js') {
            // _worker.js 是单文件 JS 入口，需要包装为 FormData(metadata + module)
            const innerForm = new FormData();
            innerForm.set('metadata', JSON.stringify({ main_module: '_worker.js' }));
            innerForm.set('_worker.js', new File([sf.buffer.toString('utf-8')], '_worker.js'));
            const wrappedBlob = await new Response(innerForm).blob();
            formData.append(sf.name, wrappedBlob, sf.name);
        }
        else if (TEXT_SPECIAL_FILES.has(sf.name)) {
            // _routes.json / _headers / _redirects / functions-filepath-routing-config.json
            // 全部 UTF-8 字符串 → new File([string])
            const text = sf.buffer.toString('utf-8');
            formData.append(sf.name, new File([text], sf.name));
        }
        else {
            const view = new Uint8Array(sf.buffer.byteLength);
            view.set(sf.buffer);
            formData.append(sf.name, new Blob([view], { type: sf.contentType }), sf.name);
        }
    }
    const deployResp = await withRetry(() => (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/pages/projects/${name}/deployments`, {
        method: 'POST',
        headers: { ...deployHeaders },
        body: formData,
    }, 300000, undefined, account));
    const deployJson = await deployResp.json();
    if (!deployResp.ok || !deployJson.success) {
        throw new Error(`Pages deploy failed: ${deployResp.status} ${JSON.stringify(deployJson)}`);
    }
    // Step 5: 轮询部署状态
    const deploymentId = deployJson?.result?.id;
    if (deploymentId) {
        const pollResult = await pollDeploymentStatus(account, name, deploymentId);
        if (pollResult.status === 'failure') {
            logger_1.appLogger.warn(`[Pages Deploy] Deployment build stage failed: ${pollResult.logs || 'unknown error'}`);
        }
        else {
            logger_1.appLogger.info(`[Pages Deploy] Deployment status: ${pollResult.status}`);
        }
    }
    return deployJson.result;
}
//# sourceMappingURL=pagesDeploy.js.map