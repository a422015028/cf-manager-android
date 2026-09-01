"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preflightDeploy = exports.deployTemplate = void 0;
/**
 * catalogDeploy.ts — 部署逻辑已迁移到 deploy/ 子模块。
 * 此文件仅保留 re-export 以维持向后兼容。
 */
var deploy_1 = require("./deploy");
Object.defineProperty(exports, "deployTemplate", { enumerable: true, get: function () { return deploy_1.deployTemplate; } });
Object.defineProperty(exports, "preflightDeploy", { enumerable: true, get: function () { return deploy_1.preflightDeploy; } });
//# sourceMappingURL=catalogDeploy.js.map