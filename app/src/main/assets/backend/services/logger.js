"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appLogger = exports.apiLogger = exports.v1Logger = void 0;
const winston_1 = __importDefault(require("winston"));
const winston_daily_rotate_file_1 = __importDefault(require("winston-daily-rotate-file"));
const config_1 = require("../config");
const logDir = config_1.config.logDir;
function createLogger(filename) {
    const fileTransport = new winston_daily_rotate_file_1.default({
        dirname: logDir,
        filename: `${filename}-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '7d',
        zippedArchive: false,
    });
    return winston_1.default.createLogger({
        level: 'info',
        format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.printf(({ timestamp, message }) => `${timestamp} ${message}`)),
        transports: [
            fileTransport,
            new winston_1.default.transports.Console({
                format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'HH:mm:ss' }), winston_1.default.format.printf(({ timestamp, message }) => `${timestamp} ${message}`)),
            }),
        ],
    });
}
exports.v1Logger = createLogger('v1');
exports.apiLogger = createLogger('api');
exports.appLogger = createLogger('app');
//# sourceMappingURL=logger.js.map