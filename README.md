# CloudCostGuard – Autonomous Cloud Cost Intelligence System

## 📋 Project Overview

### What the System Does

CloudCostGuard is an autonomous cloud cost intelligence platform that continuously monitors AWS resource usage, detects anomalies using machine learning, and provides actionable optimization recommendations. It acts as an intelligent guardian that watches your cloud spend 24/7, identifies waste, and helps you take action before costs spiral out of control.

### Real-World Use Case

A DevOps team managing multiple AWS accounts struggles to track resource utilization across hundreds of EC2 instances, S3 buckets, and RDS databases. CloudCostGuard automatically:
- Detects an idle `t3.medium` instance running 24/7 with only 5% CPU utilization
- Flags this as an anomaly with 94% confidence
- Recommends stopping the instance during off-hours
- Calculates potential savings ($23.40/month)
- Executes the optimization (with approval) and logs the action

---

## 🏗️ System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CloudCostGuard                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐    │
│  │              │     │              │     │                      │    │
│  │   AWS Cloud  │────▶│  Express.js  │────▶│      SQLite          │    │
│  │   (EC2/S3)   │     │   Backend    │     │   Database           │    │
│  │              │     │              │     │                      │    │
│  └──────────────┘     └──────┬───────┘     └──────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│                     ┌──────────────────┐                               │
│                     │                   │                               │
│                     │    ML Engine      │                               │
│                     │ (Isolation Forest)│                               │
│                     │                   │                               │
│                     └─────────┬─────────┘                               │
│                               │                                          │
│                              ▼                                           │
│                     ┌──────────────────┐                                │
│                     │  Automation      │                                │
│                     │  Engine          │                                │
│                     └─────────┬────────┘                                │
│                               │                                          │
│                              ▼                                           │
│  ┌───────────────────────────────────────────────────────────────┐     │
│  │                    React Frontend (Premium UI)                  │     │
│  │  ┌─────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────┐  │     │
│  │  │  Dashboard  │ │   Alerts     │ │   Costs    │ │  Actions │  │     │
│  │  │  Overview   │ │    Panel     │ │   Trends   │ │   Log    │  │     │
│  │  └─────────────┘ └──────────────┘ └────────────┘ └──────────┘  │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
AWS Cloud ──▶ Metrics Fetcher ──▶ SQLite DB ──▶ ML Analyzer ──▶ Decision Engine
                    │                                         │
                    │                                         ▼
                    │                               ┌─────────────────┐
                    │                               │ Automation Hub  │
                    │                               │ (Stop/Start/    │
                    │                               │  Alert/Scale)   │
                    │                               └────────┬────────┘
                    │                                        │
                    ▼                                        ▼
              Real-time Data                           Approved Actions
                    │                                        │
                    ▼                                        ▼
           ┌────────────────┐                      ┌────────────────┐
           │  React UI      │◀─────────────────────│  AWS Execute   │
           │  Dashboard     │                      │  (with approval)│
           └────────────────┘                      └────────────────┘
