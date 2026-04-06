const express = require('express');
const router = express.Router();
const { queryAll, queryOne } = require('../config/database');
const loggerService = require('../services/loggerService');
const automationService = require('../services/automationService');

// GET /api/recommendations - Get cost optimization recommendations
router.get('/', (req, res) => {
    try {
        const userId = req.session.userId;

        const anomalies = queryAll(`
            SELECT * FROM anomalies
            WHERE user_id = ?
            AND recommended_action IN ('STOP_INSTANCE', 'SET_LIFECYCLE')
            AND status = 'new'
            ORDER BY detected_at DESC
        `, [userId]);

        const recommendations = anomalies.map((a) => ({
            id: `rec_${a.id}`,
            type: a.recommended_action === 'STOP_INSTANCE' ? 'STOP_IDLE' : 'STORAGE_OPTIMIZATION',
            resourceId: a.resource_id,
            resourceName: a.resource_name,
            resourceType: a.resource_type,
            action: a.recommended_action,
            monthlySavings: a.estimated_savings,
            confidence: a.confidence,
            reason: getReasonForType(a.anomaly_type),
            detectedAt: a.detected_at,
            anomalyId: a.id
        }));

        const idleResources = queryAll(`
            SELECT
                m.resource_id,
                m.resource_name,
                m.resource_type,
                AVG(CASE WHEN m.metric_type = 'cpu_utilization' THEN m.value END) as avg_cpu,
                SUM(CASE WHEN m.metric_type = 'network_in' THEN m.value ELSE 0 END) +
                SUM(CASE WHEN m.metric_type = 'network_out' THEN m.value ELSE 0 END) as total_network
            FROM metrics m
            WHERE m.user_id = ?
            AND m.timestamp >= datetime('now', '-24 hours')
            GROUP BY m.resource_id, m.resource_name, m.resource_type
            HAVING COALESCE(avg_cpu, 0) < 10 AND COALESCE(total_network, 0) < 10000
        `, [userId]);

        for (const resource of idleResources) {
            const exists = recommendations.find((r) => r.resourceId === resource.resource_id);
            if (!exists) {
                recommendations.push({
                    id: `rec_idle_${resource.resource_id}`,
                    type: 'STOP_IDLE',
                    resourceId: resource.resource_id,
                    resourceName: resource.resource_name,
                    resourceType: resource.resource_type,
                    action: 'STOP_INSTANCE',
                    monthlySavings: 25.0,
                    confidence: 0.85,
                    reason: `CPU utilization avg ${resource.avg_cpu?.toFixed(1)}% over 24 hours - likely idle`,
                    detectedAt: new Date().toISOString(),
                    anomalyId: null
                });
            }
        }

        const totalSavings = recommendations.reduce((sum, recommendation) => sum + (recommendation.monthlySavings || 0), 0);

        res.json({
            data: recommendations,
            count: recommendations.length,
            totalPotentialSavings: totalSavings
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch recommendations', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch recommendations' });
    }
});

function getReasonForType(type) {
    const reasons = {
        IDLE_INSTANCE: 'Very low CPU and network activity detected',
        ZOMBIE_INSTANCE: 'No network traffic for extended period',
        SCHEDULED_WASTE: 'Active during typically off-hours',
        UNUSED_S3: 'No access for 30+ days'
    };

    return reasons[type] || 'Anomaly detected by ML model';
}

// POST /api/recommendations/execute - Execute a recommendation (create action)
router.post('/execute', (req, res) => {
    try {
        const userId = req.session.userId;
        const { anomalyId, resourceId, resourceName, action, monthlySavings, confidence } = req.body;

        if (!resourceId || !action) {
            return res.status(400).json({ error: 'resourceId and action are required' });
        }

        const actionId = automationService.createAction(
            anomalyId || null,
            resourceId,
            resourceName || resourceId,
            action,
            monthlySavings || 0,
            confidence || 0.5,
            userId
        );

        if (!actionId) {
            return res.status(429).json({ error: 'Action recently created for this resource' });
        }

        const actionData = queryOne('SELECT * FROM actions WHERE id = ? AND user_id = ?', [actionId, userId]);

        res.json({
            success: true,
            actionId,
            requiresApproval: actionData?.requires_approval,
            message: actionData?.requires_approval
                ? 'Action created and pending approval. Check Action Center.'
                : 'Action auto-approved. Check Action Center for status.'
        });
    } catch (error) {
        loggerService.log('error', 'api', 'Failed to execute recommendation', { error: error.message });
        res.status(500).json({ error: 'Failed to execute recommendation' });
    }
});

module.exports = router;
