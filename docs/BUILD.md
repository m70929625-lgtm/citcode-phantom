# CloudCostGuard - Build Instructions

## Prerequisites

- Node.js 18+ (LTS recommended)
- npm or yarn
- AWS Account with appropriate IAM permissions
- Git

## Quick Start

### 1. Backend Setup

```bash
cd backend
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your AWS credentials:
# AWS_ACCESS_KEY_ID=AKIA...
# AWS_SECRET_ACCESS_KEY=...
# AWS_REGION=us-east-1
```

### 2. Initialize Database

```bash
cd backend
npm run db:setup
```

### 3. Start Backend

```bash
npm run dev
# Server runs on http://localhost:5000
```

### 4. Frontend Setup

```bash
cd frontend
npm install
npm run dev
# Frontend runs on http://localhost:5173
```

## AWS IAM Permissions

Create an IAM user or role with these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeInstanceStatus",
        "ec2:StopInstances",
        "ec2:StartInstances",
        "cloudwatch:GetMetricData",
        "cloudwatch:ListMetrics"
      ],
      "Resource": "*"
    }
  ]
}
```

## Demo Flow

1. Start backend and frontend
2. Open http://localhost:5173
3. Go to Settings and enter AWS credentials
4. Click "Save Settings"
5. System will start collecting metrics
6. View Dashboard for overview
7. Check Alerts for anomalies
8. Approve actions in Action Center

## Troubleshooting

**Backend won't start:**
- Check if port 5000 is available
- Verify Node.js version (18+)

**AWS connection failed:**
- Verify credentials are correct
- Check IAM permissions
- Ensure region is correct

**No metrics showing:**
- Wait 5 minutes for first collection
- Check if EC2 instances are running
- Verify CloudWatch metrics enabled