```

---

## 📦 Modules Breakdown

### 1. Frontend (React + Tailwind CSS)

**Purpose:** Premium dashboard for visualization and control

**Components:**
- `Dashboard` - Main overview with key metrics cards
- `ResourceMonitor` - Live resource usage graphs (Recharts)
- `AnomalyAlerts` - Real-time anomaly notifications
- `CostTrends` - Cost analysis and projections
- `ActionCenter` - Pending approvals and action history
- `SettingsPanel` - AWS credentials and configuration

**Features:**
- Apple-like glassmorphism design
- Smooth CSS animations
- Real-time WebSocket updates (polling fallback)
- Dark/light mode support
- Responsive layout

### 2. Backend (Node.js + Express)

**Purpose:** API server, AWS integration, orchestration

**Routes:**
- `/api/metrics` - Fetch and store AWS metrics
- `/api/anomalies` - Query detected anomalies
- `/api/actions` - Manage automation actions
- `/api/recommendations` - Cost optimization suggestions
- `/api/status` - System health check

**Services:**
- `AWSService` - AWS SDK integration
- `MetricCollector` - Scheduled data fetching
- `MLService` - Anomaly detection interface
- `AutomationService` - Action execution
- `LoggerService` - Audit logging

### 3. ML Engine (Isolation Forest)

**Purpose:** Detect anomalies in cloud resource usage

**Algorithm:** Isolation Forest (scikit-learn style implementation)

**Input Features:**
- CPU utilization (%)
- Memory usage (%)
- Network I/O (bytes/s)
- Disk I/O (bytes/s)
- Time of day (hour)
- Day of week
- Historical average
- Standard deviation

**Output:**
- `isAnomaly`: boolean
- `anomalyScore`: 0.0 - 1.0 (higher = more anomalous)
- `confidence`: 0.0 - 1.0
- `features`: array of feature contributions

### 4. Automation Engine

**Purpose:** Map anomalies to corrective actions

**Action Mapping:**

| Anomaly Type | Condition | Action | Safety Level |
|--------------|-----------|--------|--------------|
| Idle Instance | CPU < 5% for 30+ min | Stop Instance | Medium |
| Unused Instance | No network traffic 24h | Stop Instance | High |
| Cost Spike | Usage > 3σ from mean | Send Alert | None |
| Resource Burn | CPU > 90% sustained | Alert + Scale Suggestion | Low |
| Scheduled Waste | Off-hours high idle | Stop (if approved) | Medium |

**Safety Features:**
- Dry-run mode (default ON)
- Explicit approval required for destructive actions
- Action cooldown period (5 minutes)
- Rollback capability for stop actions

### 5. AWS Integration

**Monitored Services:**
- EC2 (instances, CPU, network)
- S3 (bucket sizes, request counts)
- RDS (database instances)
- Lambda (function executions)

**Security:**
- IAM role with minimal permissions (read-only + stop/start)
- Credentials via environment variables
- No hardcoded secrets
- All API calls logged

### 6. Database (SQLite)

**Purpose:** Store telemetry data and anomaly history

**Tables:**
- `metrics` - Time-series resource data
- `anomalies` - Detected anomalies
- `actions` - Automation actions taken
- `audit_log` - All system events
- `settings` - Configuration storage

---

## 📁 Folder Structure

```
cloudcostguard/
├── README.md
├── package.json
├── .env.example
├── .gitignore
│
├── backend/
│   ├── package.json
│   ├── server.js                 # Express entry point
│   ├── config/
│   │   └── database.js           # SQLite connection
│   ├── routes/
│   │   ├── metrics.js            # /api/metrics
│   │   ├── anomalies.js          # /api/anomalies
│   │   ├── actions.js            # /api/actions
│   │   └── status.js             # /api/status
│   ├── services/
│   │   ├── awsService.js         # AWS SDK integration
│   │   ├── metricCollector.js    # Scheduled fetching
│   │   ├── mlService.js          # ML inference
│   │   ├── automationService.js   # Action execution
│   │   └── loggerService.js      # Audit logging
│   ├── ml/
│   │   ├── model.js              # Isolation Forest model
│   │   ├── trainer.js            # Model training script
│   │   └── normalizer.js         # Feature scaling
│   └── database/
│       ├── schema.sql            # Database schema
│       └── migrations/
│           └── 001_initial.sql
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── index.css
│   │   ├── components/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── ResourceMonitor.jsx
│   │   │   ├── AnomalyAlerts.jsx
│   │   │   ├── CostTrends.jsx
│   │   │   ├── ActionCenter.jsx
│   │   │   ├── SettingsPanel.jsx
│   │   │   ├── MetricCard.jsx
│   │   │   ├── AnomalyBadge.jsx
│   │   │   └── GlassCard.jsx
│   │   ├── hooks/
│   │   │   ├── useApi.js
│   │   │   └── useMetrics.js
│   │   └── utils/
│   │       └── formatters.js
│   └── public/
│       └── favicon.svg
│
└── scripts/
    ├── train-model.js           # One-time model training
    └── setup-database.js        # Initialize SQLite
