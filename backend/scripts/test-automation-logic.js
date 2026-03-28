const { initializeDatabase, runSql, queryAll, queryOne, closeDatabase } = require('../config/database');
const mlService = require('../services/mlService');
const metricCollector = require('../services/metricCollector');
const automationService = require('../services/automationService');
const alertService = require('../services/alertService');

async function test() {
    console.log('--- STARTING AUTOMATION TEST ---');
    
    try {
        await initializeDatabase();
        
        // 1. Setup Environment
        runSql("DELETE FROM metrics");
        runSql("DELETE FROM anomalies");
        runSql("DELETE FROM actions");
        runSql("DELETE FROM alerts");
        
        // Ensure dry run is ON and automation is 'auto' (though our new logic overrides automation level)
        runSql("INSERT OR REPLACE INTO settings (key, value) VALUES ('dry_run', 'true')");
        runSql("INSERT OR REPLACE INTO settings (key, value) VALUES ('automation_level', 'auto')");
        automationService.initialize();

        const timestamp = new Date().toISOString();
        
        // 2. Insert Mock Metrics for Resource A (Standard Idle EC2)
        // This should be AUTO-EXECUTED
        const resourceA = { id: 'i-normal-idle', name: 'Dev-Web-Server', type: 'EC2' };
        console.log(`\nInserting metrics for ${resourceA.name}...`);
        
        const metricsA = [
            [timestamp, resourceA.id, resourceA.type, resourceA.name, 'cpu_utilization', 2.5, 'percent'],
            [timestamp, resourceA.id, resourceA.type, resourceA.name, 'network_in', 500, 'bytes'],
            [timestamp, resourceA.id, resourceA.type, resourceA.name, 'network_out', 300, 'bytes']
        ];
        
        for (const m of metricsA) {
            runSql(`INSERT INTO metrics (timestamp, resource_id, resource_type, resource_name, metric_type, value, unit) VALUES (?, ?, ?, ?, ?, ?, ?)`, m);
        }

        // 3. Insert Mock Metrics for Resource B (Crucial Production DB)
        // This should stay PENDING (requires permission)
        const resourceB = { id: 'i-crucial-db', name: 'Production-DB-Primary', type: 'EC2' };
        console.log(`Inserting metrics for ${resourceB.name}...`);
        
        const metricsB = [
            [timestamp, resourceB.id, resourceB.type, resourceB.name, 'cpu_utilization', 1.2, 'percent'],
            [timestamp, resourceB.id, resourceB.type, resourceB.name, 'network_in', 0, 'bytes'],
            [timestamp, resourceB.id, resourceB.type, resourceB.name, 'network_out', 0, 'bytes']
        ];
        
        for (const m of metricsB) {
            runSql(`INSERT INTO metrics (timestamp, resource_id, resource_type, resource_name, metric_type, value, unit) VALUES (?, ?, ?, ?, ?, ?, ?)`, m);
        }

        // 4. Run Anomaly Detection
        console.log('\nRunning Anomaly Detection...');
        await metricCollector.runAnomalyDetection();

        // 5. Verify Results
        console.log('\n--- VERIFYING RESULTS ---');
        
        const anomalies = queryAll("SELECT id, resource_name, anomaly_type, confidence FROM anomalies");
        console.log(`Detected Anomalies: ${anomalies.length}`);
        anomalies.forEach(a => console.log(` - ${a.resource_name}: ${a.anomaly_type} (Confidence: ${a.confidence})`));

        const actions = queryAll("SELECT resource_name, action_type, status, requires_approval FROM actions");
        console.log(`\nActions Created: ${actions.length}`);
        actions.forEach(a => {
            console.log(` - ${a.resource_name}: ${a.action_type} | Status: ${a.status} | Requires Approval: ${a.requires_approval === 1 ? 'YES' : 'NO'}`);
        });

        const alerts = queryAll("SELECT title, type FROM alerts ORDER BY created_at DESC");
        console.log(`\nAlerts Generated: ${alerts.length}`);
        alerts.forEach(al => console.log(` - [${al.type}] ${al.title}`));

        // 6. Conclusion
        const autoAction = actions.find(a => a.resource_name === resourceA.name);
        const manualAction = actions.find(a => a.resource_name === resourceB.name);

        if (autoAction && autoAction.status === 'executed' && manualAction && manualAction.status === 'pending') {
            console.log('\n✅ SUCCESS: Logic working as expected!');
            console.log('   - Non-crucial idle instance was auto-executed.');
            console.log('   - Production database requires permission.');
        } else {
            console.log('\n❌ FAILURE: Logic did not behave as expected.');
        }

        closeDatabase();
    } catch (error) {
        console.error('Test failed with error:', error);
        closeDatabase();
    }
}

test();
