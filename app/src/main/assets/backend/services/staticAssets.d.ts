export declare function extractZipFiles(zipBuffer: Buffer): Array<{
    path: string;
    buffer: Buffer;
}>;
export declare function getContentType(filename: string): string;
export declare function computeStaticAssetHash(buffer: Buffer, filePath: string): Promise<string>;
//# sourceMappingURL=staticAssets.d.ts.map