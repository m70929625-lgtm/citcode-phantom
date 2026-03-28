const express = require('express');
const router = express.Router();
const { queryAll } = require('../config/database');
const awsService = require('../services/awsService');
const loggerService = require('../services/loggerService');
const costAnomalyService = require('../services/costAnomalyService');

function formatDate(date) {
    return date.toISOString().slice(0, 10);
}

function getPeriodDays(period) {
    return { '7d': 7, '30d': 30, '90d': 90 }[period] || 30;
}

function getDateDaysAgo(daysAgo) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    return date;
}

function getTomorrowUtc() {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + 1);
    return date;
}

function getMonthStartUtc() {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(1);
    return date;
}

function getDaysInCurrentMonth() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

function parseAmount(amount) {
    const numericValue = parseFloat(amount?.Amount || 0);
    return Number.isFinite(numericValue) ? numericValue : 0;
}

function getBucketKey(serviceName = '') {
    if (/elastic compute cloud|ec2/i.test(serviceName)) return 'ec2';
    if (/simple storage service|s3/i.test(serviceName)) return 's3';
    if (/relational database service|rds/i.test(serviceName)) return 'rds';
    if (/lambda/i.test(serviceName)) return 'lambda';
    return 'other';
}

function summarizeDailyCosts(resultsByTime = []) {
    const trend = resultsByTime.map((entry) => {
        const dailyCost = (entry.Groups || []).reduce((sum, group) => (
            sum + parseAmount(group.Metrics?.UnblendedCost)
        ), 0);

        return {
            date: entry.TimePeriod?.Start,
            cost: parseFloat(dailyCost.toFixed(2)),
            estimated: Boolean(entry.Estimated)
        };
    });

    const total = trend.reduce((sum, day) => sum + day.cost, 0);
    const mean = trend.length > 0 ? total / trend.length : 0;
    const variance = trend.length > 0
        ? trend.reduce((sum, day) => sum + Math.pow(day.cost - mean, 2), 0) / trend.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const threshold = mean + stdDev;

    const highCostDays = trend
        .filter((day) => day.cost >= threshold && day.cost > 0)
        .map((day) => ({
            date: day.date,
            cost: day.cost,
            reason: 'Above recent average'
        }));

    return {
        trend,
        total,
        highCostDays
    };
}

function summarizeServiceBreakdown(resultsByTime = []) {
    const serviceTotals = {};
    let currency = 'USD';

    for (const entry of resultsByTime) {
        for (const group of entry.Groups || []) {
            const serviceName = group.Keys?.[0] || 'Other';
            const amount = parseAmount(group.Metrics?.UnblendedCost);
            currency = group.Metrics?.UnblendedCost?.Unit || currency;

            serviceTotals[serviceName] = (serviceTotals[serviceName] || 0) + amount;
        }
    }

    const breakdown = {
        ec2: 0,
        s3: 0,
        rds: 0,
        lambda: 0,
        other: 0
    };

    const serviceBreakdown = Object.entries(serviceTotals)
        .map(([serviceName, amount]) => ({
            serviceName,
            amount: parseFloat(amount.toFixed(2))
        }))
        .sort((a, b) => b.amount - a.amount);

    for (const service of serviceBreakdown) {
        const bucket = getBucketKey(service.serviceName);
        breakdown[bucket] += service.amount;
    }

    Object.keys(breakdown).forEach((key) => {
        breakdown[key] = parseFloat(breakdown[key].toFixed(2));
    });

    return { breakdown, serviceBreakdown, currency };
}

async function getProjectedMonthlyCost() {
    const monthStart = getMonthStartUtc();
    const tomorrow = getTomorrowUtc();
    const response = await awsService.getCostAndUsage({
        startDate: formatDate(monthStart),
        endDate: formatDate(tomorrow),
        granularity: 'DAILY'
    });

    const monthToDateTotal = (response.ResultsByTime || []).reduce((sum, entry) => {
        const dailyAmount = parseAmount(entry.Total?.UnblendedCost);
        return sum + dailyAmount;
    }, 0);

    const elapsedDays = Math.max(
        1,
        Math.ceil((tomorrow.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)) - 1
    );
    const daysInMonth = getDaysInCurrentMonth();

    return parseFloat(((monthToDateTotal / elapsedDays) * daysInMonth).toFixed(2));
}

