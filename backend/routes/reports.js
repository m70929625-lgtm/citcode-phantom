const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../config/database');

const router = express.Router();

const REPORTS_DIR = path.join(__dirname, '..', 'data', 'reports');

function ensureReportsDir(userId) {
    const userDir = path.join(REPORTS_DIR, userId);
    fs.mkdirSync(userDir, { recursive: true });
    return userDir;
}

function normalizePeriod(period) {
    if (['7d', '30d', '90d'].includes(period)) return period;
    if (period === '24h' || period === '1h') return '7d';
    return '30d';
}

function getTimeCondition(period) {
    switch (period) {
        case '7d': return "datetime('now', '-7 days')";
        case '90d': return "datetime('now', '-90 days')";
        case '30d':
        default:
            return "datetime('now', '-30 days')";
    }
}

function estimateCostFromMetrics(userId, period) {
    const monthlyCostByType = {
        EC2: 24,
        S3: 2,
        RDS: 72,
        Lambda: 3
    };

    const rows = queryAll(`
        SELECT resource_type, COUNT(DISTINCT resource_id) as resource_count
        FROM metrics
        WHERE user_id = ? AND timestamp >= ${getTimeCondition(period)}
        GROUP BY resource_type
    `, [userId]);

    const periodDays = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    return rows.reduce((sum, row) => {
        const monthlyRate = monthlyCostByType[row.resource_type] || 0;
        return sum + ((row.resource_count || 0) * monthlyRate * (periodDays / 30));
    }, 0);
}

function buildReportSnapshot(userId, period, filterQuery = {}) {
    const serviceFilter = filterQuery?.service && filterQuery.service !== 'all' ? filterQuery.service : null;
    const statusFilter = filterQuery?.status && filterQuery.status !== 'all' ? filterQuery.status : null;

    const metricFilterClause = serviceFilter ? ' AND resource_type = ?' : '';
    const anomalyFilterClause = statusFilter ? ' AND status = ?' : '';
    const actionFilterClause = statusFilter ? ' AND status = ?' : '';

    const metricParams = [userId];
    if (serviceFilter) metricParams.push(serviceFilter);

    const anomalyParams = [userId];
    if (statusFilter) anomalyParams.push(statusFilter);

    const actionParams = [userId];
    if (statusFilter) actionParams.push(statusFilter);

    const resourceSummary = queryAll(`
        SELECT
            resource_type,
            COUNT(DISTINCT resource_id) as resources,
            AVG(CASE WHEN metric_type = 'cpu_utilization' THEN value END) as avg_cpu
        FROM metrics
        WHERE user_id = ? AND timestamp >= ${getTimeCondition(period)} ${metricFilterClause}
        GROUP BY resource_type
        ORDER BY resources DESC
    `, metricParams);

    const anomalySummary = queryOne(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
            SUM(CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END) as acknowledged_count,
            SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count
        FROM anomalies
        WHERE user_id = ? AND detected_at >= ${getTimeCondition(period)} ${anomalyFilterClause}
    `, anomalyParams);

    const actionSummary = queryOne(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'executed' AND COALESCE(dry_run, 0) = 0 THEN 1 ELSE 0 END) as executed,
            SUM(CASE WHEN status = 'executed' AND COALESCE(dry_run, 0) = 1 THEN 1 ELSE 0 END) as simulated,
            SUM(CASE WHEN status = 'executed' AND COALESCE(dry_run, 0) = 0 THEN COALESCE(savings, 0) ELSE 0 END) as savings
        FROM actions
        WHERE user_id = ? AND created_at >= ${getTimeCondition(period)} ${actionFilterClause}
    `, actionParams);

    const recentAnomalies = queryAll(`
        SELECT resource_name, anomaly_type, anomaly_score, detected_at, status
        FROM anomalies
        WHERE user_id = ? AND detected_at >= ${getTimeCondition(period)}
        ORDER BY detected_at DESC
        LIMIT 20
    `, [userId]);

    const recentActions = queryAll(`
        SELECT resource_name, action_type, status, dry_run, savings, created_at
        FROM actions
        WHERE user_id = ? AND created_at >= ${getTimeCondition(period)}
        ORDER BY created_at DESC
        LIMIT 20
    `, [userId]);

    const liveCost = queryOne(`
        SELECT cost_total, currency, source, sample_time
        FROM cost_live_samples
        WHERE user_id = ? AND sample_time >= ${getTimeCondition(period)}
        ORDER BY sample_time DESC
        LIMIT 1
    `, [userId]);

    const estimatedCost = estimateCostFromMetrics(userId, period);

    return {
        generatedAt: new Date().toISOString(),
        period,
        filters: filterQuery,
        overview: {
            resources: resourceSummary,
            anomalies: {
                total: anomalySummary?.total || 0,
                new: anomalySummary?.new_count || 0,
                acknowledged: anomalySummary?.acknowledged_count || 0,
                resolved: anomalySummary?.resolved_count || 0
            },
            actions: {
                total: actionSummary?.total || 0,
                executed: actionSummary?.executed || 0,
                simulated: actionSummary?.simulated || 0,
                savings: actionSummary?.savings || 0
            },
            costs: {
                latestCost: liveCost?.cost_total || 0,
                latestCurrency: liveCost?.currency || 'USD',
                latestSource: liveCost?.source || 'resource_count_heuristic',
                latestSampleTime: liveCost?.sample_time || null,
                estimatedPeriodCost: Number(estimatedCost.toFixed(2))
            }
        },
        recentAnomalies,
        recentActions
    };
}

