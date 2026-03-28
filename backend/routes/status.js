const express = require('express');
const router = express.Router();
const { queryAll, queryOne, runSql } = require('../config/database');
const awsService = require('../services/awsService');
const mlService = require('../services/mlService');
const automationService = require('../services/automationService');
const loggerService = require('../services/loggerService');

const startTime = Date.now();

// GET /api/status - System health check
router.get('/', async (req, res) => {
    try {
        const lastFetch = queryOne('SELECT value, updated_at FROM settings WHERE key = ?', ['last_fetch']);
        const systemStatus = queryOne('SELECT value FROM settings WHERE key = ?', ['system_status']);
        const awsRegion = queryOne('SELECT value FROM settings WHERE key = ?', ['aws_region']);
        const pendingActions = queryOne("SELECT COUNT(*) as count FROM actions WHERE status = 'pending'");
        const recentAnomalies = queryOne(`
            SELECT COUNT(*) as count FROM anomalies
            WHERE status = 'new'
            AND detected_at > datetime('now', '-1 hour')
        `);

        const resourceCounts = queryAll(`
            SELECT resource_type, COUNT(DISTINCT resource_id) as count
            FROM metrics
            GROUP BY resource_type
        `);

        const resources = {};
        for (const r of resourceCounts) {
            resources[r.resource_type] = r.count;
        }

        res.json({
            status: 'healthy',
            version: '1.0.0',
            uptime: Math.floor((Date.now() - startTime) / 1000),
            lastFetch: lastFetch?.value || null,
            lastFetchAt: lastFetch?.updated_at || null,
            awsConnected: awsService.isConnected,
            awsRegion: awsRegion?.value || awsService.region,
            mlModelLoaded: mlService.isModelLoaded(),
            dryRunMode: automationService.isDryRun(),
            automationLevel: automationService.getAutomationLevel(),
            systemStatus: systemStatus?.value || 'running',
            pendingActions: pendingActions?.count || 0,
            recentAnomalies: recentAnomalies?.count || 0,
            resources: resources
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
