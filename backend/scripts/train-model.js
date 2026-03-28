const { closeDatabase, initializeDatabase, queryAll, runSql } = require('../config/database');
const mlModel = require('../ml/model');

console.log('Training CloudCostGuard ML Model...\n');

function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values, mean) {
    if (!values.length) return 0;
    return Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length);
}

async function trainModel() {
    try {
        await initializeDatabase();

        console.log('Collecting training data...');

        const trainingData = queryAll(`
            SELECT * FROM metrics
            WHERE timestamp >= datetime('now', '-7 days')
            ORDER BY timestamp ASC
        `);

        if (trainingData.length < 100) {
            console.log(`Only ${trainingData.length} samples collected. Need at least 100.`);
            console.log('Will use statistical anomaly detection as fallback.');
            console.log('\nTrain model after running the system for a few days to collect more data.');
            closeDatabase();
            process.exitCode = 0;
            return;
        }

        const samplesByResource = {};

        for (const m of trainingData) {
            const hour = new Date(m.timestamp).getHours();
            const dayOfWeek = new Date(m.timestamp).getDay();
            const sampleKey = `${m.resource_id}:${m.timestamp}`;

            if (!samplesByResource[m.resource_id]) {
                samplesByResource[m.resource_id] = new Map();
            }

            if (!samplesByResource[m.resource_id].has(sampleKey)) {
                samplesByResource[m.resource_id].set(sampleKey, {
                    resourceId: m.resource_id,
                    timestamp: m.timestamp,
                    cpu: 0,
                    memory: 0,
                    networkIn: 0,
                    networkOut: 0,
                    hour,
                    dayOfWeek,
                    cpuMa7: 0,
                    cpuStd: 0,
                    networkMa7: 0
                });
            }

            const sample = samplesByResource[m.resource_id].get(sampleKey);
            if (m.metric_type === 'cpu_utilization') {
                sample.cpu = Number(m.value) || 0;
            } else if (m.metric_type === 'network_in') {
                sample.networkIn = Number(m.value) || 0;
            } else if (m.metric_type === 'network_out') {
                sample.networkOut = Number(m.value) || 0;
            }
        }

        const features = [];

        for (const resourceId in samplesByResource) {
            const data = Array.from(samplesByResource[resourceId].values())
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            for (let i = 0; i < data.length; i++) {
                const current = data[i];

                const recentData = data.slice(Math.max(0, i - 7), i + 1);
                const cpuValues = recentData.map(d => d.cpu);
                const networkValues = recentData.map(d => d.networkIn);

                current.cpuMa7 = average(cpuValues);
                current.cpuStd = standardDeviation(cpuValues, current.cpuMa7);
                current.networkMa7 = average(networkValues);

                features.push({
                    cpu: current.cpu,
                    memory: current.memory,
                    networkIn: current.networkIn,
                    networkOut: current.networkOut,
                    hour: current.hour,
                    dayOfWeek: current.dayOfWeek,
                    cpuMa7: current.cpuMa7,
                    cpuStd: current.cpuStd,
                    networkMa7: current.networkMa7
                });
            }
        }

        console.log(`Training with ${features.length} samples...`);

        const { model, stats } = mlModel.train(features, {
            numTrees: 100,
            maxSamples: Math.min(256, features.length),
            maxDepth: 10
        });

        console.log('Model trained successfully!');

        runSql(`
            INSERT OR REPLACE INTO ml_model (id, model_type, model_data, feature_names, stats, trained_at, metrics)
            VALUES (1, 'isolation_forest', ?, ?, ?, ?, ?)
        `, [
            JSON.stringify(model),
            JSON.stringify(['cpu', 'memory', 'networkIn', 'networkOut', 'hour', 'dayOfWeek', 'cpuMa7', 'cpuStd', 'networkMa7']),
            JSON.stringify(stats),
            new Date().toISOString(),
            JSON.stringify({
                sampleSize: features.length,
                numTrees: 100,
                maxDepth: 10
            })
        ]);

        console.log('Model saved to database.');

        console.log('\nTesting model...');

        const testCases = [
            { cpu: 5, memory: 20, networkIn: 0, networkOut: 0, hour: 3, dayOfWeek: 1, cpuMa7: 5, cpuStd: 1, networkMa7: 0 },
            { cpu: 45, memory: 60, networkIn: 1000000, networkOut: 500000, hour: 10, dayOfWeek: 3, cpuMa7: 42, cpuStd: 5, networkMa7: 900000 },
            { cpu: 95, memory: 85, networkIn: 5000000, networkOut: 2000000, hour: 14, dayOfWeek: 5, cpuMa7: 30, cpuStd: 10, networkMa7: 400000 }
        ];

        for (const test of testCases) {
            const result = mlModel.predict(model, test);
            console.log(`  CPU:${test.cpu}% Net:${test.networkIn > 0 ? 'active' : 'idle'} -> Score:${result.score.toFixed(3)} (${result.score > 0.5 ? 'ANOMALY' : 'normal'})`);
        }

        console.log('\nML model training complete!');
        closeDatabase();
        process.exitCode = 0;
    } catch (error) {
        console.error('Training failed:', error);
        closeDatabase();
        process.exitCode = 1;
    }
}

trainModel();
