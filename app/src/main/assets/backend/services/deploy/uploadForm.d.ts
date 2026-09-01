import type { CfWorkerInit } from './types';
export interface MultipartBody {
    body: Buffer;
    contentType: string;
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
export declare function createWorkerUploadForm(worker: CfWorkerInit, bindings: Record<string, unknown>[] | undefined): MultipartBody;
//# sourceMappingURL=uploadForm.d.ts.map