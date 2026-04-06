const express = require('express');
const router = express.Router();
const { queryAll, runSql } = require('../config/database');
const awsService = require('../services/awsService');
const loggerService = require('../services/loggerService');
const costAnomalyService = require('../services/costAnomalyService');

const LIVE_COST_TABLE = 'cost_live_samples';
const DEFAULT_LIVE_WINDOW_MINUTES = 90;
const MAX_LIVE_WINDOW_MINUTES = 24 * 60;

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

async function getProjectedMonthlyCost(userId) {
    const monthStart = getMonthStartUtc();
    const tomorrow = getTomorrowUtc();
    const response = await awsService.getCostAndUsage({
        startDate: formatDate(monthStart),
        endDate: formatDate(tomorrow),
        granularity: 'DAILY'
    }, userId);

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

function ensureLiveCostTable() {
    runSql(`
        CREATE TABLE IF NOT EXISTS ${LIVE_COST_TABLE} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            sample_time TEXT NOT NULL,
            sample_minute TEXT NOT NULL UNIQUE,
            cost_total REAL NOT NULL,
            source TEXT NOT NULL,
            currency TEXT NOT NULL,
            is_estimated INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    runSql(`
        CREATE INDEX IF NOT EXISTS idx_${LIVE_COST_TABLE}_sample_time
        ON ${LIVE_COST_TABLE}(sample_time)
    `);

    runSql(`
        CREATE INDEX IF NOT EXISTS idx_${LIVE_COST_TABLE}_user_id
        ON ${LIVE_COST_TABLE}(user_id)
    `);
}

function getMinuteKey(date = new Date()) {
    const minute = new Date(date);
    minute.setUTCSeconds(0, 0);
    return minute.toISOString();
}

function parseLiveWindowMinutes(windowParam) {
    if (!windowParam) return DEFAULT_LIVE_WINDOW_MINUTES;

    const raw = String(windowParam).trim();
    const minutes = raw.endsWith('m')
        ? parseInt(raw.slice(0, -1), 10)
        : parseInt(raw, 10);

    if (!Number.isFinite(minutes) || minutes <= 0) {
        return DEFAULT_LIVE_WINDOW_MINUTES;
    }

    return Math.min(minutes, MAX_LIVE_WINDOW_MINUTES);
}

function sumDailyCost(entry = {}) {
    const totalAmount = parseAmount(entry.Total?.UnblendedCost);
    if (totalAmount > 0) return totalAmount;

    return (entry.Groups || []).reduce((sum, group) => (
        sum + parseAmount(group.Metrics?.UnblendedCost)
    ), 0);
}

function getEstimatedLiveCostSnapshot(userId) {
    const minuteKey = getMinuteKey();
    const resourceRows = queryAll(`
        SELECT resource_type, COUNT(DISTINCT resource_id) as resource_count
        FROM metrics
        WHERE user_id = ? AND timestamp >= datetime('now', '-30 minutes')
        GROUP BY resource_type
    `, [userId]);

    const monthlyCostByType = {
        EC2: 24,
        S3: 2,
        RDS: 72,
        Lambda: 3
    };

    const estimatedDailyCost = resourceRows.reduce((sum, row) => {
        const monthlyRate = monthlyCostByType[row.resource_type] || 0;
        const resourceCount = row.resource_count || 0;
        return sum + (resourceCount * (monthlyRate / 30));
    }, 0);

    return {
        sampleTime: new Date().toISOString(),
        sampleMinute: minuteKey,
        sampleMinuteKey: `${userId}:${minuteKey}`,
        costTotal: parseFloat(estimatedDailyCost.toFixed(4)),
        source: 'resource_count_heuristic',
        currency: 'USD',
        isEstimated: true
    };
}

async function fetchLiveCostSnapshot(userId) {
    try {
        const minuteKey = getMinuteKey();
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const tomorrow = getTomorrowUtc();
        const todayDate = formatDate(todayStart);

        const response = await awsService.getCostAndUsage({
            startDate: todayDate,
            endDate: formatDate(tomorrow),
            granularity: 'DAILY'
        }, userId);

        const results = response.ResultsByTime || [];
        const todayEntry = results.find((entry) => entry.TimePeriod?.Start === todayDate) || results[results.length - 1];

        if (!todayEntry) {
            throw new Error('No cost data returned for live snapshot');
        }

        return {
            sampleTime: new Date().toISOString(),
            sampleMinute: minuteKey,
            sampleMinuteKey: `${userId}:${minuteKey}`,
            costTotal: parseFloat(sumDailyCost(todayEntry).toFixed(4)),
            source: 'aws_cost_explorer',
            currency: todayEntry.Total?.UnblendedCost?.Unit || 'USD',
            isEstimated: Boolean(todayEntry.Estimated)
        };
    } catch (error) {
        loggerService.warn('api', 'Failed to fetch live AWS cost snapshot, using heuristic', { error: error.message, userId });
        return getEstimatedLiveCostSnapshot(userId);
    }
}

function upsertLiveCostSample(userId, sample) {
    runSql(`
        INSERT INTO ${LIVE_COST_TABLE} (
            user_id,
            sample_time,
            sample_minute,
            cost_total,
            source,
            currency,
            is_estimated,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sample_minute) DO UPDATE SET
            user_id = excluded.user_id,
            sample_time = excluded.sample_time,
            cost_total = excluded.cost_total,
            source = excluded.source,
            currency = excluded.currency,
            is_estimated = excluded.is_estimated
    `, [
        userId,
        sample.sampleTime,
        sample.sampleMinuteKey,
        sample.costTotal,
        sample.source,
        sample.currency,
        sample.isEstimated ? 1 : 0,
        new Date().toISOString()
    ]);
}

async function captureLiveCostSample(userId) {
    ensureLiveCostTable();
    const sample = await fetchLiveCostSnapshot(userId);
    upsertLiveCostSample(userId, sample);
    return sample;
}

function getLiveCostSeries(userId, windowMinutes = DEFAULT_LIVE_WINDOW_MINUTES) {
    ensureLiveCostTable();

    const fromTime = new Date(Date.now() - (windowMinutes * 60 * 1000)).toISOString();
    const rows = queryAll(`
        SELECT sample_time, cost_total, source, currency, is_estimated
        FROM ${LIVE_COST_TABLE}
        WHERE user_id = ? AND sample_time >= ?
        ORDER BY sample_time ASC
    `, [userId, fromTime]);

    return rows.map((row) => ({
        timestamp: row.sample_time,
        cost: parseFloat((row.cost_total || 0).toFixed(4)),
        source: row.source,
        currency: row.currency || 'USD',
        isEstimated: Boolean(row.is_estimated)
    }));
}

function getHeuristicCostData(userId, period) {
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
        WHERE user_id = ? AND ${timeCondition}
        GROUP BY resource_type
    `, [userId]);

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
        WHERE user_id = ? AND ${timeCondition}
        GROUP BY date(timestamp), resource_type
        ORDER BY date ASC
    `, [userId]);

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

// POST /api/costs/live/fetch - Capture a fresh live cost sample
router.post('/live/fetch', async (req, res) => {
    try {
        const userId = req.session.userId;
        const sample = await captureLiveCostSample(userId);

        res.json({
            success: true,
            sample: {
                timestamp: sample.sampleTime,
                cost: sample.costTotal,
                source: sample.source,
                sourceCurrency: sample.currency,
                displayCurrency: sample.currency === 'USD' ? 'INR' : sample.currency,
                isEstimated: Boolean(sample.isEstimated)
            }
        });
    } catch (error) {
        loggerService.error('api', 'Failed to capture live cost sample', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch live cost sample', details: error.message });
    }
});

// GET /api/costs/live - Read minute-level live cost series
router.get('/live', async (req, res) => {
    try {
        const userId = req.session.userId;
        const windowMinutes = parseLiveWindowMinutes(req.query.window);
        let points = getLiveCostSeries(userId, windowMinutes);

        if (points.length === 0) {
            await captureLiveCostSample(userId);
            points = getLiveCostSeries(userId, windowMinutes);
        }

        const latest = points[points.length - 1] || null;

        res.json({
            windowMinutes,
            points,
            latest,
            source: latest?.source || 'resource_count_heuristic',
            sourceCurrency: latest?.currency || 'USD',
            displayCurrency: (latest?.currency || 'USD') === 'USD' ? 'INR' : (latest?.currency || 'USD'),
            isEstimated: points.length > 0 ? points.every((point) => point.isEstimated) : true
        });
    } catch (error) {
        loggerService.error('api', 'Failed to fetch live cost series', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch live cost series', details: error.message });
    }
});

// GET /api/costs - Get cost analysis data
router.get('/', async (req, res) => {
    try {
        const userId = req.session.userId;
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
                }, userId),
                getProjectedMonthlyCost(userId)
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
                ...getHeuristicCostData(userId, period),
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
        const userId = req.session.userId;
        loggerService.info('api', 'Manual cost anomaly detection triggered');
        
        const anomalies = await costAnomalyService.detectCostAnomalies(userId);
        
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
