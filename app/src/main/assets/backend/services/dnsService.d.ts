import { Account } from '../models/account';
export interface DnsRecord {
    id: string;
    type: string;
    name: string;
    content: string;
    ttl: number;
    proxied: boolean;
    priority?: number;
}
export declare function listDnsRecords(account: Account, zoneId: string): Promise<DnsRecord[]>;
export declare function createDnsRecord(account: Account, zoneId: string, data: Partial<DnsRecord>): Promise<DnsRecord>;
export declare function updateDnsRecord(account: Account, zoneId: string, recordId: string, data: Partial<DnsRecord>): Promise<DnsRecord>;
export declare function deleteDnsRecord(account: Account, zoneId: string, recordId: string): Promise<void>;
//# sourceMappingURL=dnsService.d.ts.map