```

---

## 🔄 Data Pipeline

### Step 1: Collection
```
AWS CloudWatch API ──▶ MetricCollector ──▶ SQLite (metrics table)
```
- Runs every 5 minutes via setInterval
- Fetches: CPU, Network, Memory for all EC2 instances
- Stores with timestamp, resource_id, metric_type, value

### Step 2: Analysis
```
SQLite (metrics) ──▶ MLService ──▶ Anomaly Detection
```
- Loads last 24 hours of data per resource
- Normalizes features
- Runs Isolation Forest inference
- Returns anomaly score and confidence

### Step 3: Decision
```
ML Output ──▶ AutomationService ──▶ Action Recommendation
```
- Maps anomaly to predefined action types
- Calculates potential savings
- Creates pending action with approval flag
- Sends alert if high confidence

### Step 4: Execution (with approval)
```
User Approval ──▶ Action Center ──▶ AWS API ──▶ Result Logged
```
- User reviews recommendation
- Clicks "Approve" or "Dismiss"
- Backend executes via AWS SDK
- Result stored in audit_log

### Step 5: Display
```
All data ──▶ REST API ──▶ React Dashboard
```
- Frontend polls every 30 seconds
- Charts update with new data
- Alerts appear in real-time

---

## 🤖 ML Approach (DETAILED)

### Algorithm: Isolation Forest

**Why Isolation Forest?**
- Works exceptionally well with high-dimensional data (cloud metrics)
- Does not require labeled training data (unsupervised)
- Fast inference suitable for real-time detection
- Robust to outliers in normal data
- Memory efficient

### Input Features

```javascript
{
  cpu_utilization: number,      // 0-100 %
  memory_utilization: number,   // 0-100 %
  network_in: number,          // bytes/s
  network_out: number,          // bytes/s
  disk_read: number,           // bytes/s
  disk_write: number,          // bytes/s
  hour_of_day: number,         // 0-23
  day_of_week: number,         // 0-6
  cpu_ma7: number,            // 7-day moving average
  cpu_std7: number,           // 7-day standard deviation
  network_ma7: number,        // 7-day network moving average
}
```

### Output Schema

```javascript
{
  resourceId: "i-0abc123def456",
  timestamp: "2026-03-28T10:30:00Z",
  isAnomaly: true,
  anomalyScore: 0.87,          // 0.5+ = anomaly threshold
  confidence: 0.94,            // certainty of prediction
  features: [
    { name: "cpu_utilization", value: 2.1, contribution: 0.34 },
    { name: "network_in", value: 0, contribution: 0.28 },
    { name: "hour_of_day", value: 3, contribution: 0.12 }
  ],
  recommendedAction: "STOP_INSTANCE",
  estimatedSavings: 23.40      // USD/month
}
```

### Model Training

```javascript
// Training process (runs once, then saved)
1. Collect 7-30 days of historical metrics
2. Label obvious anomalies manually (or use IQR method)
3. Train Isolation Forest with:
   - n_estimators: 100
   - max_samples: 256
   - contamination: 0.1 (10% expected anomalies)
4. Evaluate with cross-validation
5. Save model as JSON (tree structure)
6. Load model at startup for inference
```

### Anomaly Scoring

```
score = average_path_length / c(n)

