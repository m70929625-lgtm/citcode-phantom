# CloudCostGuard Codebase Guide

## Purpose

This document explains how the current codebase works, how the application is built, and how the main pieces connect at runtime.

It is written against the actual files in this repository. It is more accurate than the older high-level README for understanding the current implementation.

## What This Application Does

CloudCostGuard is a full-stack AWS monitoring and cloud-cost-control application.

At a high level, it:

1. Connects to AWS using saved credentials and a selected region.
2. Collects EC2 and CloudWatch usage data on an interval.
3. Stores that data in a local SQLite database.
4. Runs anomaly detection on the collected metrics.
5. Converts anomalies into recommended actions such as stopping an idle instance.
6. Exposes the data through an Express API.
7. Displays everything in a React dashboard.

The product is built around one local backend process plus one frontend app:

- Backend API: `http://localhost:5000`
- Frontend UI: `http://localhost:5173`

## Tech Stack

### Frontend

- React 18
- Vite
- Tailwind CSS
- Recharts
- `lucide-react` icons

Main frontend entry points:

- [main.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/main.jsx)
- [App.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/App.jsx)
- [useApi.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/hooks/useApi.js)

### Backend

- Node.js
- Express
- AWS SDK v3
- `sql.js` with a local SQLite database file

Main backend entry points:

- [server.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/server.js)
- [database.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/config/database.js)
- [schema.sql](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/database/schema.sql)

## Top-Level Structure

```text
html program/
├── backend/
├── frontend/
├── docs/
├── package.json
└── README.md
```

### Root Scripts

Defined in [package.json](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/package.json):

- `npm run dev`
  Starts backend and frontend together.
- `npm run dev:backend`
  Starts only the backend.
- `npm run dev:frontend`
  Starts only the frontend.
- `npm run build`
  Builds the frontend.
- `npm run db:setup`
  Initializes the backend database.
- `npm run ml:train`
  Runs the model training script.

## Runtime Architecture

```text
AWS APIs
  │
  ▼
AWS Service Layer
  │
  ▼
Metric Collector ──► SQLite DB ──► ML Service ──► Automation Service
  │                                           │
  └────────────────────────── API Routes ◄────┘
                              │
                              ▼
                         React Frontend
```

## Startup Flow

The backend startup flow is implemented in [server.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/server.js).

When the backend starts, it does this:

1. Initializes the database.
2. Sets `system_status` to `starting`.
3. Loads the ML model from the database, if one exists.
4. Initializes automation settings such as `dry_run` and `automation_level`.
5. Tests the AWS connection using the currently stored credentials and region.
6. Starts the metric collector.
7. Sets `system_status` to `running`.

The backend registers these API route groups:

- `/api/metrics`
- `/api/anomalies`
- `/api/actions`
- `/api/status`
- `/api/recommendations`
- `/api/costs`
- `/api/settings`

## Database Layer

The database implementation is in [database.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/config/database.js).

Important details:

- The app uses `sql.js`, which loads the SQLite database into memory.
- The database file is stored at `backend/cloudcostguard.db`.
- Every write calls `saveDatabase()` so the in-memory database is written back to disk.

### Main Tables

Defined in [schema.sql](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/database/schema.sql):

- `metrics`
  Time-series resource telemetry.
- `anomalies`
  Detected anomalies and suggested actions.
- `actions`
  Action queue and execution history.
- `audit_log`
  System log records.
- `settings`
  Runtime configuration values.
- `ml_model`
  Serialized trained model and feature stats.

### Important Settings Keys

Stored in the `settings` table:

- `dry_run`
- `anomaly_threshold`
- `metric_interval`
- `aws_region`
- `automation_level`
- `last_fetch`
- `system_status`
- `aws_access_key_id`
- `aws_secret_access_key`

## AWS Integration

AWS access is implemented in [awsService.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/awsService.js).

### What It Does

It creates AWS SDK clients for:

- EC2
- CloudWatch
- S3
- RDS
- Lambda
- Cost Explorer

### Configuration Source

AWS configuration is loaded in this order:

1. Saved values from the `settings` table
2. Environment variables
3. Default region fallback

The service can:

- test AWS connectivity
- list EC2 instances
- fetch EC2 CloudWatch metrics
- list S3 buckets
- list RDS instances
- list Lambda functions
- stop or start EC2 instances
- query AWS Cost Explorer

### Important Current Behavior

- Regular resource metrics use the selected app region.
- Cost Explorer is always called in `us-east-1`, which is correct for the AWS billing API.
- If Cost Explorer is not enabled for the AWS account or IAM user, the app falls back to estimated cost values.

## Metric Collection Flow

Metric collection is implemented in [metricCollector.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/metricCollector.js).

### What It Collects

For each EC2 instance, the collector stores:

- `cpu_utilization`
- `network_in`
- `network_out`

### Collection Schedule

