import { Account } from '../../models/account';
import type { CatalogTemplate } from '../catalogValidator';
import type { PreflightParams, PreflightResult } from './types';
/**
 * 预检验证 — 在实际部署前检查 Worker 存在性、配置差异、Secrets 覆盖。
 *
 * 流程：
 * 1. 本地验证：Worker 名称格式、compatibility_date 存在性
 * 2. API 验证：GET worker services 检查存在性，下载远程配置做 Diff
 * 3. 选择上传路径：Versions API vs 传统 PUT
 * 4. Secrets 覆盖检查
 */
export declare function preflight(account: Account, template: CatalogTemplate, params: PreflightParams): Promise<PreflightResult>;
//# sourceMappingURL=preflight.d.ts.map