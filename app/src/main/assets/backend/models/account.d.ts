export type AccountFeature = 'ai' | 'workers' | 'browser_render' | 'dns' | 'storage';
export declare const ALL_FEATURES: AccountFeature[];
export interface Account {
    id: number;
    name: string;
    auth_type: 'token' | 'global_key';
    api_token: string | null;
    api_key: string | null;
    email: string | null;
    account_id: string | null;
    is_active: number;
    enabled_features: string;
    created_at: string;
    updated_at: string;
    password: string | null;
    available_features: string;
    proxy_url: string;
    proxy_enabled: number;
}
export interface AccountInput {
    name: string;
    auth_type: 'token' | 'global_key';
    api_token?: string | null;
    api_key?: string | null;
    email?: string | null;
    account_id?: string;
    enabled_features?: string;
    password?: string;
    available_features?: string;
    proxy_url?: string;
    proxy_enabled?: number;
}
export declare function hasFeature(account: Account, feature: AccountFeature): boolean;
export declare function getActiveAccountsByFeature(feature: AccountFeature): Account[];
export declare function getAllAccounts(): Account[];
export type AccountListFilter = 'all' | 'active' | 'unverified';
export interface PagedAccounts {
    accounts: Account[];
    total: number;
    counts: {
        all: number;
        active: number;
        unverified: number;
    };
}
/**
 * 分页查询账户，支持按 active/unverified 筛选 + 按名称/邮箱模糊搜索
 */
export declare function listAccountsPaged(opts: {
    page: number;
    pageSize: number;
    filter?: AccountListFilter;
    search?: string;
}): PagedAccounts;
export declare function getActiveAccounts(): Account[];
export declare function getAccountById(id: number): Account | undefined;
export declare function createAccount(input: AccountInput): number;
export declare function updateAccount(id: number, input: Partial<AccountInput>): void;
export declare function updateAccountFeatures(id: number, features: string): void;
export declare function deleteAccount(id: number): void;
export declare function updateAccountStatus(id: number, isActive: boolean): void;
export declare function updateAccountId(id: number, accountId: string): void;
export declare function getAccountByEmail(email: string): Account | undefined;
/**
 * 从邮箱中提取账户名：
 * - lauren.bailey2701@maildrop.cc -> bailey2701
 * - laurenbailey2701@maildrop.cc -> laurenbailey2701
 * - lauren.b.bailey2701@maildrop.cc -> bailey2701 (取最后一段)
 */
export declare function nameFromEmail(email: string): string;
//# sourceMappingURL=account.d.ts.map