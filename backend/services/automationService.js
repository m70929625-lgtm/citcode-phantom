const { queryAll, queryOne, runSql } = require('../config/database');
const awsService = require('./awsService');
const loggerService = require('./loggerService');
const userSettingsService = require('./userSettingsService');
const { v4: uuidv4 } = require('uuid');

function normalizeBoolean(value) {
    return value === true || value === 'true';
}

function getDryRunSetting(userId = null) {
    return normalizeBoolean(userSettingsService.getUserSetting(userId, 'dry_run', { allowGlobalFallback: true }));
}

function getAutomationLevelSetting(userId = null) {
    const value = userSettingsService.getUserSetting(userId, 'automation_level', { allowGlobalFallback: true });
    return ['suggest', 'ask', 'auto'].includes(value) ? value : 'ask';
}

function initialize() {
    loggerService.info('automation', 'Automation engine initialized (user-scoped settings enabled)');
}

function setDryRun(userId, value) {
    userSettingsService.setUserSetting(userId, 'dry_run', normalizeBoolean(value).toString());
    loggerService.info('automation', 'Dry run mode updated', { userId, dryRun: normalizeBoolean(value) });
}

function setAutomationLevel(userId, value) {
    const level = ['suggest', 'ask', 'auto'].includes(value) ? value : 'ask';
    userSettingsService.setUserSetting(userId, 'automation_level', level);
    loggerService.info('automation', 'Automation level updated', { userId, automationLevel: level });
}

async function executeAction(actionId) {
    const action = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);

    if (!action) {
        throw new Error('Action not found');
    }

    if (action.status !== 'approved') {
        throw new Error('Action must be approved before execution');
    }

    const userId = action.user_id || null;
    const dryRun = Boolean(action.dry_run);
    const actionMessage = dryRun
        ? `Successfully simulated ${action.action_type} (Dry Run)`
        : `Successfully executed ${action.action_type}`;

    loggerService.info('automation', `Executing action ${actionId}`, { type: action.action_type, dryRun, userId });

    try {
        let result;

        switch (action.action_type) {
            case 'STOP_INSTANCE':
                result = await awsService.stopInstance(action.resource_id, dryRun, userId);
                break;
            case 'START_INSTANCE':
                result = await awsService.startInstance(action.resource_id, dryRun, userId);
                break;
            case 'SEND_ALERT':
                result = {
                    success: true,
                    message: 'Cost anomaly alert sent',
                    notificationType: 'COST_ANOMALY',
                    timestamp: new Date().toISOString()
                };
                break;
            default:
                throw new Error(`Unknown action type: ${action.action_type}`);
        }

        const finalResult = {
            ...result,
            message: actionMessage,
            timestamp: new Date().toISOString()
        };

        runSql('UPDATE actions SET status = ?, executed_at = ?, result = ? WHERE id = ?', [
            'executed',
            new Date().toISOString(),
            JSON.stringify(finalResult),
            actionId
        ]);

        if (action.anomaly_id) {
            runSql('UPDATE anomalies SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?', [
                'resolved',
                new Date().toISOString(),
                action.anomaly_id,
                userId
            ]);
        }

        loggerService.log(
            dryRun ? 'info' : 'warn',
            'automation',
            `Action ${actionId} executed ${dryRun ? '(DRY RUN)' : ''}`,
            { result, userId },
            action.resource_id,
            action.action_type
        );

        return { success: true, result, dryRun };
    } catch (error) {
        runSql('UPDATE actions SET status = ?, error = ? WHERE id = ?', ['failed', error.message, actionId]);
        loggerService.error('automation', `Action ${actionId} failed`, { error: error.message, userId });
        throw error;
    }
}

function isCrucial(resourceName, actionType) {
    const crucialKeywords = ['prod', 'production', 'main', 'primary', 'critical', 'database', 'db', 'master'];
    const lowerName = (resourceName || '').toLowerCase();

    const isCrucialResource = crucialKeywords.some((keyword) => lowerName.includes(keyword));
    const isDisruptiveAction = ['STOP_INSTANCE', 'STOP_RDS'].includes(actionType);

    return isCrucialResource && isDisruptiveAction;
}

function resolveActionUserId(providedUserId, anomalyId) {
    if (providedUserId) return providedUserId;
    if (!anomalyId) return null;
    return queryOne('SELECT user_id FROM anomalies WHERE id = ?', [anomalyId])?.user_id || null;
}

