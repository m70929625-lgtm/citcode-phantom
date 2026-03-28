-- CloudCostGuard Database Schema

-- Metrics table: stores time-series resource data
CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_name TEXT,
    metric_type TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT DEFAULT 'percent',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_metrics_resource_id ON metrics(resource_id);
CREATE INDEX idx_metrics_timestamp ON metrics(timestamp);
CREATE INDEX idx_metrics_metric_type ON metrics(metric_type);
CREATE INDEX idx_metrics_resource_timestamp ON metrics(resource_id, timestamp);

-- Anomalies table: stores detected anomalies
CREATE TABLE IF NOT EXISTS anomalies (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    resource_name TEXT,
    resource_type TEXT NOT NULL,
    anomaly_type TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    anomaly_score REAL NOT NULL,
    confidence REAL NOT NULL,
    features TEXT, -- JSON string
    recommended_action TEXT,
    estimated_savings REAL,
    status TEXT DEFAULT 'new',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_anomalies_resource_id ON anomalies(resource_id);
CREATE INDEX idx_anomalies_status ON anomalies(status);
CREATE INDEX idx_anomalies_detected_at ON anomalies(detected_at);

-- Actions table: stores automation actions
CREATE TABLE IF NOT EXISTS actions (
    id TEXT PRIMARY KEY,
    anomaly_id TEXT,
    resource_id TEXT NOT NULL,
    resource_name TEXT,
    action_type TEXT NOT NULL,
    action_params TEXT, -- JSON string
    status TEXT DEFAULT 'pending',
    dry_run INTEGER DEFAULT 1,
    requires_approval INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    approved_at TEXT,
    approved_by TEXT,
    executed_at TEXT,
    executed_by TEXT,
    result TEXT, -- JSON string
    error TEXT,
    savings REAL,
    FOREIGN KEY (anomaly_id) REFERENCES anomalies(id)
);

CREATE INDEX idx_actions_resource_id ON actions(resource_id);
CREATE INDEX idx_actions_status ON actions(status);
CREATE INDEX idx_actions_created_at ON actions(created_at);

-- Audit log table: all system events
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT, -- JSON string
    resource_id TEXT,
    action_type TEXT
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_category ON audit_log(category);

-- Settings table: configuration storage
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ML Model cache: stores trained model data
CREATE TABLE IF NOT EXISTS ml_model (
    id INTEGER PRIMARY KEY,
    model_type TEXT NOT NULL,
    model_data TEXT NOT NULL, -- JSON string
    feature_names TEXT NOT NULL, -- JSON array
    stats TEXT NOT NULL, -- JSON string (mean, std for normalization)
    trained_at TEXT NOT NULL,
    metrics TEXT -- JSON string (accuracy, etc)
);

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    auth_provider TEXT DEFAULT 'email',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Sessions table for express-session
CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);

-- Alerts table: real-time user notifications
CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    resource_id TEXT,
    resource_name TEXT,
    action_id TEXT,
    anomaly_id TEXT,
    acknowledged INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);

-- Insert default settings without overwriting saved values
INSERT OR IGNORE INTO settings (key, value) VALUES ('dry_run', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('anomaly_threshold', '0.5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('metric_interval', '300000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('aws_region', 'us-east-1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('automation_level', 'ask');
INSERT OR IGNORE INTO settings (key, value) VALUES ('last_fetch', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('system_status', 'initializing');