- Default interval: `300000` ms
- That is 5 minutes
- The collector also runs once immediately at startup

### Flow

1. Fetch EC2 instances from AWS.
2. Fetch CloudWatch metrics for those instance IDs.
3. Insert metrics into the `metrics` table.
4. Fetch S3 bucket list for visibility.
5. Update `last_fetch`.
6. Trigger anomaly detection.

## ML and Anomaly Detection

The app uses two ML-related files:

- [mlService.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/mlService.js)
- [model.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/ml/model.js)

### Practical Design

The application supports two modes:

1. Trained model mode
   Uses the saved Isolation-Forest-like model from the database.
2. Statistical fallback mode
   Used when no trained model is available.

### Feature Vector

The current anomaly feature object includes:

- `cpu`
- `memory`
- `networkIn`
- `networkOut`
- `hour`
- `dayOfWeek`
- `cpuMa7`
- `cpuStd`
- `networkMa7`

In the current code, `memory` is always `0` because the collector does not fetch memory metrics.

### Detection Logic

`mlService.detectAnomaly()`:

- loads the saved threshold from `settings`
- predicts with the stored model if available
- otherwise falls back to statistical checks

`mlService.determineAnomalyType()` maps the signal to:

- `IDLE_INSTANCE`
- `ZOMBIE_INSTANCE`
- `RESOURCE_BURN`
- `SCHEDULED_WASTE`
- `COST_SPIKE`
- `ANOMALY`

Each anomaly type also carries:

- a recommended action
- an estimated savings value

### Model Training

The training script is [train-model.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/scripts/train-model.js).

It:

1. reads stored metrics
2. builds training features from real values
3. trains the local model implementation
4. stores model data in `ml_model`

## Automation and Action Flow

Action logic lives in [automationService.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/automationService.js).

### Supported Action Types

Currently supported for execution:

- `STOP_INSTANCE`
- `START_INSTANCE`

Other suggested action types may be recorded as recommendations or anomaly metadata, but only the two above can actually execute through AWS in the current backend.

### Action Lifecycle

1. An anomaly is created.
2. If automation mode is not `suggest`, an action record may be created.
3. If automation mode is `ask`, the action remains `pending`.
4. If automation mode is `auto`, the system can approve and execute automatically.
5. Execution respects the stored `dry_run` value.

### Safety Rules Implemented in Code

- Duplicate actions are suppressed within a cooldown window.
- Only `approved` actions can execute.
- `dry_run` is stored per action.
- Unsupported action types are skipped.

## Cost System

Cost logic is in [costs.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/costs.js).

### Current Behavior

The route tries this order:

1. Fetch live AWS billing data from Cost Explorer.
2. If that fails, fall back to resource-count-based estimated cost data.

### Why Fallback Exists

Many AWS users do not have Cost Explorer enabled immediately. The current app therefore stays usable by returning estimated cost data instead of an error.

### Cost Response Fields

The route returns:

- `totalCost`
- `breakdown`
- `serviceBreakdown`
- `projectedMonthly`
- `trends`
- `anomalies`
- `source`
- `sourceCurrency`
- `displayCurrency`
- `isEstimated`
- `fallbackReason` when live billing fails

### Current UI Currency Behavior

The frontend displays cost values in INR. When the source is USD, the UI converts the values for presentation.

## Recommendations

Recommendation logic is in [recommendations.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/recommendations.js).

Recommendations come from two sources:

1. Existing anomaly rows with actionable recommendations
2. A direct query that looks for idle resources over the last 24 hours

The route returns:

- recommendation list
- per-item monthly savings
- total potential savings

## Settings Flow

Settings are handled by [settings.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/settings.js) and [SettingsPanel.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/components/SettingsPanel.jsx).

### Backend

The backend supports:

- general settings updates through `PUT /api/settings`
- credential updates through `POST /api/settings/aws-credentials`

When the region or credentials change, the AWS clients are refreshed and the app retests connectivity.

### Frontend

The current UI intentionally keeps the modal simple and only exposes:

- AWS access key ID
- AWS secret access key
- AWS region

The UI does not currently expose backend controls like `dry_run` or `automation_level`, even though the backend still supports them.

## API Summary

### Metrics

- [metrics.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/metrics.js)
- fetch raw metrics
- fetch latest per-resource metrics
- fetch summary aggregates
- trigger immediate collection

### Anomalies

- [anomalies.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/anomalies.js)
- list anomalies
- read one anomaly
- update anomaly status

### Actions

- [actions.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/actions.js)
- list actions
- list pending actions
- approve action
- execute action
- dismiss action
- action summary statistics

### Status

- [status.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/status.js)
- backend uptime
- AWS connection state
- current region
- model status
- automation state
- pending actions
- anomaly count
- resource counts

## Frontend Structure

The frontend is organized around a root shell and tabbed views.

### Root Shell

[App.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/App.jsx)

Responsibilities:

