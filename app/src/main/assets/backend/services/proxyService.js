"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResinConfig = getResinConfig;
exports.setResinConfig = setResinConfig;
exports.isResinEnabled = isResinEnabled;
exports.buildResinProxyUrl = buildResinProxyUrl;
exports.isProxyEnabled = isProxyEnabled;
exports.setProxyEnabled = setProxyEnabled;
exports.getProxyUrl = getProxyUrl;
exports.setProxyUrl = setProxyUrl;
exports.getAccountProxyUrl = getAccountProxyUrl;
exports.getHttpAgent = getHttpAgent;
exports.getHttpAgentForAccount = getHttpAgentForAccount;
exports.proxyFetch = proxyFetch;
exports.buildCurlCommand = buildCurlCommand;
exports.testProxyConnection = testProxyConnection;
exports.testResinConnection = testResinConnection;
const https_proxy_agent_1 = require("https-proxy-agent");
const socks_proxy_agent_1 = require("socks-proxy-agent");
const node_fetch_1 = __importDefault(require("node-fetch"));
const config_1 = require("../config");
const db_1 = require("../db");
let cachedAgent;
let cachedUrl = '';
// Per-account agent cache
const accountAgentCache = new Map();
function isSocks(url) {
    return /^socks([45][ah]?)?:\/\//i.test(url);
}
function getResinConfig() {
    return {
        enabled: (0, db_1.getSetting)('resin_enabled') === '1',
        url: (0, db_1.getSetting)('resin_url') || '',
        token: (0, db_1.getSetting)('resin_token') || '',
        platform: (0, db_1.getSetting)('resin_platform') || 'Default',
    };
}
function setResinConfig(cfg) {
    if (cfg.enabled !== undefined)
        (0, db_1.setSetting)('resin_enabled', cfg.enabled ? '1' : '0');
    if (cfg.url !== undefined)
        (0, db_1.setSetting)('resin_url', cfg.url);
    if (cfg.token !== undefined)
        (0, db_1.setSetting)('resin_token', cfg.token);
    if (cfg.platform !== undefined)
        (0, db_1.setSetting)('resin_platform', cfg.platform);
    // Clear all caches when Resin config changes
    cachedAgent = undefined;
    cachedUrl = '';
    accountAgentCache.clear();
}
function isResinEnabled() {
    return (0, db_1.getSetting)('resin_enabled') === '1';
}
/**
 * 为指定账户构建 Resin sticky 代理 URL
 * 格式: http://Platform.AccountId:Token@host:port
 */
function buildResinProxyUrl(accountId) {
    const { url, token, platform } = getResinConfig();
    if (!url || !token)
        return '';
    try {
        const parsed = new URL(url);
        // Resin 认证格式: Platform.Account:Token
        parsed.username = `${platform}.${accountId}`;
        parsed.password = token;
        return parsed.toString();
    }
    catch {
        return '';
    }
}
// ==================== 经典代理配置 ====================
function isProxyEnabled() {
    const val = (0, db_1.getSetting)('proxy_enabled');
    if (val !== undefined)
        return val === '1';
    return !!config_1.config.proxyUrl;
}
function setProxyEnabled(enabled) {
    (0, db_1.setSetting)('proxy_enabled', enabled ? '1' : '0');
    cachedAgent = undefined;
    cachedUrl = '';
    accountAgentCache.clear();
}
function getProxyUrl() {
    const dbVal = (0, db_1.getSetting)('proxy_url');
    if (dbVal !== undefined)
        return dbVal;
    return config_1.config.proxyUrl;
}
function setProxyUrl(url) {
    (0, db_1.setSetting)('proxy_url', url);
    cachedAgent = undefined;
    cachedUrl = '';
    accountAgentCache.clear();
}
/**
 * 获取指定账户的代理 URL
 * 优先级：账户专属代理(已启用) > Resin(已启用) > 全局代理(设置页) > 环境变量 PROXY_URL
 * 返回空字符串表示不使用代理
 */
