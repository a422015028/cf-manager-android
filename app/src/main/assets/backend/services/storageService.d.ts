import { Account } from '../models/account';
export declare function createKvNamespace(account: Account, title: string): Promise<any>;
export declare function deleteKvNamespace(account: Account, namespaceId: string): Promise<void>;
export declare function listKvKeys(account: Account, namespaceId: string, options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
}): Promise<{
    keys: any[];
    cursor?: string;
}>;
export declare function getKvValue(account: Account, namespaceId: string, key: string): Promise<{
    value: string;
    metadata: any;
}>;
export declare function putKvValue(account: Account, namespaceId: string, key: string, value: string, options?: {
    expiration?: number;
    expiration_ttl?: number;
    metadata?: any;
}): Promise<void>;
export declare function deleteKvKey(account: Account, namespaceId: string, key: string): Promise<void>;
export declare function bulkDeleteKvKeys(account: Account, namespaceId: string, keys: string[]): Promise<void>;
export declare function listD1Tables(account: Account, databaseId: string): Promise<any[]>;
export declare function getD1TableSchema(account: Account, databaseId: string, tableName: string): Promise<any[]>;
export declare function executeD1Query(account: Account, databaseId: string, sql: string): Promise<any>;
export declare function createD1Database(account: Account, name: string): Promise<any>;
export declare function deleteD1Database(account: Account, databaseId: string): Promise<void>;
export declare function createR2Bucket(account: Account, name: string): Promise<any>;
export declare function deleteR2Bucket(account: Account, name: string): Promise<void>;
export declare function listR2Objects(account: Account, bucketName: string, options?: {
    prefix?: string;
    delimiter?: string;
    cursor?: string;
    limit?: number;
}): Promise<{
    objects: any[];
    delimited_prefixes: string[];
    cursor?: string;
}>;
export declare function getR2Object(account: Account, bucketName: string, key: string): Promise<Response>;
export declare function putR2Object(account: Account, bucketName: string, key: string, body: Buffer, contentType?: string): Promise<void>;
export declare function deleteR2Object(account: Account, bucketName: string, key: string): Promise<void>;
export declare function bulkDeleteR2Objects(account: Account, bucketName: string, keys: string[]): Promise<void>;
//# sourceMappingURL=storageService.d.ts.map