where:
- average_path_length = mean depth to isolate point
- c(n) = average path length for average pointer
- Lower score = more anomalous (isolated faster)
```

---

## ⚡ Automation Logic

### Action Mapping Matrix

```
┌────────────────────────────────────────────────────────────────────┐
│                    Anomaly → Action Mapping                         │
├──────────────────┬───────────────┬──────────────┬─────────────────┤
│ Detection        │ Threshold    │ Action       │ Approval        │
├──────────────────┼───────────────┼──────────────┼─────────────────┤
│ IDLE_INSTANCE    │ CPU < 5%      │ STOP_INSTANCE │ REQUIRED        │
│                  │ for 30+ min  │              │ (MEDIUM_SAFE)   │
├──────────────────┼───────────────┼──────────────┼─────────────────┤
│ ZOMBIE_INSTANCE  │ Network = 0   │ STOP_INSTANCE │ REQUIRED        │
│                  │ for 24 hours  │              │ (HIGH_SAFE)     │
├──────────────────┼───────────────┼──────────────┼─────────────────┤
│ COST_SPIKE       │ > 3σ from    │ SEND_ALERT    │ NOT_REQUIRED    │
│                  │ mean          │              │                 │
├──────────────────┼───────────────┼──────────────┼─────────────────┤
│ RESOURCE_BURN    │ CPU > 90%     │ ALERT_SCALE   │ REVIEW_ONLY     │
│                  │ for 10+ min   │              │                 │
├──────────────────┼───────────────┼──────────────┼─────────────────┤
│ SCHEDULED_WASTE  │ Off-hours     │ STOP_INSTANCE │ REQUIRED        │
│                  │ CPU < 10%     │              │ (AUTO_APPROVE   │
│                  │               │              │  if trusted)    │
├──────────────────┼───────────────┼──────────────┼─────────────────┤
│ UNUSED_S3        │ No access     │ SET_LIFECYCLE │ REQUIRED        │
│                  │ 30+ days      │              │                 │
└──────────────────┴───────────────┴──────────────┴─────────────────┘
```

### Safety Rules

1. **Dry Run Mode (Default: ON)**
   - All actions logged but NOT executed
   - Shows what WOULD happen

2. **Approval Levels**
   - `NONE` - Execute immediately (alerts only)
   - `REVIEW_ONLY` - Log suggestion
   - `REQUIRED` - Must click approve
   - `HIGH_SAFE` - Double confirmation for stop/delete

3. **Resource Protection Tags**
   - Resources with `CostGuard:Protected=true` are NEVER auto-actioned
   - Must be manually approved only

4. **Cooldown Period**
   - Same action on same resource: 5 minute minimum
   - Prevents rapid flip-flopping

5. **Rollback Capability**
   - Stop actions can be reversed with 1-click
   - Shows "Undo" for 30 minutes after action

---

## 🌐 API Design

### Endpoints

#### GET /api/status
Health check and system status.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 86400,
  "lastFetch": "2026-03-28T10:30:00Z",
  "awsConnected": true,
  "mlModelLoaded": true,
  "pendingActions": 3
}
```

#### GET /api/metrics
Fetch stored metrics.

