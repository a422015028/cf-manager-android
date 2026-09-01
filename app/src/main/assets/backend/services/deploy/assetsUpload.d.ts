import { Account } from '../../models/account';
/**
 * Worker 静态资源三阶段上传（与 wrangler 同款）：
 *   1) POST .../assets-upload-session 提交 manifest → 返回 { jwt, buckets }
 *      - buckets 非空：jwt 是 upload token，需按 buckets 分批上传缺失文件
 *      - buckets 为空：所有资源已存在，jwt 直接就是 completion token，跳过阶段 2
 *   2) POST .../workers/assets/upload?base64=true 按 bucket 分批 multipart 上传（field=hash, value=base64）
 *   3) 返回 completion jwt，挂到 metadata.assets.jwt
 */
export declare function deployWorkerAssets(account: Account, scriptName: string, files: Array<{
    path: string;
    buffer: Buffer;
}>): Promise<{
    jwt: string;
}>;
//# sourceMappingURL=assetsUpload.d.ts.map