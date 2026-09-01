"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deployWorker = deployWorker;
const headers_1 = require("./headers");
const uploadForm_1 = require("./uploadForm");
const assetsUpload_1 = require("./assetsUpload");
const logger_1 = require("../logger");
const proxyService_1 = require("../proxyService");
const CF_BASE = 'https://api.cloudflare.com/client/v4';
const MAX_RETRIES = 3;
// 上传重试：网络抖动 / undici 响应截断时可自动重试
async function withRetry(fn, maxAttempts = MAX_RETRIES) {
    let lastErr;
    for (let i = 0; i < maxAttempts; i++) {
        try {
            return await fn();
        }
        catch (e) {
            lastErr = e;
            const isRetryable = e.code === 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH'
                || e.code === 'UND_ERR_SOCKET'
                || e.code === 'ECONNRESET'
                || e.code === 'EPIPE';
            if (!isRetryable || i >= maxAttempts - 1)
                throw e;
            logger_1.appLogger.warn(`[Worker Deploy] Retry ${i + 1}/${maxAttempts} after: ${e.code || e.message}`);
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        }
    }
    throw lastErr;
}
/**
 * Worker 部署 — 对齐 wrangler 部署流程。
 *
 * 路径 A (Versions API): POST versions → POST deployments → PATCH settings
 * 路径 B (传统 PUT): PUT /scripts/{name}
 *
 * 两条路径的选择由调用方（preflight）决定，此处通过 useVersionsApi 参数传入。
 */
