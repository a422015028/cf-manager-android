"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeployHeaders = getDeployHeaders;
const cfFactory_1 = require("../cfFactory");
const WRANGLER_UA = 'wrangler/4.112.0';
/** 部署专用 headers — 在常规 auth headers 基础上追加 wrangler UA */
function getDeployHeaders(account) {
    return { ...(0, cfFactory_1.getAuthHeaders)(account), 'User-Agent': WRANGLER_UA };
}
//# sourceMappingURL=headers.js.map