"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getModelInputSchema = getModelInputSchema;
exports.getModelSpeakerEnum = getModelSpeakerEnum;
exports.resolveTtsSpeaker = resolveTtsSpeaker;
exports.extractTtsAdvancedParams = extractTtsAdvancedParams;
exports.buildTtsCfBody = buildTtsCfBody;
exports.getAvailableModels = getAvailableModels;
exports.getAiUsageToday = getAiUsageToday;
const cfFactory_1 = require("./cfFactory");
const proxyService_1 = require("./proxyService");
const logger_1 = require("./logger");
const inputSchemaCache = new Map();
const SCHEMA_TTL_MS = 1000 * 60 * 60; // 1 小时
/**
 * 获取指定模型的 input schema（取自 CF 模型 schema 的 input 部分）。
 * 获取失败或非对象时返回 null。
 */
async function getModelInputSchema(account, model) {
    if (!account.account_id || !model)
        return null;
    const key = `${account.account_id}::${model}`;
    const cached = inputSchemaCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < SCHEMA_TTL_MS) {
        return cached.schema;
    }
    let result = null;
    try {
        const cfAny = (0, cfFactory_1.getCfClient)(account);
        const schema = await cfAny.ai.models.schema.get({ account_id: account.account_id, model });
        const input = schema?.input;
        if (input && typeof input === 'object') {
            result = {
                properties: input.properties || {},
                required: Array.isArray(input.required) ? input.required : [],
            };
        }
    }
    catch (err) {
        logger_1.appLogger.warn(`[AI ModelSchema] 获取模型 ${model} 的 input schema 失败: ${err?.message || err}`);
    }
    inputSchemaCache.set(key, { schema: result, fetchedAt: Date.now() });
    return result;
}
/**
 * 从模型 schema 中提取 speaker 枚举。非 TTS 模型或 schema 中无 speaker 参数时返回 null。
 */
async function getModelSpeakerEnum(account, model) {
    const schema = await getModelInputSchema(account, model);
    const speakerProp = schema?.properties?.speaker;
    if (speakerProp && Array.isArray(speakerProp.enum)) {
        return { speakers: speakerProp.enum, defaultSpeaker: speakerProp.default };
    }
    return null;
}
/**
 * 将请求中的 voice（可能是 OpenAI 音色名，或 CF 原生 speaker 名）解析为
 * 当前模型实际支持的 speaker。若均不匹配，回退到枚举中的第一个/默认值。
 */
function resolveTtsSpeaker(requestedVoice, speakerEnum, voiceMap) {
    const speakers = speakerEnum?.speakers || [];
    if (speakers.length === 0) {
        // 无 speaker 参数的模型（如 melotts），不设置 speaker
        return undefined;
    }
    if (requestedVoice && speakers.includes(requestedVoice)) {
        return requestedVoice;
    }
    if (requestedVoice && voiceMap[requestedVoice] && speakers.includes(voiceMap[requestedVoice])) {
        return voiceMap[requestedVoice];
    }
    return speakerEnum?.defaultSpeaker || speakers[0];
}
/**
 * 提取模型 schema 中可供前端"高级设置"展示的可选参数（排除 text/prompt/speaker 主字段）。
 * 返回 { 字段名: { type, enum?, default?, min?, max? } }，供 /models 接口下发。
 */
function extractTtsAdvancedParams(schema) {
    if (!schema)
        return undefined;
    const excluded = new Set(['text', 'prompt', 'speaker']);
    const out = {};
    for (const [name, def] of Object.entries(schema.properties)) {
        if (excluded.has(name))
            continue;
        const entry = { type: def.type };
        if (Array.isArray(def.enum))
            entry.enum = def.enum;
        if (def.default !== undefined)
            entry.default = def.default;
        if (typeof def.minimum === 'number')
            entry.min = def.minimum;
        if (typeof def.maximum === 'number')
            entry.max = def.maximum;
        out[name] = entry;
    }
    return Object.keys(out).length ? out : undefined;
}
/**
 * 按模型 schema 动态构造 TTS 请求体（只发送 schema 中存在的字段）：
 * - 文本字段：优先 `prompt`（melotts），否则 `text`（aura 系列）
 * - speaker：仅当 schema 含 speaker 属性时解析并设置
 * - encoding：默认 mp3（若模型支持）；用户显式提供合法值时覆盖
 * - 高级参数（container/sample_rate/bit_rate/lang）：仅当 schema 支持且值合法时写入
 * 返回 { body, speaker }，speaker 用于审计日志展示。
 */