function escapeCsv(value) {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function toCsv(snapshot) {
    const rows = [];
    rows.push(['CloudCostGuard Report']);
    rows.push(['Generated At', snapshot.generatedAt]);
    rows.push(['Period', snapshot.period]);
    rows.push([]);

    rows.push(['Overview']);
    rows.push(['Total Anomalies', snapshot.overview.anomalies.total]);
    rows.push(['New Anomalies', snapshot.overview.anomalies.new]);
    rows.push(['Executed Actions', snapshot.overview.actions.executed]);
    rows.push(['Simulated Actions', snapshot.overview.actions.simulated]);
    rows.push(['Savings', snapshot.overview.actions.savings]);
    rows.push(['Estimated Cost', snapshot.overview.costs.estimatedPeriodCost]);
    rows.push([]);

    rows.push(['Resources By Type']);
    rows.push(['Resource Type', 'Count', 'Avg CPU']);
    for (const item of snapshot.overview.resources) {
        rows.push([item.resource_type, item.resources, item.avg_cpu || 0]);
    }
    rows.push([]);

    rows.push(['Recent Anomalies']);
    rows.push(['Resource', 'Type', 'Score', 'Status', 'Detected At']);
    for (const anomaly of snapshot.recentAnomalies) {
        rows.push([anomaly.resource_name, anomaly.anomaly_type, anomaly.anomaly_score, anomaly.status, anomaly.detected_at]);
    }
    rows.push([]);

    rows.push(['Recent Actions']);
    rows.push(['Resource', 'Action', 'Status', 'Dry Run', 'Savings', 'Created At']);
    for (const action of snapshot.recentActions) {
        rows.push([action.resource_name, action.action_type, action.status, action.dry_run ? 'yes' : 'no', action.savings || 0, action.created_at]);
    }

    return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function escapePdfText(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildMinimalPdf(lines) {
    const clipped = lines.slice(0, 45);
    const textStream = [
        'BT',
        '/F1 11 Tf',
        '50 790 Td',
        ...clipped.map((line, idx) => `${idx === 0 ? '' : 'T* '}(${escapePdfText(line)}) Tj`).map((line) => line.trim()),
        'ET'
    ].join('\n');

    const objects = [];
    objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');
    objects.push('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj');
    objects.push('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >> endobj');
    objects.push('4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj');
    objects.push(`5 0 obj << /Length ${Buffer.byteLength(textStream, 'utf8')} >> stream\n${textStream}\nendstream endobj`);

    let content = '%PDF-1.4\n';
    const offsets = [0];

    for (const object of objects) {
        offsets.push(Buffer.byteLength(content, 'utf8'));
        content += `${object}\n`;
    }

    const xrefStart = Buffer.byteLength(content, 'utf8');
    content += `xref\n0 ${objects.length + 1}\n`;
    content += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i += 1) {
        content += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }

    content += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return Buffer.from(content, 'utf8');
}

function toPdf(snapshot) {
    const lines = [
        'CloudCostGuard Report',
        `Generated At: ${snapshot.generatedAt}`,
        `Period: ${snapshot.period}`,
        '',
        `Anomalies: total=${snapshot.overview.anomalies.total}, new=${snapshot.overview.anomalies.new}, resolved=${snapshot.overview.anomalies.resolved}`,
        `Actions: total=${snapshot.overview.actions.total}, executed=${snapshot.overview.actions.executed}, simulated=${snapshot.overview.actions.simulated}`,
        `Savings: ${snapshot.overview.actions.savings}`,
        `Estimated Cost: ${snapshot.overview.costs.estimatedPeriodCost} ${snapshot.overview.costs.latestCurrency}`,
        '',
        'Resources',
        ...snapshot.overview.resources.map((item) => `- ${item.resource_type}: ${item.resources} resources, avg CPU ${Number(item.avg_cpu || 0).toFixed(2)}%`),
        '',
        'Recent Anomalies',
        ...snapshot.recentAnomalies.map((item) => `- ${item.resource_name} | ${item.anomaly_type} | ${Number(item.anomaly_score || 0).toFixed(2)} | ${item.status}`),
        '',
        'Recent Actions',
        ...snapshot.recentActions.map((item) => `- ${item.resource_name} | ${item.action_type} | ${item.status} | dryRun=${item.dry_run ? 'yes' : 'no'}`)
    ];

    return buildMinimalPdf(lines);
}

function createReportFile(userId, jobId, format, snapshot) {
    const userDir = ensureReportsDir(userId);
    const ext = format === 'pdf' ? 'pdf' : 'csv';
    const fileName = `report-${jobId}.${ext}`;
    const filePath = path.join(userDir, fileName);

    if (format === 'pdf') {
        fs.writeFileSync(filePath, toPdf(snapshot));
        return { filePath, fileName, mimeType: 'application/pdf' };
    }

    fs.writeFileSync(filePath, toCsv(snapshot), 'utf8');
    return { filePath, fileName, mimeType: 'text/csv' };
}

function sanitizeJobRow(row) {
    return {
        id: row.id,
        format: row.format,
        period: row.period,
        filters: row.filter_query ? JSON.parse(row.filter_query) : {},
        status: row.status,
        fileName: row.file_name,
        mimeType: row.mime_type,
        error: row.error,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        downloadUrl: row.status === 'completed' ? `/api/reports/jobs/${row.id}/download` : null
    };
}

router.get('/summary', (req, res) => {
    const userId = req.session.userId;
    const period = normalizePeriod(req.query.period);
    const filters = {
        region: req.query.region || 'all',
        service: req.query.service || 'all',
        status: req.query.status || 'all',
        window: req.query.window || '24h'
    };

    const snapshot = buildReportSnapshot(userId, period, filters);
    res.json(snapshot);
});

router.post('/jobs', (req, res) => {
    const userId = req.session.userId;
    const format = req.body?.format === 'pdf' ? 'pdf' : 'csv';
    const period = normalizePeriod(req.body?.period);
    const filters = req.body?.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
    const jobId = `report_${uuidv4().slice(0, 8)}`;
    const now = new Date().toISOString();

    runSql(`
        INSERT INTO report_jobs (id, user_id, format, period, filter_query, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [jobId, userId, format, period, JSON.stringify(filters), 'queued', now]);

    try {
        runSql('UPDATE report_jobs SET status = ? WHERE id = ? AND user_id = ?', ['processing', jobId, userId]);

        const snapshot = buildReportSnapshot(userId, period, filters);
        const file = createReportFile(userId, jobId, format, snapshot);

        runSql(`
            UPDATE report_jobs
            SET status = ?, file_path = ?, file_name = ?, mime_type = ?, completed_at = ?
            WHERE id = ? AND user_id = ?
        `, ['completed', file.filePath, file.fileName, file.mimeType, new Date().toISOString(), jobId, userId]);
    } catch (error) {
        runSql(`
            UPDATE report_jobs
            SET status = ?, error = ?, completed_at = ?
            WHERE id = ? AND user_id = ?
        `, ['failed', error.message, new Date().toISOString(), jobId, userId]);
    }

    const job = queryOne('SELECT * FROM report_jobs WHERE id = ? AND user_id = ?', [jobId, userId]);
    res.status(201).json({ success: true, job: sanitizeJobRow(job) });
});

router.get('/jobs', (req, res) => {
    const userId = req.session.userId;
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const jobs = queryAll(`
        SELECT * FROM report_jobs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    `, [userId, limit]);

    res.json({ data: jobs.map(sanitizeJobRow) });
});

router.get('/jobs/:id', (req, res) => {
    const userId = req.session.userId;
    const job = queryOne('SELECT * FROM report_jobs WHERE id = ? AND user_id = ?', [req.params.id, userId]);
    if (!job) {
        return res.status(404).json({ error: 'Report job not found' });
    }

    res.json({ job: sanitizeJobRow(job) });
});

router.get('/jobs/:id/download', (req, res) => {
    const userId = req.session.userId;
    const job = queryOne('SELECT * FROM report_jobs WHERE id = ? AND user_id = ?', [req.params.id, userId]);

    if (!job || job.status !== 'completed' || !job.file_path) {
        return res.status(404).json({ error: 'Report file not available' });
    }

    const safeRoot = path.resolve(REPORTS_DIR);
    const absolutePath = path.resolve(job.file_path);
    if (!absolutePath.startsWith(safeRoot)) {
        return res.status(403).json({ error: 'Invalid report file path' });
    }

    if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({ error: 'Report file missing' });
    }

    res.setHeader('Content-Type', job.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${job.file_name || path.basename(absolutePath)}"`);
    res.sendFile(absolutePath);
});

module.exports = router;
