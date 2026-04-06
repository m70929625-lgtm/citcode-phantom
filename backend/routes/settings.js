const express = require('express');
const router = express.Router();
const awsService = require('../services/awsService');
const automationService = require('../services/automationService');
const metricCollector = require('../services/metricCollector');
const loggerService = require('../services/loggerService');
const userSettingsService = require('../services/userSettingsService');
const cryptoService = require('../services/cryptoService');

const MIN_METRIC_INTERVAL_MS = 30000;
const MAX_METRIC_INTERVAL_MS = 15 * 60 * 1000;

// GET /api/settings - Get all settings
router.get('/', (req, res) => {
    try {
        const userId = req.session.userId;
        const settingsObj = {
            dry_run: userSettingsService.getUserSetting(userId, 'dry_run', { allowGlobalFallback: true }),
            anomaly_threshold: userSettingsService.getUserSetting(userId, 'anomaly_threshold', { allowGlobalFallback: true }),
            metric_interval: userSettingsService.getUserSetting(userId, 'metric_interval', { allowGlobalFallback: true }),
            aws_region: userSettingsService.getUserSetting(userId, 'aws_region', { allowGlobalFallback: true }),
            automation_level: userSettingsService.getUserSetting(userId, 'automation_level', { allowGlobalFallback: true }),
            system_status: userSettingsService.getUserSetting(userId, 'system_status', { allowGlobalFallback: true })
        };

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
        const userId = req.session.userId;
        const allowedKeys = [
            'dry_run', 'anomaly_threshold', 'metric_interval',
            'aws_region', 'automation_level', 'system_status'
        ];

        let shouldRefreshAws = false;
        let shouldRestartCollector = false;

        for (const [key, value] of Object.entries(req.body)) {
            if (allowedKeys.includes(key)) {
                if (key === 'metric_interval') {
                    const parsedInterval = parseInt(value, 10);

                    if (!Number.isFinite(parsedInterval)) {
                        return res.status(400).json({ error: 'Metric interval must be a number in milliseconds' });
                    }

                    if (parsedInterval < MIN_METRIC_INTERVAL_MS || parsedInterval > MAX_METRIC_INTERVAL_MS) {
                        return res.status(400).json({
                            error: `Metric interval must be between ${MIN_METRIC_INTERVAL_MS} and ${MAX_METRIC_INTERVAL_MS} milliseconds`
                        });
                    }
                }

                userSettingsService.setUserSetting(userId, key, String(value));

                if (key === 'aws_region') {
                    shouldRefreshAws = true;
                }

                if (key === 'metric_interval') {
                    shouldRestartCollector = true;
                }
            }
        }

        if (req.body.dry_run !== undefined) {
            automationService.setDryRun(userId, req.body.dry_run);
        }

        if (req.body.automation_level !== undefined) {
            automationService.setAutomationLevel(userId, req.body.automation_level);
        }

        if (shouldRefreshAws) {
            awsService.refreshClients(userId);
            await awsService.testConnection(userId);
        }

        if (shouldRestartCollector) {
            metricCollector.restart();
        }

        loggerService.info('api', 'Settings updated', req.body);

        res.json({
            success: true,
            message: 'Settings updated',
            awsConnected: awsService.getConnectionState(userId)
        });
    } catch (error) {
        loggerService.error('api', 'Failed to update settings', { error: error.message });
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// POST /api/settings/aws-credentials - Set AWS credentials
router.post('/aws-credentials', async (req, res) => {
    try {
        const userId = req.session.userId;
        const { accessKeyId, secretAccessKey, region } = req.body;

        if (!accessKeyId || !secretAccessKey) {
            return res.status(400).json({ error: 'Access key and secret are required' });
        }

        userSettingsService.setUserSetting(userId, 'aws_access_key_id', cryptoService.encryptText(accessKeyId));
        userSettingsService.setUserSetting(userId, 'aws_secret_access_key', cryptoService.encryptText(secretAccessKey));

        if (region) {
            userSettingsService.setUserSetting(userId, 'aws_region', region);
        }

        awsService.refreshClients(userId);
        const awsConnected = await awsService.testConnection(userId);

        loggerService.info('api', 'AWS credentials updated', { userId });

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