function getAccountProxyUrl(account) {
    // 1. 优先使用账户专属代理（已启用）
    if (account?.proxy_url && account.proxy_url.trim() && account.proxy_enabled === 1) {
        return account.proxy_url.trim();
    }
    // 2. Resin 代理池（已启用）
    if (isResinEnabled() && account?.id) {
        const resinUrl = buildResinProxyUrl(account.id);
        if (resinUrl)
            return resinUrl;
    }
    // 3. 回退到全局代理
    return getProxyUrl();
}
function getHttpAgent() {
    if (!isProxyEnabled())
        return undefined;
    const url = getProxyUrl();
    if (!url)
        return undefined;
    if (url === cachedUrl && cachedAgent)
        return cachedAgent;
    cachedAgent = isSocks(url)
        ? new socks_proxy_agent_1.SocksProxyAgent(url, { timeout: 30000 })
        : new https_proxy_agent_1.HttpsProxyAgent(url, { timeout: 30000 });
    cachedUrl = url;
    return cachedAgent;
}
/**
 * 获取指定账户的 HTTP Agent（支持账户专属代理 + Resin 代理池）
 * 优先级：账户专属代理(已启用) > Resin(已启用) > 全局代理(已启用)
 */
function getHttpAgentForAccount(account) {
    // 1. 账户专属代理：只要账户有 URL 且开关开启，就用它（不受全局开关限制）
    if (account?.proxy_url && account.proxy_url.trim() && account.proxy_enabled === 1) {
        const url = account.proxy_url.trim();
        const accountId = account.id;
        const cached = accountAgentCache.get(accountId);
        if (cached && cached.url === url)
            return cached.agent;
        const agent = isSocks(url)
            ? new socks_proxy_agent_1.SocksProxyAgent(url, { timeout: 30000 })
            : new https_proxy_agent_1.HttpsProxyAgent(url, { timeout: 30000 });
        accountAgentCache.set(accountId, { agent, url });
        return agent;
    }
    // 2. Resin 代理池（已启用）— 自动为每个账户构建 sticky 代理 URL
    if (isResinEnabled() && account?.id) {
        const resinUrl = buildResinProxyUrl(account.id);
        if (resinUrl) {
            const accountId = account.id;
            const cached = accountAgentCache.get(accountId);
            if (cached && cached.url === resinUrl)
                return cached.agent;
            const agent = isSocks(resinUrl)
                ? new socks_proxy_agent_1.SocksProxyAgent(resinUrl, { timeout: 30000 })
                : new https_proxy_agent_1.HttpsProxyAgent(resinUrl, { timeout: 30000 });
            accountAgentCache.set(accountId, { agent, url: resinUrl });
            return agent;
        }
    }
    // 3. 账户没有专属代理 / Resin 未启用 → 回退到全局代理（受全局开关控制）
    if (!isProxyEnabled())
        return undefined;
    return getHttpAgent();
}
async function proxyFetch(input, init, timeoutMs = 300000, accountProxyUrl, account) {
    let agent;
    // 优先级：accountProxyUrl (显式传入) > account 对象 (含 Resin/账户代理) > 全局代理
    if (accountProxyUrl) {
        agent = isSocks(accountProxyUrl)
            ? new socks_proxy_agent_1.SocksProxyAgent(accountProxyUrl, { timeout: 30000 })
            : new https_proxy_agent_1.HttpsProxyAgent(accountProxyUrl, { timeout: 30000 });
    }
    else if (account) {
        agent = getHttpAgentForAccount(account);
    }
    else if (isProxyEnabled()) {
        agent = getHttpAgent();
    }
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        if (!agent) {
            const response = await fetch(input, { ...init, signal: controller.signal });
            clearTimeout(timeoutId);
            return response;
        }
        const doFetch = () => (0, node_fetch_1.default)(input.toString(), { ...init, agent, timeout: timeoutMs });
        const result = await doFetch();
        clearTimeout(timeoutId);
        return result;
    }
    catch (err) {
        clearTimeout(timeoutId);
        if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
            cachedAgent = undefined;
            cachedUrl = '';
            // 重建 agent 进行重试（优先级与首次请求一致）
            let newAgent;
            if (accountProxyUrl) {
                newAgent = isSocks(accountProxyUrl)
                    ? new socks_proxy_agent_1.SocksProxyAgent(accountProxyUrl, { timeout: 30000 })
                    : new https_proxy_agent_1.HttpsProxyAgent(accountProxyUrl, { timeout: 30000 });
            }
            else if (account) {
                newAgent = getHttpAgentForAccount(account);
            }
            else if (isProxyEnabled()) {
                newAgent = getHttpAgent();
            }
            // Retry with new agent
            const retryController = new AbortController();
            const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
            try {
                if (!newAgent) {
                    const response = await fetch(input, { ...init, signal: retryController.signal });
                    clearTimeout(retryTimeoutId);
                    return response;
                }
                const result = await (0, node_fetch_1.default)(input.toString(), { ...init, agent: newAgent, timeout: timeoutMs });
                clearTimeout(retryTimeoutId);
                return result;
            }
            catch (retryErr) {
                clearTimeout(retryTimeoutId);
                throw retryErr;
            }
        }
        // Handle timeout error
        if (err.name === 'AbortError' || err.type === 'request-timeout') {
            const timeoutErr = new Error(`Request timeout after ${timeoutMs}ms`);
            timeoutErr.name = 'TimeoutError';
            throw timeoutErr;
        }
        throw err;
    }
}
function buildCurlCommand(url, init) {
    const proxyUrl = getProxyUrl();
    const parts = ['curl -s'];
    if (proxyUrl)
        parts.push(`-x '${proxyUrl}'`);
    if (init?.method && init.method !== 'GET')
        parts.push(`-X ${init.method}`);
    if (init?.headers) {
        for (const [k, v] of Object.entries(init.headers)) {
            const val = k.toLowerCase() === 'authorization' ? v.replace(/^(Bearer\s+).+/, '$1***') : v;
            parts.push(`-H '${k}: ${val}'`);
        }
    }
    if (init?.body) {
        const body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
        const truncated = body.length > 500 ? body.substring(0, 500) + '...' : body;
        parts.push(`-d '${truncated.replace(/'/g, "'\\''")}'`);
    }
    parts.push(`'${url}'`);
    return parts.join(' \\\n  ');
}
async function testProxyConnection(proxyUrl) {
    const agent = isSocks(proxyUrl)
        ? new socks_proxy_agent_1.SocksProxyAgent(proxyUrl)
        : new https_proxy_agent_1.HttpsProxyAgent(proxyUrl);
    const start = Date.now();
    const resp = await (0, node_fetch_1.default)('https://api.cloudflare.com/client/v4/ips', {
        agent,
        timeout: 10000,
    });
    const latency = Date.now() - start;
    if (!resp.ok) {
        throw new Error(`Upstream returned HTTP ${resp.status}`);
    }
    return { latency_ms: latency, status: resp.status };
}
/**
 * 测试 Resin 代理池连接
 * 使用 Resin 代理访问 Cloudflare API，验证连通性和延迟
 */
async function testResinConnection(accountId) {
    const testAccountId = accountId || 0;
    const resinUrl = buildResinProxyUrl(testAccountId);
    if (!resinUrl) {
        throw new Error('Resin 配置不完整（需要服务地址和 Token）');
    }
    const agent = isSocks(resinUrl)
        ? new socks_proxy_agent_1.SocksProxyAgent(resinUrl, { timeout: 10000 })
        : new https_proxy_agent_1.HttpsProxyAgent(resinUrl, { timeout: 10000 });
    const start = Date.now();
    const resp = await (0, node_fetch_1.default)('https://api.cloudflare.com/client/v4/ips', {
        agent,
        timeout: 10000,
    });
    const latency = Date.now() - start;
    if (!resp.ok) {
        throw new Error(`Upstream returned HTTP ${resp.status}`);
    }
    return { latency_ms: latency, status: resp.status };
}
//# sourceMappingURL=proxyService.js.map