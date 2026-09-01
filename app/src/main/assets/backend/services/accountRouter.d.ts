import { Account } from '../models/account';
import { ResourceType } from './quotaTracker';
interface Zone {
    id: string;
    name: string;
    status: string;
    account: {
        id: string;
        name: string;
    };
}
export declare function getAllZones(): Promise<Array<Zone & {
    cfAccountId: number;
    accountName: string;
}>>;
export declare function findAccountByDomain(domain: string): Promise<{
    account: Account;
    zoneId: string;
}>;
export declare function selectBestAccount(resource: ResourceType, excludeIds?: Set<number>, model?: string): Promise<Account | null>;
export declare function invalidateAiCache(): void;
export declare function updateAiCacheAfterUsage(accountId: number, neurons: number): void;
export declare function removeAccountFromAiCache(accountId: number): void;
export declare function clearCache(resource?: ResourceType): void;
export {};
//# sourceMappingURL=accountRouter.d.ts.map