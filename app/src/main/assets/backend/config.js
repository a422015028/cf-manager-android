"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const path_1 = __importDefault(require("path"));
// Load .env from project root so encryption key stays stable across restarts
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)({ path: path_1.default.join(__dirname, '..', '..', '.env') });
exports.config = {
    port: parseInt(process.env.PORT || '3001', 10),
    encryptionKey: process.env.ENCRYPTION_KEY || 'feiyu',
    apiSecret: process.env.API_SECRET || '',
    dbPath: process.env.DB_PATH || path_1.default.join(__dirname, '..', 'data', 'cf-manager.db'),
    proxyUrl: process.env.PROXY_URL || '',
    demoAccountIds: process.env.DEMO_ACCOUNT_IDS || '',
    logDir: process.env.LOG_DIR || path_1.default.join(__dirname, '..', '..', 'data', 'logs'),
    workerDeployUrlAllowlist: process.env.WORKER_DEPLOY_URL_ALLOWLIST || '',
};
//# sourceMappingURL=config.js.map