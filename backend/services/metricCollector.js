const { queryAll, queryOne, runSql } = require('../config/database');
const awsService = require('./awsService');
const mlService = require('./mlService');
const automationService = require('./automationService');
const alertService = require('./alertService');
const loggerService = require('./loggerService');
const costAnomalyService = require('./costAnomalyService');
const userSettingsService = require('./userSettingsService');
const { v4: uuidv4 } = require('uuid');

let collectionInterval = null;
const MIN_COLLECTION_INTERVAL_MS = 30000;
const MAX_COLLECTION_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_COLLECTION_INTERVAL_MS = Number.parseInt(process.env.METRIC_INTERVAL || '60000', 10);
const SCHEDULER_TICK_MS = Math.min(MIN_COLLECTION_INTERVAL_MS, DEFAULT_COLLECTION_INTERVAL_MS);

function clampCollectionInterval(intervalMs) {
    if (!Number.isFinite(intervalMs)) {
        return DEFAULT_COLLECTION_INTERVAL_MS;
    }

    return Math.min(Math.max(intervalMs, MIN_COLLECTION_INTERVAL_MS), MAX_COLLECTION_INTERVAL_MS);
}

function getCollectionIntervalMs(userId, overrideIntervalMs = null) {
    if (overrideIntervalMs !== null && overrideIntervalMs !== undefined) {
        return clampCollectionInterval(Number.parseInt(overrideIntervalMs, 10));
    }

    const configuredInterval = Number.parseInt(
        userSettingsService.getUserSetting(userId, 'metric_interval', { allowGlobalFallback: true }) || DEFAULT_COLLECTION_INTERVAL_MS,
        10
    );

    return clampCollectionInterval(configuredInterval);
}

function shouldCollectNow(userId) {
    const lastFetch = userSettingsService.getUserSetting(userId, 'last_fetch', { allowGlobalFallback: false });
    if (!lastFetch) {
        return true;
    }

    const lastFetchTime = new Date(lastFetch).getTime();
    if (!Number.isFinite(lastFetchTime)) {
        return true;
    }

    const intervalMs = getCollectionIntervalMs(userId);
    return Date.now() - lastFetchTime >= intervalMs;
}

function actionRowToAlertShape(action) {
    return {
        id: action.id,
        actionType: action.action_type,
        resourceId: action.resource_id,
        resourceName: action.resource_name,
        savings: action.savings
    };
}

