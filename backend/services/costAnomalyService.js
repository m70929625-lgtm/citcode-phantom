const { queryAll, queryOne, runSql } = require('../config/database');
const awsService = require('./awsService');
const loggerService = require('./loggerService');
const automationService = require('./automationService');
const alertService = require('./alertService');
const { v4: uuidv4 } = require('uuid');

/**
 * Cost Anomaly Detection Service
 * 
 * Monitors AWS cost data and automatically detects cost spikes/anomalies.
 * When a cost anomaly is detected, it:
 * 1. Creates an anomaly record
 * 2. Automatically creates and executes an action
 * 3. Displays results in the Action Center
 */

const COST_ANOMALY_THRESHOLD = 2.0; // 2x average = anomaly
const MIN_COST_FOR_ANOMALY = 10; // Minimum $10 to trigger

/**
 * Detect cost anomalies by comparing today's cost against historical average
 */
async function detectCostAnomalies(userId) {
    try {
        loggerService.info('cost-anomaly', 'Starting cost anomaly detection...', { userId });

        const today = new Date();
        const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Fetch cost data for the last 30 days
        const costData = await fetchCostData(thirtyDaysAgo, today, userId);
        
        if (!costData || costData.length === 0) {
            loggerService.info('cost-anomaly', 'No cost data available for analysis');
            return [];
        }

        const anomalies = [];

        // Calculate daily costs
        const dailyCosts = {};
        for (const entry of costData) {
            const date = entry.date;
            if (!dailyCosts[date]) {
                dailyCosts[date] = 0;
            }
            dailyCosts[date] += entry.cost;
        }

        const dates = Object.keys(dailyCosts).sort();
        if (dates.length < 3) {
            loggerService.info('cost-anomaly', 'Insufficient historical data for anomaly detection');
            return [];
        }

        // Calculate historical average (excluding today)
        const historicalDates = dates.slice(0, -1);
        const historicalCosts = historicalDates.map(d => dailyCosts[d]);
        const averageCost = historicalCosts.reduce((a, b) => a + b, 0) / historicalCosts.length;
        const maxHistoricalCost = Math.max(...historicalCosts);
        
        // Get today's cost
        const todayStr = today.toISOString().slice(0, 10);
        const yesterdayStr = historicalDates[historicalDates.length - 1];
        const todayCost = dailyCosts[todayStr] || dailyCosts[yesterdayStr] || 0;

        // Check for cost spike
        if (todayCost > averageCost * COST_ANOMALY_THRESHOLD && todayCost > MIN_COST_FOR_ANOMALY) {
            const spikePercentage = ((todayCost - averageCost) / averageCost * 100).toFixed(1);
            const anomalyScore = Math.min(todayCost / (averageCost || 1) / 3, 1);
            
            loggerService.warn('cost-anomaly', `Cost spike detected: $${todayCost.toFixed(2)} (avg: $${averageCost.toFixed(2)}, +${spikePercentage}%)`);

            // Find which service caused the spike
            const serviceBreakdown = await analyzeServiceSpike(costData, todayStr);
            
            const anomaly = {
                id: `cost_anomaly_${uuidv4().slice(0, 8)}`,
                type: 'COST_SPIKE',
                resourceId: serviceBreakdown.topService || 'multiple-services',
                resourceName: serviceBreakdown.topService || 'Multiple Services',
                resourceType: 'COST',
                detectedAt: new Date().toISOString(),
                score: anomalyScore,
                confidence: Math.min(anomalyScore + 0.3, 0.95),
                details: {
                    todayCost,
                    averageCost,
                    spikePercentage: parseFloat(spikePercentage),
                    serviceBreakdown: serviceBreakdown.services,
                    topService: serviceBreakdown.topService
                },
                recommendedAction: 'SEND_ALERT',
                estimatedSavings: Math.max(0, todayCost - averageCost)
            };

            anomalies.push(anomaly);
        }

        // Check for unusual service-level spikes
        const serviceAnomalies = await detectServiceLevelAnomalies(costData, dates);
        anomalies.push(...serviceAnomalies);

        // Process detected anomalies
        for (const anomaly of anomalies) {
            await processCostAnomaly(anomaly, userId);
        }

        loggerService.info('cost-anomaly', `Detected ${anomalies.length} cost anomalies`, { userId });
        return anomalies;

    } catch (error) {
        loggerService.error('cost-anomaly', 'Cost anomaly detection failed', { error: error.message, userId });
        return [];
    }
}