function getTimeCondition(period) {
    switch (period) {
        case '7d': return "timestamp >= datetime('now', '-7 days')";
        case '30d': return "timestamp >= datetime('now', '-30 days')";
        case '90d': return "timestamp >= datetime('now', '-90 days')";
        default: return "timestamp >= datetime('now', '-30 days')";
    }
}

function getHeuristicCostData(period) {
    const periodDays = getPeriodDays(period);
    const monthlyCostByType = {
        EC2: 24,
        S3: 2,
        RDS: 72,
        Lambda: 3
    };
    const timeCondition = getTimeCondition(period);

    const breakdownRows = queryAll(`
        SELECT
            resource_type,
            COUNT(DISTINCT resource_id) as resource_count
        FROM metrics
        WHERE ${timeCondition}
        GROUP BY resource_type
    `);

    const monthlyBreakdown = {
        ec2: 0,
        s3: 0,
        rds: 0,
        lambda: 0,
        other: 0
    };

    for (const item of breakdownRows) {
        const monthlyRate = monthlyCostByType[item.resource_type] || 0;
        const amount = (item.resource_count || 0) * monthlyRate;

        if (item.resource_type === 'EC2') monthlyBreakdown.ec2 += amount;
        else if (item.resource_type === 'S3') monthlyBreakdown.s3 += amount;
        else if (item.resource_type === 'RDS') monthlyBreakdown.rds += amount;
        else if (item.resource_type === 'Lambda') monthlyBreakdown.lambda += amount;
        else monthlyBreakdown.other += amount;
    }

    const trendRows = queryAll(`
        SELECT
            date(timestamp) as date,
            resource_type,
            COUNT(DISTINCT resource_id) as resource_count
        FROM metrics
        WHERE ${timeCondition}
        GROUP BY date(timestamp), resource_type
        ORDER BY date ASC
    `);

    const trendByDate = {};
    for (const row of trendRows) {
        if (!trendByDate[row.date]) {
            trendByDate[row.date] = {
                date: row.date,
                cost: 0,
                estimated: true
            };
        }

        const monthlyRate = monthlyCostByType[row.resource_type] || 0;
        trendByDate[row.date].cost += (row.resource_count || 0) * (monthlyRate / 30);
    }

    const periodFactor = periodDays / 30;
    const costs = {
        ec2: monthlyBreakdown.ec2 * periodFactor,
        s3: monthlyBreakdown.s3 * periodFactor,
        rds: monthlyBreakdown.rds * periodFactor,
        lambda: monthlyBreakdown.lambda * periodFactor,
        other: monthlyBreakdown.other * periodFactor
    };

    const totalCost = Object.values(costs).reduce((sum, cost) => sum + cost, 0);
    const projectedMonthly = Object.values(monthlyBreakdown).reduce((sum, cost) => sum + cost, 0);
    const trends = Object.values(trendByDate).slice(-30).map((entry) => ({
        date: entry.date,
        cost: parseFloat(entry.cost.toFixed(2)),
        estimated: true
    }));

    const mean = trends.length > 0
        ? trends.reduce((sum, day) => sum + day.cost, 0) / trends.length
        : 0;
    const variance = trends.length > 0
        ? trends.reduce((sum, day) => sum + Math.pow(day.cost - mean, 2), 0) / trends.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const threshold = mean + stdDev;

    const highCostDays = trends
        .filter((day) => day.cost >= threshold && day.cost > 0)
        .map((day) => ({
            date: day.date,
            cost: day.cost,
            reason: 'Estimated higher than recent average'
        }));

    const serviceBreakdown = Object.entries(monthlyBreakdown)
        .filter(([, amount]) => amount > 0)
        .map(([key, amount]) => ({
            serviceName: key.toUpperCase(),
            amount: parseFloat(amount.toFixed(2))
        }))
        .sort((a, b) => b.amount - a.amount);

    return {
        period,
        totalCost: parseFloat(totalCost.toFixed(2)),
        breakdown: {
            ec2: parseFloat(costs.ec2.toFixed(2)),
            s3: parseFloat(costs.s3.toFixed(2)),
            rds: parseFloat(costs.rds.toFixed(2)),
            lambda: parseFloat(costs.lambda.toFixed(2)),
            other: parseFloat(costs.other.toFixed(2))
        },
        serviceBreakdown,
        projectedMonthly: parseFloat(projectedMonthly.toFixed(2)),
        trends,
        anomalies: {
            highCostDays,
            totalAnomalies: highCostDays.length,
            recentAnomalies: highCostDays.slice(-5).map((day) => ({
                date: day.date,
                type: 'COST_SPIKE',
                score: null
            }))
        },
        source: 'resource_count_heuristic',
        sourceCurrency: 'USD',
        displayCurrency: 'INR',
        isEstimated: true,
        assumptions: {
            monthlyCostByType
        }
    };
}

