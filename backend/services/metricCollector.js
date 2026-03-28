const { queryAll, queryOne, runSql } = require('../config/database');
const awsService = require('./awsService');
const mlService = require('./mlService');
const automationService = require('./automationService');
const alertService = require('./alertService');
const loggerService = require('./loggerService');
const costAnomalyService = require('./costAnomalyService');
const { v4: uuidv4 } = require('uuid');

let collectionInterval = null;
const COLLECTION_INTERVAL = process.env.METRIC_INTERVAL || 300000;

async function collectMetrics() {
    loggerService.info('collector', 'Starting metric collection...');

    try {
        const timestamp = new Date().toISOString();

        const ec2Instances = await awsService.getEC2Instances();
        if (ec2Instances.length > 0) {
            const instanceIds = ec2Instances.map(i => i.id);
            const metrics = await awsService.getEC2Metrics(instanceIds);

            for (const instance of ec2Instances) {
                const metricData = metrics.find(m => m.resourceId === instance.id) || {};

                const metricsToInsert = [
                    {
                        timestamp,
                        resourceId: instance.id,
                        resourceType: 'EC2',
                        resourceName: instance.name,
                        metricType: 'cpu_utilization',
                        value: metricData.cpu || 0,
                        unit: 'percent'
                    },
                    {
                        timestamp,
                        resourceId: instance.id,
                        resourceType: 'EC2',
                        resourceName: instance.name,
                        metricType: 'network_in',
                        value: metricData.networkIn || 0,
                        unit: 'bytes'
                    },
                    {
                        timestamp,
                        resourceId: instance.id,
                        resourceType: 'EC2',
                        resourceName: instance.name,
                        metricType: 'network_out',
                        value: metricData.networkOut || 0,
                        unit: 'bytes'
                    }
                ];

                for (const m of metricsToInsert) {
                    runSql(`
                        INSERT INTO metrics (timestamp, resource_id, resource_type, resource_name, metric_type, value, unit)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `, [m.timestamp, m.resourceId, m.resourceType, m.resourceName, m.metricType, m.value, m.unit]);
                }
            }

            loggerService.info('collector', `Collected metrics for ${ec2Instances.length} EC2 instances`);
        }

        const s3Buckets = await awsService.getS3Buckets();
        const s3Metrics = await awsService.getS3BucketMetrics(s3Buckets);
        for (const bucket of s3Buckets) {
            const metricData = s3Metrics.find(m => m.resourceId === bucket.id) || {};
            const metricsToInsert = [
                {
                    timestamp,
                    resourceId: bucket.id,
                    resourceType: 'S3',
                    resourceName: bucket.name,
                    metricType: 'object_count',
                    value: metricData.objectCount || 0,
                    unit: 'count'
                },
                {
                    timestamp,
                    resourceId: bucket.id,
                    resourceType: 'S3',
                    resourceName: bucket.name,
                    metricType: 'storage_bytes',
                    value: metricData.totalSize || 0,
                    unit: 'bytes'
                }
            ];

            for (const m of metricsToInsert) {
                runSql(`
                    INSERT INTO metrics (timestamp, resource_id, resource_type, resource_name, metric_type, value, unit)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [m.timestamp, m.resourceId, m.resourceType, m.resourceName, m.metricType, m.value, m.unit]);
            }
        }

        const rdsInstances = await awsService.getRDSInstances();
        const rdsMetrics = await awsService.getRDSMetrics(rdsInstances);
        for (const instance of rdsInstances) {
            const metricData = rdsMetrics.find(m => m.resourceId === instance.id) || {};
            const metricsToInsert = [
                {
                    timestamp,
                    resourceId: instance.id,
                    resourceType: 'RDS',
                    resourceName: instance.name,
                    metricType: 'cpu_utilization',
                    value: metricData.cpu || 0,
                    unit: 'percent'
                },
                {
                    timestamp,
                    resourceId: instance.id,
                    resourceType: 'RDS',
                    resourceName: instance.name,
                    metricType: 'db_connections',
                    value: metricData.connections || 0,
                    unit: 'count'
                },
                {
                    timestamp,
                    resourceId: instance.id,
                    resourceType: 'RDS',
                    resourceName: instance.name,
                    metricType: 'free_storage_bytes',
                    value: metricData.freeStorage || 0,
                    unit: 'bytes'
                }
            ];

            for (const m of metricsToInsert) {
                runSql(`
                    INSERT INTO metrics (timestamp, resource_id, resource_type, resource_name, metric_type, value, unit)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [m.timestamp, m.resourceId, m.resourceType, m.resourceName, m.metricType, m.value, m.unit]);
            }
        }

        const lambdaFunctions = await awsService.getLambdaFunctions();
        const lambdaMetrics = await awsService.getLambdaMetrics(lambdaFunctions);
        for (const fn of lambdaFunctions) {
            const metricData = lambdaMetrics.find(m => m.resourceId === fn.id) || {};
            const metricsToInsert = [
                {
                    timestamp,
                    resourceId: fn.id,
                    resourceType: 'Lambda',
                    resourceName: fn.name,
                    metricType: 'invocations',
                    value: metricData.invocations || 0,
                    unit: 'count'
                },
                {
                    timestamp,
                    resourceId: fn.id,
                    resourceType: 'Lambda',
                    resourceName: fn.name,
                    metricType: 'errors',
                    value: metricData.errors || 0,
                    unit: 'count'
                },
                {
                    timestamp,
                    resourceId: fn.id,
                    resourceType: 'Lambda',
                    resourceName: fn.name,
                    metricType: 'duration_ms',
                    value: metricData.duration || 0,
                    unit: 'milliseconds'
                }
            ];

            for (const m of metricsToInsert) {
                runSql(`
                    INSERT INTO metrics (timestamp, resource_id, resource_type, resource_name, metric_type, value, unit)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [m.timestamp, m.resourceId, m.resourceType, m.resourceName, m.metricType, m.value, m.unit]);
            }
        }

        runSql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
            ['last_fetch', timestamp, new Date().toISOString()]);

        await runAnomalyDetection();
        
        // Run cost anomaly detection every 6th collection (30 minutes) or on startup
        const collectionCount = parseInt(queryOne('SELECT value FROM settings WHERE key = ?', ['collection_count'])?.value || '0');
        const shouldCheckCosts = collectionCount % 6 === 0 || collectionCount === 0;
        
        if (shouldCheckCosts) {
            loggerService.info('collector', 'Running cost anomaly detection...');
            await costAnomalyService.detectCostAnomalies();
        }
        
        // Increment collection counter
        runSql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
            ['collection_count', (collectionCount + 1).toString(), new Date().toISOString()]);

        return {
            ec2: ec2Instances.length,
            s3: s3Buckets.length,
            rds: rdsInstances.length,
            lambda: lambdaFunctions.length,
            timestamp
        };
    } catch (error) {
        loggerService.error('collector', 'Metric collection failed', { error: error.message });
        throw error;
    }
}

async function runAnomalyDetection() {
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

        const recentMetrics = queryAll(`
            SELECT * FROM metrics WHERE timestamp > ? ORDER BY timestamp DESC
        `, [oneHourAgo]);

        const resourceGroups = {};
        for (const metric of recentMetrics) {
            if (!resourceGroups[metric.resource_id]) {
                resourceGroups[metric.resource_id] = {
                    resourceId: metric.resource_id,
                    resourceName: metric.resource_name,
                    resourceType: metric.resource_type,
                    cpu: [],
                    networkIn: [],
                    networkOut: []
                };
            }

            if (metric.metric_type === 'cpu_utilization') {
                resourceGroups[metric.resource_id].cpu.push(metric.value);
            } else if (metric.metric_type === 'network_in') {
                resourceGroups[metric.resource_id].networkIn.push(metric.value);
            } else if (metric.metric_type === 'network_out') {
                resourceGroups[metric.resource_id].networkOut.push(metric.value);
            }
        }

        for (const resourceId in resourceGroups) {
            const data = resourceGroups[resourceId];

            if (data.resourceType !== 'EC2') continue;
            if (data.cpu.length === 0) continue;

            const features = {
                cpu: average(data.cpu),
                memory: 0,
                networkIn: average(data.networkIn),
                networkOut: average(data.networkOut),
                hour: new Date().getHours(),
                dayOfWeek: new Date().getDay(),
                cpuMa7: average(data.cpu),
                cpuStd: stdDev(data.cpu),
                networkMa7: average(data.networkIn)
            };

            const result = mlService.detectAnomaly(features);

            if (result.isAnomaly) {
                const anomalyInfo = mlService.determineAnomalyType(features, result.anomalyScore);

                const existingAnomaly = queryOne(`
                    SELECT * FROM anomalies
                    WHERE resource_id = ? AND status = 'new'
                    AND detected_at > datetime('now', '-1 hour')
                `, [resourceId]);

                if (!existingAnomaly) {
                    const anomalyId = `anomaly_${uuidv4().slice(0, 8)}`;

                    runSql(`
                        INSERT INTO anomalies (
                            id, resource_id, resource_name, resource_type,
                            anomaly_type, detected_at, anomaly_score, confidence,
                            features, recommended_action, estimated_savings, status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                        anomalyId,
                        resourceId,
                        data.resourceName,
                        data.resourceType,
                        anomalyInfo.type,
                        new Date().toISOString(),
                        result.anomalyScore,
                        result.confidence,
                        JSON.stringify(result.features),
                        anomalyInfo.action,
                        anomalyInfo.savings,
                        'new'
                    ]);

                    loggerService.log(
                        'warn',
                        'anomaly',
                        `Anomaly detected: ${anomalyInfo.type} for ${resourceId}`,
                        { score: result.anomalyScore, confidence: result.confidence },
                        resourceId,
                        anomalyInfo.action
                    );

                    // Alert the user about the anomaly
                    alertService.alertAnomalyDetected({
                        id: anomalyId,
                        type: anomalyInfo.type,
                        resourceId,
                        resourceName: data.resourceName,
                        resourceType: data.resourceType,
                        savings: anomalyInfo.savings
                    }, result.confidence, anomalyInfo.action);

                    // Create action based on confidence and cruciality (logic is inside automationService)
                    const actionId = automationService.createAction(
                        anomalyId,
                        resourceId,
                        data.resourceName,
                        anomalyInfo.action,
                        anomalyInfo.savings,
                        result.confidence
                    );

                    if (actionId) {
                        const action = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
                        
                        // If it doesn't require approval (auto-execute), proceed
                        if (action && !action.requires_approval) {
                            try {
                                automationService.approveAction(actionId, 'system:auto');
                                
                                // Alert that it's being auto-approved
                                alertService.alertAutoApproved(action, { id: anomalyId, type: anomalyInfo.type }, result.confidence);
                                
                                await automationService.executeAction(actionId);
                                
                                // Alert that it's been executed
                                const updatedAction = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
                                alertService.alertActionExecuted(updatedAction);
                            } catch (actionError) {
                                loggerService.error('automation', 'Automatic action execution failed', {
                                    actionId,
                                    error: actionError.message
                                });
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        loggerService.error('ml', 'Anomaly detection failed', { error: error.message });
    }
}

function average(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr) {
    if (!arr || arr.length === 0) return 0;
    const avg = average(arr);
    return Math.sqrt(arr.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / arr.length);
}

function start() {
    if (collectionInterval) {
        clearInterval(collectionInterval);
    }

    collectionInterval = setInterval(() => {
        collectMetrics().catch(console.error);
    }, COLLECTION_INTERVAL);

    loggerService.info('collector', `Metric collector started (interval: ${COLLECTION_INTERVAL / 1000}s)`);
    collectMetrics().catch(error => {
        loggerService.error('collector', 'Initial metric collection failed', { error: error.message });
    });
}

function stop() {
    if (collectionInterval) {
        clearInterval(collectionInterval);
        collectionInterval = null;
        loggerService.info('collector', 'Metric collector stopped');
    }
}

module.exports = {
    collectMetrics,
    runAnomalyDetection,
    start,
    stop
};
