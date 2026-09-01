import { Account } from '../../models/account';
export interface DeployPageFile {
    path: string;
    buffer: Buffer;
}
export interface DeployPagesOptions {
    skipCreateProject?: boolean;
    productionBranch?: string;
    branch?: string;
    commitMessage?: string;
    commitHash?: string;
    commitDirty?: boolean | string;
    deploymentConfigs?: any;
}
export declare function deployPages(account: Account, name: string, files: DeployPageFile[], opts?: DeployPagesOptions): Promise<any>;
//# sourceMappingURL=pagesDeploy.d.ts.map