const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'cloudcostguard.db');

let db = null;
let SQL = null;
let initPromise = null;

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
                if (!error.message.includes('already exists') && !error.message.includes('UNIQUE constraint failed')) {
                    console.error('Schema error:', error.message);
                }
            }
        }
    }

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
