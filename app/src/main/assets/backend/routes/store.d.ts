import { Catalog } from '../services/catalogValidator';
declare const DEFAULT_CATALOG_URL = "https://cf-store.surge.sh/catalog.json";
declare const DEFAULT_CATALOG_NAME = "\u5B98\u65B9\u6E90";
declare const router: import("express-serve-static-core").Router;
declare function refreshSource(source: any): Promise<Catalog | null>;
export default router;
export { refreshSource as refreshCatalogSource, DEFAULT_CATALOG_URL, DEFAULT_CATALOG_NAME };
//# sourceMappingURL=store.d.ts.map