// GET /api/costs - Get cost analysis data
router.get('/', async (req, res) => {
    try {
        const { period = '30d' } = req.query;
        try {
            const periodDays = getPeriodDays(period);
            const startDate = formatDate(getDateDaysAgo(periodDays));
            const endDate = formatDate(getTomorrowUtc());

            const [costResponse, projectedMonthly] = await Promise.all([
                awsService.getCostAndUsage({
                    startDate,
                    endDate,
                    granularity: 'DAILY',
                    groupBy: ['SERVICE']
                }),
                getProjectedMonthlyCost()
            ]);

            const { trend, total, highCostDays } = summarizeDailyCosts(costResponse.ResultsByTime || []);
            const { breakdown, serviceBreakdown, currency } = summarizeServiceBreakdown(costResponse.ResultsByTime || []);

            return res.json({
                period,
                totalCost: parseFloat(total.toFixed(2)),
                breakdown,
                serviceBreakdown,
                projectedMonthly,
                trends: trend,
                anomalies: {
                    highCostDays,
                    totalAnomalies: highCostDays.length,
                    recentAnomalies: highCostDays.slice(-5).map((day) => ({
                        date: day.date,
                        type: 'COST_SPIKE',
                        score: null
                    }))
                },
                source: 'aws_cost_explorer',
                sourceCurrency: currency,
                displayCurrency: currency === 'USD' ? 'INR' : currency,
                isEstimated: (costResponse.ResultsByTime || []).some((entry) => Boolean(entry.Estimated))
            });
        } catch (error) {
            loggerService.warn('api', 'Falling back to estimated cost data', { error: error.message });
            return res.json({
                ...getHeuristicCostData(period),
                fallbackReason: error.message
            });
        }
    } catch (error) {
        loggerService.error('api', 'Failed to fetch costs', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch costs', details: error.message });
    }
});

// POST /api/costs/detect-anomalies - Manually trigger cost anomaly detection
router.post('/detect-anomalies', async (req, res) => {
    try {
        loggerService.info('api', 'Manual cost anomaly detection triggered');
        
        const anomalies = await costAnomalyService.detectCostAnomalies();
        
        res.json({
            success: true,
            detected: anomalies.length,
            anomalies: anomalies.map(a => ({
                id: a.id,
                type: a.type,
                resourceId: a.resourceId,
                resourceName: a.resourceName,
                score: a.score,
                confidence: a.confidence,
                estimatedSavings: a.estimatedSavings,
                details: a.details
            }))
        });
    } catch (error) {
        loggerService.error('api', 'Cost anomaly detection failed', { error: error.message });
        res.status(500).json({ error: 'Failed to detect cost anomalies', details: error.message });
    }
});

module.exports = router;
