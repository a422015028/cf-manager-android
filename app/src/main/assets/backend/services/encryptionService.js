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
// 与 worker（Web Crypto）对齐：IV 固定 12 字节，GCM tag（16 字节）内联于密文末尾。
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
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
// 统一线格式（与 worker 对齐）：ivHex:encHex，其中 enc = ciphertext + GCM tag（内联），IV 12 字节。
function encrypt(text) {
    const key = getKey();
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // 将 tag 内联到密文末尾，使其与 Web Crypto 输出完全一致
    const combined = Buffer.concat([encrypted, tag]);
    return iv.toString('hex') + ':' + combined.toString('hex');
}
function decrypt(encryptedText) {
    const key = getKey();
    const parts = encryptedText.split(':');
    // 兼容旧格式（iv:tag:enc，16 字节 IV + 独立 tag；旧 backend 历史数据）
    if (parts.length === 3) {
        return decryptLegacy(parts, key);
    }
    if (parts.length !== 2) {
        throw new Error('[Encryption] invalid ciphertext format');
    }
    const iv = Buffer.from(parts[0], 'hex');
    const combined = Buffer.from(parts[1], 'hex');
    const tag = combined.subarray(combined.length - TAG_LENGTH);
    const encrypted = combined.subarray(0, combined.length - TAG_LENGTH);
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}
// 旧 backend 格式解密（16 字节 IV + 独立 tag），用于平滑读取历史数据，无需一次性迁移。
function decryptLegacy(parts, key) {
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}
//# sourceMappingURL=encryptionService.js.map