function buildTtsCfBody(schema, input, voice, voiceMap, options) {
    const props = schema?.properties || {};
    const body = {};
    // 文本字段：melotts 用 prompt，aura 系列用 text
    const textKey = props.prompt ? 'prompt' : props.text ? 'text' : '';
    if (textKey)
        body[textKey] = input;
    // speaker（仅当模型支持）
    let speaker;
    if (props.speaker && Array.isArray(props.speaker.enum)) {
        speaker = resolveTtsSpeaker(voice, { speakers: props.speaker.enum, defaultSpeaker: props.speaker.default }, voiceMap);
        if (speaker)
            body.speaker = speaker;
    }
    // encoding：模型支持 mp3 时默认 mp3；用户显式提供的合法值覆盖
    const encodingEnum = Array.isArray(props.encoding?.enum) ? props.encoding.enum : [];
    if (encodingEnum.length > 0) {
        body.encoding = encodingEnum.includes('mp3') ? 'mp3' : encodingEnum[0];
        if (options?.encoding && encodingEnum.includes(options.encoding)) {
            body.encoding = options.encoding;
        }
    }
    // container：仅当 schema 支持且值合法时写入
    if (options?.container && Array.isArray(props.container?.enum) && props.container.enum.includes(options.container)) {
        body.container = options.container;
    }
    // sample_rate / bit_rate：仅当 schema 支持时写入，做基本数值校验
    const writeNumber = (name, value) => {
        if (value == null || !props[name] || typeof props[name] !== 'object')
            return;
        const num = Number(value);
        if (Number.isNaN(num))
            return;
        const def = props[name];
        if (typeof def.minimum === 'number' && num < def.minimum)
            return;
        if (typeof def.maximum === 'number' && num > def.maximum)
            return;
        body[name] = num;
    };
    writeNumber('sample_rate', options?.sample_rate);
    writeNumber('bit_rate', options?.bit_rate);
    // lang（melotts 等）：仅当 schema 支持时写入
    if (options?.lang && props.lang && typeof props.lang === 'object') {
        const def = props.lang;
        if (!Array.isArray(def.enum) || def.enum.includes(options.lang)) {
            body.lang = options.lang;
        }
    }
    return { body, speaker };
}
async function getAvailableModels(account, taskFilter) {
    if (!account.account_id) {
        throw new Error(`账户 "${account.name}" 缺少 Cloudflare Account ID，请点击"测试连接"以获取`);
    }
    const cfAny = (0, cfFactory_1.getCfClient)(account);
    const models = [];
    let count = 0;
    for await (const model of cfAny.ai.models.list({ account_id: account.account_id })) {
        const m = model;
        // Log first model structure for debugging
        if (count === 0) {
            logger_1.appLogger.debug(`[AI Models] Sample model structure: ${JSON.stringify(m, null, 2).slice(0, 500)}`);
        }
        count++;
        // 如果指定了任务过滤，只返回匹配的模型
        if (taskFilter) {
            const taskName = m.task?.name || m.task || '';
            // Normalize: convert both to lowercase and replace hyphens with spaces for matching
            // e.g., "text-generation" matches "Text Generation"
            const normalizedTaskName = taskName.toLowerCase().replace(/-/g, ' ');
            const normalizedFilter = taskFilter.toLowerCase().replace(/-/g, ' ');
            if (!normalizedTaskName.includes(normalizedFilter))
                continue;
        }
        models.push(m);
    }
    logger_1.appLogger.debug(`[AI Models] Total: ${count}, Filtered (${taskFilter}): ${models.length}`);
    return models;
}
async function getAiUsageToday(account) {
    const accountId = account.account_id;
    if (!accountId)
        throw new Error(`AI usage: account "${account.name}" missing account_id`);
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const todayEnd = now.toISOString();
    const query = `
    query CfAiUsage($accountTag: string!, $start: Time!, $end: Time!) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          total: aiInferenceAdaptiveGroups(
            filter: { datetime_geq: $start, datetime_leq: $end }
            limit: 1
          ) {
            sum { totalNeurons }
          }
          byModel: aiInferenceAdaptiveGroups(
            filter: { datetime_geq: $start, datetime_leq: $end }
            limit: 100
            orderBy: [sum_totalNeurons_DESC]
          ) {
            count
            sum { totalNeurons }
            dimensions { modelId }
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
            variables: { accountTag: accountId, start: todayStart, end: todayEnd },
        }),
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let resp;
    try {
        resp = await (0, proxyService_1.proxyFetch)(fetchUrl, { ...fetchInit, signal: controller.signal }, 300000, undefined, account);
    }
    catch (e) {
        logger_1.appLogger.error(`[AI Usage] Fetch failed for ${account.name}: ${e}\n[DEBUG curl] ${(0, proxyService_1.buildCurlCommand)(fetchUrl, fetchInit)}`);
        throw new Error(`AI usage fetch failed for ${account.name}: ${e}`);
    }
    finally {
        clearTimeout(timeout);
    }
    if (!resp.ok)
        throw new Error(`AI usage HTTP ${resp.status} for ${account.name}`);
    const json = await resp.json();
    if (json.errors) {
        logger_1.appLogger.error(`[GraphQL] AI usage errors: ${JSON.stringify(json.errors)}`);
        throw new Error(`GraphQL errors for ${account.name}: ${JSON.stringify(json.errors)}`);
    }
    const acct = json?.data?.viewer?.accounts?.[0];
    const totalRecs = acct?.total || [];
    const modelRecs = acct?.byModel || [];
    const totalNeurons = totalRecs[0]?.sum?.totalNeurons || 0;
    const models = modelRecs
        .filter((r) => r.dimensions?.modelId)
        .map((r) => ({
        modelId: r.dimensions.modelId,
        neurons: r.sum?.totalNeurons || 0,
        requests: r.count || 0,
    }));
    return { totalNeurons: Math.round(totalNeurons), models };
}
//# sourceMappingURL=aiService.js.map