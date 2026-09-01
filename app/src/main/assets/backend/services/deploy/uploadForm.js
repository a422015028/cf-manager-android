"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkerUploadForm = createWorkerUploadForm;
// 模块类型 → MIME 映射（对齐 wrangler moduleTypeMimeType）
const MODULE_MIME = {
    'esm': 'application/javascript+module',
    'commonjs': 'application/javascript',
    'compiled-wasm': 'application/wasm',
    'text': 'text/plain',
    'buffer': 'application/octet-stream',
};
// 将 string / Uint8Array / Buffer 安全转换为独立 Buffer（拷贝，不共享底层内存）
function toBuffer(content) {
    if (typeof content === 'string')
        return Buffer.from(content, 'utf-8');
    // 必须拷贝，避免 Buffer/Uint8Array 视图共享底层 ArrayBuffer 导致 content-length 不匹配
    const copy = Buffer.alloc(content.byteLength);
    copy.set(content);
    return copy;
}
/**
 * 手动构建 multipart/form-data body。
 *
 * 不使用 FormData + undici 自动序列化，因为 undici 在计算 multipart Content-Length 时
 * 可能与实际 body 不一致（尤其当 Blob 部分由 ArrayBuffer 支撑时），
 * 导致 Cloudflare API 返回截断响应 → UND_ERR_RES_CONTENT_LENGTH_MISMATCH。
 *
 * 手动构建可精确控制每个 part 的字节，Buffer.concat 后 Content-Length 完全确定。
 */
function createWorkerUploadForm(worker, bindings) {
    const boundary = '----formdata-cf-manager-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const parts = [];
    const CRLF = '\r\n';
    // 1. 构建 metadata
    const metadataBindings = bindings || [];
    const metadata = {
        main_module: worker.main.name,
        compatibility_date: worker.compatibility_date,
        bindings: metadataBindings,
    };
    // 仅在非空时发送 compatibility_flags（对标 wrangler：空数组不发送）
    if (worker.compatibility_flags?.length)
        metadata.compatibility_flags = worker.compatibility_flags;
    if (worker.migrations?.length)
        metadata.migrations = worker.migrations;
    if (worker.keepVars)
        metadata.keep_vars = true;
    if (worker.keepSecrets)
        metadata.keep_secrets = true;
    // keep_bindings: CF API 期望 []string（要保留的绑定类型列表），不是 boolean
    if (worker.keepBindings) {
        metadata.keep_bindings = [
            'kv_namespace', 'd1', 'r2_bucket',
            'service', 'queue', 'durable_object_namespace',
            'ai', 'assets', 'secret_text', 'plain_text',
        ];
    }
    if (worker.placement)
        metadata.placement = worker.placement;
    if (worker.tail_consumers?.length)
        metadata.tail_consumers = worker.tail_consumers;
    if (worker.limits)
        metadata.limits = worker.limits;
    if (worker.logpush !== undefined)
        metadata.logpush = worker.logpush;
    if (worker.assets)
        metadata.assets = worker.assets;
    if (worker.observability)
        metadata.observability = worker.observability;
    // 2. 添加 metadata part
    parts.push(Buffer.from(`--${boundary}${CRLF}`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="metadata"${CRLF}`));
    parts.push(Buffer.from(`Content-Type: application/json${CRLF}${CRLF}`));
    parts.push(Buffer.from(JSON.stringify(metadata), 'utf-8'));
    // 3. 添加主模块
    const mainContent = toBuffer(worker.main.content);
    parts.push(Buffer.from(`${CRLF}--${boundary}${CRLF}`));
    parts.push(Buffer.from(`Content-Disposition: form-data; name="${worker.main.name}"; filename="${worker.main.name}"${CRLF}`));
    parts.push(Buffer.from(`Content-Type: ${MODULE_MIME[worker.main.type]}${CRLF}${CRLF}`));
    parts.push(mainContent);
    // 4. 添加附加模块
    for (const mod of worker.modules) {
        const content = toBuffer(mod.content);
        parts.push(Buffer.from(`${CRLF}--${boundary}${CRLF}`));
        parts.push(Buffer.from(`Content-Disposition: form-data; name="${mod.name}"; filename="${mod.name}"${CRLF}`));
        parts.push(Buffer.from(`Content-Type: ${MODULE_MIME[mod.type]}${CRLF}${CRLF}`));
        parts.push(content);
    }
    // 5. 添加 source maps
    for (const sm of worker.sourceMaps) {
        const content = toBuffer(sm.content);
        parts.push(Buffer.from(`${CRLF}--${boundary}${CRLF}`));
        parts.push(Buffer.from(`Content-Disposition: form-data; name="${sm.name}"; filename="${sm.name}"${CRLF}`));
        parts.push(Buffer.from(`Content-Type: application/json${CRLF}${CRLF}`));
        parts.push(content);
    }
    // 6. 结束边界
    parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));
    const body = Buffer.concat(parts);
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
//# sourceMappingURL=uploadForm.js.map