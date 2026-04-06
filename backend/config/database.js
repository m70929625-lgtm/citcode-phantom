const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const cryptoService = require('../services/cryptoService');

const DB_PATH = path.join(__dirname, '..', 'cloudcostguard.db');

let db = null;
let SQL = null;
let initPromise = null;

function getTableColumns(tableName) {
    try {
        const result = db.exec(`PRAGMA table_info(${tableName})`);
        if (!result || result.length === 0) return [];
        const columns = result[0].values || [];
        return columns.map((row) => row[1]);
    } catch (error) {
        return [];
    }
}

function ensureColumnExists(tableName, columnName, columnType = 'TEXT') {
    const columns = getTableColumns(tableName);
    if (columns.includes(columnName)) {
        return;
    }

    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
}

function ensureUserScopedSchema() {
    const tableColumns = [
        ['metrics', 'user_id', 'TEXT'],
        ['anomalies', 'user_id', 'TEXT'],
        ['actions', 'user_id', 'TEXT'],
        ['alerts', 'user_id', 'TEXT'],
        ['cost_live_samples', 'user_id', 'TEXT']
    ];

    for (const [tableName, columnName, columnType] of tableColumns) {
        ensureColumnExists(tableName, columnName, columnType);
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, key),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run('CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_user_settings_key ON user_settings(key)');
    db.run('CREATE INDEX IF NOT EXISTS idx_metrics_user_id ON metrics(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_anomalies_user_id ON anomalies(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_actions_user_id ON actions(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_cost_live_samples_user_id ON cost_live_samples(user_id)');
}

function assignLegacyDataToFirstUser() {
    const firstUser = queryOne('SELECT id FROM users ORDER BY created_at ASC LIMIT 1');
    if (!firstUser?.id) {
        return;
    }

    const legacyTables = ['metrics', 'anomalies', 'actions', 'alerts', 'cost_live_samples'];
    for (const tableName of legacyTables) {
        db.run(`UPDATE ${tableName} SET user_id = ? WHERE user_id IS NULL`, [firstUser.id]);
    }

    const keysToMigrate = [
        'dry_run',
        'anomaly_threshold',
        'metric_interval',
        'aws_region',
        'automation_level',
        'last_fetch',
        'aws_access_key_id',
        'aws_secret_access_key'
    ];

    for (const key of keysToMigrate) {
        const globalSetting = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
        if (!globalSetting?.value) continue;

        db.run(
            `INSERT OR IGNORE INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)` ,
            [firstUser.id, key, globalSetting.value, new Date().toISOString()]
        );
    }
}

function encryptLegacyCredentialValues() {
    const sensitiveKeys = ['aws_access_key_id', 'aws_secret_access_key'];

    const userSettingRows = queryAll(
        `SELECT user_id, key, value FROM user_settings WHERE key IN (?, ?)` ,
        sensitiveKeys
    );

    for (const row of userSettingRows) {
        if (!row.value || row.value.startsWith('enc:v1:')) {
            continue;
        }

        db.run(
            'UPDATE user_settings SET value = ?, updated_at = ? WHERE user_id = ? AND key = ?',
            [cryptoService.encryptText(row.value), new Date().toISOString(), row.user_id, row.key]
        );
    }

    const globalRows = queryAll('SELECT key, value FROM settings WHERE key IN (?, ?)', sensitiveKeys);
    for (const row of globalRows) {
        if (!row.value || row.value.startsWith('enc:v1:')) {
            continue;
        }

        db.run(
            'UPDATE settings SET value = ?, updated_at = ? WHERE key = ?',
            [cryptoService.encryptText(row.value), new Date().toISOString(), row.key]
        );
    }
}

async function getDb() {
    if (db) return db;

    if (!initPromise) {
        initPromise = (async () => {
            SQL = await initSqlJs();

            try {
                if (fs.existsSync(DB_PATH)) {
                    const fileBuffer = fs.readFileSync(DB_PATH);
                    db = new SQL.Database(fileBuffer);
                } else {
                    db = new SQL.Database();
                }
            } catch (error) {
                console.error('Error loading database, creating new:', error);
                db = new SQL.Database();
            }
            return db;
        })();
    }

    return initPromise;
}

function queryAll(sql, params = []) {
    if (!db) return [];
    try {
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    } catch (error) {
        console.error('Query error:', error);
        return [];
    }
}

function queryOne(sql, params = []) {
    const results = queryAll(sql, params);
    return results[0] || null;
}

function runSql(sql, params = []) {
    if (!db) return { changes: 0 };
    try {
        db.run(sql, params);
        saveDatabase();
        return { changes: db.getRowsModified() };
    } catch (error) {
        console.error('Run error:', error);
        return { changes: 0, error: error.message };
    }
}

function saveDatabase() {
    if (db) {
        try {
            const data = db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(DB_PATH, buffer);
        } catch (error) {
            console.error('Error saving database:', error);
        }
    }
}

async function initializeDatabase() {
    await getDb();
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    const statements = schema.split(';').filter(s => s.trim());
    for (const statement of statements) {
        if (statement.trim()) {
            try {
                db.run(statement);
            } catch (error) {
                // Ignore errors from INSERT OR REPLACE on existing data
                if (
                    !error.message.includes('already exists') &&
                    !error.message.includes('UNIQUE constraint failed') &&
                    !error.message.includes('duplicate column name')
                ) {
                    console.error('Schema error:', error.message);
                }
            }
        }
    }

    ensureUserScopedSchema();
    assignLegacyDataToFirstUser();
    encryptLegacyCredentialValues();

    saveDatabase();
    console.log('Database initialized successfully');
    return db;
}

function closeDatabase() {
    if (db) {
        saveDatabase();
        db.close();
        db = null;
    }
}

module.exports = {
    getDb,
    initializeDatabase,
    closeDatabase,
    saveDatabase,
    queryAll,
    queryOne,
    runSql
};
