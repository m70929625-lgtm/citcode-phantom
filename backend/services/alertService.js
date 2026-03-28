const { queryAll, queryOne, runSql } = require('../config/database');
const loggerService = require('./loggerService');
const { v4: uuidv4 } = require('uuid');

const ALERT_TYPES = {
    ANOMALY: 'anomaly',
    COST_SPIKE: 'cost_spike',
    ACTION_EXECUTED: 'action_executed',
    ACTION_AUTO_APPROVED: 'action_auto_approved',
    CRITICAL: 'critical',
    INFO: 'info'
};

const SEVERITY = {
    INFO: 'info',
    WARNING: 'warning',
    CRITICAL: 'critical'
};

function createAlert({
    type,
    severity = SEVERITY.INFO,
    title,
    message,
    resourceId = null,
    resourceName = null,
    actionId = null,
    anomalyId = null
}) {
    const alertId = `alert_${uuidv4().slice(0, 8)}`;

    runSql(`
        INSERT INTO alerts (id, type, severity, title, message, resource_id, resource_name, action_id, anomaly_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [alertId, type, severity, title, message, resourceId, resourceName, actionId, anomalyId]);

    loggerService.info('alerts', `Alert created: ${title}`, { id: alertId, type, severity, resourceId });

    return alertId;
}

function getActiveAlerts(limit = 20) {
    return queryAll(`
        SELECT * FROM alerts
        WHERE acknowledged = 0
        ORDER BY
            CASE severity
                WHEN 'critical' THEN 1
                WHEN 'warning' THEN 2
                WHEN 'info' THEN 3
            END,
            created_at DESC
        LIMIT ?
    `, [limit]);
}

function getAllAlerts({ acknowledged = null, limit = 50, severity = null } = {}) {
    let query = 'SELECT * FROM alerts WHERE 1=1';
    const params = [];

    if (acknowledged !== null) {
        query += ' AND acknowledged = ?';
        params.push(acknowledged ? 1 : 0);
    }

    if (severity) {
        query += ' AND severity = ?';
        params.push(severity);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    return queryAll(query, params);
}

function acknowledgeAlert(alertId) {
    const alert = queryOne('SELECT * FROM alerts WHERE id = ?', [alertId]);
    if (!alert) return null;

    runSql('UPDATE alerts SET acknowledged = 1 WHERE id = ?', [alertId]);
    loggerService.info('alerts', `Alert acknowledged: ${alertId}`);
    return queryOne('SELECT * FROM alerts WHERE id = ?', [alertId]);
}

function acknowledgeAllAlerts() {
    runSql('UPDATE alerts SET acknowledged = 1 WHERE acknowledged = 0');
    loggerService.info('alerts', 'All alerts acknowledged');
}

function deleteAlert(alertId) {
    runSql('DELETE FROM alerts WHERE id = ?', [alertId]);
    loggerService.info('alerts', `Alert deleted: ${alertId}`);
}

function getAlertCounts() {
    return queryOne(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN acknowledged = 0 THEN 1 ELSE 0 END) as unacknowledged,
            SUM(CASE WHEN severity = 'critical' AND acknowledged = 0 THEN 1 ELSE 0 END) as critical,
            SUM(CASE WHEN severity = 'warning' AND acknowledged = 0 THEN 1 ELSE 0 END) as warning,
            SUM(CASE WHEN severity = 'info' AND acknowledged = 0 THEN 1 ELSE 0 END) as info
        FROM alerts
    `);
}

// Create standard alert templates
function alertAnomalyDetected(anomaly, confidence, action) {
    const severity = confidence >= 0.7 ? SEVERITY.CRITICAL : confidence >= 0.5 ? SEVERITY.WARNING : SEVERITY.INFO;

    let actionText = '';
    if (action === 'STOP_INSTANCE') {
        actionText = 'Will attempt to stop the instance to save costs.';
    } else if (action === 'START_INSTANCE') {
        actionText = 'Will start the instance.';
    } else if (action === 'SEND_ALERT') {
        actionText = 'Manual review recommended.';
    } else {
        actionText = `Recommended action: ${action}`;
    }

    return createAlert({
        type: ALERT_TYPES.ANOMALY,
        severity,
        title: `Cost Anomaly: ${anomaly.type}`,
        message: `${anomaly.resourceName} (${anomaly.resourceType}) shows unusual ${anomaly.type.toLowerCase().replace('_', ' ')} behavior. ${actionText} Estimated savings: $${anomaly.savings || 0}/month.`,
        resourceId: anomaly.resourceId,
        resourceName: anomaly.resourceName,
        anomalyId: anomaly.id
    });
}

function alertAutoApproved(action, anomaly, confidence) {
    return createAlert({
        type: ALERT_TYPES.ACTION_AUTO_APPROVED,
        severity: SEVERITY.INFO,
        title: `Action Auto-Approved (${Math.round(confidence * 100)}% confidence)`,
        message: `${action.actionType.replace('_', ' ')} for ${action.resourceName} has been auto-approved and is being executed. Estimated savings: $${action.savings || 0}/month.`,
        resourceId: action.resourceId,
        resourceName: action.resourceName,
        actionId: action.id,
        anomalyId: anomaly?.id
    });
}

function alertActionExecuted(action) {
    return createAlert({
        type: ALERT_TYPES.ACTION_EXECUTED,
        severity: SEVERITY.INFO,
        title: `Action Executed: ${action.actionType.replace('_', ' ')}`,
        message: `${action.resourceName} has been ${action.actionType === 'STOP_INSTANCE' ? 'stopped' : 'started'}. Potential savings: $${action.savings || 0}/month.`,
        resourceId: action.resourceId,
        resourceName: action.resourceName,
        actionId: action.id
    });
}

function alertCostSpike(resourceName, currentCost, expectedCost, resourceId) {
    const spikePercent = expectedCost > 0 ? Math.round(((currentCost - expectedCost) / expectedCost) * 100) : 0;

    return createAlert({
        type: ALERT_TYPES.COST_SPIKE,
        severity: spikePercent >= 100 ? SEVERITY.CRITICAL : SEVERITY.WARNING,
        title: `Cost Spike Detected: ${resourceName}`,
        message: `Cost is ${spikePercent}% higher than expected ($${currentCost.toFixed(2)} vs $${expectedCost.toFixed(2)} expected). Review resource usage.`,
        resourceId,
        resourceName
    });
}

module.exports = {
    createAlert,
    getActiveAlerts,
    getAllAlerts,
    acknowledgeAlert,
    acknowledgeAllAlerts,
    deleteAlert,
    getAlertCounts,
    alertAnomalyDetected,
    alertAutoApproved,
    alertActionExecuted,
    alertCostSpike,
    ALERT_TYPES,
    SEVERITY
};
