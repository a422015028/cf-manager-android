"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
function getKey() {
    if (!config_1.config.encryptionKey) {
        console.warn('[Encryption] ENCRYPTION_KEY not set, using default key. This is insecure for production!');
    }
    // 支持两种格式：
    // 1. 64位 hex 字符串（如 openssl rand -hex 32 生成）
    // 2. 任意长度字符串（自动 SHA-256 哈希为 32 字节）
    const key = config_1.config.encryptionKey;
    if (/^[0-9a-fA-F]{64}$/.test(key)) {
        return Buffer.from(key, 'hex');
    }
    // 对非 hex 格式的密钥，使用 SHA-256 哈希
    return crypto_1.default.createHash('sha256').update(key).digest();
}
function encrypt(text) {
    const key = getKey();
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}
function decrypt(encryptedText) {
    const key = getKey();
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
//# sourceMappingURL=encryptionService.js.map