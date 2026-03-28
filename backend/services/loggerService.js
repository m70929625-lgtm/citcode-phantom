const { queryAll, runSql } = require('../config/database');

let logBuffer = [];
const FLUSH_INTERVAL = 5000;

function formatMessage(level, category, message, details, resourceId, actionType) {
    return {
        timestamp: new Date().toISOString(),
        level,
        category,
        message,
        details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
        resourceId: resourceId || null,
        actionType: actionType || null
    };
}

function log(level, category, message, details = null, resourceId = null, actionType = null) {
    const entry = formatMessage(level, category, message, details, resourceId, actionType);
    logBuffer.push(entry);

    // Also log to console
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${category}]`;
    console.log(`${prefix} ${message}`, details || '');

    // Flush to database periodically
    if (logBuffer.length >= 10) {
        flush();
    }
}

function flush() {
    if (logBuffer.length === 0) return;

    try {
        const insertMany = logBuffer.map(entry => [
            entry.timestamp,
            entry.level,
            entry.category,
            entry.message,
            entry.details,
            entry.resourceId,
            entry.actionType
        ]);

        for (const params of insertMany) {
            runSql(`
                INSERT INTO audit_log (timestamp, level, category, message, details, resource_id, action_type)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, params);
        }

        logBuffer = [];
    } catch (error) {
        console.error('Failed to flush logs:', error);
    }
}

// Flush periodically
setInterval(flush, FLUSH_INTERVAL);

// Graceful shutdown
process.on('exit', flush);
process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });

module.exports = {
    log,
    flush,
    info: (category, message, details) => log('info', category, message, details),
    warn: (category, message, details) => log('warn', category, message, details),
    error: (category, message, details) => log('error', category, message, details),
    debug: (category, message, details) => {
        if (process.env.LOG_LEVEL === 'debug') {
            log('debug', category, message, details);
        }
    }
};
