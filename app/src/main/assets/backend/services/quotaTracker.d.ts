export type ResourceType = 'workers_requests' | 'ai_neurons' | 'browser_render_seconds';
export declare function trackUsage(accountId: number, resource: ResourceType, amount?: number): void;
export declare function syncUsageFromCloudflare(): Promise<void>;
export declare function getQuotaSummary(): {
    accountId: number;
    accountName: string;
    resources: {
        resource: ResourceType;
        count: number;
        limit: number;
        remaining: number;
        exhausted: boolean;
    }[];
}[];
export declare function getAccountQuota(accountId: number, resource: ResourceType): {
    used: number;
    remaining: number;
};
//# sourceMappingURL=quotaTracker.d.ts.map