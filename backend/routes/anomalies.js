const express = require('express');
const router = express.Router();
const { queryAll, queryOne, runSql } = require('../config/database');
const loggerService = require('../services/loggerService');

// GET /api/anomalies - Get detected anomalies
router.get('/', (req, res) => {
    try {
        const userId = req.session.userId;
        const { status, minScore, limit = 100 } = req.query;

        let query = 'SELECT * FROM anomalies WHERE user_id = ?';
        const params = [userId];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        if (minScore) {
            query += ' AND anomaly_score >= ?';
            params.push(parseFloat(minScore));
        }

        query += ' ORDER BY detected_at DESC LIMIT ?';
        params.push(parseInt(limit));

        const data = queryAll(query, params);

        const summary = queryOne(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
                SUM(CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END) as acknowledged_count,
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count
            FROM anomalies
            WHERE user_id = ?
        `, [userId]);

        res.json({
            data: data.map(a => ({
                id: a.id,
                resourceId: a.resource_id,
                resourceName: a.resource_name,
                resourceType: a.resource_type,
                type: a.anomaly_type,
                detectedAt: a.detected_at,
                score: a.anomaly_score,
                confidence: a.confidence,
                features: a.features ? JSON.parse(a.features) : null,
                recommendedAction: a.recommended_action,
                estimatedSavings: a.estimated_savings,
                status: a.status,
                actionRequired: a.recommended_action !== 'SEND_ALERT' && a.recommended_action !== 'REVIEW'
            })),
            count: data.length,
            summary: {
                total: summary?.total || 0,
                new: summary?.new_count || 0,
                acknowledged: summary?.acknowledged_count || 0,
                resolved: summary?.resolved_count || 0
            }
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch anomalies', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch anomalies' });
    }
});

// GET /api/anomalies/:id - Get single anomaly
router.get('/:id', (req, res) => {
    try {
        const userId = req.session.userId;
        const anomaly = queryOne('SELECT * FROM anomalies WHERE id = ? AND user_id = ?', [req.params.id, userId]);

        if (!anomaly) {
            return res.status(404).json({ error: 'Anomaly not found' });
        }

        const actions = queryAll('SELECT * FROM actions WHERE anomaly_id = ? AND user_id = ?', [req.params.id, userId]);

        res.json({
            id: anomaly.id,
            resourceId: anomaly.resource_id,
            resourceName: anomaly.resource_name,
            resourceType: anomaly.resource_type,
            type: anomaly.anomaly_type,
            detectedAt: anomaly.detected_at,
            score: anomaly.anomaly_score,
            confidence: anomaly.confidence,
            features: anomaly.features ? JSON.parse(anomaly.features) : null,
            recommendedAction: anomaly.recommended_action,
            estimatedSavings: anomaly.estimated_savings,
            status: anomaly.status,
            createdAt: anomaly.created_at,
            updatedAt: anomaly.updated_at,
            actions: actions.map(a => ({
                id: a.id,
                type: a.action_type,
                status: a.status,
                createdAt: a.created_at
            }))
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch anomaly', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch anomaly' });
    }
});

// PATCH /api/anomalies/:id - Update anomaly status
router.patch('/:id', (req, res) => {
    try {
        const userId = req.session.userId;
        const { status } = req.body;

        if (!['new', 'acknowledged', 'resolved'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const result = runSql(`
            UPDATE anomalies SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?
        `, [status, new Date().toISOString(), req.params.id, userId]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Anomaly not found' });
        }

        loggerService.info('api', `Anomaly ${req.params.id} status updated to ${status}`);

        const updated = queryOne('SELECT * FROM anomalies WHERE id = ? AND user_id = ?', [req.params.id, userId]);
        res.json({ success: true, anomaly: updated });
    } catch (error) {
        loggerService.error('api', 'Failed to update anomaly', { error: error.message });
        res.status(500).json({ error: 'Failed to update anomaly' });
    }
});

module.exports = router;
