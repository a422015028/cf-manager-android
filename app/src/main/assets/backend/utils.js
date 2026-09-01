"use strict";
/**
 * Utility functions shared across backend services.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeRandomUUID = safeRandomUUID;
/**
 * Polyfill for crypto.randomUUID() for Node < 19.
 * Generates a UUID v4 string.
 */
function safeRandomUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback: generate UUID v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
//# sourceMappingURL=utils.js.map