async function deployWorker(account, name, scriptContent, workerInit, options) {
    const accountId = account.account_id;
    if (!accountId)
        throw new Error('Account ID is required');
    const deployHeaders = (0, headers_1.getDeployHeaders)(account);
    // 1. 上传静态资源（如果有）
    let assetsJwt;
    if (options?.assets?.files?.length) {
        const result = await (0, assetsUpload_1.deployWorkerAssets)(account, name, options.assets.files);
        assetsJwt = result.jwt;
    }
    // 2. 构建 bindings 数组
    const metadataBindings = [...(options?.bindings || [])];
    if (options?.assets && assetsJwt) {
        metadataBindings.push({
            name: options.assets.binding || 'ASSETS',
            type: 'assets',
        });
    }
    // 3. 组装 CfWorkerInit
    // 若 workerInit.main 已由上层设置（zip 多模块场景），直接使用；否则用 scriptContent
    if (!workerInit.main?.content && scriptContent === null) {
        throw new Error('Either workerInit.main.content or scriptContent must be provided');
    }
    const fallbackContent = typeof scriptContent === 'string'
        ? new TextEncoder().encode(scriptContent)
        : scriptContent ? new Uint8Array(scriptContent) : new Uint8Array(0);
    const worker = {
        name,
        main: {
            name: workerInit.main?.name || 'worker.js',
            content: workerInit.main?.content ?? fallbackContent,
            type: workerInit.main?.type || 'esm',
        },
        modules: workerInit.modules || [],
        sourceMaps: workerInit.sourceMaps || [],
        compatibility_date: workerInit.compatibility_date || '2024-11-01',
        compatibility_flags: workerInit.compatibility_flags || [],
        migrations: workerInit.migrations,
        keepVars: workerInit.keepVars ?? true,
        keepSecrets: workerInit.keepSecrets ?? true,
        keepBindings: workerInit.keepBindings ?? true,
        placement: workerInit.placement,
        tail_consumers: workerInit.tail_consumers || [],
        limits: workerInit.limits,
        logpush: workerInit.logpush,
        assets: assetsJwt ? {
            jwt: assetsJwt,
            config: options?.assets?.config,
        } : undefined,
        // 对标 wrangler：observability 在上传 metadata 中一并设置，不依赖后续 PATCH
        observability: { enabled: true },
    };
    // 4. 构建上传表单（手动 multipart，避免 undici FormData Content-Length 计算不准）
    const { body: formBody, contentType: formContentType } = (0, uploadForm_1.createWorkerUploadForm)(worker, metadataBindings);
    const mainSize = typeof worker.main.content === 'string' ? worker.main.content.length : worker.main.content.byteLength;
    logger_1.appLogger.info(`[Worker Deploy] Upload form: ${formBody.length} bytes, main=${worker.main.name} (${mainSize} bytes), modules=${worker.modules.length}`);
    // 5. 上传到 Cloudflare
    const useVersionsApi = options?.useVersionsApi ?? false;
    let respJson;
    let versionId;
    if (useVersionsApi) {
        // Path A: Versions API（对标 wrangler：先检查 script 是否存在）
        // Versions API 只能对已存在的 script 创建版本，首次部署必须先 PUT 创建
        const checkResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}`, {
            method: 'GET',
            headers: { ...deployHeaders },
        }, 30000, undefined, account);
        if (checkResp.status === 404) {
            // Script 不存在，首次 PUT 创建（对标 wrangler 首次部署）
            logger_1.appLogger.info(`[Worker Deploy] Script ${name} does not exist, creating via PUT`);
            const createResp = await withRetry(() => (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}`, {
                method: 'PUT',
                headers: { ...deployHeaders, 'Content-Type': formContentType },
                body: formBody,
            }, 300000, undefined, account));
            respJson = await createResp.json();
            if (!createResp.ok || !respJson.success) {
                throw new Error(`Script creation failed: ${createResp.status} ${JSON.stringify(respJson)}`);
            }
            versionId = respJson?.result?.version_id;
            // 首次创建后也尝试创建 deployment（如果有 version_id）
            if (versionId && options?.createDeployment) {
                try {
                    const depResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}/deployments`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...deployHeaders },
                        body: JSON.stringify({
                            strategy: 'percentage',
                            versions: [{ percentage: 100, version_id: versionId }],
                        }),
                    }, 30000, undefined, account);
                    if (!depResp.ok) {
                        const depTxt = await depResp.text();
                        logger_1.appLogger.warn(`[Worker Deploy] Deployment creation failed for ${name}: ${depResp.status} ${depTxt.slice(0, 300)}`);
                    }
                }
                catch (e) {
                    logger_1.appLogger.warn(`[Worker Deploy] Deployment creation warning for ${name}: ${e.message}`);
                }
            }
        }
        else if (!checkResp.ok) {
            // 非 404 的错误状态（401/403/500 等），不应继续部署
            const errBody = await checkResp.text();
            throw new Error(`Script existence check failed: ${checkResp.status} ${errBody.slice(0, 300)}`);
        }
        else {
            // Script 已存在，用 Versions API 创建新版本
            const versionResp = await withRetry(() => (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}/versions?bindings_inherit=strict`, {
                method: 'POST',
                headers: { ...deployHeaders, 'Content-Type': formContentType },
                body: formBody,
            }, 300000, undefined, account));
            const versionJson = await versionResp.json();
            if (!versionResp.ok || !versionJson.success) {
                throw new Error(`Version upload failed: ${versionResp.status} ${JSON.stringify(versionJson)}`);
            }
            versionId = versionJson?.result?.id;
            // Create deployment with 100% traffic
            if (versionId && options?.createDeployment !== false) {
                const depResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}/deployments`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...deployHeaders },
                    body: JSON.stringify({
                        strategy: 'percentage',
                        versions: [{ percentage: 100, version_id: versionId }],
                    }),
                }, 30000, undefined, account);
                if (!depResp.ok) {
                    const depTxt = await depResp.text();
                    logger_1.appLogger.warn(`[Worker Deploy] Deployment creation failed for ${name}: ${depResp.status} ${depTxt.slice(0, 300)}`);
                }
            }
            respJson = versionJson;
        }
    }
    else {
        // Path B: Legacy PUT（PUT 已自动部署脚本，无需再创建 deployment）
        const resp = await withRetry(() => (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}`, {
            method: 'PUT',
            headers: { ...deployHeaders, 'Content-Type': formContentType },
            body: formBody,
        }, 300000, undefined, account));
        respJson = await resp.json();
        if (!resp.ok || !respJson.success) {
            throw new Error(`${resp.status} ${JSON.stringify(respJson)}`);
        }
        versionId = respJson?.result?.version_id || respJson?.result?.version?.id;
    }
    // 6. 设置可观测性
    const tracesEnabled = options?.traces !== false;
    const logsEnabled = options?.logs !== false;
    if (tracesEnabled || logsEnabled) {
        const obsBody = { enabled: true, head_sampling_rate: 1 };
        if (tracesEnabled)
            obsBody.traces = { enabled: true, persist: true, head_sampling_rate: 1 };
        if (logsEnabled)
            obsBody.logs = { enabled: true, persist: true, invocation_logs: true, head_sampling_rate: 1 };
        try {
            const obsResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}/script-settings`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...deployHeaders },
                body: JSON.stringify({ observability: obsBody }),
            }, 30000, undefined, account);
            if (!obsResp.ok) {
                const obsErr = await obsResp.text();
                logger_1.appLogger.warn(`[Worker Deploy] Observability setup failed (${obsResp.status}): ${obsErr}`);
            }
        }
        catch (e) {
            logger_1.appLogger.warn(`[Worker Deploy] Observability setup warning: ${e.message}`);
        }
    }
    // 7. 启用 workers.dev 子域
    let subdomain;
    if (options?.enableSubdomain !== false) {
        try {
            await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/scripts/${name}/subdomain`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...deployHeaders },
                body: JSON.stringify({ enabled: true }),
            }, 30000, undefined, account);
        }
        catch {
            // Soft fail
        }
        // Get account-level subdomain
        try {
            const subResp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${accountId}/workers/subdomain`, {
                headers: { 'Content-Type': 'application/json', ...deployHeaders },
            }, 30000, undefined, account);
            if (subResp.ok) {
                const subJson = await subResp.json();
                subdomain = subJson?.result?.subdomain;
            }
        }
        catch {
            // Soft fail
        }
    }
    return { script: respJson.result, subdomain, versionId };
}
//# sourceMappingURL=workerDeploy.js.map