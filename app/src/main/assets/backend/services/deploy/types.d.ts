export type CfModuleType = 'esm' | 'commonjs' | 'compiled-wasm' | 'text' | 'buffer';
export interface CfModule {
    name: string;
    content: string | Uint8Array;
    type: CfModuleType;
}
export interface CfWorkerSourceMap {
    name: string;
    content: string | Uint8Array;
}
export interface Migration {
    tag: string;
    new_classes?: string[];
    renamed_classes?: Array<{
        from: string;
        to: string;
    }>;
    deleted_classes?: string[];
}
export interface Placement {
    mode: 'smart' | 'off';
}
export interface TailConsumer {
    service: string;
    environment?: string;
}
export interface Limits {
    cpu_ms?: number;
    memory_mb?: number;
}
export interface AssetsUpload {
    jwt: string;
    config?: {
        html_handling?: string;
        not_found_handling?: string;
        run_worker_first?: string[];
    };
}
export interface Observability {
    enabled: boolean;
    traces?: {
        enabled: boolean;
        persist?: boolean;
        head_sampling_rate?: number;
    };
    logs?: {
        enabled: boolean;
        persist?: boolean;
        invocation_logs?: boolean;
        head_sampling_rate?: number;
    };
}
export interface CfWorkerInit {
    name: string;
    main: CfModule;
    modules: CfModule[];
    sourceMaps: CfWorkerSourceMap[];
    compatibility_date: string;
    compatibility_flags: string[];
    migrations: Migration[] | undefined;
    keepVars: boolean;
    keepSecrets: boolean;
    keepBindings: boolean;
    placement: Placement | undefined;
    tail_consumers: TailConsumer[];
    limits: Limits | undefined;
    logpush: boolean | undefined;
    assets: AssetsUpload | undefined;
    observability: Observability | undefined;
}
export interface PreflightParams {
    templateId: string;
    accountId: number;
    name: string;
    bindingSelections: Record<string, {
        mode: 'auto' | 'existing';
        existingId?: string;
    }>;
    secretValues: Record<string, string>;
    deployType?: 'worker' | 'pages' | 'both';
}
export interface ConfigDiff {
    added: Array<{
        type: string;
        name: string;
    }>;
    removed: Array<{
        type: string;
        name: string;
    }>;
    modified: Array<{
        type: string;
        name: string;
    }>;
}
export interface PreflightResult {
    workerExists: boolean;
    deployPath: 'versions-api' | 'legacy-put';
    configDiff?: ConfigDiff;
    secretsOverride: string[];
    warnings: string[];
    canProceed: boolean;
}
export interface DeployParams extends PreflightParams {
    skipPreflight?: boolean;
    traces?: boolean;
    logs?: boolean;
}
export interface ResolvedBinding {
    type: string;
    name: string;
    cfBinding: Record<string, unknown>;
    created: boolean;
    resourceType?: 'kv' | 'd1' | 'r2';
    resourceId?: string;
}
export interface DeployResult {
    success: boolean;
    error?: string;
    warnings: string[];
    url?: string;
    bindings: ResolvedBinding[];
    rolledBack?: boolean;
    rollbackErrors?: string[];
    accountName?: string;
    accountId?: string;
}
//# sourceMappingURL=types.d.ts.map