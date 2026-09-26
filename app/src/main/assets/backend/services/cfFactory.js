"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuthHeaders = getAuthHeaders;
exports.getCfClient = getCfClient;
exports.clearClientCache = clearClientCache;
const cloudflare_1 = __importDefault(require("cloudflare"));
const encryptionService_1 = require("./encryptionService");
const proxyService_1 = require("./proxyService");
/** 错误提示里用的账号标识：让用户在几十个账号里知道是哪一个坏了。 */
function accountLabel(account) {
    return account.name ? `${account.name} (ID ${account.id})` : `ID ${account.id}`;
}
/**
 * 解密账号凭据。解密失败时补上账号标识后继续抛 DecryptError，
 * 让上层（errorHandler / 前端提示）能直接告诉用户「哪个账号、该怎么办」。
 */
function decryptCredential(value, account) {
    try {
        return (0, encryptionService_1.decrypt)(value);
    }
    catch (err) {
        if (err instanceof encryptionService_1.DecryptError)
            throw new encryptionService_1.DecryptError(accountLabel(account), err);
        throw err;
    }
}
function getAuthHeaders(account) {
    if (account.auth_type === 'token') {
        if (!account.api_token)
            throw new Error(`Account ${account.id} is missing api_token`);
        return { 'Authorization': `Bearer ${decryptCredential(account.api_token, account)}` };
    }
    if (!account.api_key)
        throw new Error(`Account ${account.id} is missing api_key`);
    if (!account.email)
        throw new Error(`Account ${account.id} is missing email`);
    return { 'X-Auth-Email': account.email, 'X-Auth-Key': decryptCredential(account.api_key, account) };
}
function getCfClient(account) {
    const httpAgent = (0, proxyService_1.getHttpAgentForAccount)(account);
    const opts = {};
    if (httpAgent)
        opts.httpAgent = httpAgent;
    if (account.auth_type === 'token') {
        if (!account.api_token)
            throw new Error(`Account ${account.id} is missing api_token`);
        return new cloudflare_1.default({ apiToken: decryptCredential(account.api_token, account), ...opts });
    }
    if (!account.api_key)
        throw new Error(`Account ${account.id} is missing api_key`);
    if (!account.email)
        throw new Error(`Account ${account.id} is missing email`);
    return new cloudflare_1.default({ apiKey: decryptCredential(account.api_key, account), apiEmail: account.email, ...opts });
}
function clearClientCache() {
    // No-op since we're not caching anymore
}
//# sourceMappingURL=cfFactory.js.map