async function collectMetrics(userId) {
    if (!userId) {
        throw new Error('userId is required for metric collection');
    }

    loggerService.info('collector', 'Starting metric collection', { userId });

    try {
        const timestamp = new Date().toISOString();

        const ec2Instances = await awsService.getEC2Instances(userId);
        if (ec2Instances.length > 0) {
            const instanceIds = ec2Instances.map((i) => i.id);
            const metrics = await awsService.getEC2Metrics(instanceIds, 300, userId);

            for (const instance of ec2Instances) {
                const metricData = metrics.find((m) => m.resourceId === instance.id) || {};
                const metricsToInsert = [
                    { metricType: 'cpu_utilization', value: metricData.cpu || 0, unit: 'percent' },
                    { metricType: 'network_in', value: metricData.networkIn || 0, unit: 'bytes' },
                    { metricType: 'network_out', value: metricData.networkOut || 0, unit: 'bytes' }
                ];

                for (const metric of metricsToInsert) {
                    runSql(`
                        INSERT INTO metrics (user_id, timestamp, resource_id, resource_type, resource_name, metric_type, value, unit)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [userId, timestamp, instance.id, 'EC2', instance.name, metric.metricType, metric.value, metric.unit]);
                }
            }

            loggerService.info('collector', `Collected metrics for ${ec2Instances.length} EC2 instances`, { userId });
        }

        const s3Buckets = await awsService.getS3Buckets(userId);
        const s3Metrics = await awsService.getS3BucketMetrics(s3Buckets, userId);
        for (const bucket of s3Buckets) {
            const metricData = s3Metrics.find((m) => m.resourceId === bucket.id) || {};
            const metricsToInsert = [
                { metricType: 'object_count', value: metricData.objectCount || 0, unit: 'count' },
                { metricType: 'storage_bytes', value: metricData.totalSize || 0, unit: 'bytes' }
            ];

            for (const metric of metricsToInsert) {
                runSql(`
                    INSERT INTO metrics (user_id, timestamp, resource_id, resource_type, resource_name, metric_type, value, unit)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [userId, timestamp, bucket.id, 'S3', bucket.name, metric.metricType, metric.value, metric.unit]);
            }
        }

        const rdsInstances = await awsService.getRDSInstances(userId);
        const rdsMetrics = await awsService.getRDSMetrics(rdsInstances, 300, userId);
        for (const instance of rdsInstances) {
            const metricData = rdsMetrics.find((m) => m.resourceId === instance.id) || {};
            const metricsToInsert = [
                { metricType: 'cpu_utilization', value: metricData.cpu || 0, unit: 'percent' },
                { metricType: 'db_connections', value: metricData.connections || 0, unit: 'count' },
                { metricType: 'free_storage_bytes', value: metricData.freeStorage || 0, unit: 'bytes' }
            ];

            for (const metric of metricsToInsert) {
                runSql(`
                    INSERT INTO metrics (user_id, timestamp, resource_id, resource_type, resource_name, metric_type, value, unit)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [userId, timestamp, instance.id, 'RDS', instance.name, metric.metricType, metric.value, metric.unit]);
            }
        }

        const lambdaFunctions = await awsService.getLambdaFunctions(userId);
        const lambdaMetrics = await awsService.getLambdaMetrics(lambdaFunctions, 300, userId);
        for (const fn of lambdaFunctions) {
            const metricData = lambdaMetrics.find((m) => m.resourceId === fn.id) || {};
            const metricsToInsert = [
                { metricType: 'invocations', value: metricData.invocations || 0, unit: 'count' },
                { metricType: 'errors', value: metricData.errors || 0, unit: 'count' },
                { metricType: 'duration_ms', value: metricData.duration || 0, unit: 'milliseconds' }
            ];

            for (const metric of metricsToInsert) {
                runSql(`
                    INSERT INTO metrics (user_id, timestamp, resource_id, resource_type, resource_name, metric_type, value, unit)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [userId, timestamp, fn.id, 'Lambda', fn.name, metric.metricType, metric.value, metric.unit]);
            }
        }

        userSettingsService.setUserSetting(userId, 'last_fetch', timestamp);

        await runAnomalyDetection(userId);

        const collectionCount = parseInt(
            userSettingsService.getUserSetting(userId, 'collection_count', { allowGlobalFallback: false }) || '0',
            10
        );

        const shouldCheckCosts = collectionCount % 6 === 0 || collectionCount === 0;
        if (shouldCheckCosts) {
            loggerService.info('collector', 'Running cost anomaly detection', { userId });
            await costAnomalyService.detectCostAnomalies(userId);
        }

        userSettingsService.setUserSetting(userId, 'collection_count', String(collectionCount + 1));

        return {
            ec2: ec2Instances.length,
            s3: s3Buckets.length,
            rds: rdsInstances.length,
            lambda: lambdaFunctions.length,
            timestamp
        };
    } catch (error) {
        loggerService.error('collector', 'Metric collection failed', { error: error.message, userId });
        throw error;
    }
}

async function runAnomalyDetection(userId) {
    try {
        const lookbackWindowHours = 1;
        const lookbackTimestamp = new Date(Date.now() - lookbackWindowHours * 60 * 60 * 1000).toISOString();

        const recentMetrics = queryAll(`
            SELECT * FROM metrics
            WHERE user_id = ? AND timestamp > ?
            ORDER BY timestamp DESC
        `, [userId, lookbackTimestamp]);

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
            if (data.resourceType !== 'EC2' || data.cpu.length === 0) continue;

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

            const result = mlService.detectAnomaly(features, null, userId);
            if (!result.isAnomaly) continue;

            const anomalyInfo = mlService.determineAnomalyType(features, result.anomalyScore);

            const existingAnomaly = queryOne(`
                SELECT id FROM anomalies
                WHERE user_id = ? AND resource_id = ? AND status = 'new'
                AND detected_at > datetime('now', '-1 hour')
            `, [userId, resourceId]);

            if (existingAnomaly) continue;

            const anomalyId = `anomaly_${uuidv4().slice(0, 8)}`;

            runSql(`
                INSERT INTO anomalies (
                    id, user_id, resource_id, resource_name, resource_type,
                    anomaly_type, detected_at, anomaly_score, confidence,
                    features, recommended_action, estimated_savings, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                anomalyId,
                userId,
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
                { score: result.anomalyScore, confidence: result.confidence, userId },
                resourceId,
                anomalyInfo.action
            );

            alertService.alertAnomalyDetected(userId, {
                id: anomalyId,
                type: anomalyInfo.type,
                resourceId,
                resourceName: data.resourceName,
                resourceType: data.resourceType,
                savings: anomalyInfo.savings
            }, result.confidence, anomalyInfo.action);

            const actionId = automationService.createAction(
                anomalyId,
                resourceId,
                data.resourceName,
                anomalyInfo.action,
                anomalyInfo.savings,
                result.confidence,
                userId
            );

            if (!actionId) continue;

            let action = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
            if (action && !action.requires_approval) {
                try {
                    if (action.status === 'pending') {
                        automationService.approveAction(actionId, 'system:auto', userId);
                        action = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
                        alertService.alertAutoApproved(userId, actionRowToAlertShape(action), { id: anomalyId, type: anomalyInfo.type }, result.confidence);
                    }

                    await automationService.executeAction(actionId);
                    const updatedAction = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
                    alertService.alertActionExecuted(userId, actionRowToAlertShape(updatedAction));
                } catch (actionError) {
                    loggerService.error('automation', 'Automatic action execution failed', {
                        actionId,
                        userId,
                        error: actionError.message
                    });
                }
            }
        }
    } catch (error) {
        loggerService.error('ml', 'Anomaly detection failed', { error: error.message, userId });
    }
}

async function collectMetricsForDueUsers() {
    const usersWithAws = userSettingsService.getUsersWithAwsCredentials();

    for (const user of usersWithAws) {
        if (!shouldCollectNow(user.user_id)) {
            continue;
        }

        try {
            await collectMetrics(user.user_id);
        } catch (error) {
            loggerService.error('collector', 'Scheduled user collection failed', {
                userId: user.user_id,
                error: error.message
            });
        }
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
        collectMetricsForDueUsers().catch(console.error);
    }, SCHEDULER_TICK_MS);

    loggerService.info('collector', `Metric collector started (tick: ${SCHEDULER_TICK_MS / 1000}s)`);
    collectMetricsForDueUsers().catch((error) => {
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

function restart() {
    stop();
    start();
}

function getCurrentIntervalMs() {
    return SCHEDULER_TICK_MS;
}

module.exports = {
    collectMetrics,
    runAnomalyDetection,
    start,
    stop,
    restart,
    getCurrentIntervalMs
};
