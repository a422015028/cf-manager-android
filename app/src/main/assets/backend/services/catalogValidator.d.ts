export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export interface SourceConfig {
    kind: 'raw' | 'release' | 'repo-archive';
    url: string;
    assetName?: string;
    subPath?: string;
    size?: number;
    mainModule?: string;
}
export interface CatalogBinding {
    type: 'kv' | 'd1' | 'r2' | 'ai' | 'var' | 'durable_object' | 'service' | 'queue';
    name: string;
    title?: string;
    resourceName?: string;
    action?: 'create-or-reuse' | 'prompt';
    required?: boolean;
    secret?: boolean;
    value?: string;
    initSqlUrl?: string;
    initSql?: string;
    className?: string;
    scriptName?: string;
    environment?: string;
    service?: string;
    entrypoint?: string;
    queueName?: string;
    deliveryDelay?: number;
}
export interface CatalogTemplate {
    id: string;
    name: string;
    description?: string;
    author?: {
        name: string;
        url?: string;
    };
    version: string;
    tags?: string[];
    icon?: string;
    homepage?: string;
    readmeUrl?: string;
    type: 'worker' | 'pages' | 'hybrid';
    compatibility_date?: string;
    compatibility_flags?: string[];
    source?: SourceConfig;
    sources?: {
        worker?: SourceConfig;
        pages?: SourceConfig;
    };
    bindings?: CatalogBinding[];
    env?: Record<string, string>;
    routes?: string[];
    crons?: string[];
    assets?: {
        source: SourceConfig;
        binding?: string;
        config?: {
            html_handling?: string;
            not_found_handling?: string;
            run_worker_first?: string[];
        };
    };
    migrations?: Array<{
        tag: string;
        new_classes?: string[];
        renamed_classes?: Array<{
            from: string;
            to: string;
        }>;
        deleted_classes?: string[];
    }>;
    keep_vars?: boolean;
    keep_secrets?: boolean;
    keep_bindings?: boolean;
    placement?: {
        mode: 'smart' | 'off';
    };
    tail_consumers?: Array<{
        service: string;
        environment?: string;
    }>;
    limits?: {
        cpu_ms?: number;
        memory_mb?: number;
    };
    logpush?: boolean;
}
export interface Catalog {
    version: string;
    updated?: string;
    name?: string;
    defaultLanguage?: string;
    templates: CatalogTemplate[];
}
export declare function validateCatalog(raw: unknown): ValidationResult;
export declare function validateTemplate(raw: unknown): ValidationResult;
//# sourceMappingURL=catalogValidator.d.ts.map