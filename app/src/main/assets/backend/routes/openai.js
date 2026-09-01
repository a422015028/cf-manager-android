"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const accountRouter_1 = require("../services/accountRouter");
const account_1 = require("../models/account");
const aiService_1 = require("../services/aiService");
const cfFactory_1 = require("../services/cfFactory");
const auditLog_1 = require("../models/auditLog");
const proxyService_1 = require("../services/proxyService");
const logger_1 = require("../services/logger");
const quotaUsage_1 = require("../models/quotaUsage");
const utils_1 = require("../utils");
const accountRouter_2 = require("../services/accountRouter");
const pricing_1 = require("../services/pricing");
const router = (0, express_1.Router)();
/** Maximum retries per account before skipping it permanently in this request. */
const MAX_RETRY_PER_ACCOUNT = 1; // 每个账户最多重试 1 次，失败立即换账户
/** Upstream status codes that should trigger account rotation instead of immediate error. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
/** Map upstream HTTP status to an OpenAI-style semantic error code string. */
function upstreamStatusToCode(status) {
    const map = {
        400: 'bad_request',
        401: 'authentication_error',
        403: 'permission_denied',
        404: 'not_found',
        413: 'request_too_large',
        429: 'rate_limit_exceeded',
    };
    return map[status] || 'upstream_error';
}
function isNeuronLimitError(text) {
    // 优先解析 JSON 精确匹配 CF 错误码 4006，避免字符串 "4006" 误匹配时间戳/请求ID等
    try {
        const json = JSON.parse(text);
        const errors = json?.errors || json?.result?.errors || (Array.isArray(json) ? json : []);
        if (Array.isArray(errors) && errors.some((e) => e?.code === 4006)) {
            return true;
        }
    }
    catch { /* 非 JSON，回退到关键词匹配 */ }
    // 兜底：CF 错误格式变化时通过特异关键词识别
    return text.includes('daily free allocation') || text.includes('neuron limit');
}
function writeSseDone(res) {
    if (res.writableEnded)
        return;
    if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
    }
    res.write('data: [DONE]\n\n');
}
/** Delay before first heartbeat (ms) — only send heartbeat if upstream TTFB exceeds this. */
const HEARTBEAT_DELAY_MS = 15_000;
/** SSE heartbeat interval (ms) — repeat interval after first heartbeat. */
const HEARTBEAT_INTERVAL_MS = 10_000;
/**
 * Start DELAYED SSE heartbeat to prevent client TTFB timeout.
 *
 * Does NOT send anything immediately. Only starts sending `: heartbeat\n\n`
 * comments after HEARTBEAT_DELAY_MS (15s) of silence, then every 10s.
 *
 * This avoids interfering with fast responses — most requests get a response
 * from CF within a few seconds and never need a heartbeat. Only genuinely
 * slow responses (30s+ TTFB) trigger the heartbeat.
 *
 * ONLY sends SSE comment (`: heartbeat\n\n`) — spec-compliant, all SSE
 * parsers ignore comments, zero risk of corrupting the stream.
 *
 * Returns a stop function.
 */
