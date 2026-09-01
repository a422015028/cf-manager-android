"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.initDb = initDb;
exports.initDbAsync = initDbAsync;
exports.getSetting = getSetting;
exports.setSetting = setSetting;
exports.saveDbToDisk = saveDbToDisk;

const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("./config");

let db = null;
let dbReady = false;
let initPromise = null;
let SQL = null;

// Auto-save debounce
let saveTimeout = null;
const SAVE_DEBOUNCE_MS = 2000;

function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveDbToDisk();
    }, SAVE_DEBOUNCE_MS);
}

function saveDbToDisk() {
    if (!db || !SQL) return;
    try {
        const data = db._raw.export();
        const buffer = Buffer.from(data);
        const dir = path_1.default.dirname(config_1.config.dbPath);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        fs_1.default.writeFileSync(config_1.config.dbPath, buffer);
        console.log('[sql.js] Database saved to disk');
    } catch (e) {
        console.error('[sql.js] Failed to save database:', e.message);
    }
}

async function loadSqlJs() {
    if (SQL) return SQL;
    console.log('[sql.js] Loading sql.js...');
    try {
        const initSqlJs = require('sql.js');
        
        // Find the wasm file location
        const sqlJsPath = require.resolve('sql.js');
        const sqlJsDir = path_1.default.dirname(sqlJsPath);
        
        console.log('[sql.js] sql.js path:', sqlJsPath);
        
        SQL = await initSqlJs({
            locateFile: file => {
                return path_1.default.join(sqlJsDir, file);
            }
        });
        console.log('[sql.js] Loaded successfully');
        return SQL;
    } catch (e) {
        console.error('[sql.js] Failed to load sql.js:', e.message);
        console.error('[sql.js] Error stack:', e.stack);
        throw e;
    }
}

// Wrap sql.js statement to be compatible with better-sqlite3 API
function wrapStatement(stmt) {
    const wrapped = {
        _stmt: stmt,
        
        run: function(...params) {
            stmt.reset();
            if (params.length > 0) {
                stmt.bind(params);
            }
            stmt.step();
            
            // Get last insert rowid
            let lastInsertRowid = null;
            let changes = 0;
            try {
                const res = db._raw.exec('SELECT last_insert_rowid() as id, changes() as ch');
                if (res.length > 0 && res[0].values.length > 0) {
                    lastInsertRowid = res[0].values[0][0];
                    changes = res[0].values[0][1];
                }
            } catch (e) {}
            
            scheduleSave();
            return { lastInsertRowid, changes };
        },
        
        get: function(...params) {
            stmt.reset();
            if (params.length > 0) {
                stmt.bind(params);
            }
            let result = undefined;
            if (stmt.step()) {
                result = stmt.getAsObject();
            }
            return result;
        },
        
        all: function(...params) {
            stmt.reset();
            if (params.length > 0) {
                stmt.bind(params);
            }
            const rows = [];
            while (stmt.step()) {
                rows.push(stmt.getAsObject());
            }
            return rows;
        },
        
        // For iterate support
        [Symbol.iterator]: function*() {
            stmt.reset();
            while (stmt.step()) {
                yield stmt.getAsObject();
            }
        }
    };
    return wrapped;
}

// Wrap sql.js database to be compatible with better-sqlite3 API
function wrapDatabase(sqlDb) {
    const wrapped = {
        _db: sqlDb,
        
        prepare: function(sql) {
            const stmt = sqlDb.prepare(sql);
            return wrapStatement(stmt);
        },
        
        exec: function(sql) {
            sqlDb.exec(sql);
            scheduleSave();
            return this;
        },
        
        run: function(sql, ...params) {
            const stmt = this.prepare(sql);
            return stmt.run(...params);
        },
        
        get: function(sql, ...params) {
            const stmt = this.prepare(sql);
            return stmt.get(...params);
        },
        
        all: function(sql, ...params) {
            const stmt = this.prepare(sql);
            return stmt.all(...params);
        },
        
        pragma: function(source, options) {
            // sql.js doesn't have pragma method, use exec
            if (options && options.simple) {
                const result = sqlDb.exec(`PRAGMA ${source}`);
                if (result.length > 0 && result[0].values.length > 0) {
                    return result[0].values[0][0];
                }
                return null;
            }
            sqlDb.exec(`PRAGMA ${source}`);
            return [];
        },
        
        function: function(name, options, fn) {
            // Not fully supported, just a stub
            console.warn('[sql.js] db.function() not fully supported:', name);
        },
        
        aggregate: function(name, options) {
            console.warn('[sql.js] db.aggregate() not supported:', name);
        },
        
        close: function() {
            sqlDb.close();
        },
        
        // Export the raw db for internal use
        _raw: sqlDb
    };
    return wrapped;
}

