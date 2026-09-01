export interface CatalogSource {
    id: number;
    url: string;
    name: string;
    is_default: number;
    enabled: number;
    last_synced: string | null;
    last_status: string;
    last_error: string | null;
    etag: string | null;
    created_at: string;
}
export declare function getCatalogSources(): CatalogSource[];
export declare function getEnabledCatalogSources(): CatalogSource[];
export declare function getCatalogSourceById(id: number): CatalogSource | undefined;
export declare function getDefaultCatalogSource(): CatalogSource | undefined;
export declare function createCatalogSource(data: {
    url: string;
    name: string;
    is_default?: number;
}): number;
export declare function updateCatalogSource(id: number, data: Partial<CatalogSource>): void;
export declare function deleteCatalogSource(id: number): void;
export declare function ensureDefaultCatalogSource(url: string, name: string): void;
//# sourceMappingURL=catalogSource.d.ts.map