/**
 * Fetch cost data from AWS Cost Explorer
 */
async function fetchCostData(startDate, endDate, userId) {
    try {
        const formatDate = (date) => date.toISOString().slice(0, 10);
        
        const response = await awsService.getCostAndUsage({
            startDate: formatDate(startDate),
            endDate: formatDate(endDate),
            granularity: 'DAILY',
            groupBy: ['SERVICE']
        }, userId);

        const results = [];
        for (const entry of response.ResultsByTime || []) {
            const date = entry.TimePeriod?.Start;
            for (const group of entry.Groups || []) {
                const serviceName = group.Keys?.[0] || 'Other';
                const amount = parseFloat(group.Metrics?.UnblendedCost?.Amount || 0);
                
                results.push({
                    date,
                    service: serviceName,
                    cost: amount
                });
            }
        }

        return results;
    } catch (error) {
        loggerService.warn('cost-anomaly', 'Failed to fetch cost data, using heuristic', { error: error.message, userId });
        
        // Fallback to estimated costs from metrics
        return getEstimatedCostData(startDate, endDate, userId);
    }
}

/**
 * Get estimated cost data from resource metrics
 */
function getEstimatedCostData(startDate, endDate, userId) {
    const dailyCosts = [];
    const metrics = queryAll(`
        SELECT 
            date(timestamp) as date,
            resource_type,
            COUNT(DISTINCT resource_id) as resource_count
        FROM metrics
        WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
        GROUP BY date(timestamp), resource_type
    `, [userId, startDate.toISOString(), endDate.toISOString()]);

    const monthlyCostByType = {
        'EC2': 24,
        'S3': 2,
        'RDS': 72,
        'Lambda': 3
    };

    const costsByDate = {};
    for (const row of metrics) {
        if (!costsByDate[row.date]) {
            costsByDate[row.date] = {};
        }
        const monthlyRate = monthlyCostByType[row.resource_type] || 0;
        const dailyRate = monthlyRate / 30;
        costsByDate[row.date][row.resource_type] = (row.resource_count || 0) * dailyRate;
    }

    for (const date in costsByDate) {
        for (const service in costsByDate[date]) {
            dailyCosts.push({
                date,
                service,
                cost: costsByDate[date][service]
            });
        }
    }

    return dailyCosts;
}

/**
 * Analyze which service caused the cost spike
 */
async function analyzeServiceSpike(costData, todayStr) {
    const serviceTotals = {};
    
    // Get costs by service for today
    for (const entry of costData) {
        if (entry.date === todayStr || entry.date === costData[costData.length - 1]?.date) {
            if (!serviceTotals[entry.service]) {
                serviceTotals[entry.service] = 0;
            }
            serviceTotals[entry.service] += entry.cost;
        }
    }

    // Sort by cost
    const sortedServices = Object.entries(serviceTotals)
        .map(([service, cost]) => ({ service, cost }))
        .sort((a, b) => b.cost - a.cost);

    return {
        topService: sortedServices[0]?.service || 'Unknown',
        services: sortedServices.slice(0, 5)
    };
}

/**
 * Detect anomalies at individual service level
 */
async function detectServiceLevelAnomalies(costData, dates) {
    const anomalies = [];
    const serviceData = {};

    // Group by service
    for (const entry of costData) {
        if (!serviceData[entry.service]) {
            serviceData[entry.service] = {};
        }
        serviceData[entry.service][entry.date] = entry.cost;
    }

    const todayStr = dates[dates.length - 1];
    const yesterdayStr = dates[dates.length - 2];

    for (const service in serviceData) {
        const costs = Object.entries(serviceData[service])
            .filter(([date]) => date !== todayStr)
            .map(([, cost]) => cost);

        if (costs.length < 3) continue;

        const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
        const todayCost = serviceData[service][todayStr] || serviceData[service][yesterdayStr] || 0;

        // Detect 3x spike for individual service
        if (todayCost > avg * 3 && todayCost > 5) {
            const spikePercentage = ((todayCost - avg) / avg * 100).toFixed(1);
            const anomalyScore = Math.min(todayCost / (avg || 1) / 4, 1);

            anomalies.push({
                id: `cost_anomaly_${uuidv4().slice(0, 8)}`,
                type: 'SERVICE_COST_SPIKE',
                resourceId: service,
                resourceName: service,
                resourceType: 'COST',
                detectedAt: new Date().toISOString(),
                score: anomalyScore,
                confidence: Math.min(anomalyScore + 0.2, 0.9),
                details: {
                    todayCost,
                    averageCost: avg,
                    spikePercentage: parseFloat(spikePercentage),
                    service
                },
                recommendedAction: 'SEND_ALERT',
                estimatedSavings: Math.max(0, todayCost - avg)
            });
        }
    }

    return anomalies;
}

