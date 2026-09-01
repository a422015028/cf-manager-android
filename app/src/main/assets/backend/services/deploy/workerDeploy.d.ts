import { Account } from '../../models/account';
import type { CfWorkerInit } from './types';
export interface DeployWorkerOptions {
    bindings?: Record<string, unknown>[];
    enableSubdomain?: boolean;
    createDeployment?: boolean;
    traces?: boolean;
    logs?: boolean;
    assets?: {
        files: Array<{
            path: string;
            buffer: Buffer;
        }>;
        binding?: string;
        config?: {
            html_handling?: string;
            not_found_handling?: string;
            run_worker_first?: string[];
        };
    };
}
export interface DeployWorkerResult {
    script: any;
    subdomain?: string;
    versionId?: string;
}
/**
 * Worker 部署 — 对齐 wrangler 部署流程。
 *
 * 路径 A (Versions API): POST versions → POST deployments → PATCH settings
 * 路径 B (传统 PUT): PUT /scripts/{name}
 *
 * 两条路径的选择由调用方（preflight）决定，此处通过 useVersionsApi 参数传入。
 */
export declare function deployWorker(account: Account, name: string, scriptContent: string | Buffer | null, workerInit: Partial<CfWorkerInit>, options?: DeployWorkerOptions & {
    useVersionsApi?: boolean;
}): Promise<DeployWorkerResult>;
//# sourceMappingURL=workerDeploy.d.ts.map