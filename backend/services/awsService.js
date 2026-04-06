const { EC2Client, DescribeInstancesCommand, StopInstancesCommand, StartInstancesCommand } = require('@aws-sdk/client-ec2');
const { CloudWatchClient, GetMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const { S3Client, ListBucketsCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { RDSClient, DescribeDBInstancesCommand } = require('@aws-sdk/client-rds');
const { LambdaClient, ListFunctionsCommand } = require('@aws-sdk/client-lambda');
const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');
const { queryOne } = require('../config/database');
const loggerService = require('./loggerService');
const userSettingsService = require('./userSettingsService');
const cryptoService = require('./cryptoService');

class AWSService {
    constructor() {
        this.contextByUser = new Map();
    }

    resolveUserKey(userId = null) {
        return userId || 'global';
    }

    loadConfiguration(userId = null) {
        const isUserScoped = Boolean(userId);
        const region = userSettingsService.getUserSetting(userId, 'aws_region', { allowGlobalFallback: true }) || process.env.AWS_REGION || 'us-east-1';

        const accessRaw = userSettingsService.getUserSetting(userId, 'aws_access_key_id', { allowGlobalFallback: !isUserScoped });
        const secretRaw = userSettingsService.getUserSetting(userId, 'aws_secret_access_key', { allowGlobalFallback: !isUserScoped });

        let accessKeyId = accessRaw || null;
        let secretAccessKey = secretRaw || null;

        try {
            if (accessKeyId) accessKeyId = cryptoService.decryptText(accessKeyId);
            if (secretAccessKey) secretAccessKey = cryptoService.decryptText(secretAccessKey);
        } catch (error) {
            loggerService.warn('aws', 'Failed to decrypt user AWS credentials', { error: error.message, userId });
            accessKeyId = null;
            secretAccessKey = null;
        }

        if (!isUserScoped) {
            accessKeyId = accessKeyId || process.env.AWS_ACCESS_KEY_ID || null;
            secretAccessKey = secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || null;
        }

        return {
            region,
            accessKeyId,
            secretAccessKey,
            sessionToken: !isUserScoped ? process.env.AWS_SESSION_TOKEN : null
        };
    }

    initializeClients(userId = null, force = false) {
        try {
            const userKey = this.resolveUserKey(userId);
            const existingContext = this.contextByUser.get(userKey);

            if (!force && existingContext?.ec2Client && existingContext?.cloudWatchClient && existingContext?.s3Client && existingContext?.rdsClient && existingContext?.lambdaClient && existingContext?.costExplorerClient) {
                return true;
            }

            const config = this.loadConfiguration(userId);
            const options = { region: config.region };

            if (config.accessKeyId && config.secretAccessKey) {
                options.credentials = {
                    accessKeyId: config.accessKeyId,
                    secretAccessKey: config.secretAccessKey,
                    sessionToken: config.sessionToken || undefined
                };
            }

            const context = {
                region: config.region,
                ec2Client: new EC2Client(options),
                cloudWatchClient: new CloudWatchClient(options),
                s3Client: new S3Client(options),
                rdsClient: new RDSClient(options),
                lambdaClient: new LambdaClient(options),
                costExplorerClient: new CostExplorerClient({ ...options, region: 'us-east-1' }),
                isConnected: false,
                hasCredentials: Boolean(config.accessKeyId && config.secretAccessKey)
            };

            this.contextByUser.set(userKey, context);
            loggerService.info('aws', 'AWS clients initialized', { userId, region: context.region });
            return true;
        } catch (error) {
            loggerService.error('aws', 'Failed to initialize AWS clients', { error: error.message, userId });
            return false;
        }
    }

    getContext(userId = null) {
        const userKey = this.resolveUserKey(userId);
        let context = this.contextByUser.get(userKey);

        if (!context) {
            this.initializeClients(userId);
            context = this.contextByUser.get(userKey);
        }

        return context;
    }

    refreshClients(userId = null) {
        const userKey = this.resolveUserKey(userId);
        this.contextByUser.delete(userKey);
        return this.initializeClients(userId, true);
    }

    setConnectionState(userId, isConnected) {
        const context = this.getContext(userId);
        if (context) {
            context.isConnected = Boolean(isConnected);
        }
    }

    getConnectionState(userId = null) {
        const context = this.getContext(userId);
        return Boolean(context?.isConnected);
    }

    getRegion(userId = null) {
        const context = this.getContext(userId);
        return context?.region || 'us-east-1';
    }

    async testConnection(userId = null) {
        try {
            const context = this.getContext(userId);
            if (!context?.ec2Client) {
                return false;
            }

            const command = new DescribeInstancesCommand({ MaxResults: 5 });
            await context.ec2Client.send(command);
            this.setConnectionState(userId, true);
            return true;
        } catch (error) {
            loggerService.error('aws', 'AWS connection test failed', { error: error.message, userId });
            this.setConnectionState(userId, false);
            return false;
        }
    }

    async getEC2Instances(userId = null) {
        try {
            const context = this.getContext(userId);
            if (!context?.ec2Client) return [];

            const instances = [];
            let nextToken = undefined;

            do {
                const command = new DescribeInstancesCommand({
                    Filters: [{ Name: 'instance-state-name', Values: ['running', 'stopped'] }],
                    MaxResults: 100,
                    NextToken: nextToken
                });

                const response = await context.ec2Client.send(command);

                for (const reservation of response.Reservations || []) {
                    for (const instance of reservation.Instances || []) {
                        instances.push({
                            id: instance.InstanceId,
                            type: instance.InstanceType,
                            state: instance.State?.Name,
                            name: instance.Tags?.find((t) => t.Key === 'Name')?.Value || instance.InstanceId,
                            region: context.region,
                            platform: instance.Platform || 'Linux/UNIX',
                            launched: instance.LaunchTime
                        });
                    }
                }

                nextToken = response.NextToken;
            } while (nextToken);

            this.setConnectionState(userId, true);
            loggerService.info('aws', `Fetched ${instances.length} EC2 instances`, { userId });
            return instances;
        } catch (error) {
            this.setConnectionState(userId, false);
            loggerService.error('aws', 'Failed to fetch EC2 instances', { error: error.message, userId });
            return [];
        }
    }

    async getEC2Metrics(instanceIds, period = 300, userId = null) {
        try {
            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - period * 1000);

            const metrics = [];
            for (const instanceId of instanceIds) {
                const cpuMetric = await this.getMetricData(instanceId, 'CPUUtilization', startTime, endTime, userId);
                const networkMetric = await this.getMetricData(instanceId, 'NetworkIn', startTime, endTime, userId);
                const networkOutMetric = await this.getMetricData(instanceId, 'NetworkOut', startTime, endTime, userId);

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
            loggerService.error('aws', 'Failed to fetch EC2 metrics', { error: error.message, userId });
            return [];
        }
    }

    async getMetricData(instanceId, metricName, startTime, endTime, userId = null) {
        return this.getCloudWatchMetric({
            namespace: 'AWS/EC2',
            metricName,
            dimensions: [{ Name: 'InstanceId', Value: instanceId }],
            startTime,
            endTime,
            period: 300,
            stat: 'Average'
        }, userId);
    }

    async getCloudWatchMetric({ namespace, metricName, dimensions, startTime, endTime, period = 300, stat = 'Average' }, userId = null) {
        try {
            const context = this.getContext(userId);
            if (!context?.cloudWatchClient) return null;

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

            const response = await context.cloudWatchClient.send(command);
            return response.MetricDataResults?.[0]?.Values?.[0] || null;
        } catch (error) {
            return null;
        }
    }

    async getS3Buckets(userId = null) {
        try {
            const context = this.getContext(userId);
            if (!context?.s3Client) return [];

            const command = new ListBucketsCommand({});
            const response = await context.s3Client.send(command);

            const buckets = (response.Buckets || []).map((bucket) => ({
                id: bucket.Name,
                name: bucket.Name,
                creationDate: bucket.CreationDate,
                region: context.region
            }));

            loggerService.info('aws', `Fetched ${buckets.length} S3 buckets`, { userId });
            return buckets;
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch S3 buckets', { error: error.message, userId });
            return [];
        }
    }

    async getS3BucketMetrics(buckets = [], userId = null) {
        try {
            const context = this.getContext(userId);
            if (!context?.s3Client) return [];

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

                        const response = await context.s3Client.send(command);
                        objectCount += response.KeyCount || 0;

                        for (const object of response.Contents || []) {
                            totalSize += object.Size || 0;
                        }

                        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
                    } while (continuationToken);
                } catch (error) {
                    loggerService.warn('aws', 'Failed to inspect S3 bucket contents', {
                        userId,
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
            loggerService.error('aws', 'Failed to fetch S3 bucket metrics', { error: error.message, userId });
            return [];
        }
    }

    async getRDSInstances(userId = null) {
        try {
            const context = this.getContext(userId);
            if (!context?.rdsClient) return [];

            const command = new DescribeDBInstancesCommand({});
            const response = await context.rdsClient.send(command);

            const instances = (response.DBInstances || []).map((db) => ({
                id: db.DBInstanceIdentifier,
                engine: db.Engine,
                state: db.DBInstanceStatus,
                class: db.DBInstanceClass,
                name: db.DBInstanceIdentifier,
                region: context.region,
                allocatedStorage: db.AllocatedStorage
            }));

            loggerService.info('aws', `Fetched ${instances.length} RDS instances`, { userId });
            return instances;
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch RDS instances', { error: error.message, userId });
            return [];
        }
    }

    async getRDSMetrics(instances = [], period = 300, userId = null) {
        try {
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
                }, userId);

                const connections = await this.getCloudWatchMetric({
                    namespace: 'AWS/RDS',
                    metricName: 'DatabaseConnections',
                    dimensions: [{ Name: 'DBInstanceIdentifier', Value: instance.id }],
                    startTime,
                    endTime,
                    period,
                    stat: 'Average'
                }, userId);

                const freeStorage = await this.getCloudWatchMetric({
                    namespace: 'AWS/RDS',
                    metricName: 'FreeStorageSpace',
                    dimensions: [{ Name: 'DBInstanceIdentifier', Value: instance.id }],
                    startTime,
                    endTime,
                    period,
                    stat: 'Average'
                }, userId);

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
            loggerService.error('aws', 'Failed to fetch RDS metrics', { error: error.message, userId });
            return [];
        }
    }

    async getLambdaFunctions(userId = null) {
        try {
            const context = this.getContext(userId);
            if (!context?.lambdaClient) return [];

            const command = new ListFunctionsCommand({});
            const response = await context.lambdaClient.send(command);

            const functions = (response.Functions || []).map((fn) => ({
                id: fn.FunctionName,
                name: fn.FunctionName,
                runtime: fn.Runtime,
                state: fn.State,
                region: context.region
            }));

            loggerService.info('aws', `Fetched ${functions.length} Lambda functions`, { userId });
            return functions;
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch Lambda functions', { error: error.message, userId });
            return [];
        }
    }

    async getLambdaMetrics(functions = [], period = 300, userId = null) {
        try {
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
                }, userId);

                const errors = await this.getCloudWatchMetric({
                    namespace: 'AWS/Lambda',
                    metricName: 'Errors',
                    dimensions: [{ Name: 'FunctionName', Value: fn.name }],
                    startTime,
                    endTime,
                    period,
                    stat: 'Sum'
                }, userId);

                const duration = await this.getCloudWatchMetric({
                    namespace: 'AWS/Lambda',
                    metricName: 'Duration',
                    dimensions: [{ Name: 'FunctionName', Value: fn.name }],
                    startTime,
                    endTime,
                    period,
                    stat: 'Average'
                }, userId);

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
            loggerService.error('aws', 'Failed to fetch Lambda metrics', { error: error.message, userId });
            return [];
        }
    }

    async stopInstance(instanceId, dryRun = true, userId = null) {
        try {
            const context = this.getContext(userId);
            if (!context?.ec2Client) {
                return { success: false, error: 'AWS client not initialized' };
            }

            const command = new StopInstancesCommand({ InstanceIds: [instanceId], DryRun: dryRun });
            const response = await context.ec2Client.send(command);

            loggerService.log(
                dryRun ? 'info' : 'warn',
                'aws',
                `Stop instance ${instanceId} ${dryRun ? '(DRY RUN)' : ''}`,
                { response, userId },
                instanceId,
                'STOP_INSTANCE'
            );

            return {
                success: true,
                currentState: response.StoppingInstances?.[0]?.CurrentState?.Name,
                previousState: response.StoppingInstances?.[0]?.PreviousState?.Name
            };
        } catch (error) {
            loggerService.error('aws', `Failed to stop instance ${instanceId}`, { error: error.message, userId });
            return { success: false, error: error.message };
        }
    }

    async startInstance(instanceId, dryRun = true, userId = null) {
        try {
            const context = this.getContext(userId);
            if (!context?.ec2Client) {
                return { success: false, error: 'AWS client not initialized' };
            }

            const command = new StartInstancesCommand({ InstanceIds: [instanceId], DryRun: dryRun });
            const response = await context.ec2Client.send(command);

            loggerService.log(
                dryRun ? 'info' : 'warn',
                'aws',
                `Start instance ${instanceId} ${dryRun ? '(DRY RUN)' : ''}`,
                { response, userId },
                instanceId,
                'START_INSTANCE'
            );

            return {
                success: true,
                currentState: response.StartingInstances?.[0]?.CurrentState?.Name,
                previousState: response.StartingInstances?.[0]?.PreviousState?.Name
            };
        } catch (error) {
            loggerService.error('aws', `Failed to start instance ${instanceId}`, { error: error.message, userId });
            return { success: false, error: error.message };
        }
    }

    async getResourceById(resourceId, userId = null) {
        if (userId) {
            return queryOne(
                'SELECT * FROM metrics WHERE user_id = ? AND resource_id = ? ORDER BY timestamp DESC LIMIT 1',
                [userId, resourceId]
            );
        }

        return queryOne('SELECT * FROM metrics WHERE resource_id = ? ORDER BY timestamp DESC LIMIT 1', [resourceId]);
    }

    async getCostAndUsage({ startDate, endDate, granularity = 'DAILY', groupBy = [] }, userId = null) {
        try {
            const context = this.getContext(userId);
            if (!context?.costExplorerClient) {
                throw new Error('Cost Explorer client not initialized');
            }

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

            return await context.costExplorerClient.send(command);
        } catch (error) {
            loggerService.error('aws', 'Failed to fetch cost and usage data', { error: error.message, userId });
            throw error;
        }
    }
}

module.exports = new AWSService();