**Query Parameters:**
- `resourceId` (optional) - Filter by instance
- `metricType` (optional) - cpu, memory, network
- `startDate` (optional) - ISO timestamp
- `endDate` (optional) - ISO timestamp
- `limit` (optional) - Max records (default 1000)

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "timestamp": "2026-03-28T10:30:00Z",
      "resourceId": "i-0abc123def456",
      "resourceType": "EC2",
      "metricType": "cpu_utilization",
      "value": 45.2,
      "unit": "percent"
    }
  ],
  "count": 1,
  "pagination": {
    "page": 1,
    "limit": 1000,
    "hasMore": false
  }
}
```

#### POST /api/metrics/fetch
Trigger immediate metric fetch from AWS.

**Response:**
```json
{
  "success": true,
  "fetched": {
    "ec2": 12,
    "s3": 5,
    "rds": 2
  },
  "timestamp": "2026-03-28T10:35:00Z"
}
```

#### GET /api/anomalies
Get detected anomalies.

**Query Parameters:**
- `status` (optional) - new, acknowledged, resolved
- `minScore` (optional) - Minimum anomaly score (0-1)
- `limit` (optional)

**Response:**
```json
{
  "data": [
    {
      "id": "anomaly_001",
      "resourceId": "i-0abc123def456",
      "resourceName": "web-server-prod",
      "type": "IDLE_INSTANCE",
      "detectedAt": "2026-03-28T10:30:00Z",
      "score": 0.87,
      "confidence": 0.94,
      "features": [...],
      "recommendedAction": "STOP_INSTANCE",
      "estimatedSavings": 23.40,
      "status": "new",
      "actionRequired": true
    }
  ],
  "count": 1,
  "summary": {
    "total": 1,
    "new": 1,
    "acknowledged": 0,
    "resolved": 0
  }
}
```

#### GET /api/actions
Get automation actions.

**Query Parameters:**
- `status` (optional) - pending, approved, executed, dismissed
- `resourceId` (optional)

**Response:**
```json
{
  "data": [
    {
      "id": "action_001",
      "anomalyId": "anomaly_001",
      "resourceId": "i-0abc123def456",
      "actionType": "STOP_INSTANCE",
      "status": "pending",
      "dryRun": true,
      "createdAt": "2026-03-28T10:30:00Z",
      "requiresApproval": true,
      "approver": null,
      "executedAt": null,
      "result": null
    }
  ]
}
```

#### POST /api/actions/:id/approve
Approve a pending action.

**Response:**
```json
{
  "success": true,
  "action": {
    "id": "action_001",
    "status": "approved",
    "approvedAt": "2026-03-28T10:35:00Z",
    "approver": "admin"
  }
}
```

#### POST /api/actions/:id/execute
Execute an approved action.

**Response:**
```json
{
  "success": true,
  "action": {
    "id": "action_001",
    "status": "executed",
    "executedAt": "2026-03-28T10:35:05Z",
    "result": {
      "awsResponse": {
        "StoppingInstances": [
          {
            "InstanceId": "i-0abc123def456",
            "CurrentState": { "Code": 64, "Name": "stopping" },
            "PreviousState": { "Code": 16, "Name": "running" }
          }
        ]
      }
    },
    "savings": 23.40
  }
}
```

#### POST /api/actions/:id/dismiss
Dismiss an action without execution.

**Response:**
```json
{
  "success": true,
  "action": {
    "id": "action_001",
    "status": "dismissed",
    "dismissedAt": "2026-03-28T10:35:00Z"
  }
}
```

#### GET /api/recommendations
Get cost optimization recommendations.

**Response:**
```json
{
  "data": [
    {
      "id": "rec_001",
      "type": "RIGHT_SIZING",
      "resourceId": "i-0abc123def456",
      "resourceName": "db-server",
      "currentType": "t3.large",
      "recommendedType": "t3.medium",
      "monthlySavings": 45.00,
      "confidence": 0.89,
      "reason": "CPU utilization avg 15%, memory avg 30%"
    },
    {
      "id": "rec_002",
      "type": "STOP_IDLE",
      "resourceId": "i-0xyz789",
      "resourceName": "dev-instance",
      "action": "STOP",
      "monthlySavings": 18.50,
      "confidence": 0.95,
      "reason": "No network traffic for 72 hours"
    }
  ],
  "totalPotentialSavings": 563.40
}
```

#### GET /api/costs
Get cost analysis data.

**Query Parameters:**
- `period` - 7d, 30d, 90d

**Response:**
```json
{
  "period": "30d",
  "totalCost": 1247.80,
  "breakdown": {
    "ec2": 890.50,
    "s3": 124.30,
    "rds": 200.00,
    "lambda": 33.00
  },
  "projectedMonthly": 1247.80,
  "trends": [
    { "date": "2026-03-01", "cost": 41.20 },
    { "date": "2026-03-02", "cost": 42.10 }
  ],
  "anomalies": {
    "highCostDays": [
      { "date": "2026-03-15", "cost": 89.40, "reason": "Suspected spike" }
    ]
  }
}
```

---

## 🔐 Security Plan

### AWS Credentials Handling

1. **Environment Variables (Primary)**
   ```bash
   export AWS_ACCESS_KEY_ID=AKIA...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_REGION=us-east-1
   ```

2. **IAM Role (Recommended for EC2/Lambda)**
   - Attach least-privilege IAM role
   - No long-term credentials needed
   - Role: `CloudCostGuardReadOnly` + `CloudCostGuardActions`

3. **Credentials File**
   ```ini
   [cloudcostguard]
   aws_access_key_id = AKIA...
   aws_secret_access_key = ...
   ```

### Permission Model

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeInstanceStatus",
        "cloudwatch:GetMetricData",
        "cloudwatch:ListMetrics"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:StopInstances",
        "ec2:StartInstances"
      ],
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringEquals": {
          "ec2:ResourceTag/CostGuard:Managed": "true"
        }
      }
    }
  ]
}
```

