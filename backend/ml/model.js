/**
 * Isolation Forest Implementation
 *
 * Isolation Forest is an unsupervised anomaly detection algorithm
 * that isolates anomalies by randomly selecting a feature and
 * splitting values randomly.
 *
 * Anomalies require fewer splits to be isolated, resulting in
 * shorter average path lengths in the decision tree.
 */

function buildIsolationTree(data, depth = 0, maxDepth = 10) {
    // Base case: no data or max depth reached
    if (depth >= maxDepth || data.length <= 1) {
        return { type: 'leaf', size: data.length };
    }

    // Random feature selection
    const features = Object.keys(data[0]);
    const feature = features[Math.floor(Math.random() * features.length)];

    // Random split point
    const values = data.map(d => d[feature]);
    const min = Math.min(...values);
    const max = Math.max(...values);

    if (min === max) {
        return { type: 'leaf', size: data.length };
    }

    // Random split point
    const splitValue = min + Math.random() * (max - min);

    const left = data.filter(d => d[feature] < splitValue);
    const right = data.filter(d => d[feature] >= splitValue);

    return {
        type: 'node',
        feature,
        splitValue,
        left: buildIsolationTree(left, depth + 1, maxDepth),
        right: buildIsolationTree(right, depth + 1, maxDepth)
    };
}

function pathLength(point, tree, depth = 0) {
    if (tree.type === 'leaf') {
        // Average path length for a given sample size (c(n))
        const c = (n) => {
            if (n <= 1) return 0;
            if (n === 2) return 1;
            return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1) / n);
        };
        return depth + c(tree.size);
    }

    if (point[tree.feature] < tree.splitValue) {
        return pathLength(point, tree.left, depth + 1);
    } else {
        return pathLength(point, tree.right, depth + 1);
    }
}

function train(features, options = {}) {
    const {
        numTrees = 100,
        maxSamples = 256,
        maxDepth = 10
    } = options;

    // Normalize features
    const stats = {};
    const featureKeys = Object.keys(features[0]);

    for (const key of featureKeys) {
        const values = features.map(f => f[key]);
        stats[key] = {
            mean: values.reduce((a, b) => a + b, 0) / values.length,
            std: Math.sqrt(values.reduce((a, b) => a + Math.pow(b - values.reduce((c, d) => c + d, 0) / values.length, 2), 0) / values.length),
            min: Math.min(...values),
            max: Math.max(...values)
        };
    }

    // Normalize data
    const normalizedData = features.map(f => {
        const normalized = {};
        for (const key in f) {
            if (stats[key] && stats[key].std > 0) {
                normalized[key] = (f[key] - stats[key].mean) / stats[key].std;
            } else {
                normalized[key] = f[key];
            }
        }
        return normalized;
    });

    // Sample data if necessary
    const sampleSize = Math.min(maxSamples, normalizedData.length);
    const sampledData = [];
    for (let i = 0; i < sampleSize; i++) {
        sampledData.push(normalizedData[Math.floor(Math.random() * normalizedData.length)]);
    }

    // Build isolation trees
    const trees = [];
    for (let i = 0; i < numTrees; i++) {
        // Bootstrap sample
        const bootstrapSample = [];
        for (let j = 0; j < sampleSize; j++) {
            bootstrapSample.push(sampledData[Math.floor(Math.random() * sampleSize)]);
        }
        trees.push(buildIsolationTree(bootstrapSample, 0, maxDepth));
    }

    return {
        model: { trees, stats },
        stats,
        options
    };
}

function predict(model, point) {
    const { trees, stats } = model;

    // Normalize point
    const normalized = {};
    for (const key in point) {
        if (stats[key] && stats[key].std > 0) {
            normalized[key] = (point[key] - stats[key].mean) / stats[key].std;
        } else {
            normalized[key] = point[key];
        }
    }

    // Calculate average path length
    const avgPathLength = trees.reduce((sum, tree) => {
        return sum + pathLength(normalized, tree, 0);
    }, 0) / trees.length;

    // c(n) for average path length calculation
    const c = (n) => {
        if (n <= 1) return 0;
        if (n === 2) return 1;
        return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1) / n);
    };

    // Anomaly score
    // Score = 2^(-avgPathLength / c(n))
    // Lower path length = higher score = more anomalous
    const sampleSize = trees.length;
    const score = Math.pow(2, -(avgPathLength / c(sampleSize)));

    // Confidence based on variance of path lengths
    const pathLengths = trees.map(tree => pathLength(normalized, tree, 0));
    const variance = pathLengths.reduce((sum, pl) => sum + Math.pow(pl - avgPathLength, 2), 0) / pathLengths.length;
    const confidence = 1 - Math.min(Math.sqrt(variance) / avgPathLength, 1);

    return {
        score: Math.min(Math.max(score, 0), 1),
        confidence: Math.min(Math.max(confidence, 0), 1)
    };
}

module.exports = {
    train,
    predict,
    buildIsolationTree,
    pathLength
};
