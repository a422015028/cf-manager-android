export interface QuotaUsage {
    id: number;
    account_id: number;
    resource: string;
    date: string;
    count: number;
    exhausted: number;
}
export declare function getQuotaByAccount(accountId: number, resource: string, date: string): QuotaUsage | undefined;
export declare function incrementQuota(accountId: number, resource: string, amount: number): void;
export declare function setQuota(accountId: number, resource: string, count: number): void;
export declare function getAllQuotaToday(): QuotaUsage[];
export declare function setExhausted(accountId: number, resource: string): void;
export declare function clearExhausted(accountId: number, resource: string): void;
export declare function getQuotaTodayByResource(resource: string): QuotaUsage[];
//# sourceMappingURL=quotaUsage.d.ts.map