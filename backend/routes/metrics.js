const express = require('express');
const router = express.Router();
const { queryAll, queryOne } = require('../config/database');
const loggerService = require('../services/loggerService');

// GET /api/metrics - Fetch stored metrics
router.get('/', (req, res) => {
    try {
        const { resourceId, metricType, startDate, endDate, limit = 1000 } = req.query;

        let query = 'SELECT * FROM metrics WHERE 1=1';
        const params = [];

        if (resourceId) {
            query += ' AND resource_id = ?';
            params.push(resourceId);
        }

        if (metricType) {
            query += ' AND metric_type = ?';
            params.push(metricType);
        }

        if (startDate) {
            query += ' AND timestamp >= ?';
            params.push(startDate);
        }

        if (endDate) {
            query += ' AND timestamp <= ?';
            params.push(endDate);
        }

        query += ' ORDER BY timestamp DESC LIMIT ?';
        params.push(parseInt(limit));

        const data = queryAll(query, params);

        res.json({
            data: data.map(m => ({
                id: m.id,
                timestamp: m.timestamp,
                resourceId: m.resource_id,
                resourceType: m.resource_type,
                resourceName: m.resource_name,
                metricType: m.metric_type,
                value: m.value,
                unit: m.unit
            })),
            count: data.length,
            pagination: {
                limit: parseInt(limit),
                hasMore: data.length === parseInt(limit)
            }
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch metrics', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch metrics' });
    }
});

// POST /api/metrics/fetch - Trigger immediate metric fetch
router.post('/fetch', async (req, res) => {
    try {
        const metricCollector = require('../services/metricCollector');
        const result = await metricCollector.collectMetrics();
        res.json({
            success: true,
            fetched: {
                ec2: result.ec2,
                s3: result.s3,
                rds: result.rds,
                lambda: result.lambda
            },
            timestamp: result.timestamp
        });
    } catch (error) {
        loggerService.error('api', 'Metric fetch failed', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch metrics', details: error.message });
    }
});

// GET /api/metrics/latest - Get latest metrics for all resources
router.get('/latest', (req, res) => {
    try {
        const data = queryAll(`
            SELECT m.* FROM metrics m
            INNER JOIN (
                SELECT resource_id, metric_type, MAX(timestamp) as max_ts
                FROM metrics
                GROUP BY resource_id, metric_type
            ) latest ON m.resource_id = latest.resource_id
                AND m.metric_type = latest.metric_type
                AND m.timestamp = latest.max_ts
        `);

        const resources = {};
        for (const m of data) {
            if (!resources[m.resource_id]) {
                resources[m.resource_id] = {
                    resourceId: m.resource_id,
                    resourceType: m.resource_type,
                    resourceName: m.resource_name,
                    timestamp: m.timestamp,
                    metrics: {}
                };
            }
            resources[m.resource_id].metrics[m.metric_type] = {
                value: m.value,
                unit: m.unit
            };
        }

        res.json({
            data: Object.values(resources),
            count: Object.values(resources).length
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch latest metrics', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch latest metrics' });
    }
});

// GET /api/metrics/summary - Get aggregated metric summaries
router.get('/summary', (req, res) => {
    try {
        const { period = '24h' } = req.query;

        let timeCondition;
        switch (period) {
            case '1h': timeCondition = "timestamp >= datetime('now', '-1 hour')"; break;
            case '24h': timeCondition = "timestamp >= datetime('now', '-24 hours')"; break;
            case '7d': timeCondition = "timestamp >= datetime('now', '-7 days')"; break;
            case '30d': timeCondition = "timestamp >= datetime('now', '-30 days')"; break;
            default: timeCondition = "timestamp >= datetime('now', '-24 hours')";
        }

        const data = queryAll(`
            SELECT
                resource_id,
                resource_type,
                metric_type,
                AVG(value) as avg_value,
                MAX(value) as max_value,
                MIN(value) as min_value,
                COUNT(*) as data_points
            FROM metrics
            WHERE ${timeCondition}
            GROUP BY resource_id, resource_type, metric_type
        `);

        res.json({
            period,
            data: data.map(d => ({
                resourceId: d.resource_id,
                resourceType: d.resource_type,
                metricType: d.metric_type,
                avgValue: parseFloat(d.avg_value?.toFixed(2) || 0),
                maxValue: parseFloat(d.max_value?.toFixed(2) || 0),
                minValue: parseFloat(d.min_value?.toFixed(2) || 0),
                dataPoints: d.data_points
            }))
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch metric summary', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch metric summary' });
    }
});

module.exports = router;
