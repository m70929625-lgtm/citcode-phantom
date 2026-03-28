const express = require('express');
const router = express.Router();
const { queryAll, queryOne, runSql } = require('../config/database');
const automationService = require('../services/automationService');
const loggerService = require('../services/loggerService');

// GET /api/actions - Get all actions
router.get('/', (req, res) => {
    try {
        const { status, resourceId, limit = 100 } = req.query;

        let query = `
            SELECT a.*, an.anomaly_type 
            FROM actions a
            LEFT JOIN anomalies an ON a.anomaly_id = an.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND a.status = ?';
            params.push(status);
        }

        if (resourceId) {
            query += ' AND a.resource_id = ?';
            params.push(resourceId);
        }

        query += ' ORDER BY a.created_at DESC LIMIT ?';
        params.push(parseInt(limit));

        const data = queryAll(query, params);

        res.json({
            data: data.map(a => ({
                id: a.id,
                anomalyId: a.anomaly_id,
                anomalyType: a.anomaly_type,
                resourceId: a.resource_id,
                resourceName: a.resource_name,
                actionType: a.action_type,
                params: a.action_params ? JSON.parse(a.action_params) : null,
                status: a.status,
                dryRun: Boolean(a.dry_run),
                requiresApproval: Boolean(a.requires_approval),
                createdAt: a.created_at,
                approvedAt: a.approved_at,
                approvedBy: a.approved_by,
                executedAt: a.executed_at,
                executedBy: a.executed_by,
                result: a.result ? JSON.parse(a.result) : null,
                error: a.error,
                savings: a.savings
            })),
            count: data.length
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch actions', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch actions' });
    }
});

// GET /api/actions/pending - Get pending actions
router.get('/pending', (req, res) => {
    try {
        const actions = automationService.getPendingActions();

        res.json({
            data: actions.map(a => ({
                id: a.id,
                anomalyId: a.anomaly_id,
                resourceId: a.resource_id,
                resourceName: a.resource_name,
                actionType: a.action_type,
                status: a.status,
                dryRun: Boolean(a.dry_run),
                requiresApproval: Boolean(a.requires_approval),
                createdAt: a.created_at,
                savings: a.savings
            })),
            count: actions.length
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch pending actions', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch pending actions' });
    }
});

// GET /api/actions/:id - Get single action
router.get('/:id', (req, res) => {
    try {
        const action = queryOne('SELECT * FROM actions WHERE id = ?', [req.params.id]);

        if (!action) {
            return res.status(404).json({ error: 'Action not found' });
        }

        res.json({
            id: action.id,
            anomalyId: action.anomaly_id,
            resourceId: action.resource_id,
            resourceName: action.resource_name,
            actionType: action.action_type,
            params: action.action_params ? JSON.parse(action.action_params) : null,
            status: action.status,
            dryRun: Boolean(action.dry_run),
            requiresApproval: Boolean(action.requires_approval),
            createdAt: action.created_at,
            approvedAt: action.approved_at,
            approvedBy: action.approved_by,
            executedAt: action.executed_at,
            executedBy: action.executed_by,
            result: action.result ? JSON.parse(action.result) : null,
            error: action.error,
            savings: action.savings
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch action', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch action' });
    }
});

// POST /api/actions/:id/approve - Approve an action
router.post('/:id/approve', (req, res) => {
    try {
        const { approver = 'admin' } = req.body;
        const action = automationService.approveAction(req.params.id, approver);

        if (!action) {
            return res.status(404).json({ error: 'Action not found' });
        }

        res.json({
            success: true,
            action: {
                id: action.id,
                status: action.status,
                approvedAt: action.approved_at,
                approver: action.approved_by
            }
        });
    } catch (error) {
        loggerService.error('api', 'Failed to approve action', { error: error.message });
        res.status(500).json({ error: 'Failed to approve action' });
    }
});

// POST /api/actions/:id/execute - Execute an approved action
router.post('/:id/execute', async (req, res) => {
    try {
        const result = await automationService.executeAction(req.params.id);
        res.json({
            success: true,
            action: result
        });
    } catch (error) {
        loggerService.error('api', 'Failed to execute action', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/actions/:id/dismiss - Dismiss an action
router.post('/:id/dismiss', (req, res) => {
    try {
        const action = automationService.dismissAction(req.params.id);

        if (!action) {
            return res.status(404).json({ error: 'Action not found' });
        }

        res.json({
            success: true,
            action: {
                id: action.id,
                status: action.status
            }
        });
    } catch (error) {
        loggerService.error('api', 'Failed to dismiss action', { error: error.message });
        res.status(500).json({ error: 'Failed to dismiss action' });
    }
});

// GET /api/actions/stats/summary - Get action statistics
router.get('/stats/summary', (req, res) => {
    try {
        const stats = queryOne(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN status = 'executed' THEN 1 ELSE 0 END) as executed,
                SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(savings) as total_savings
            FROM actions
        `);

        const recentActivity = queryAll(`
            SELECT * FROM actions
            ORDER BY created_at DESC
            LIMIT 10
        `);

        res.json({
            total: stats?.total || 0,
            byStatus: {
                pending: stats?.pending || 0,
                approved: stats?.approved || 0,
                executed: stats?.executed || 0,
                dismissed: stats?.dismissed || 0,
                failed: stats?.failed || 0
            },
            totalSavings: stats?.total_savings || 0,
            recentActivity: recentActivity.map(a => ({
                id: a.id,
                resourceName: a.resource_name,
                actionType: a.action_type,
                status: a.status,
                createdAt: a.created_at,
                savings: a.savings
            }))
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch action stats', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch action stats' });
    }
});

module.exports = router;