/**
 * Process a detected cost anomaly - create anomaly record and action
 */
async function processCostAnomaly(anomaly, userId) {
    try {
        // Check if similar anomaly already exists (within last hour)
        const existingAnomaly = queryOne(`
            SELECT * FROM anomalies
            WHERE user_id = ? AND resource_id = ? AND status = 'new'
            AND anomaly_type LIKE 'COST%'
            AND detected_at > datetime('now', '-1 hour')
        `, [userId, anomaly.resourceId]);

        if (existingAnomaly) {
            loggerService.info('cost-anomaly', 'Similar cost anomaly already exists, skipping', { 
                resourceId: anomaly.resourceId 
            });
            return;
        }

        // Insert anomaly into database
        runSql(`
            INSERT INTO anomalies (
                id, user_id, resource_id, resource_name, resource_type,
                anomaly_type, detected_at, anomaly_score, confidence,
                features, recommended_action, estimated_savings, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            anomaly.id,
            userId,
            anomaly.resourceId,
            anomaly.resourceName,
            anomaly.resourceType,
            anomaly.type,
            anomaly.detectedAt,
            anomaly.score,
            anomaly.confidence,
            JSON.stringify(anomaly.details),
            anomaly.recommendedAction,
            anomaly.estimatedSavings,
            'new'
        ]);

        loggerService.log(
            'warn',
            'anomaly',
            `Cost anomaly detected: ${anomaly.type} for ${anomaly.resourceName}`,
            { score: anomaly.score, confidence: anomaly.confidence, savings: anomaly.estimatedSavings, userId },
            anomaly.resourceId,
            anomaly.recommendedAction
        );

        // Alert about the anomaly
        alertService.alertAnomalyDetected(userId, {
            id: anomaly.id,
            type: anomaly.type,
            resourceId: anomaly.resourceId,
            resourceName: anomaly.resourceName,
            resourceType: anomaly.resourceType,
            savings: anomaly.estimatedSavings
        }, anomaly.confidence, anomaly.recommendedAction);

        // For cost anomalies, we create an alert action but don't auto-execute
        // Cost spikes need investigation before any action
        const actionId = automationService.createAction(
            anomaly.id,
            anomaly.resourceId,
            anomaly.resourceName,
            'SEND_ALERT',
            anomaly.estimatedSavings,
            anomaly.confidence,
            userId
        );

        if (actionId) {
            // Auto-approve and execute alert actions for cost anomalies
            try {
                automationService.approveAction(actionId, 'system:auto-cost', userId);
                await automationService.executeAction(actionId);
                
                loggerService.info('cost-anomaly', `Cost alert action executed: ${actionId}`, {
                    anomalyId: anomaly.id,
                    actionId
                });

                // Send notification that action was taken
                const executedAction = queryOne('SELECT * FROM actions WHERE id = ?', [actionId]);
                alertService.alertActionExecuted(userId, {
                    id: executedAction.id,
                    actionType: executedAction.action_type,
                    resourceId: executedAction.resource_id,
                    resourceName: executedAction.resource_name,
                    savings: executedAction.savings
                });
            } catch (actionError) {
                loggerService.error('cost-anomaly', 'Failed to execute cost alert action', {
                    actionId,
                    userId,
                    error: actionError.message
                });
            }
        }

        return anomaly.id;

    } catch (error) {
        loggerService.error('cost-anomaly', 'Failed to process cost anomaly', { 
            error: error.message,
            userId,
            anomalyId: anomaly.id 
        });
    }
}

module.exports = {
    detectCostAnomalies,
    COST_ANOMALY_THRESHOLD
};
