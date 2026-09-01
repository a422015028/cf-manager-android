export declare function estimateNeurons(model: string, promptTokens: number, completionTokens: number, cachedTokens?: number): number;
/** 图片生成模型的神经元消耗估算（按每张图片计费） */
export declare function estimateImageNeurons(model: string): number;
/** TTS 模型的神经元消耗估算（按字符数计费） */
export declare function estimateTtsNeurons(text: string, model: string): number;
/** 翻译模型的神经元消耗估算（按字符数计费） */
export declare function estimateTranslationNeurons(text: string, model: string): number;
//# sourceMappingURL=pricing.d.ts.map