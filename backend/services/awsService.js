const { EC2Client, DescribeInstancesCommand, StopInstancesCommand, StartInstancesCommand, DescribeInstanceStatusCommand } = require('@aws-sdk/client-ec2');
const { CloudWatchClient, GetMetricDataCommand, ListMetricsCommand } = require('@aws-sdk/client-cloudwatch');
const { S3Client, ListBucketsCommand, ListObjectsV2Command, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { RDSClient, DescribeDBInstancesCommand } = require('@aws-sdk/client-rds');
const { LambdaClient, ListFunctionsCommand, InvokeCommand } = require('@aws-sdk/client-lambda');
const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');
const { queryOne } = require('../config/database');
const loggerService = require('./loggerService');

class AWSService {
    constructor() {
        this.region = process.env.AWS_REGION || 'us-east-1';
        this.ec2Client = null;
        this.cloudWatchClient = null;
        this.s3Client = null;
        this.rdsClient = null;
        this.lambdaClient = null;
        this.costExplorerClient = null;
        this.isConnected = false;
    }

    loadConfiguration() {
        const savedRegion = queryOne('SELECT value FROM settings WHERE key = ?', ['aws_region'])?.value;
        const savedAccessKeyId = queryOne('SELECT value FROM settings WHERE key = ?', ['aws_access_key_id'])?.value;
        const savedSecretAccessKey = queryOne('SELECT value FROM settings WHERE key = ?', ['aws_secret_access_key'])?.value;

        return {
            region: savedRegion || process.env.AWS_REGION || 'us-east-1',
            accessKeyId: savedAccessKeyId || process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: savedSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY,
            sessionToken: process.env.AWS_SESSION_TOKEN
        };
    }

    initializeClients(force = false) {
        try {
            if (!force && this.ec2Client && this.cloudWatchClient && this.s3Client && this.rdsClient && this.lambdaClient && this.costExplorerClient) {
                return true;
            }

            const config = this.loadConfiguration();
            this.region = config.region;

            const options = { region: this.region };

            if (config.accessKeyId && config.secretAccessKey) {
                options.credentials = {
                    accessKeyId: config.accessKeyId,
                    secretAccessKey: config.secretAccessKey,
                    sessionToken: config.sessionToken
                };
            }

            this.ec2Client = new EC2Client(options);
            this.cloudWatchClient = new CloudWatchClient(options);
            this.s3Client = new S3Client(options);
            this.rdsClient = new RDSClient(options);
            this.lambdaClient = new LambdaClient(options);
            this.costExplorerClient = new CostExplorerClient({
                ...options,
                region: 'us-east-1'
            });

            loggerService.info('aws', 'AWS clients initialized', { region: this.region });
            return true;
        } catch (error) {
            loggerService.error('aws', 'Failed to initialize AWS clients', { error: error.message });
            return false;
        }
    }

    refreshClients() {
        this.ec2Client = null;
        this.cloudWatchClient = null;
        this.s3Client = null;
        this.rdsClient = null;
        this.lambdaClient = null;
        this.costExplorerClient = null;
        this.isConnected = false;

        return this.initializeClients(true);
    }

    async testConnection() {
        try {
            if (!this.ec2Client) {
                this.initializeClients();
            }

            const command = new DescribeInstancesCommand({ MaxResults: 5 });
            await this.ec2Client.send(command);
            this.isConnected = true;
            return true;
        } catch (error) {
            loggerService.error('aws', 'AWS connection test failed', { error: error.message });
            this.isConnected = false;
            return false;
        }
    }

    async getEC2Instances() {
        try {
            if (!this.ec2Client) this.initializeClients();

            const instances = [];
            let nextToken = undefined;

            do {
                const command = new DescribeInstancesCommand({
                    Filters: [{ Name: 'instance-state-name', Values: ['running', 'stopped'] }],
                    MaxResults: 100,
                    NextToken: nextToken
                });

                const response = await this.ec2Client.send(command);

                for (const reservation of response.Reservations) {
                    for (const instance of reservation.Instances) {
                        instances.push({
                            id: instance.InstanceId,
                            type: instance.InstanceType,
                            state: instance.State.Name,
                            name: instance.Tags?.find(t => t.Key === 'Name')?.Value || instance.InstanceId,
                            region: this.region,
                            platform: instance.Platform || 'Linux/UNIX',
                            launched: instance.LaunchTime
                        });
                    }
                }

                nextToken = response.NextToken;
            } while (nextToken);

            loggerService.info('aws', `Fetched ${instances.length} EC2 instances`);
            return instances;
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch EC2 instances', { error: error.message });
            return [];
        }
    }

    async getEC2Metrics(instanceIds, period = 300) {
        try {
            if (!this.cloudWatchClient) this.initializeClients();

            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - period * 1000);

            const metrics = [];

            for (const instanceId of instanceIds) {
                const cpuMetric = await this.getMetricData(instanceId, 'CPUUtilization', startTime, endTime);
                const networkMetric = await this.getMetricData(instanceId, 'NetworkIn', startTime, endTime);
                const networkOutMetric = await this.getMetricData(instanceId, 'NetworkOut', startTime, endTime);

                metrics.push({
                    resourceId: instanceId,
                    timestamp: endTime.toISOString(),
                    cpu: cpuMetric || 0,
                    networkIn: networkMetric || 0,
                    networkOut: networkOutMetric || 0
                });
            }

            return metrics;
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch EC2 metrics', { error: error.message });
            return [];
        }
    }

    async getMetricData(instanceId, metricName, startTime, endTime) {
        return this.getCloudWatchMetric({
            namespace: 'AWS/EC2',
            metricName,
            dimensions: [{ Name: 'InstanceId', Value: instanceId }],
            startTime,
            endTime,
            period: 300,
            stat: 'Average'
        });
    }

    async getCloudWatchMetric({ namespace, metricName, dimensions, startTime, endTime, period = 300, stat = 'Average' }) {
        try {
            const command = new GetMetricDataCommand({
                MetricDataQueries: [{
                    Id: 'm1',
                    MetricStat: {
                        Metric: {
                            Namespace: namespace,
                            MetricName: metricName,
                            Dimensions: dimensions
                        },
                        Period: period,
                        Stat: stat
                    }
                }],
                StartTime: startTime,
                EndTime: endTime
            });

            const response = await this.cloudWatchClient.send(command);
            return response.MetricDataResults[0]?.Values[0] || null;
        } catch (error) {
            return null;
        }
    }

    async getS3Buckets() {
        try {
            if (!this.s3Client) this.initializeClients();

            const command = new ListBucketsCommand({});
            const response = await this.s3Client.send(command);

            const buckets = response.Buckets.map(bucket => ({
                id: bucket.Name,
                name: bucket.Name,
                creationDate: bucket.CreationDate,
                region: this.region
            }));

            loggerService.info('aws', `Fetched ${buckets.length} S3 buckets`);
            return buckets;
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch S3 buckets', { error: error.message });
            return [];
        }
    }

    async getS3BucketMetrics(buckets = []) {
        try {
            if (!this.s3Client) this.initializeClients();

            const metrics = [];

            for (const bucket of buckets) {
                let continuationToken = undefined;
                let objectCount = 0;
                let totalSize = 0;

                try {
                    do {
                        const command = new ListObjectsV2Command({
                            Bucket: bucket.name,
                            ContinuationToken: continuationToken
                        });

                        const response = await this.s3Client.send(command);
                        objectCount += response.KeyCount || 0;

                        for (const object of response.Contents || []) {
                            totalSize += object.Size || 0;
                        }

                        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
                    } while (continuationToken);
                } catch (error) {
                    loggerService.warn('aws', 'Failed to inspect S3 bucket contents', {
                        bucket: bucket.name,
                        error: error.message
                    });
                }

                metrics.push({
                    resourceId: bucket.id,
                    timestamp: new Date().toISOString(),
                    objectCount,
                    totalSize
                });
            }

            return metrics;
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch S3 bucket metrics', { error: error.message });
            return [];
        }
    }

    async getRDSInstances() {
        try {
            if (!this.rdsClient) this.initializeClients();

            const command = new DescribeDBInstancesCommand({});
            const response = await this.rdsClient.send(command);

            const instances = response.DBInstances.map(db => ({
                id: db.DBInstanceIdentifier,
                engine: db.Engine,
                state: db.DBInstanceStatus,
                class: db.DBInstanceClass,
                name: db.DBInstanceIdentifier,
                region: this.region,
                allocatedStorage: db.AllocatedStorage
            }));

            loggerService.info('aws', `Fetched ${instances.length} RDS instances`);
            return instances;
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch RDS instances', { error: error.message });
            return [];
        }
    }

    async getRDSMetrics(instances = [], period = 300) {
        try {
            if (!this.cloudWatchClient) this.initializeClients();

            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - period * 1000);
            const metrics = [];

            for (const instance of instances) {
                const cpu = await this.getCloudWatchMetric({
                    namespace: 'AWS/RDS',
                    metricName: 'CPUUtilization',
                    dimensions: [{ Name: 'DBInstanceIdentifier', Value: instance.id }],
                    startTime,
                    endTime,
                    period,
                    stat: 'Average'
                });
                const connections = await this.getCloudWatchMetric({
                    namespace: 'AWS/RDS',
                    metricName: 'DatabaseConnections',
                    dimensions: [{ Name: 'DBInstanceIdentifier', Value: instance.id }],
                    startTime,
                    endTime,
                    period,
                    stat: 'Average'
                });
                const freeStorage = await this.getCloudWatchMetric({
                    namespace: 'AWS/RDS',
                    metricName: 'FreeStorageSpace',
                    dimensions: [{ Name: 'DBInstanceIdentifier', Value: instance.id }],
                    startTime,
                    endTime,
                    period,
                    stat: 'Average'
                });

                metrics.push({
                    resourceId: instance.id,
                    timestamp: endTime.toISOString(),
                    cpu: cpu || 0,
                    connections: connections || 0,
                    freeStorage: freeStorage || 0
                });
            }

            return metrics;
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch RDS metrics', { error: error.message });
            return [];
        }
    }

    async getLambdaFunctions() {
        try {
            if (!this.lambdaClient) this.initializeClients();

            const command = new ListFunctionsCommand({});
            const response = await this.lambdaClient.send(command);

            const functions = response.Functions.map(fn => ({
                id: fn.FunctionName,
                name: fn.FunctionName,
                runtime: fn.Runtime,
                state: fn.State,
                region: this.region
            }));

            loggerService.info('aws', `Fetched ${functions.length} Lambda functions`);
            return functions;
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch Lambda functions', { error: error.message });
            return [];
        }
    }

    async getLambdaMetrics(functions = [], period = 300) {
        try {
            if (!this.cloudWatchClient) this.initializeClients();

            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - period * 1000);
            const metrics = [];

            for (const fn of functions) {
                const invocations = await this.getCloudWatchMetric({
                    namespace: 'AWS/Lambda',
                    metricName: 'Invocations',
                    dimensions: [{ Name: 'FunctionName', Value: fn.name }],
                    startTime,
                    endTime,
                    period,
                    stat: 'Sum'
                });
                const errors = await this.getCloudWatchMetric({
                    namespace: 'AWS/Lambda',
                    metricName: 'Errors',
                    dimensions: [{ Name: 'FunctionName', Value: fn.name }],
                    startTime,
                    endTime,
                    period,
                    stat: 'Sum'
                });
                const duration = await this.getCloudWatchMetric({
                    namespace: 'AWS/Lambda',
                    metricName: 'Duration',
                    dimensions: [{ Name: 'FunctionName', Value: fn.name }],
                    startTime,
                    endTime,
                    period,
                    stat: 'Average'
                });

                metrics.push({
                    resourceId: fn.id,
                    timestamp: endTime.toISOString(),
                    invocations: invocations || 0,
                    errors: errors || 0,
                    duration: duration || 0
                });
            }

            return metrics;
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch Lambda metrics', { error: error.message });
            return [];
        }
    }

    async stopInstance(instanceId, dryRun = true) {
        try {
            if (!this.ec2Client) this.initializeClients();

            const command = new StopInstancesCommand({
                InstanceIds: [instanceId],
                DryRun: dryRun
            });

            const response = await this.ec2Client.send(command);
            loggerService.log(
                dryRun ? 'info' : 'warn',
                'aws',
                `Stop instance ${instanceId} ${dryRun ? '(DRY RUN)' : ''}`,
                { response },
                instanceId,
                'STOP_INSTANCE'
            );

            return {
                success: true,
                currentState: response.StoppingInstances[0].CurrentState.Name,
                previousState: response.StoppingInstances[0].PreviousState.Name
            };
        } catch (error) {
            loggerService.error('aws', `Failed to stop instance ${instanceId}`, { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async startInstance(instanceId, dryRun = true) {
        try {
            if (!this.ec2Client) this.initializeClients();

            const command = new StartInstancesCommand({
                InstanceIds: [instanceId],
                DryRun: dryRun
            });

            const response = await this.ec2Client.send(command);
            loggerService.log(
                dryRun ? 'info' : 'warn',
                'aws',
                `Start instance ${instanceId} ${dryRun ? '(DRY RUN)' : ''}`,
                { response },
                instanceId,
                'START_INSTANCE'
            );

            return {
                success: true,
                currentState: response.StartingInstances[0].CurrentState.Name,
                previousState: response.StartingInstances[0].PreviousState.Name
            };
        } catch (error) {
            loggerService.error('aws', `Failed to start instance ${instanceId}`, { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async getResourceById(resourceId) {
        return queryOne(
            'SELECT * FROM metrics WHERE resource_id = ? ORDER BY timestamp DESC LIMIT 1',
            [resourceId]
        );
    }

    async getCostAndUsage({ startDate, endDate, granularity = 'DAILY', groupBy = [] }) {
        try {
            if (!this.costExplorerClient) this.initializeClients();

            const command = new GetCostAndUsageCommand({
                TimePeriod: {
                    Start: startDate,
                    End: endDate
                },
                Granularity: granularity,
                Metrics: ['UnblendedCost'],
                ...(groupBy.length > 0
                    ? {
                        GroupBy: groupBy.map((key) => ({
                            Type: 'DIMENSION',
                            Key: key
                        }))
                    }
                    : {})
            });

            return await this.costExplorerClient.send(command);
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch cost and usage data', { error: error.message });
            throw error;
        }
    }
}

module.exports = new AWSService();