function createAction(anomalyId, resourceId, resourceName, actionType, estimatedSavings = 0, confidence = 0, userId = null) {
    if (!['STOP_INSTANCE', 'START_INSTANCE', 'SEND_ALERT'].includes(actionType)) {
        loggerService.info('automation', 'Skipping unsupported action type', { resourceId, actionType, userId });
        return null;
    }

    const scopedUserId = resolveActionUserId(userId, anomalyId);
    if (!scopedUserId) {
        loggerService.warn('automation', 'Cannot create action without user scope', { actionType, resourceId, anomalyId });
        return null;
    }

    const recentAction = queryOne(`
        SELECT * FROM actions
        WHERE user_id = ? AND resource_id = ? AND action_type = ?
        AND created_at > datetime('now', '-5 minutes')
        AND status IN ('pending', 'approved', 'executed')
    `, [scopedUserId, resourceId, actionType]);

    if (recentAction) {
        loggerService.info('automation', 'Action skipped due to cooldown', { userId: scopedUserId, resourceId, actionType });
        return null;
    }

    const actionId = `action_${uuidv4().slice(0, 8)}`;
    const crucial = isCrucial(resourceName, actionType);
    const isNotificationOnly = actionType === 'SEND_ALERT';
    const dryRun = getDryRunSetting(scopedUserId);
    const automationLevel = getAutomationLevelSetting(scopedUserId);

    let requiresApproval = true;

    if (isNotificationOnly) {
        requiresApproval = false;
    } else if (automationLevel === 'suggest') {
        requiresApproval = true;
    } else if (automationLevel === 'ask') {
        requiresApproval = crucial && confidence >= 0.5;
    } else if (automationLevel === 'auto') {
        requiresApproval = crucial;
    }

    const initialStatus = requiresApproval ? 'pending' : 'approved';

    runSql(`
        INSERT INTO actions (
            id, user_id, anomaly_id, resource_id, resource_name, action_type,
            status, dry_run, requires_approval, savings
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        actionId,
        scopedUserId,
        anomalyId,
        resourceId,
        resourceName,
        actionType,
        initialStatus,
        dryRun ? 1 : 0,
        requiresApproval ? 1 : 0,
        estimatedSavings
    ]);

    if (!requiresApproval && automationLevel === 'auto' && !dryRun) {
        setImmediate(() => {
            try {
                const action = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
                if (action && action.status === 'approved') {
                    executeAction(actionId);
                }
            } catch (err) {
                loggerService.error('automation', `Auto-execute failed for ${actionId}`, { error: err.message, userId: scopedUserId });
            }
        });
    }

    loggerService.info('automation', 'Action created', {
        id: actionId,
        userId: scopedUserId,
        type: actionType,
        resource: resourceId,
        confidence,
        crucial,
        requiresApproval,
        automationLevel
    });

    return actionId;
}

function approveAction(actionId, approver = 'admin', userId = null) {
    const action = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
    if (!action) {
        throw new Error('Action not found');
    }

    if (userId && action.user_id !== userId) {
        throw new Error('Action not found');
    }

    if (action.status !== 'pending') {
        throw new Error('Only pending actions can be approved');
    }

    runSql('UPDATE actions SET status = ?, approved_at = ?, approved_by = ? WHERE id = ?', [
        'approved',
        new Date().toISOString(),
        approver,
        actionId
    ]);

    loggerService.info('automation', `Action ${actionId} approved`, { userId: action.user_id, approver });
    return queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
}

function dismissAction(actionId, userId = null) {
    const action = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
    if (!action || (userId && action.user_id !== userId)) {
        throw new Error('Action not found');
    }

    runSql('UPDATE actions SET status = ? WHERE id = ?', ['dismissed', actionId]);
    loggerService.info('automation', `Action ${actionId} dismissed`, { userId: action.user_id });
    return queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
}

function getPendingActions(userId) {
    return queryAll('SELECT * FROM actions WHERE user_id = ? AND status = ? ORDER BY created_at DESC', [userId, 'pending']);
}

function getActionHistory(userId, limit = 50) {
    return queryAll('SELECT * FROM actions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
}

module.exports = {
    initialize,
    setDryRun,
    executeAction,
    createAction,
    approveAction,
    dismissAction,
    getPendingActions,
    getActionHistory,
    isDryRun: getDryRunSetting,
    getAutomationLevel: getAutomationLevelSetting,
    setAutomationLevel
};