async function initDbAsync() {
    if (initPromise) return initPromise;
    
    initPromise = (async () => {
        console.log('[sql.js] Initializing database...');
        const sql = await loadSqlJs();
        
        const dir = path_1.default.dirname(config_1.config.dbPath);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        
        let sqlDb;
        // Load existing database or create new
        if (fs_1.default.existsSync(config_1.config.dbPath)) {
            try {
                const fileBuffer = fs_1.default.readFileSync(config_1.config.dbPath);
                sqlDb = new sql.Database(fileBuffer);
                console.log('[sql.js] Database loaded from disk');
            } catch (e) {
                console.warn('[sql.js] Failed to load database, creating new:', e.message);
                sqlDb = new sql.Database();
            }
        } else {
            sqlDb = new sql.Database();
            console.log('[sql.js] New database created');
        }
        
        // Enable foreign keys
        sqlDb.run('PRAGMA foreign_keys = ON');
        
        // Wrap for better-sqlite3 compatibility
        db = wrapDatabase(sqlDb);
        
        // Initialize tables (same as better-sqlite3 version)
        initTables();
        
        dbReady = true;
        console.log('[sql.js] Database initialized successfully');
        return db;
    })();
    
    return initPromise;
}

function initDb() {
    // Sync wrapper - for backward compatibility
    // Tables are initialized in initDbAsync()
    if (!dbReady) {
        console.warn('[sql.js] Database not ready yet. Call initDbAsync() first.');
    }
}

function initTables() {
    console.log('[sql.js] Initializing tables...');
    db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      auth_type   TEXT NOT NULL CHECK(auth_type IN ('token', 'global_key')),
      api_token   TEXT,
      api_key     TEXT,
      email       TEXT,
      account_id  TEXT,
      is_active   INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quota_usage (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
      resource    TEXT NOT NULL,
      date        DATE NOT NULL,
      count       INTEGER DEFAULT 0,
      optimistic  INTEGER DEFAULT 0,
      exhausted   INTEGER DEFAULT 0,
      UNIQUE(account_id, resource, date)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      action      TEXT NOT NULL,
      target      TEXT,
      detail      TEXT,
      status      TEXT NOT NULL CHECK(status IN ('success', 'error')),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      cron        TEXT NOT NULL,
      config      TEXT,
      enabled     INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS task_executions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      status      TEXT NOT NULL CHECK(status IN ('running', 'success', 'error')),
      detail      TEXT,
      started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS catalog_sources (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      url           TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      is_default    INTEGER DEFAULT 0,
      enabled       INTEGER DEFAULT 1,
      last_synced   DATETIME,
      last_status   TEXT DEFAULT 'pending',
      last_error    TEXT,
      etag          TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
    // Column migrations
    try {
        const cols = db.prepare("PRAGMA table_info('accounts')").all();
        if (!cols.find(c => c.name === 'enabled_features')) {
            db.exec("ALTER TABLE accounts ADD COLUMN enabled_features TEXT DEFAULT 'ai,workers,browser_render,dns,storage'");
        }
        if (!cols.find(c => c.name === 'password')) {
            db.exec("ALTER TABLE accounts ADD COLUMN password TEXT");
        }
        if (!cols.find(c => c.name === 'available_features')) {
            db.exec("ALTER TABLE accounts ADD COLUMN available_features TEXT DEFAULT ''");
        }
        if (!cols.find(c => c.name === 'proxy_url')) {
            db.exec("ALTER TABLE accounts ADD COLUMN proxy_url TEXT DEFAULT ''");
        }
        if (!cols.find(c => c.name === 'proxy_enabled')) {
            db.exec("ALTER TABLE accounts ADD COLUMN proxy_enabled INTEGER DEFAULT 0");
        }
        // Migrate quota_usage
        const quotaCols = db.prepare("PRAGMA table_info('quota_usage')").all();
        if (!quotaCols.find(c => c.name === 'exhausted')) {
            db.exec("ALTER TABLE quota_usage ADD COLUMN exhausted INTEGER DEFAULT 0");
        }
        if (!quotaCols.find(c => c.name === 'optimistic')) {
            db.exec("ALTER TABLE quota_usage ADD COLUMN optimistic INTEGER DEFAULT 0");
        }
        console.log('[sql.js] Tables initialized successfully');
    } catch (e) {
        console.error('[sql.js] Error initializing tables:', e.message);
    }
}

function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDbAsync() first.');
    }
    return db;
}

// Settings helpers
function getSetting(key) {
    try {
        const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
        return row?.value;
    } catch (e) {
        console.warn('[sql.js] getSetting error:', e.message);
        return null;
    }
}

function setSetting(key, value) {
    try {
        db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
        scheduleSave();
    } catch (e) {
        console.warn('[sql.js] setSetting error:', e.message);
    }
}
