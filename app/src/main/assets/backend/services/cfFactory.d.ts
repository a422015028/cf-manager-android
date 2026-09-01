import Cloudflare from 'cloudflare';
import { Account } from '../models/account';
export declare function getAuthHeaders(account: Account): Record<string, string>;
export declare function getCfClient(account: Account): Cloudflare;
export declare function clearClientCache(): void;
//# sourceMappingURL=cfFactory.d.ts.map