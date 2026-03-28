const express = require('express');
const router = express.Router();
const { queryAll, queryOne, runSql } = require('../config/database');
const awsService = require('../services/awsService');
const automationService = require('../services/automationService');
const loggerService = require('../services/loggerService');

// GET /api/settings - Get all settings
router.get('/', (req, res) => {
    try {
        const settings = queryAll('SELECT * FROM settings');

        const settingsObj = {};
        for (const s of settings) {
            settingsObj[s.key] = s.value;
        }

        delete settingsObj.aws_secret_access_key;

        res.json({
            dryRun: settingsObj.dry_run === 'true',
            anomalyThreshold: parseFloat(settingsObj.anomaly_threshold || 0.5),
            metricInterval: parseInt(settingsObj.metric_interval || 300000),
            awsRegion: settingsObj.aws_region || 'us-east-1',
            automationLevel: settingsObj.automation_level || 'ask',
            systemStatus: settingsObj.system_status || 'running'
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch settings', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// PUT /api/settings - Update settings
router.put('/', async (req, res) => {
    try {
        const allowedKeys = [
            'dry_run', 'anomaly_threshold', 'metric_interval',
            'aws_region', 'automation_level', 'system_status'
        ];

        let shouldRefreshAws = false;

        for (const [key, value] of Object.entries(req.body)) {
            if (allowedKeys.includes(key)) {
                runSql(`
                    INSERT OR REPLACE INTO settings (key, value, updated_at)
                    VALUES (?, ?, ?)
                `, [key, String(value), new Date().toISOString()]);

                if (key === 'aws_region') {
                    shouldRefreshAws = true;
                }
            }
        }

        if (req.body.dry_run !== undefined) {
            automationService.setDryRun(req.body.dry_run);
        }

        if (req.body.automation_level !== undefined) {
            automationService.setAutomationLevel(req.body.automation_level);
        }

        if (shouldRefreshAws) {
            awsService.refreshClients();
            await awsService.testConnection();
        }

        loggerService.info('api', 'Settings updated', req.body);

        res.json({
            success: true,
            message: 'Settings updated',
            awsConnected: awsService.isConnected
        });
    } catch (error) {
        loggerService.error('api', 'Failed to update settings', { error: error.message });
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// POST /api/settings/aws-credentials - Set AWS credentials
router.post('/aws-credentials', async (req, res) => {
    try {
        const { accessKeyId, secretAccessKey, region } = req.body;

        if (!accessKeyId || !secretAccessKey) {
            return res.status(400).json({ error: 'Access key and secret are required' });
        }

        runSql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('aws_access_key_id', ?, ?)`,
            [accessKeyId, new Date().toISOString()]);

        runSql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('aws_secret_access_key', ?, ?)`,
            [secretAccessKey, new Date().toISOString()]);

        if (region) {
            runSql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('aws_region', ?, ?)`,
                [region, new Date().toISOString()]);
        }

        awsService.refreshClients();
        const awsConnected = await awsService.testConnection();

        loggerService.info('api', 'AWS credentials updated');

        res.json({
            success: true,
            message: 'AWS credentials updated',
            awsConnected
        });
    } catch (error) {
        loggerService.error('api', 'Failed to update AWS credentials', { error: error.message });
        res.status(500).json({ error: 'Failed to update credentials' });
    }
});

module.exports = router;