### Safe Execution Rules

1. **Never Delete** - Only stop/start operations
2. **Protected Resources** - Respect `CostGuard:Protected=true` tag
3. **Audit Everything** - All API calls logged with timestamp
4. **Dry Run Default** - Actions must be explicitly approved
5. **Credential Isolation** - Backend never exposes raw credentials

---

## 🚀 Setup Instructions

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm or yarn
- AWS Account (Free Tier sufficient)
- Git

### Step 1: Clone Repository

```bash
git clone <repository-url>
cd cloudcostguard
```

### Step 2: Backend Setup

```bash
cd backend
npm install

# Create environment file
cp .env.example .env
# Edit .env with your AWS credentials
```

### Step 3: Initialize Database

```bash
cd backend
npm run db:setup
# This creates cloudcostguard.db with all tables
```

### Step 4: Train ML Model

```bash
cd backend
npm run ml:train
# First run: Collects 7 days data, trains model
# Subsequent runs: Incremental learning
```

### Step 5: Start Backend

```bash
cd backend
npm run dev
# Server runs on http://localhost:5000
```

### Step 6: Frontend Setup

```bash
cd frontend
npm install
npm run dev
# Frontend runs on http://localhost:3000
```

### Step 7: Initial Configuration

1. Open http://localhost:3000
2. Go to Settings
3. Enter AWS credentials (or use IAM role)
4. Select regions to monitor
5. Choose automation level
6. Click "Save & Start Monitoring"

### Step 8: Verify Integration

```bash
# Backend health check
curl http://localhost:5000/api/status

# Expected response:
# {"status":"healthy","awsConnected":true,...}
```

---

## ⚙️ Configuration Options

### Environment Variables

```bash
# Backend (.env)
PORT=5000
NODE_ENV=development
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
METRIC_INTERVAL=300000       # 5 minutes
ANOMALY_THRESHOLD=0.5        # Score threshold
DRY_RUN=true                 # Safety mode
LOG_LEVEL=info

# Frontend (.env)
VITE_API_URL=http://localhost:5000
VITE_REFRESH_INTERVAL=30000   # 30 seconds
```

---

## 📊 Expected Outcomes

### Demo Flow (End-to-End)

1. System starts, connects to AWS
2. Collects metrics for all EC2 instances
3. Stores in SQLite database
4. ML model analyzes last 24 hours
5. Detects idle instance (CPU < 5%)
6. Creates anomaly record with score 0.87
7. Frontend displays alert with recommendation
8. User clicks "Approve" to stop instance
9. Backend executes EC2 StopInstances API
10. Action logged in audit table
11. Dashboard updates to show "Stopped" status
12. Estimated savings displayed

### Performance Targets

- Metric fetch: < 5 seconds for 50 instances
- ML inference: < 100ms per resource
- Dashboard load: < 2 seconds
- Action execution: < 3 seconds
- Database queries: < 50ms

---

## 🛠️ Troubleshooting

### Common Issues

1. **AWS Connection Failed**
   - Verify credentials are correct
   - Check IAM permissions
   - Ensure region is correct

2. **No Metrics Showing**
   - Wait 5 minutes for first collection
   - Check if EC2 instances are running
   - Verify CloudWatch metrics enabled

3. **ML Model Not Loading**
   - Run `npm run ml:train` first
   - Check database has enough data

4. **Actions Not Executing**
   - Verify DRY_RUN=false
   - Check approval status
   - Ensure IAM has stop/start permissions

---

## 📄 License

MIT License - See LICENSE file for details.

---

## 🤝 Contributing

Contributions welcome! Please read CONTRIBUTING.md before submitting PRs.
