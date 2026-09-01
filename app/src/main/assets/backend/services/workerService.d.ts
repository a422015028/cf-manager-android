import { Account } from '../models/account';
import { ManualVarInput } from './bindings';
import { extractZipFiles } from './staticAssets';
export { extractZipFiles };
export declare function validatePagesProjectName(name: string): boolean;
export interface WorkerScript {
    id: string;
    name?: string;
    created_on: string;
    modified_on: string;
    etag: string;
    handlers: string[];
}
export interface DeployWorkerOptions {
    bindings?: Record<string, unknown>[];
    env?: Record<string, string>;
    compatibilityDate?: string;
    compatibilityFlags?: string[];
    enableSubdomain?: boolean;
    createDeployment?: boolean;
    deploymentAnnotation?: Record<string, string>;
}
export interface WorkerAssetsInput {
    source: {
        kind: string;
        url: string;
        assetName?: string;
        subPath?: string;
    };
    binding?: string;
    config?: {
        html_handling?: string;
        not_found_handling?: string;
    };
}
export declare function buildAssetsManifest(files: Array<{
    path: string;
    buffer: Buffer;
}>): Promise<Record<string, {
    hash: string;
    size: number;
}>>;
export interface DeployWorkerResult {
    script: any;
    subdomain?: string;
}
export interface PagesProject {
    id: string;
    name: string;
    domains: string[];
    production_branch: string;
    created_on: string;
    modified_on: string;
    deployment_count: number;
    source?: {
        type: string;
    };
}
export declare function listWorkers(account: Account): Promise<WorkerScript[]>;
export declare function listPages(account: Account): Promise<PagesProject[]>;
export declare function resolveMainModule(modules: Array<{
    path: string;
    buffer: Buffer;
}> | null, explicit?: string): string;
export declare function deployWorker(account: Account, name: string, scriptContent: string | Buffer, options?: DeployWorkerOptions & {
    packageZip?: Buffer;
    mainModule?: string;
    assets?: WorkerAssetsInput;
    assetsBuffer?: Buffer;
    traces?: boolean;
    logs?: boolean;
}): Promise<DeployWorkerResult>;
export declare function deployWorkerFromUrl(account: Account, name: string, url: string, options?: DeployWorkerOptions & {
    assets?: WorkerAssetsInput;
    assetsBuffer?: Buffer;
}): Promise<DeployWorkerResult>;
export declare function deleteWorker(account: Account, name: string): Promise<void>;
export declare function deletePagesProject(account: Account, name: string): Promise<void>;
export declare function getWorkerLogs(account: Account, name: string): Promise<any>;
export declare function listSecrets(account: Account, scriptName: string): Promise<any>;
export declare function updateSecret(account: Account, scriptName: string, secretName: string, type: string, text?: string, keyBase64?: string): Promise<any>;
export declare function deleteSecret(account: Account, scriptName: string, secretName: string): Promise<any>;
export declare function getSchedules(account: Account, scriptName: string): Promise<any>;
export declare function updateSchedules(account: Account, scriptName: string, crons: string[]): Promise<any>;
export declare function listDomains(account: Account, serviceName?: string): Promise<any[]>;
export declare function createDomain(account: Account, hostname: string, service: string, environment?: string): Promise<any>;
export declare function deleteDomain(account: Account, domainId: string): Promise<any>;
export declare function getSubdomain(account: Account, scriptName: string): Promise<any>;
export declare function setSubdomain(account: Account, scriptName: string, enabled: boolean): Promise<any>;
export declare function getScriptSettings(account: Account, scriptName: string): Promise<any>;
export declare function updateScriptSettings(account: Account, scriptName: string, settings: any): Promise<any>;
export declare function listRoutes(account: Account, zoneId: string): Promise<any[]>;
export declare function createRoute(account: Account, zoneId: string, pattern: string, script?: string): Promise<any>;
export declare function deleteRoute(account: Account, zoneId: string, routeId: string): Promise<any>;
export declare function getScriptContent(account: Account, scriptName: string): Promise<string>;
export declare function listDeployments(account: Account, scriptName: string): Promise<any>;
export declare function getPagesProject(account: Account, projectName: string): Promise<any>;
export declare function editPagesProject(account: Account, projectName: string, params: any): Promise<any>;
export declare function listPagesDomains(account: Account, projectName: string): Promise<any[]>;
export declare function addPagesDomain(account: Account, projectName: string, hostname: string): Promise<any>;
export declare function removePagesDomain(account: Account, projectName: string, hostname: string): Promise<any>;
export declare function listPagesDeployments(account: Account, projectName: string): Promise<any[]>;
export declare function deletePagesDeployment(account: Account, projectName: string, deploymentId: string): Promise<{
    success: boolean;
    error?: string;
}>;
/**
 * 批量删除 Pages 部署记录（受控并发，最多 3 条并行）
 */
export declare function batchDeletePagesDeployments(account: Account, projectName: string, ids: string[]): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
        id: string;
        success: boolean;
        error?: string;
    }>;
}>;
export declare function listKvNamespaces(account: Account): Promise<any[]>;
export declare function listD1Databases(account: Account): Promise<any[]>;
export declare function listR2Buckets(account: Account): Promise<any[]>;
export declare function updatePagesBindings(account: Account, projectName: string, deploymentConfigs: any): Promise<any>;
export interface WorkersUsage {
    requests: number;
    errors: number;
    subrequests: number;
    cpuTimeMs: number;
}
export declare function getWorkersUsageToday(account: Account): Promise<WorkersUsage>;
export declare function ensurePagesProject(account: Account, projectName: string): Promise<void>;
export interface WorkerConfigBinding {
    type: string;
    name: string;
    resourceName?: string;
    mode: 'existing';
    className?: string;
    scriptName?: string;
    service?: string;
    environment?: string;
    queueName?: string;
}
export interface WorkerConfigResult {
    vars: Array<{
        name: string;
        value: string | null;
        secret: boolean;
    }>;
    bindings: WorkerConfigBinding[];
}
export declare function getWorkerConfig(account: Account, name: string): Promise<WorkerConfigResult>;
export declare function getPagesConfig(account: Account, name: string): Promise<WorkerConfigResult>;
export declare function applyWorkerConfigDiff(account: Account, name: string, opts: {
    vars: ManualVarInput[];
    bindings: Record<string, unknown>[];
    scriptContent?: string;
    packageZip?: Buffer;
    mainModule?: string;
}): Promise<void>;
//# sourceMappingURL=workerService.d.ts.map