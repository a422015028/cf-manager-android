import { Account } from '../models/account';
export interface ManualVarInput {
    name: string;
    value: string;
    secret: boolean;
    keep?: boolean;
}
export interface ManualBindingInput {
    type: 'kv' | 'd1' | 'r2' | 'ai' | 'durable_object' | 'service' | 'queue';
    name: string;
    resourceName?: string;
    mode?: 'auto' | 'existing';
    existingId?: string;
    className?: string;
    scriptName?: string;
    service?: string;
    environment?: string;
    queueName?: string;
}
export declare function isValidBindingName(name: string): boolean;
export declare function varsToBindings(vars: ManualVarInput[]): Record<string, unknown>[];
export declare function resolveManualBindings(account: Account, inputs: ManualBindingInput[]): Promise<Record<string, unknown>[]>;
export declare function buildPagesConfigsFromInput(vars: ManualVarInput[], resolved: Record<string, unknown>[]): {
    production: any;
    preview: any;
} | undefined;
//# sourceMappingURL=bindings.d.ts.map