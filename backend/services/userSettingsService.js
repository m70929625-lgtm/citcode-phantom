const { queryAll, queryOne, runSql } = require('../config/database');

const DEFAULT_SETTINGS = {
    dry_run: 'true',
    anomaly_threshold: '0.5',
    metric_interval: '60000',
    aws_region: 'us-east-1',
    automation_level: 'ask',
    last_fetch: '',
    system_status: 'running'
};

const SENSITIVE_KEYS = new Set(['aws_access_key_id', 'aws_secret_access_key']);

function normalizeUserId(userId) {
    return userId || null;
}

function getGlobalSetting(key) {
    return queryOne('SELECT value FROM settings WHERE key = ?', [key])?.value;
}

function getUserSetting(userId, key, options = {}) {
    const resolvedUserId = normalizeUserId(userId);
    const allowGlobalFallback = options.allowGlobalFallback ?? !SENSITIVE_KEYS.has(key);

    if (resolvedUserId) {
        const userValue = queryOne('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [resolvedUserId, key])?.value;
        if (userValue !== undefined && userValue !== null) {
            return userValue;
        }
    }

    if (allowGlobalFallback) {
        const globalValue = getGlobalSetting(key);
        if (globalValue !== undefined && globalValue !== null) {
            return globalValue;
        }
    }

    return DEFAULT_SETTINGS[key] ?? null;
}

function setUserSetting(userId, key, value) {
    const resolvedUserId = normalizeUserId(userId);
    if (!resolvedUserId) {
        throw new Error('userId is required to save user setting');
    }

    runSql(
        `INSERT OR REPLACE INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)`,
        [resolvedUserId, key, String(value), new Date().toISOString()]
    );
}

function getUserSettingsMap(userId) {
    const resolvedUserId = normalizeUserId(userId);
    const map = { ...DEFAULT_SETTINGS };

    if (resolvedUserId) {
        const settings = queryAll('SELECT key, value FROM user_settings WHERE user_id = ?', [resolvedUserId]);
        for (const setting of settings) {
            map[setting.key] = setting.value;
        }
    }

    const globalFallbackKeys = ['system_status'];
    for (const key of globalFallbackKeys) {
        if (map[key] === undefined || map[key] === null) {
            const globalValue = getGlobalSetting(key);
            if (globalValue !== undefined && globalValue !== null) {
                map[key] = globalValue;
            }
        }
    }

    return map;
}

function getUsersWithAwsCredentials() {
    return queryAll(`
        SELECT
            u.id as user_id,
            u.email,
            access.value as access_key,
            secret.value as secret_key,
            region.value as aws_region
        FROM users u
        JOIN user_settings access ON access.user_id = u.id AND access.key = 'aws_access_key_id'
        JOIN user_settings secret ON secret.user_id = u.id AND secret.key = 'aws_secret_access_key'
        LEFT JOIN user_settings region ON region.user_id = u.id AND region.key = 'aws_region'
    `);
}

module.exports = {
    DEFAULT_SETTINGS,
    getUserSetting,
    setUserSetting,
    getUserSettingsMap,
    getUsersWithAwsCredentials
};
