const express = require('express');
const router = express.Router();
const alertService = require('../services/alertService');
const loggerService = require('../services/loggerService');

// GET /api/alerts - List alerts with filtering
router.get('/', (req, res) => {
    try {
        const userId = req.session.userId;
        const { acknowledged, severity, limit = 50 } = req.query;

        const alerts = alertService.getAllAlerts(userId, {
            acknowledged: acknowledged !== undefined ? acknowledged === 'true' : null,
            severity: severity || null,
            limit: parseInt(limit, 10)
        });

        res.json({
            data: alerts.map(a => ({
                id: a.id,
                type: a.type,
                severity: a.severity,
                title: a.title,
                message: a.message,
                resourceId: a.resource_id,
                resourceName: a.resource_name,
                actionId: a.action_id,
                anomalyId: a.anomaly_id,
                acknowledged: Boolean(a.acknowledged),
                createdAt: a.created_at
            })),
            count: alerts.length
        });
    } catch (error) {
        loggerService.log('error', 'api', 'Failed to fetch alerts', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch alerts' });
    }
});

// GET /api/alerts/active - Get unacknowledged alerts
router.get('/active', (req, res) => {
    try {
        const userId = req.session.userId;
        const alerts = alertService.getActiveAlerts(userId, 20);

        res.json({
            data: alerts.map(a => ({
                id: a.id,
                type: a.type,
                severity: a.severity,
                title: a.title,
                message: a.message,
                resourceId: a.resource_id,
                resourceName: a.resource_name,
                createdAt: a.created_at
            })),
            count: alerts.length
        });
    } catch (error) {
        loggerService.log('error', 'api', 'Failed to fetch active alerts', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch active alerts' });
    }
});

// GET /api/alerts/counts - Get alert counts by severity
router.get('/counts', (req, res) => {
    try {
        const userId = req.session.userId;
        const counts = alertService.getAlertCounts(userId);
        res.json(counts);
    } catch (error) {
        loggerService.log('error', 'api', 'Failed to fetch alert counts', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch alert counts' });
    }
});

// POST /api/alerts/:id/acknowledge - Acknowledge a single alert
router.post('/:id/acknowledge', (req, res) => {
    try {
        const userId = req.session.userId;
        const alert = alertService.acknowledgeAlert(userId, req.params.id);

        if (!alert) {
            return res.status(404).json({ error: 'Alert not found' });
        }

        res.json({
            success: true,
            alert: {
                id: alert.id,
                acknowledged: Boolean(alert.acknowledged)
            }
        });
    } catch (error) {
        loggerService.log('error', 'api', 'Failed to acknowledge alert', { error: error.message });
        res.status(500).json({ error: 'Failed to acknowledge alert' });
    }
});

// POST /api/alerts/acknowledge-all - Acknowledge all alerts
router.post('/acknowledge-all', (req, res) => {
    try {
        const userId = req.session.userId;
        alertService.acknowledgeAllAlerts(userId);
        res.json({ success: true, message: 'All alerts acknowledged' });
    } catch (error) {
        loggerService.log('error', 'api', 'Failed to acknowledge all alerts', { error: error.message });
        res.status(500).json({ error: 'Failed to acknowledge all alerts' });
    }
});

module.exports = router;
