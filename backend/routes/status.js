const express = require('express');
const router = express.Router();
const { queryAll, queryOne } = require('../config/database');
const awsService = require('../services/awsService');
const mlService = require('../services/mlService');
const automationService = require('../services/automationService');
const loggerService = require('../services/loggerService');
const userSettingsService = require('../services/userSettingsService');

const startTime = Date.now();
const STATUS_CACHE_TTL_MS = 60000;

const realtimeStatusCache = new Map();

function getFallbackResourcesFromMetrics(userId) {
    const resourceCounts = queryAll(`
        SELECT resource_type, COUNT(DISTINCT resource_id) as count
        FROM metrics
        WHERE user_id = ? AND timestamp >= datetime('now', '-24 hours')
        GROUP BY resource_type
    `, [userId]);

    const resources = {
        EC2: 0,
        S3: 0,
        RDS: 0,
        Lambda: 0
    };

    for (const row of resourceCounts) {
        if (row.resource_type && Object.prototype.hasOwnProperty.call(resources, row.resource_type)) {
            resources[row.resource_type] = row.count || 0;
        }
    }

    return resources;
}

function buildRealtimeFeatures(metric) {
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();

    return {
        cpu: metric?.cpu || 0,
        memory: 0,
        networkIn: metric?.networkIn || 0,
        networkOut: metric?.networkOut || 0,
        hour,
        dayOfWeek,
        cpuMa7: metric?.cpu || 0,
        cpuStd: 0,
        networkMa7: metric?.networkIn || 0
    };
}

async function buildRealtimeAwsSnapshot(userId) {
    const [ec2Instances, s3Buckets, rdsInstances, lambdaFunctions] = await Promise.all([
        awsService.getEC2Instances(userId),
        awsService.getS3Buckets(userId),
        awsService.getRDSInstances(userId),
        awsService.getLambdaFunctions(userId)
    ]);

    const runningInstances = ec2Instances.filter((instance) => instance.state === 'running');
    let recentAnomalies = 0;

    if (runningInstances.length > 0) {
        const instanceMetrics = await awsService.getEC2Metrics(
            runningInstances.map((instance) => instance.id),
            900,
            userId
        );

        for (const metric of instanceMetrics) {
            const detectionResult = mlService.detectAnomaly(buildRealtimeFeatures(metric), null, userId);
            if (detectionResult.isAnomaly) {
                recentAnomalies += 1;
            }
        }
    }

    return {
        resources: {
            EC2: ec2Instances.length,
            S3: s3Buckets.length,
            RDS: rdsInstances.length,
            Lambda: lambdaFunctions.length
        },
        recentAnomalies,
        source: 'realtime_aws',
        computedAt: new Date().toISOString()
    };
}

async function getRealtimeAwsSnapshot(userId) {
    const now = Date.now();
    const cached = realtimeStatusCache.get(userId);
    if (cached?.data && cached.expiresAt > now) {
        return cached.data;
    }

    const snapshot = await buildRealtimeAwsSnapshot(userId);
    realtimeStatusCache.set(userId, {
        data: snapshot,
        expiresAt: now + STATUS_CACHE_TTL_MS
    });

    return snapshot;
}

// GET /api/status - System health check
router.get('/', async (req, res) => {
    try {
        const userId = req.session.userId;
        const lastFetch = userSettingsService.getUserSetting(userId, 'last_fetch', { allowGlobalFallback: false });
        const systemStatus = userSettingsService.getUserSetting(userId, 'system_status', { allowGlobalFallback: true });
        const awsRegion = userSettingsService.getUserSetting(userId, 'aws_region', { allowGlobalFallback: true });
        const pendingActions = queryOne("SELECT COUNT(*) as count FROM actions WHERE user_id = ? AND status = 'pending'", [userId]);
        const fallbackAnomalies = queryOne(`
            SELECT COUNT(*) as count FROM anomalies
            WHERE user_id = ? AND detected_at > datetime('now', '-24 hours')
        `, [userId]);

        let realtimeSnapshot = null;
        try {
            realtimeSnapshot = await getRealtimeAwsSnapshot(userId);
        } catch (snapshotError) {
            loggerService.warn('api', 'Realtime AWS status snapshot failed, using fallback values', {
                error: snapshotError.message,
                userId
            });
        }

        const resources = realtimeSnapshot?.resources || getFallbackResourcesFromMetrics(userId);
        const recentAnomalies = realtimeSnapshot?.recentAnomalies ?? fallbackAnomalies?.count ?? 0;
        const overviewSource = realtimeSnapshot?.source || 'database_fallback';

        res.json({
            status: 'healthy',
            version: '1.0.0',
            uptime: Math.floor((Date.now() - startTime) / 1000),
            lastFetch: lastFetch || null,
            lastFetchAt: lastFetch || null,
            awsConnected: awsService.getConnectionState(userId),
            awsRegion: awsRegion || awsService.getRegion(userId),
            mlModelLoaded: mlService.isModelLoaded(),
            dryRunMode: automationService.isDryRun(userId),
            automationLevel: automationService.getAutomationLevel(userId),
            systemStatus: systemStatus || 'running',
            pendingActions: pendingActions?.count || 0,
            recentAnomalies,
            resources,
            overviewSource,
            overviewUpdatedAt: realtimeSnapshot?.computedAt || null
        });
    } catch (error) {
        loggerService.error('api', 'Status check failed', { error: error.message });
        res.status(500).json({
            status: 'degraded',
            error: error.message
        });
    }
});

// GET /api/status/health - Simple health check
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
