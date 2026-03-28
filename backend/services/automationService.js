const { queryAll, queryOne, runSql } = require('../config/database');
const awsService = require('./awsService');
const loggerService = require('./loggerService');
const { v4: uuidv4 } = require('uuid');

let isDryRun = true;
let automationLevel = 'ask';

function normalizeBoolean(value) {
    return value === true || value === 'true';
}

function initialize() {
    const dryRunSetting = queryOne('SELECT value FROM settings WHERE key = ?', ['dry_run']);
    const automationLevelSetting = queryOne('SELECT value FROM settings WHERE key = ?', ['automation_level']);

    isDryRun = normalizeBoolean(dryRunSetting?.value);
    automationLevel = automationLevelSetting?.value || 'ask';

    loggerService.info('automation', `Automation engine initialized (dry_run: ${isDryRun}, level: ${automationLevel})`);
}

function setDryRun(value) {
    isDryRun = normalizeBoolean(value);
    runSql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
        ['dry_run', isDryRun.toString(), new Date().toISOString()]);
    loggerService.info('automation', `Dry run mode ${isDryRun ? 'enabled' : 'disabled'}`);
}

function setAutomationLevel(value) {
    automationLevel = ['suggest', 'ask', 'auto'].includes(value) ? value : 'ask';
    runSql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
        ['automation_level', automationLevel, new Date().toISOString()]);
    loggerService.info('automation', `Automation level set to ${automationLevel}`);
}

async function executeAction(actionId) {
    const action = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);

    if (!action) {
        throw new Error('Action not found');
    }

    if (action.status !== 'approved') {
        throw new Error('Action must be approved before execution');
    }

        const dryRun = Boolean(action.dry_run);
        const actionMessage = dryRun 
            ? `Successfully simulated ${action.action_type} (Dry Run)`
            : `Successfully executed ${action.action_type}`;

        loggerService.info('automation', `Executing action ${actionId}`, { type: action.action_type, dryRun });

        try {
            let result;

            switch (action.action_type) {
                case 'STOP_INSTANCE':
                    result = await awsService.stopInstance(action.resource_id, dryRun);
                    break;
                case 'START_INSTANCE':
                    result = await awsService.startInstance(action.resource_id, dryRun);
                    break;
                case 'SEND_ALERT':
                    // SEND_ALERT is an internal notification action, no AWS call needed
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

            runSql(`
                UPDATE actions SET status = 'executed', executed_at = ?, result = ? WHERE id = ?
            `, [new Date().toISOString(), JSON.stringify(finalResult), actionId]);

        if (action.anomaly_id) {
            runSql(`UPDATE anomalies SET status = 'resolved', updated_at = ? WHERE id = ?`,
                [new Date().toISOString(), action.anomaly_id]);
        }

        loggerService.log(
            dryRun ? 'info' : 'warn',
            'automation',
            `Action ${actionId} executed ${dryRun ? '(DRY RUN)' : ''}`,
            { result },
            action.resource_id,
            action.action_type
        );

        return { success: true, result, dryRun };
    } catch (error) {
        runSql(`UPDATE actions SET status = 'failed', error = ? WHERE id = ?`,
            [error.message, actionId]);

        loggerService.error('automation', `Action ${actionId} failed`, { error: error.message });
        throw error;
    }
}

function isCrucial(resourceName, actionType) {
    const crucialKeywords = ['prod', 'production', 'main', 'primary', 'critical', 'database', 'db', 'master'];
    const lowerName = (resourceName || '').toLowerCase();

    const isCrucialResource = crucialKeywords.some(keyword => lowerName.includes(keyword));

    // For now, stopping instances is the primary disruptive action
    const isDisruptiveAction = ['STOP_INSTANCE', 'STOP_RDS'].includes(actionType);

    return isCrucialResource && isDisruptiveAction;
}

