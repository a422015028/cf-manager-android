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
function getAuthHeaders(account) {
    if (account.auth_type === 'token') {
        if (!account.api_token)
            throw new Error(`Account ${account.id} is missing api_token`);
        return { 'Authorization': `Bearer ${(0, encryptionService_1.decrypt)(account.api_token)}` };
    }
    if (!account.api_key)
        throw new Error(`Account ${account.id} is missing api_key`);
    if (!account.email)
        throw new Error(`Account ${account.id} is missing email`);
    return { 'X-Auth-Email': account.email, 'X-Auth-Key': (0, encryptionService_1.decrypt)(account.api_key) };
}
function getCfClient(account) {
    const httpAgent = (0, proxyService_1.getHttpAgentForAccount)(account);
    const opts = {};
    if (httpAgent)
        opts.httpAgent = httpAgent;
    if (account.auth_type === 'token') {
        if (!account.api_token)
            throw new Error(`Account ${account.id} is missing api_token`);
        try {
            return new cloudflare_1.default({ apiToken: (0, encryptionService_1.decrypt)(account.api_token), ...opts });
        }
        catch (err) {
            throw new Error(`Failed to decrypt credentials for account ${account.id}: ${err}`);
        }
    }
    if (!account.api_key)
        throw new Error(`Account ${account.id} is missing api_key`);
    if (!account.email)
        throw new Error(`Account ${account.id} is missing email`);
    try {
        return new cloudflare_1.default({ apiKey: (0, encryptionService_1.decrypt)(account.api_key), apiEmail: account.email, ...opts });
    }
    catch (err) {
        throw new Error(`Failed to decrypt credentials for account ${account.id}: ${err}`);
    }
}
function clearClientCache() {
    // No-op since we're not caching anymore
}
//# sourceMappingURL=cfFactory.js.map