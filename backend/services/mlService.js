const { queryAll, queryOne, runSql } = require('../config/database');
const loggerService = require('./loggerService');
const mlModel = require('../ml/model');

let model = null;
let modelStats = null;
let modelLoaded = false;

function getAnomalyThreshold() {
    const threshold = parseFloat(queryOne('SELECT value FROM settings WHERE key = ?', ['anomaly_threshold'])?.value || 0.5);
    return Number.isFinite(threshold) ? threshold : 0.5;
}

async function loadModel() {
    try {
        const savedModel = queryOne('SELECT * FROM ml_model WHERE id = 1');

        if (savedModel) {
            model = JSON.parse(savedModel.model_data);
            modelStats = JSON.parse(savedModel.stats);
            modelLoaded = true;
            loggerService.info('ml', 'Loaded existing ML model from database');
        } else {
            model = null;
            modelStats = null;
            modelLoaded = false;
            loggerService.info('ml', 'No model found, will train on next data collection');
        }
        return modelLoaded;
    } catch (error) {
        model = null;
        modelStats = null;
        modelLoaded = false;
        loggerService.error('ml', 'Failed to load ML model', { error: error.message });
        return false;
    }
}

function trainModel(features) {
    if (!features || features.length < 100) {
        loggerService.warn('ml', 'Insufficient data for training', { samples: features?.length || 0 });
        return null;
    }

    try {
        const { model: trainedModel, stats } = mlModel.train(features);
        model = trainedModel;
        modelStats = stats;
        modelLoaded = true;

        runSql(`
            INSERT OR REPLACE INTO ml_model (id, model_type, model_data, feature_names, stats, trained_at, metrics)
            VALUES (1, 'isolation_forest', ?, ?, ?, ?, ?)
        `, [
            JSON.stringify(model),
            JSON.stringify(['cpu', 'memory', 'networkIn', 'networkOut', 'hour', 'dayOfWeek', 'cpuMa7', 'cpuStd', 'networkMa7']),
            JSON.stringify(stats),
            new Date().toISOString(),
            JSON.stringify({ sampleSize: features.length })
        ]);

        loggerService.info('ml', 'Model trained and saved', { samples: features.length, stats });
        return true;
    } catch (error) {
        loggerService.error('ml', 'Model training failed', { error: error.message });
        return null;
    }
}

function detectAnomaly(features, threshold = null) {
    const anomalyThreshold = typeof threshold === 'number' ? threshold : getAnomalyThreshold();

    try {
        let result;

        if (!model) {
            result = statisticalAnomalyDetection(features);
        } else {
            const prediction = mlModel.predict(model, features);

            result = {
                anomalyScore: prediction.score,
                confidence: prediction.confidence || 0.8,
                features: features
            };
        }

        return {
            ...result,
            isAnomaly: result.anomalyScore >= anomalyThreshold,
            threshold: anomalyThreshold
        };
    } catch (error) {
        loggerService.error('ml', 'Anomaly detection failed', { error: error.message });

        const result = statisticalAnomalyDetection(features);
        return {
            ...result,
            isAnomaly: result.anomalyScore >= anomalyThreshold,
            threshold: anomalyThreshold
        };
    }
}

function normalizeFeatures(features) {
    if (!modelStats) {
        return features;
    }

    const normalized = {};
    for (const key in features) {
        const stat = modelStats[key];
        if (stat) {
            normalized[key] = (features[key] - stat.mean) / (stat.std || 1);
        } else {
            normalized[key] = features[key];
        }
    }
    return normalized;
}

function statisticalAnomalyDetection(features) {
    const cpu = features.cpu || 0;
    const networkIn = features.networkIn || 0;
    const networkOut = features.networkOut || 0;

    let score = 0;
    let reasons = [];

    if (cpu < 5) {
        score += 0.3;
        reasons.push('Very low CPU usage');
    } else if (cpu > 90) {
        score += 0.4;
        reasons.push('Very high CPU usage');
    }

    if (networkIn === 0 && networkOut === 0) {
        score += 0.35;
        reasons.push('No network activity');
    }

    const hour = features.hour || new Date().getHours();
    if (hour >= 22 || hour <= 6) {
        if (cpu > 20) {
            score += 0.15;
            reasons.push('Active during off-hours');
        }
    }

    return {
        anomalyScore: Math.min(score, 1),
        confidence: 0.7,
        features: features,
        reasons: reasons
    };
}

function determineAnomalyType(features, score) {
    const cpu = features.cpu || 0;
    const networkIn = features.networkIn || 0;
    const networkOut = features.networkOut || 0;
    const hour = features.hour || new Date().getHours();
    const costAnomaly = features.costAnomaly || false;
    const costSpikePercent = features.costSpikePercent || 0;

    // Check for cost anomalies first (highest priority)
    if (costAnomaly) {
        if (costSpikePercent > 200) {
            return { type: 'COST_SPIKE', action: 'SEND_ALERT', savings: estimateSavings('COST_ALERT') };
        }
        return { type: 'COST_ANOMALY', action: 'SEND_ALERT', savings: estimateSavings('COST_ALERT') };
    }

    if (cpu < 5 && networkIn < 1000 && networkOut < 1000) {
        return { type: 'IDLE_INSTANCE', action: 'STOP_INSTANCE', savings: estimateSavings('STOP_INSTANCE') };
    }

    if (networkIn === 0 && networkOut === 0 && cpu < 10) {
        return { type: 'ZOMBIE_INSTANCE', action: 'STOP_INSTANCE', savings: estimateSavings('STOP_INSTANCE') };
    }

    if (cpu > 90) {
        return { type: 'RESOURCE_BURN', action: 'ALERT_SCALE', savings: 0 };
    }

    if (hour >= 22 || hour <= 6) {
        if (cpu < 10) {
            return { type: 'SCHEDULED_WASTE', action: 'STOP_INSTANCE', savings: estimateSavings('STOP_INSTANCE') };
        }
    }

    if (score > 0.7) {
        return { type: 'COST_SPIKE', action: 'SEND_ALERT', savings: 0 };
    }

    return { type: 'ANOMALY', action: 'REVIEW', savings: 0 };
}

function estimateSavings(action) {
    const monthlySavings = {
        STOP_INSTANCE: 18.00,
        STOP_RDS: 75.00,
        SET_LIFECYCLE: 5.00,
        COST_ALERT: 0 // Cost alerts don't directly save money, they alert about spikes
    };
    return monthlySavings[action] || 5.00;
}

module.exports = {
    loadModel,
    trainModel,
    detectAnomaly,
    determineAnomalyType,
    statisticalAnomalyDetection,
    isModelLoaded: () => modelLoaded,
    getAnomalyThreshold
};