function startSseHeartbeat(res) {
    if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
    }
    let intervalId = null;
    // Delay first heartbeat — most responses arrive before this.
    const delayId = setTimeout(() => {
        if (!res.writableEnded) {
            res.write(': heartbeat\n\n');
        }
        intervalId = setInterval(() => {
            if (!res.writableEnded) {
                res.write(': heartbeat\n\n');
            }
        }, HEARTBEAT_INTERVAL_MS);
    }, HEARTBEAT_DELAY_MS);
    return () => {
        clearTimeout(delayId);
        if (intervalId)
            clearInterval(intervalId);
    };
}
/** Send an error as an SSE event (for stream mode when headers already sent). */
function sendSseError(res, errorObj) {
    if (res.writableEnded)
        return;
    res.write(`data: ${JSON.stringify({ error: errorObj })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
}
router.get('/models', async (req, res, next) => {
    try {
        const account = await (0, accountRouter_1.selectBestAccount)('ai_neurons');
        if (!account) {
            res.status(503).json({
                error: { message: 'No active AI accounts available', type: 'service_error', code: 'NO_ACCOUNTS' },
            });
            return;
        }
        const taskFilter = req.query.task;
        const models = await (0, aiService_1.getAvailableModels)(account, taskFilter);
        // TTS 模型：一次性获取模型 schema，下发 speaker 枚举与高级可选参数
        let ttsModelMeta = {};
        if (taskFilter && taskFilter.toLowerCase().replace(/-/g, ' ').includes('text to speech')) {
            await Promise.all(models.map(async (m) => {
                const modelId = m.name || m.id;
                if (!modelId)
                    return;
                const schema = await (0, aiService_1.getModelInputSchema)(account, modelId);
                if (!schema)
                    return;
                const speakerProp = schema.properties?.speaker;
                ttsModelMeta[modelId] = {
                    speakers: Array.isArray(speakerProp?.enum) ? speakerProp.enum : [],
                    default_speaker: speakerProp?.default,
                    advanced_params: (0, aiService_1.extractTtsAdvancedParams)(schema),
                };
            }));
        }
        const data = models.map((m) => {
            const modelId = m.name || m.id;
            const meta = ttsModelMeta[modelId] || {};
            return {
                id: modelId,
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: 'cloudflare',
                task: m.task?.name || m.task || undefined,
                speakers: meta.speakers || undefined,
                default_speaker: meta.default_speaker || undefined,
                advanced_params: meta.advanced_params || undefined,
            };
        });
        res.json({ object: 'list', data });
    }
    catch (err) {
        next(err);
    }
});
router.post('/chat/completions', async (req, res, next) => {
    // Declare before try so catch block can access it for cleanup.
    let stopHeartbeat = null;
    try {
        const specifiedAccountId = req.headers['x-account-id'];
        const isStream = req.body.stream === true;
        // 流式请求强制要求 CF 返回 usage，否则无法记账
        if (isStream && !req.body.stream_options?.include_usage) {
            req.body.stream_options = { ...(req.body.stream_options || {}), include_usage: true };
        }
        const rid = req.requestId || '-';
        // For streaming: send SSE headers + heartbeat IMMEDIATELY to prevent
        // client TTFB timeout. CF AI can take 30+ seconds before first byte;
        // without this, clients like Cursor disconnect after ~30s of silence.
        stopHeartbeat = isStream ? startSseHeartbeat(res) : null;
        // --- X-Account-ID specified: use that account directly, no rotation ---
        if (specifiedAccountId && specifiedAccountId !== 'auto') {
            const allAccounts = (0, account_1.getActiveAccountsByFeature)('ai');
            const account = allAccounts.find((a) => a.account_id === specifiedAccountId);
            if (!account) {
                if (stopHeartbeat) {
                    stopHeartbeat();
                    stopHeartbeat = null;
                }
                if (isStream) {
                    sendSseError(res, { message: `Account ${specifiedAccountId} not found or inactive`, type: 'invalid_request_error', code: 'ACCOUNT_NOT_FOUND' });
                }
                else {
                    res.status(404).json({
                        error: { message: `Account ${specifiedAccountId} not found or inactive`, type: 'invalid_request_error', code: 'ACCOUNT_NOT_FOUND' },
                    });
                }
                return;
            }
            // Make the CF request directly (no retry for specified account)
            const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/v1/chat/completions`;
            const headers = { 'Content-Type': 'application/json', ...(0, cfFactory_1.getAuthHeaders)(account) };
            try {
                const timeoutMs = isStream ? 600000 : 300000;
                const cfResp = await (0, proxyService_1.proxyFetch)(cfUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(req.body),
                }, timeoutMs, undefined, account);
                if (!cfResp.ok) {
                    const errorText = await cfResp.text();
                    if (isNeuronLimitError(errorText)) {
                        (0, quotaUsage_1.setExhausted)(account.id, 'ai_neurons');
                        (0, accountRouter_2.removeAccountFromAiCache)(account.id);
                    }
                    if (stopHeartbeat) {
                        stopHeartbeat();
                        stopHeartbeat = null;
                    }
                    if (isStream) {
                        sendSseError(res, { message: errorText, type: 'upstream_error', code: upstreamStatusToCode(cfResp.status) });
                    }
                    else {
                        res.status(cfResp.status).json({
                            error: { message: errorText, type: 'upstream_error', code: upstreamStatusToCode(cfResp.status) },
                        });
                    }
                    return;
                }
                await processAccount(account, req, res, rid, isStream, cfResp, stopHeartbeat);
                stopHeartbeat = null;
            }
            catch (netErr) {
                const errMsg = `Network error: ${netErr.message || netErr}`;
                logger_1.appLogger.error(`[AI][${rid}] Specified account ${account.name} ${errMsg}`);
                (0, auditLog_1.createAuditLog)(account.id, 'ai_chat_completion', req.body.model, `[${rid}] ${errMsg}`, 'error');
                if (stopHeartbeat) {
                    stopHeartbeat();
                    stopHeartbeat = null;
                }
                if (isStream) {
                    sendSseError(res, { message: errMsg, type: 'upstream_error', code: 'NETWORK_ERROR' });
                }
                else {
                    res.status(502).json({
                        error: { message: errMsg, type: 'upstream_error', code: 'NETWORK_ERROR' },
                    });
                }
            }
            return;
        }
        // --- while + selectBestAccount rotation loop ---
        const skipped = new Set();
        const retryCount = new Map();
        let lastError = '';
        while (true) {
            const account = await (0, accountRouter_1.selectBestAccount)('ai_neurons', skipped, req.body.model);
            if (!account)
                break; // no available account
            const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/v1/chat/completions`;
            const headers = { 'Content-Type': 'application/json', ...(0, cfFactory_1.getAuthHeaders)(account) };
            let cfResp;
            try {
                const timeoutMs = isStream ? 600000 : 300000;
                cfResp = await (0, proxyService_1.proxyFetch)(cfUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(req.body),
                }, timeoutMs, undefined, account);
            }
            catch (netErr) {
                // Network error — retryable, increment retry count
                const errMsg = `Network error: ${netErr.message || netErr}`;
                logger_1.appLogger.warn(`[AI][${rid}] Account ${account.name} ${errMsg}`);
                lastError = errMsg;
                (0, auditLog_1.createAuditLog)(account.id, 'ai_chat_completion', req.body.model, `[${rid}] ${errMsg}`, 'error');
                const retries = (retryCount.get(account.id) || 0) + 1;
                retryCount.set(account.id, retries);
                if (retries >= MAX_RETRY_PER_ACCOUNT) {
                    skipped.add(account.id);
                    logger_1.appLogger.warn(`[AI][${rid}] Account ${account.name} exceeded max retries, skipping`);
                }
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }
            if (!cfResp.ok) {
                const errorText = await cfResp.text();
                lastError = errorText;
                if (isRetryableError(cfResp.status, errorText)) {
                    if (isNeuronLimitError(errorText)) {
                        // 4006 — mark exhausted, remove from cache, skip in this request loop, rotate
                        logger_1.appLogger.warn(`[AI][${rid}] Account ${account.name} neuron limit hit (4006), rotating`);
                        (0, quotaUsage_1.setExhausted)(account.id, 'ai_neurons');
                        (0, accountRouter_2.removeAccountFromAiCache)(account.id);
                        skipped.add(account.id);
                        (0, auditLog_1.createAuditLog)(account.id, 'ai_chat_completion', req.body.model, `[${rid}] 4006 neuron limit, switching`, 'error');
                    }
                    else {
                        // Other retryable error — increment retry count
                        const retries = (retryCount.get(account.id) || 0) + 1;
                        retryCount.set(account.id, retries);
                        if (retries >= MAX_RETRY_PER_ACCOUNT) {
                            skipped.add(account.id);
                            logger_1.appLogger.warn(`[AI][${rid}] Account ${account.name} upstream ${cfResp.status} exceeded max retries, skipping`);
                        }
                        else {
                            logger_1.appLogger.warn(`[AI][${rid}] Account ${account.name} upstream ${cfResp.status}, rotating`);
                        }
                        (0, auditLog_1.createAuditLog)(account.id, 'ai_chat_completion', req.body.model, `[${rid}] upstream ${cfResp.status}, switching`, 'error');
                    }
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }
                // Non-retryable (400, 401, 403, 404, etc.) — return immediately
                if (stopHeartbeat) {
                    stopHeartbeat();
                    stopHeartbeat = null;
                }
                if (isStream) {
                    sendSseError(res, { message: errorText, type: 'upstream_error', code: upstreamStatusToCode(cfResp.status) });
                }
                else {
                    res.status(cfResp.status).json({
                        error: { message: errorText, type: 'upstream_error', code: upstreamStatusToCode(cfResp.status) },
                    });
                }
                return;
            }
            // Success — process response (handles both stream and non-stream)
            await processAccount(account, req, res, rid, isStream, cfResp, stopHeartbeat);
            stopHeartbeat = null;
            return;
        }
        // All accounts exhausted
        logger_1.appLogger.error(`[AI][${rid}] All accounts exhausted. Last error: ${lastError}`);
        if (stopHeartbeat) {
            stopHeartbeat();
            stopHeartbeat = null;
        }
        if (isStream) {
            sendSseError(res, {
                message: 'All accounts have reached daily neuron limit',
                type: 'quota_exceeded',
                code: 'ALL_ACCOUNTS_EXHAUSTED',
                last_error: lastError || 'Unknown error',
            });
        }
        else {
            res.status(429).json({
                error: {
                    message: 'All accounts have reached daily neuron limit',
                    type: 'quota_exceeded',
                    code: 'ALL_ACCOUNTS_EXHAUSTED',
                    last_error: lastError || 'Unknown error',
                },
            });
        }
    }
    catch (err) {
        if (stopHeartbeat)
            stopHeartbeat();
        next(err);
    }
});
/**
 * Process a successful CF response: handle streaming vs non-streaming,
 * extract usage, do local neuron estimation, update quota/cache, write audit log.
 */
async function processAccount(account, req, res, rid, isStream, cfResp, stopHeartbeat) {
    if (isStream) {
        // SSE headers (skip if already sent by heartbeat)
        if (!res.headersSent) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();
        }
        let seenDone = false;
        let streamStatus = 'success';
        let finalUsage = null;
        let chunkIndex = 0;
        const onClose = () => {
            streamStatus = 'client_disconnected';
        };
        req.on('close', onClose);
        try {
            if (cfResp.body) {
                const body = cfResp.body;
                // --- Web Streams API (getReader) ---
                if (typeof body.getReader === 'function') {
                    const reader = body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done)
                            break;
                        if (res.writableEnded) {
                            streamStatus = 'client_disconnected';
                            break;
                        }
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const payload = line.slice(6).trim();
                                if (payload === '[DONE]') {
                                    seenDone = true;
                                }
                                else {
                                    chunkIndex++;
                                    try {
                                        const json = JSON.parse(payload);
                                        if (json.usage) {
                                            finalUsage = json.usage;
                                            logger_1.appLogger.debug(`[AI][${rid}] stream chunk#${chunkIndex} usage: ${JSON.stringify(json.usage)}`);
                                        }
                                    }
                                    catch { /* not JSON, ignore */ }
                                }
                            }
                        }
                        if (!res.write(Buffer.from(value))) {
                            await new Promise(r => res.once('drain', r));
                        }
                    }
                    if (buffer) {
                        if (buffer.startsWith('data: ') && buffer.slice(6).trim() === '[DONE]')
                            seenDone = true;
                        if (!res.write(buffer)) {
                            await new Promise(r => res.once('drain', r));
                        }
                    }
                }
                // --- Node.js Readable stream ---
                else if (typeof body.pipe === 'function') {
                    await new Promise((resolve) => {
                        const nodeStream = body;
                        let lineBuffer = '';
                        nodeStream.on('data', (chunk) => {
                            if (res.writableEnded) {
                                streamStatus = 'client_disconnected';
                                nodeStream.destroy();
                                return;
                            }
                            lineBuffer += chunk.toString();
                            const lines = lineBuffer.split('\n');
                            lineBuffer = lines.pop() || '';
                            for (const line of lines) {
                                if (line.startsWith('data: ')) {
                                    const payload = line.slice(6).trim();
                                    if (payload === '[DONE]') {
                                        seenDone = true;
                                    }
                                    else if (payload) {
                                        chunkIndex++;
                                        try {
                                            const json = JSON.parse(payload);
                                            if (json.usage) {
                                                finalUsage = json.usage;
                                                logger_1.appLogger.debug(`[AI][${rid}] stream chunk#${chunkIndex} usage: ${JSON.stringify(json.usage)}`);
                                            }
                                        }
                                        catch { /* not JSON, ignore */ }
                                    }
                                }
                            }
                            if (!res.write(chunk)) {
                                nodeStream.pause();
                                res.once('drain', () => nodeStream.resume());
                            }
                        });
                        nodeStream.on('end', () => {
                            if (lineBuffer) {
                                if (lineBuffer.startsWith('data: ') && lineBuffer.slice(6).trim() === '[DONE]')
                                    seenDone = true;
                                if (!res.write(lineBuffer)) { /* flush remaining */ }
                            }
                            resolve();
                        });
                        nodeStream.on('error', (err) => {
                            streamStatus = 'upstream_error';
                            logger_1.appLogger.error(`[AI] Stream error (pipe): ${err.message}`);
                            resolve();
                        });
                    });
                }
            }
        }
        catch (err) {
            streamStatus = 'upstream_error';
            logger_1.appLogger.error(`[AI][${rid}] Stream exception: ${err.message}`);
        }
        finally {
            req.off('close', onClose);
            if (stopHeartbeat)
                stopHeartbeat();
            if (!seenDone && !res.writableEnded) {
                writeSseDone(res);
            }
            if (!res.writableEnded)
                res.end();
            // Local neuron estimation from finalUsage
            if (finalUsage) {
                const cachedTokens = finalUsage.prompt_tokens_details?.cached_tokens || 0;
                const neurons = (0, pricing_1.estimateNeurons)(req.body.model, finalUsage.prompt_tokens || 0, finalUsage.completion_tokens || 0, cachedTokens);
                (0, quotaUsage_1.incrementQuota)(account.id, 'ai_neurons', neurons);
                (0, accountRouter_2.updateAiCacheAfterUsage)(account.id, neurons);
                logger_1.appLogger.debug(`[AI][${rid}] estimated ${neurons} neurons for account ${account.name} (cached=${cachedTokens})`);
                (0, auditLog_1.createAuditLog)(account.id, 'ai_chat_completion', req.body.model, `[${rid}] stream tokens: in=${finalUsage.prompt_tokens || 0} out=${finalUsage.completion_tokens || 0} total=${finalUsage.total_tokens || 0} cached=${cachedTokens} neurons=${neurons}`, streamStatus === 'success' ? 'success' : 'error');
            }
            else {
                logger_1.appLogger.warn(`[AI][${rid}] stream ended without usage, skipping local estimate`);
                (0, auditLog_1.createAuditLog)(account.id, 'ai_chat_completion', req.body.model, `[${rid}] stream ${streamStatus} tokens: none (no usage in SSE)`, streamStatus === 'success' ? 'success' : 'error');
            }
        }
    }
    else {
        // Non-stream
        const data = await cfResp.json();
        // Normalize response to match OpenAI format
        if (!data.id)
            data.id = `chatcmpl-${(0, utils_1.safeRandomUUID)()}`;
        if (!data.object)
            data.object = 'chat.completion';
        if (!data.model && req.body.model)
            data.model = req.body.model;
        if (!data.usage)
            data.usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        // Local neuron estimation
        let neurons = 0;
        if (data.usage) {
            const cachedTokens = data.usage.prompt_tokens_details?.cached_tokens || 0;
            neurons = (0, pricing_1.estimateNeurons)(req.body.model, data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0, cachedTokens);
            (0, quotaUsage_1.incrementQuota)(account.id, 'ai_neurons', neurons);
            (0, accountRouter_2.updateAiCacheAfterUsage)(account.id, neurons);
            logger_1.appLogger.debug(`[AI][${rid}] estimated ${neurons} neurons for account ${account.name} (cached=${cachedTokens})`);
        }
        res.json(data);
        (0, auditLog_1.createAuditLog)(account.id, 'ai_chat_completion', req.body.model, `[${rid}] non-stream tokens: in=${data?.usage?.prompt_tokens || 0} out=${data?.usage?.completion_tokens || 0} total=${data?.usage?.total_tokens || 0} cached=${data?.usage?.prompt_tokens_details?.cached_tokens || 0} neurons=${neurons}`, 'success');
    }
}
function isRetryableError(status, errorText) {
    if (RETRYABLE_STATUS.has(status))
        return true;
    return isNeuronLimitError(errorText);
}
/** 64x64 全白遮罩 PNG（base64），用于 SDXL 图生图时 mask_image 参数（白色 = 允许变换整个图像） */
const WHITE_MASK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAAAAACPAi4CAAAAKUlEQVR4nO3MQREAAAwCIPuX1hD77SAA6VEEAoFAIBAIBAKBQCAQfA8Gpwvw4pr3blgAAAAASUVORK5CYII=';
// ================================================================
// POST /images/generations — 文生图 / 图生图（OpenAI-compatible）
// ================================================================
router.post('/images/generations', async (req, res, next) => {
    try {
        const specifiedAccountId = req.headers['x-account-id'];
        const { model, prompt, image } = req.body;
        const rid = req.requestId || '-';
        if (!model || !prompt) {
            res.status(400).json({
                error: { message: 'model and prompt are required', type: 'invalid_request_error', code: 'bad_request' },
            });
            return;
        }
        // 根据模型族构建 CF 请求体（不同模型参数名不同）
        // Flux 1: steps (非 num_steps)，不支持 width/height/guidance/negative_prompt
        // Flux 2: 需要 multipart 表单格式，参数同 Flux 1
        // SDXL: num_steps, image_b64 (非 image), 支持 width/height/guidance/negative_prompt/strength
        const isFlux = model.includes('flux');
        const isFlux2 = model.includes('flux-2');
        const isSD = model.includes('stable-diffusion');
        const cfBody = { prompt };
        if (isFlux) {
            // Flux 系列: 只支持 prompt + steps
            if (req.body.num_steps)
                cfBody.steps = req.body.num_steps;
        }
        else if (isSD) {
            // Stable Diffusion: 完整参数支持
            if (image) {
                cfBody.image_b64 = image; // SDXL 用 image_b64
                // SDXL img2img 要求 mask_image（全白遮罩 = 允许变换整个图像）
                cfBody.mask_image = WHITE_MASK_PNG;
            }
            if (req.body.width)
                cfBody.width = req.body.width;
            if (req.body.height)
                cfBody.height = req.body.height;
            if (req.body.num_steps)
                cfBody.num_steps = req.body.num_steps;
            if (req.body.guidance)
                cfBody.guidance = req.body.guidance;
            if (req.body.negative_prompt)
                cfBody.negative_prompt = req.body.negative_prompt;
            if (req.body.strength)
                cfBody.strength = req.body.strength;
        }
        else {
            // 其他模型：透传所有参数
            if (image)
                cfBody.image = image;
            if (req.body.width)
                cfBody.width = req.body.width;
            if (req.body.height)
                cfBody.height = req.body.height;
            if (req.body.num_steps)
                cfBody.num_steps = req.body.num_steps;
            if (req.body.guidance)
                cfBody.guidance = req.body.guidance;
            if (req.body.negative_prompt)
                cfBody.negative_prompt = req.body.negative_prompt;
        }
        /**
         * 构建 CF 请求体和 Content-Type
         * Flux 2 模型需要 multipart 表单格式，其他模型用 JSON
         */
        const buildRequest = () => {
            if (isFlux2) {
                // Flux 2 模型需要 multipart/form-data
                const boundary = '----CFBoundary' + Math.random().toString(36).slice(2);
                const parts = [];
                const addField = (name, value) => {
                    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
                };
                addField('prompt', prompt);
                if (cfBody.steps)
                    addField('steps', String(cfBody.steps));
                parts.push(`--${boundary}--\r\n`);
                return { body: parts.join(''), contentType: `multipart/form-data; boundary=${boundary}` };
            }
            return { body: JSON.stringify(cfBody), contentType: 'application/json' };
        };
        /** 从 CF 错误响应中提取可读的错误消息 */
        const extractCfError = (raw) => {
            try {
                const json = JSON.parse(raw);
                if (json.errors?.[0]?.message)
                    return json.errors[0].message;
                if (json.error?.message)
                    return json.error.message;
                if (json.message)
                    return json.message;
            }
            catch { }
            return raw;
        };
        /** 处理 CF 图片生成响应 */
        const handleSuccess = async (account, cfResp) => {
            const contentType = cfResp.headers.get('content-type') || '';
            let b64Image = '';
            logger_1.appLogger.debug(`[AI Image][${rid}] CF response content-type: ${contentType}, status: ${cfResp.status}`);
            if (contentType.includes('application/json')) {
                const json = await cfResp.json();
                logger_1.appLogger.debug(`[AI Image][${rid}] CF JSON response keys: ${JSON.stringify(Object.keys(json))}`);
                if (!json.success) {
                    throw new Error(json.errors?.[0]?.message || 'CF image generation failed');
                }
                // 兼容多种 JSON 响应格式
                b64Image = json.result?.image || json.image || json.result?.images?.[0] || '';
            }
            else if (contentType.startsWith('image/') || contentType.includes('octet-stream')) {
                // 二进制图片响应 — 转 base64
                const buf = Buffer.from(await cfResp.arrayBuffer());
                b64Image = buf.toString('base64');
            }
            else {
                // 未知 content-type — 尝试作为文本/base64 读取
                const text = await cfResp.text();
                // 如果响应体看起来是纯 base64 字符串
                if (text.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(text.trim())) {
                    b64Image = text.trim();
                }
                else {
                    // 尝试解析为 JSON
                    try {
                        const json = JSON.parse(text);
                        b64Image = json.result?.image || json.image || json.result?.images?.[0] || '';
                    }
                    catch {
                        // 最后尝试作为二进制
                        b64Image = Buffer.from(text).toString('base64');
                    }
                }
            }
            if (!b64Image) {
                logger_1.appLogger.error(`[AI Image][${rid}] CF returned empty image. content-type: ${contentType}`);
                throw new Error('CF returned empty image');
            }
            // 估算神经元消耗
            const neurons = (0, pricing_1.estimateImageNeurons)(model);
            (0, quotaUsage_1.incrementQuota)(account.id, 'ai_neurons', neurons);
            (0, accountRouter_2.updateAiCacheAfterUsage)(account.id, neurons);
            logger_1.appLogger.debug(`[AI Image][${rid}] estimated ${neurons} neurons for account ${account.name}`);
            (0, auditLog_1.createAuditLog)(account.id, 'ai_image_generation', model, `[${rid}] ${image ? 'image-to-image' : 'text-to-image'} neurons=${neurons}`, 'success');
            res.json({
                created: Math.floor(Date.now() / 1000),
                data: [{ b64_json: b64Image, neurons }],
            });
        };
        // --- X-Account-ID 指定账户 ---
        if (specifiedAccountId && specifiedAccountId !== 'auto') {
            const allAccounts = (0, account_1.getActiveAccountsByFeature)('ai');
            const account = allAccounts.find((a) => a.account_id === specifiedAccountId);
            if (!account) {
                res.status(404).json({
                    error: { message: `Account ${specifiedAccountId} not found or inactive`, type: 'invalid_request_error', code: 'ACCOUNT_NOT_FOUND' },
                });
                return;
            }
            const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/run/${model}`;
            const { body: reqBody, contentType: reqCt } = buildRequest();
            const headers = { 'Content-Type': reqCt, 'Accept': 'application/json', ...(0, cfFactory_1.getAuthHeaders)(account) };
            try {
                const cfResp = await (0, proxyService_1.proxyFetch)(cfUrl, {
                    method: 'POST',
                    headers,
                    body: reqBody,
                }, 300000, undefined, account);
                if (!cfResp.ok) {
                    const errorText = await cfResp.text();
                    logger_1.appLogger.error(`[AI Image][${rid}] CF upstream error ${cfResp.status} for account ${account.name}: ${errorText.slice(0, 1000)}`);
                    if (isNeuronLimitError(errorText)) {
                        (0, quotaUsage_1.setExhausted)(account.id, 'ai_neurons');
                        (0, accountRouter_2.removeAccountFromAiCache)(account.id);
                    }
                    res.status(cfResp.status).json({
                        error: { message: extractCfError(errorText), type: 'upstream_error', code: upstreamStatusToCode(cfResp.status) },
                    });
                    return;
                }
                await handleSuccess(account, cfResp);
            }
            catch (netErr) {
                const errMsg = `Network error: ${netErr.message || netErr}`;
                logger_1.appLogger.error(`[AI Image][${rid}] ${errMsg}`);
                (0, auditLog_1.createAuditLog)(account.id, 'ai_image_generation', model, `[${rid}] ${errMsg}`, 'error');
                res.status(502).json({
                    error: { message: errMsg, type: 'upstream_error', code: 'NETWORK_ERROR' },
                });
            }
            return;
        }
        // --- 自动轮换账户 ---
        const skipped = new Set();
        let lastError = '';
        while (true) {
            const account = await (0, accountRouter_1.selectBestAccount)('ai_neurons', skipped, model);
            if (!account)
                break;
            const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/run/${model}`;
            const { body: reqBody, contentType: reqCt } = buildRequest();
            const headers = { 'Content-Type': reqCt, 'Accept': 'application/json', ...(0, cfFactory_1.getAuthHeaders)(account) };
            let cfResp;
            try {
                cfResp = await (0, proxyService_1.proxyFetch)(cfUrl, {
                    method: 'POST',
                    headers,
                    body: reqBody,
                }, 300000, undefined, account);
            }
            catch (netErr) {
                const errMsg = `Network error: ${netErr.message || netErr}`;
                logger_1.appLogger.warn(`[AI Image][${rid}] Account ${account.name} ${errMsg}`);
                lastError = errMsg;
                (0, auditLog_1.createAuditLog)(account.id, 'ai_image_generation', model, `[${rid}] ${errMsg}`, 'error');
                skipped.add(account.id);
                continue;
            }
            if (!cfResp.ok) {
                const errorText = await cfResp.text();
                logger_1.appLogger.warn(`[AI Image][${rid}] CF upstream error ${cfResp.status} for account ${account.name}: ${errorText.slice(0, 1000)}`);
                lastError = errorText;
                if (isRetryableError(cfResp.status, errorText)) {
                    if (isNeuronLimitError(errorText)) {
                        logger_1.appLogger.warn(`[AI Image][${rid}] Account ${account.name} neuron limit hit (4006), rotating`);
                        (0, quotaUsage_1.setExhausted)(account.id, 'ai_neurons');
                        (0, accountRouter_2.removeAccountFromAiCache)(account.id);
                        skipped.add(account.id);
                        (0, auditLog_1.createAuditLog)(account.id, 'ai_image_generation', model, `[${rid}] 4006 switching`, 'error');
                    }
                    else {
                        logger_1.appLogger.warn(`[AI Image][${rid}] Account ${account.name} upstream ${cfResp.status}, rotating`);
                        skipped.add(account.id);
                        (0, auditLog_1.createAuditLog)(account.id, 'ai_image_generation', model, `[${rid}] upstream ${cfResp.status}, switching`, 'error');
                    }
                    continue;
                }
                // Non-retryable
                res.status(cfResp.status).json({
                    error: { message: extractCfError(errorText), type: 'upstream_error', code: upstreamStatusToCode(cfResp.status) },
                });
                return;
            }
            // Success
            await handleSuccess(account, cfResp);
            return;
        }
        // All accounts exhausted
        logger_1.appLogger.error(`[AI Image][${rid}] All accounts exhausted. Last error: ${lastError}`);
        res.status(429).json({
            error: {
                message: 'All accounts have reached daily neuron limit',
                type: 'quota_exceeded',
                code: 'ALL_ACCOUNTS_EXHAUSTED',
                last_error: lastError || 'Unknown error',
            },
        });
    }
    catch (err) {
        next(err);
    }
});
// ================================================================
// POST /audio/speech — 文生语音 TTS（OpenAI-compatible）
// ================================================================
// 注意：不同 TTS 模型的 speaker 枚举完全不同（如 aura-2-en 38 个希腊名、aura-2-es 10 个西/意名、
// aura-1 12 个、melotts 无 speaker 参数），因此不能写死全局列表，须由 getModelSpeakerEnum 动态获取。
// VOICE_MAP 仅作为 OpenAI 音色名 → CF speaker 的备选映射，最终仍以模型 schema 枚举为准。
const VOICE_MAP = {
    alloy: 'luna', echo: 'mars', fable: 'athena', onyx: 'apollo', nova: 'aurora', shimmer: 'iris',
};
router.post('/audio/speech', async (req, res, next) => {
    try {
        const specifiedAccountId = req.headers['x-account-id'];
        const { model, input, voice, encoding, container, sample_rate, bit_rate, lang } = req.body;
        const rid = req.requestId || '-';
        if (!model || !input) {
            res.status(400).json({
                error: { message: 'model and input are required', type: 'invalid_request_error', code: 'bad_request' },
            });
            return;
        }
        // 选定用于解析 speaker 枚举 / 兜底的目标账户
        let targetAccount = null;
        if (specifiedAccountId && specifiedAccountId !== 'auto') {
            targetAccount = (0, account_1.getActiveAccountsByFeature)('ai').find((a) => a.account_id === specifiedAccountId) || null;
        }
        else {
            targetAccount = await (0, accountRouter_1.selectBestAccount)('ai_neurons', undefined, model);
        }
        if (!targetAccount) {
            res.status(503).json({
                error: { message: 'No active AI accounts available', type: 'service_error', code: 'NO_ACCOUNTS' },
            });
            return;
        }
        // 按模型 schema 动态构造 CF 请求体（melotts 用 prompt+lang，aura 系列用 text+speaker+encoding）
        const inputSchema = await (0, aiService_1.getModelInputSchema)(targetAccount, model);
        const { body: cfBody, speaker } = (0, aiService_1.buildTtsCfBody)(inputSchema, input, voice, VOICE_MAP, {
            encoding,
            container,
            sample_rate,
            bit_rate,
            lang,
        });
        /** 从 CF 错误响应中提取可读的错误消息 */
        const extractCfError = (raw) => {
            try {
                const json = JSON.parse(raw);
                if (json.errors?.[0]?.message)
                    return json.errors[0].message;
                if (json.error?.message)
                    return json.error.message;
                if (json.message)
                    return json.message;
            }
            catch { }
            return raw;
        };
        /** 处理 TTS 成功响应 — 返回 JSON（base64 音频，与 Worker 端一致） */
        const handleTtsSuccess = async (account, cfResp) => {
            const rawContentType = cfResp.headers.get('content-type') || 'audio/mpeg';
            const arrayBuffer = await cfResp.arrayBuffer();
            let b64Audio = '';
            let audioContentType = rawContentType;
            if (rawContentType.includes('json')) {
                // melotts 等模型可能返回 JSON { audio: "base64..." } 或被 SDK 解包后的结构
                const text = Buffer.from(arrayBuffer).toString('utf8');
                try {
                    const json = JSON.parse(text);
                    // 递归查找最像 base64 字符串的字段（兼容 audio / result.audio / data.audio / 单字符串等多种结构）
                    const findBase64 = (obj, depth = 0) => {
                        if (depth > 5 || obj == null)
                            return '';
                        if (typeof obj === 'string') {
                            // base64 通常长度 > 100 且字符集为 [A-Za-z0-9+/=]
                            return obj.length > 100 && /^[A-Za-z0-9+/=]+$/.test(obj) ? obj : '';
                        }
                        if (typeof obj !== 'object')
                            return '';
                        if (typeof obj.audio === 'string' && obj.audio.length > 50)
                            return obj.audio;
                        for (const v of Object.values(obj)) {
                            const r = findBase64(v, depth + 1);
                            if (r)
                                return r;
                        }
                        return '';
                    };
                    b64Audio = findBase64(json);
                }
                catch {
                    b64Audio = Buffer.from(text).toString('base64');
                    audioContentType = 'audio/mpeg';
                }
            }
            else {
                b64Audio = Buffer.from(arrayBuffer).toString('base64');
            }
            // 音频为空：明确返回 502 错误，避免前端拿到空 data URL 播放 0s
            if (!b64Audio) {
                logger_1.appLogger.warn(`[AI TTS][${rid}] ${model} 返回空音频 (content-type=${rawContentType}, bytes=${arrayBuffer.byteLength})`);
                return res.status(502).json({
                    error: {
                        message: `TTS 模型未返回音频数据（content-type=${rawContentType}, bytes=${arrayBuffer.byteLength}）`,
                        type: 'upstream_error',
                        code: 'EMPTY_AUDIO',
                    },
                });
            }
            // 仅保留音频 MIME；若 CF 返回的是 application/json（JSON base64 响应），用 audio/mpeg 占位（MeloTTS 实际输出 wav，
            // 浏览器对 wav 需 audio/wav，若仍 0s 可在高级设置通过转换或后端推断调整）
            if (!audioContentType.startsWith('audio/')) {
                audioContentType = 'audio/mpeg';
            }
            // 估算神经元消耗
            const neurons = (0, pricing_1.estimateTtsNeurons)(input, model);
            (0, quotaUsage_1.incrementQuota)(account.id, 'ai_neurons', neurons);
            (0, accountRouter_2.updateAiCacheAfterUsage)(account.id, neurons);
            (0, auditLog_1.createAuditLog)(account.id, 'ai_tts_generation', model, `[${rid}] chars=${input.length} speaker=${speaker} neurons=${neurons}`, 'success');
            res.json({
                created: Math.floor(Date.now() / 1000),
                data: [{ audio: b64Audio, neurons, content_type: audioContentType }],
            });
        };
        // --- X-Account-ID 指定账户 ---
        if (specifiedAccountId && specifiedAccountId !== 'auto') {
            const allAccounts = (0, account_1.getActiveAccountsByFeature)('ai');
            const account = allAccounts.find((a) => a.account_id === specifiedAccountId);
            if (!account) {
                res.status(404).json({
                    error: { message: `Account ${specifiedAccountId} not found or inactive`, type: 'invalid_request_error', code: 'ACCOUNT_NOT_FOUND' },
                });
                return;
            }
            const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/run/${model}`;
            const headers = { 'Content-Type': 'application/json', ...(0, cfFactory_1.getAuthHeaders)(account) };
            try {
                const cfResp = await (0, proxyService_1.proxyFetch)(cfUrl, {
                    method: 'POST', headers, body: JSON.stringify(cfBody),
                }, 300000, undefined, account);
                if (!cfResp.ok) {
                    const errorText = await cfResp.text();
                    logger_1.appLogger.error(`[AI TTS][${rid}] CF upstream error ${cfResp.status}: ${errorText.slice(0, 500)}`);
                    res.status(cfResp.status).json({
                        error: { message: extractCfError(errorText), type: 'upstream_error', code: upstreamStatusToCode(cfResp.status) },
                    });
                    return;
                }
                await handleTtsSuccess(account, cfResp);
            }
            catch (netErr) {
                res.status(502).json({ error: { message: `Network error: ${netErr.message}`, type: 'upstream_error', code: 'NETWORK_ERROR' } });
            }
            return;
        }
        // --- 自动轮换账户 ---
        const skipped = new Set();
        let lastError = '';
        while (true) {
            const account = await (0, accountRouter_1.selectBestAccount)('ai_neurons', skipped, model);
            if (!account)
                break;
            const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/run/${model}`;
            const headers = { 'Content-Type': 'application/json', ...(0, cfFactory_1.getAuthHeaders)(account) };
            let cfResp;
            try {
                cfResp = await (0, proxyService_1.proxyFetch)(cfUrl, {
                    method: 'POST', headers, body: JSON.stringify(cfBody),
                }, 300000, undefined, account);
            }
            catch (netErr) {
                lastError = `Network error: ${netErr.message}`;
                skipped.add(account.id);
                continue;
            }
            if (!cfResp.ok) {
                const errorText = await cfResp.text();
                lastError = extractCfError(errorText);
                if (isRetryableError(cfResp.status, errorText)) {
                    if (isNeuronLimitError(errorText)) {
                        (0, quotaUsage_1.setExhausted)(account.id, 'ai_neurons');
                        (0, accountRouter_2.removeAccountFromAiCache)(account.id);
                    }
                    skipped.add(account.id);
                    continue;
                }
                res.status(cfResp.status).json({
                    error: { message: extractCfError(errorText), type: 'upstream_error', code: upstreamStatusToCode(cfResp.status) },
                });
                return;
            }
            await handleTtsSuccess(account, cfResp);
            return;
        }
        res.status(429).json({
            error: { message: 'All accounts exhausted', type: 'quota_exceeded', code: 'ALL_ACCOUNTS_EXHAUSTED', last_error: lastError },
        });
    }
    catch (err) {
        next(err);
    }
});
// ================================================================
// POST /translations — 文本翻译（OpenAI-compatible 自定义扩展）
// ================================================================
router.post('/translations', async (req, res, next) => {
    try {
        const specifiedAccountId = req.headers['x-account-id'];
        const { model, text, source_lang, target_lang } = req.body;
        const rid = req.requestId || '-';
        if (!model || !text || !target_lang) {
            res.status(400).json({
                error: { message: 'model, text, and target_lang are required', type: 'invalid_request_error', code: 'bad_request' },
            });
            return;
        }
        // 根据模型构建不同的 CF 请求体
        const isIndicTrans2 = model.includes('indictrans2');
        const cfBody = isIndicTrans2
            ? { text, target_language: target_lang } // IndicTrans2: { text, target_language }
            : { text, source_lang: source_lang || 'en', target_lang }; // M2M100: { text, source_lang, target_lang }
        const extractCfError = (raw) => {
            try {
                const json = JSON.parse(raw);
                if (json.errors?.[0]?.message)
                    return json.errors[0].message;
                if (json.error?.message)
                    return json.error.message;
                if (json.message)
                    return json.message;
            }
            catch { }
            return raw;
        };
        const handleTranslationSuccess = async (account, cfResp) => {
            const json = await cfResp.json();
            const translatedText = isIndicTrans2
                ? (json?.result?.translations?.[0] || '')
                : (json?.result?.translated_text || json?.result?.output || json?.translated_text || '');
            if (!translatedText) {
                logger_1.appLogger.error(`[AI Translation][${rid}] CF returned empty translation`);
                throw new Error('CF returned empty translation');
            }
            const neurons = (0, pricing_1.estimateTranslationNeurons)(text, model);
            (0, quotaUsage_1.incrementQuota)(account.id, 'ai_neurons', neurons);
            (0, accountRouter_2.updateAiCacheAfterUsage)(account.id, neurons);
            logger_1.appLogger.debug(`[AI Translation][${rid}] estimated ${neurons} neurons for account ${account.name}`);
            (0, auditLog_1.createAuditLog)(account.id, 'ai_translation', model, `[${rid}] chars=${text.length} source=${source_lang || 'auto'} target=${target_lang} neurons=${neurons}`, 'success');
            res.json({
                created: Math.floor(Date.now() / 1000),
                data: [{
                        translated_text: translatedText,
                        source_lang,
                        target_lang,
                        neurons,
                    }],
            });
        };
        if (specifiedAccountId && specifiedAccountId !== 'auto') {
            const allAccounts = (0, account_1.getActiveAccountsByFeature)('ai');
            const account = allAccounts.find((a) => a.account_id === specifiedAccountId);
            if (!account) {
                res.status(404).json({
                    error: { message: `Account ${specifiedAccountId} not found or inactive`, type: 'invalid_request_error', code: 'ACCOUNT_NOT_FOUND' },
                });
                return;
            }
            const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/run/${model}`;
            const headers = { 'Content-Type': 'application/json', ...(0, cfFactory_1.getAuthHeaders)(account) };
            try {
                const cfResp = await (0, proxyService_1.proxyFetch)(cfUrl, {
                    method: 'POST', headers, body: JSON.stringify(cfBody),
                }, 300000, undefined, account);
                if (!cfResp.ok) {
                    const errorText = await cfResp.text();
                    logger_1.appLogger.error(`[AI Translation][${rid}] CF upstream error ${cfResp.status}: ${errorText.slice(0, 500)}`);
                    res.status(cfResp.status).json({
                        error: { message: extractCfError(errorText), type: 'upstream_error', code: upstreamStatusToCode(cfResp.status) },
                    });
                    return;
                }
                await handleTranslationSuccess(account, cfResp);
            }
            catch (netErr) {
                res.status(502).json({ error: { message: `Network error: ${netErr.message}`, type: 'upstream_error', code: 'NETWORK_ERROR' } });
            }
            return;
        }
        const skipped = new Set();
        let lastError = '';
        while (true) {
            const account = await (0, accountRouter_1.selectBestAccount)('ai_neurons', skipped, model);
            if (!account)
                break;
            const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/run/${model}`;
            const headers = { 'Content-Type': 'application/json', ...(0, cfFactory_1.getAuthHeaders)(account) };
            let cfResp;
            try {
                cfResp = await (0, proxyService_1.proxyFetch)(cfUrl, {
                    method: 'POST', headers, body: JSON.stringify(cfBody),
                }, 300000, undefined, account);
            }
            catch (netErr) {
                lastError = `Network error: ${netErr.message}`;
                skipped.add(account.id);
                continue;
            }
            if (!cfResp.ok) {
                const errorText = await cfResp.text();
                lastError = extractCfError(errorText);
                if (isRetryableError(cfResp.status, errorText)) {
                    if (isNeuronLimitError(errorText)) {
                        (0, quotaUsage_1.setExhausted)(account.id, 'ai_neurons');
                        (0, accountRouter_2.removeAccountFromAiCache)(account.id);
                    }
                    skipped.add(account.id);
                    continue;
                }
                res.status(cfResp.status).json({
                    error: { message: extractCfError(errorText), type: 'upstream_error', code: upstreamStatusToCode(cfResp.status) },
                });
                return;
            }
            await handleTranslationSuccess(account, cfResp);
            return;
        }
        res.status(429).json({
            error: { message: 'All accounts exhausted', type: 'quota_exceeded', code: 'ALL_ACCOUNTS_EXHAUSTED', last_error: lastError },
        });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=openai.js.map