- loads `/api/status`
- shows the hero and top navigation
- switches between tabs
- opens the settings modal

### Main Screens

- [Dashboard.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/components/Dashboard.jsx)
  Overview, usage charts, anomaly summary, recommendations, recent activity
- [ResourceMonitor.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/components/ResourceMonitor.jsx)
  Per-resource list with summary and search
- [AnomalyAlerts.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/components/AnomalyAlerts.jsx)
  Anomaly review and status updates
- [CostTrends.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/components/CostTrends.jsx)
  Cost cards, trend chart, breakdown chart
- [ActionCenter.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/components/ActionCenter.jsx)
  Pending, approved, executed, dismissed actions
- [SettingsPanel.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/components/SettingsPanel.jsx)
  AWS credential and region setup

### Shared Frontend Utilities

- [useApi.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/hooks/useApi.js)
  Simple API client wrapper for all backend endpoints
- [formatters.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/utils/formatters.js)
  Number, time, percent, and currency formatting
- [index.css](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/index.css)
  Global visual system and custom UI styles

## End-to-End Example Flow

Here is the actual runtime flow of a common case:

1. User opens the app and saves AWS credentials in the settings modal.
2. Backend stores the credentials in the `settings` table.
3. Backend refreshes AWS clients and tests the connection.
4. Metric collector runs and stores EC2 CPU and network metrics.
5. Anomaly detection groups recent metrics by resource.
6. If a resource looks idle or abnormal, the backend creates an anomaly row.
7. Depending on automation mode, the backend may also create an action row.
8. The frontend polls the API and displays:
   - anomalies in Alerts
   - action queue in Action Center
   - usage graphs on the dashboard
   - status and connection information in the header and overview

## Important Implementation Notes

### 1. This Is a Local-First App

There is no user authentication layer inside the app itself. It assumes local or trusted use.

### 2. AWS Secrets Are Stored Locally

The backend stores the AWS secret in the settings database and does not send it back to the browser. This is acceptable for local development, but not ideal for production.

### 3. Metric Coverage Is Still Narrow

The current collector is strongest for EC2. The app can list S3, RDS, and Lambda resources, but the stored time-series metrics and anomaly logic are mostly centered on EC2 CPU and network behavior.

### 4. Costs May Be Live or Estimated

The cost screen can operate in two modes:

- live AWS Cost Explorer data
- estimated fallback data

The response tells the frontend which one is being used.

### 5. No Formal Test Suite Is Present

The current repository does not include a proper automated backend or frontend test suite. Verification is mainly done through API checks, local builds, and live behavior.

## How To Extend This Codebase

### If You Want Better Metrics

Good files to extend:

- [awsService.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/awsService.js)
- [metricCollector.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/metricCollector.js)

Examples:

- add memory metrics
- add disk metrics
- add RDS CloudWatch metrics
- add Lambda invocation and duration metrics

### If You Want Better Anomaly Detection

Good files to extend:

- [mlService.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/mlService.js)
- [model.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/ml/model.js)
- [train-model.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/scripts/train-model.js)

### If You Want More Automation Actions

Good files to extend:

- [automationService.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/automationService.js)
- [awsService.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/awsService.js)

### If You Want UI Changes

Good files to extend:

- [App.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/App.jsx)
- the component under `frontend/src/components/`
- [index.css](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/index.css)

## Quick File Map

### Backend Core

- [server.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/server.js)
- [database.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/config/database.js)
- [schema.sql](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/database/schema.sql)

### Backend Services

- [awsService.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/awsService.js)
- [metricCollector.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/metricCollector.js)
- [mlService.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/mlService.js)
- [automationService.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/automationService.js)
- [loggerService.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/services/loggerService.js)

### Backend Routes

- [metrics.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/metrics.js)
- [anomalies.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/anomalies.js)
- [actions.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/actions.js)
- [status.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/status.js)
- [recommendations.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/recommendations.js)
- [costs.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/costs.js)
- [settings.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/routes/settings.js)

### Frontend Core

- [main.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/main.jsx)
- [App.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/App.jsx)
- [useApi.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/hooks/useApi.js)
- [formatters.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/utils/formatters.js)

## Summary

This application is built as a practical local cloud-operations dashboard:

- React handles the UI.
- Express handles the API.
- `sql.js` plus a SQLite file handles storage.
- AWS SDK handles cloud access.
- A custom ML layer detects anomalies.
- An automation layer turns anomalies into actions.

The most important runtime chain in the app is:

`AWS -> metric collector -> database -> anomaly detection -> actions -> API -> React dashboard`

If you want to update this guide later, the safest files to re-check are:

- [server.js](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/server.js)
- [schema.sql](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/backend/database/schema.sql)
- `backend/routes/*`
- `backend/services/*`
- [App.jsx](/C:/Users/Manoj%20N/OneDrive/Desktop/html%20program/frontend/src/App.jsx)
