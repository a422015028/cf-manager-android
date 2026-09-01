/**
 * Deploy Service 统一入口 — 编排 preflight + workerDeploy + pagesDeploy + triggers + rollback。
 *
 * 从 catalogDeploy.ts 迁移而来，改用 deploy/ 子模块替代直接调用 workerService。
 * Binding 解析逻辑也迁移至此，避免循环依赖。
 */
import { Account } from '../../models/account';
import type { CatalogTemplate } from '../catalogValidator';
import type { PreflightResult, DeployResult } from './types';
export interface DeployOptions {
    account: Account;
    template: CatalogTemplate;
    name: string;
    bindingSelections: Record<string, {
        mode: 'auto' | 'existing';
        existingId?: string;
        runInitSql?: boolean;
    }>;
    secretValues: Record<string, string>;
    deployType?: 'worker' | 'pages' | 'both';
    traces?: boolean;
    logs?: boolean;
}
export declare function preflightDeploy(opts: {
    account: Account;
    template: CatalogTemplate;
    name: string;
    bindingSelections: Record<string, {
        mode: 'auto' | 'existing';
        existingId?: string;
    }>;
    secretValues: Record<string, string>;
    deployType?: 'worker' | 'pages' | 'both';
}): Promise<PreflightResult>;
export declare function deployTemplate(opts: DeployOptions): Promise<DeployResult>;
//# sourceMappingURL=index.d.ts.map