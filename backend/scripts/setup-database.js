const { closeDatabase, initializeDatabase, queryAll, runSql } = require('../config/database');

console.log('Setting up CloudCostGuard database...');

function redactSetting(key, value) {
    if (key === 'aws_access_key_id' || key === 'aws_secret_access_key') {
        return '[redacted]';
    }

    return value;
}

async function setup() {
    try {
        await initializeDatabase();
        console.log('Database setup complete!');
        console.log('Database file: cloudcostguard.db');

        // Verify tables
        const tables = queryAll(`
            SELECT name FROM sqlite_master WHERE type='table'
        `);

        console.log('Created tables:', tables.map(t => t.name).join(', '));

        // Check settings
        const settings = queryAll('SELECT * FROM settings');
        console.log('Default settings:');
        for (const s of settings) {
            console.log(`  ${s.key}: ${redactSetting(s.key, s.value)}`);
        }

        console.log('\nDatabase ready!');
        closeDatabase();
        process.exitCode = 0;
    } catch (error) {
        console.error('Database setup failed:', error);
        closeDatabase();
        process.exitCode = 1;
    }
}

setup();