function createAction(anomalyId, resourceId, resourceName, actionType, estimatedSavings = 0, confidence = 0) {
    if (!['STOP_INSTANCE', 'START_INSTANCE', 'SEND_ALERT'].includes(actionType)) {
        loggerService.info('automation', 'Skipping unsupported action type', { resourceId, actionType });
        return null;
    }

    const recentAction = queryOne(`
        SELECT * FROM actions
        WHERE resource_id = ? AND action_type = ?
        AND created_at > datetime('now', '-5 minutes')
        AND status IN ('pending', 'approved', 'executed')
    `, [resourceId, actionType]);

    if (recentAction) {
        loggerService.info('automation', 'Action skipped due to cooldown', { resourceId, actionType });
        return null;
    }

    const actionId = `action_${uuidv4().slice(0, 8)}`;
    const crucial = isCrucial(resourceName, actionType);
    const isNotificationOnly = actionType === 'SEND_ALERT';

    // automationLevel enforcement:
    // 'suggest' - Never auto-approve; everything goes to pending
    // 'ask'    - Auto-approve if: not crucial OR confidence < 0.5; require approval if crucial AND confidence >= 0.5
    // 'auto'   - Auto-approve if: not crucial; crucial resources always need approval
    let requiresApproval = true;

    if (isNotificationOnly) {
        // SEND_ALERT is always safe to auto-approve
        requiresApproval = false;
    } else if (automationLevel === 'suggest') {
        // In suggest mode, nothing is auto-approved
        requiresApproval = true;
    } else if (automationLevel === 'ask') {
        // In ask mode, auto-approve low-confidence or non-crucial actions
        requiresApproval = crucial && confidence >= 0.5;
    } else if (automationLevel === 'auto') {
        // In auto mode, auto-approve non-crucial actions
        requiresApproval = crucial;
    }

    const initialStatus = requiresApproval ? 'pending' : 'approved';

    runSql(`
        INSERT INTO actions (
            id, anomaly_id, resource_id, resource_name, action_type,
            status, dry_run, requires_approval, savings
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        actionId,
        anomalyId,
        resourceId,
        resourceName,
        actionType,
        initialStatus,
        isDryRun ? 1 : 0,
        requiresApproval ? 1 : 0,
        estimatedSavings
    ]);

    // Auto-approve and execute in 'auto' mode for non-crucial actions
    if (!requiresApproval && automationLevel === 'auto' && !isDryRun) {
        // Execute asynchronously to avoid blocking
        setImmediate(() => {
            try {
                const action = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
                if (action && action.status === 'approved') {
                    executeAction(actionId);
                }
            } catch (err) {
                loggerService.error('automation', `Auto-execute failed for ${actionId}`, { error: err.message });
            }
        });
    }

    loggerService.info('automation', 'Action created', {
        id: actionId,
        type: actionType,
        resource: resourceId,
        confidence,
        crucial,
        requiresApproval,
        automationLevel
    });

    return actionId;
}

function approveAction(actionId, approver = 'admin') {
    const action = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
    if (!action) {
        throw new Error('Action not found');
    }

    if (action.status !== 'pending') {
        throw new Error('Only pending actions can be approved');
    }

    runSql(`
        UPDATE actions SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ?
    `, [new Date().toISOString(), approver, actionId]);

    loggerService.info('automation', `Action ${actionId} approved by ${approver}`);

    return queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
}

function dismissAction(actionId) {
    runSql(`UPDATE actions SET status = 'dismissed' WHERE id = ?`, [actionId]);
    loggerService.info('automation', `Action ${actionId} dismissed`);
    return queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
}

function getPendingActions() {
    return queryAll(`SELECT * FROM actions WHERE status = 'pending' ORDER BY created_at DESC`);
}

function getActionHistory(limit = 50) {
    return queryAll(`SELECT * FROM actions ORDER BY created_at DESC LIMIT ?`, [limit]);
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
    isDryRun: () => isDryRun,
    getAutomationLevel: () => automationLevel,
    setAutomationLevel
};
