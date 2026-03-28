require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { initializeDatabase, runSql } = require('./config/database');
const loggerService = require('./services/loggerService');
const awsService = require('./services/awsService');
const mlService = require('./services/mlService');
const metricCollector = require('./services/metricCollector');
const automationService = require('./services/automationService');
const { requireAuth } = require('./middleware/auth');

// Routes
const metricsRoutes = require('./routes/metrics');
const anomaliesRoutes = require('./routes/anomalies');
const actionsRoutes = require('./routes/actions');
const statusRoutes = require('./routes/status');
const recommendationsRoutes = require('./routes/recommendations');
const costsRoutes = require('./routes/costs');
const settingsRoutes = require('./routes/settings');
const authRoutes = require('./routes/auth');
const alertsRoutes = require('./routes/alerts');

const app = express();
const PORT = process.env.PORT || 5000;

// Session middleware (must be before other middleware)
app.use(session({
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: './data'
    }),
    secret: process.env.SESSION_SECRET || 'cloudcostguard-dev-secret-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// CORS — allow credentials for frontend
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());

// Initialize services
async function initializeServices() {
    try {
        // Initialize database first
        await initializeDatabase();
        runSql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
            ['system_status', 'starting', new Date().toISOString()]);
        loggerService.log('info', 'system', 'CloudCostGuard backend starting...');

        // Load ML model
        const modelLoaded = await mlService.loadModel();
        loggerService.log(
            'info',
            'ml',
            modelLoaded ? 'ML model loaded' : 'ML model not loaded - using statistical fallback'
        );

        // Initialize automation engine before collection starts
        automationService.initialize();
        loggerService.log('info', 'automation', 'Automation engine initialized');

        // Test AWS connection
        const awsConnected = await awsService.testConnection();
        if (awsConnected) {
            loggerService.log('info', 'aws', 'AWS connection successful');
        } else {
            loggerService.log('warn', 'aws', 'AWS connection failed - check credentials');
        }

        // Start metric collection
        metricCollector.start();
        loggerService.log('info', 'system', 'Metric collector started');

        runSql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
            ['system_status', 'running', new Date().toISOString()]);

    } catch (error) {
        runSql(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
            ['system_status', 'error', new Date().toISOString()]);
        loggerService.log('error', 'system', 'Service initialization failed', { error: error.message });
    }
}

// Auth Routes (no auth required)
app.use('/auth', authRoutes);

// Protected API Routes (all require authentication)
app.use('/api/metrics', requireAuth, metricsRoutes);
app.use('/api/anomalies', requireAuth, anomaliesRoutes);
app.use('/api/actions', requireAuth, actionsRoutes);
app.use('/api/status', requireAuth, statusRoutes);
app.use('/api/recommendations', requireAuth, recommendationsRoutes);
app.use('/api/alerts', requireAuth, alertsRoutes);
app.use('/api/costs', requireAuth, costsRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
    loggerService.log('error', 'system', 'Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`CloudCostGuard backend running on port ${PORT}`);
    initializeServices();
});

module.exports = app;
