const API_BASE = '/api';

export async function fetchApi(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let errorMessage = `API Error: ${response.statusText}`;

    try {
      const errorBody = await response.json();
      errorMessage = errorBody.details || errorBody.error || errorMessage;
    } catch (error) {
      // Ignore JSON parsing errors and keep the status text fallback.
    }

    throw new Error(errorMessage);
  }

  return response.json();
}

// Status
export const getStatus = () => fetchApi('/status');
export const getSettings = () => fetchApi('/settings');
export const updateSettings = (data) => fetchApi('/settings', {
  method: 'PUT',
  body: JSON.stringify(data),
});
export const updateAwsCredentials = (data) => fetchApi('/settings/aws-credentials', {
  method: 'POST',
  body: JSON.stringify(data),
});

// Metrics
export const getMetrics = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetchApi(`/metrics${query ? `?${query}` : ''}`);
};
export const getLatestMetrics = () => fetchApi('/metrics/latest');
export const getMetricsSummary = (period = '24h') => fetchApi(`/metrics/summary?period=${period}`);
export const fetchMetrics = () => fetchApi('/metrics/fetch', { method: 'POST' });

// Anomalies
export const getAnomalies = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetchApi(`/anomalies${query ? `?${query}` : ''}`);
};
export const getAnomaly = (id) => fetchApi(`/anomalies/${id}`);
export const updateAnomaly = (id, status) => fetchApi(`/anomalies/${id}`, {
  method: 'PATCH',
  body: JSON.stringify({ status }),
});

// Actions
export const getActions = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetchApi(`/actions${query ? `?${query}` : ''}`);
};
export const getPendingActions = () => fetchApi('/actions/pending');
export const approveAction = (id, approver = 'admin') => fetchApi(`/actions/${id}/approve`, {
  method: 'POST',
  body: JSON.stringify({ approver }),
});
export const executeAction = (id) => fetchApi(`/actions/${id}/execute`, { method: 'POST' });
export const dismissAction = (id) => fetchApi(`/actions/${id}/dismiss`, { method: 'POST' });
export const getActionStats = () => fetchApi('/actions/stats/summary');

// Recommendations
export const getRecommendations = () => fetchApi('/recommendations');
export const executeRecommendation = (rec) => fetchApi('/recommendations/execute', {
  method: 'POST',
  body: JSON.stringify(rec)
});

// Alerts
export const getAlerts = (params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetchApi(`/alerts${query ? `?${query}` : ''}`);
};
export const getActiveAlerts = () => fetchApi('/alerts/active');
export const getAlertCounts = () => fetchApi('/alerts/counts');
export const acknowledgeAlert = (id) => fetchApi(`/alerts/${id}/acknowledge`, { method: 'POST' });
export const acknowledgeAllAlerts = () => fetchApi('/alerts/acknowledge-all', { method: 'POST' });

// Costs
export const getCosts = (period = '30d') => fetchApi(`/costs?period=${period}`);
export const detectCostAnomalies = () => fetchApi('/costs/detect-anomalies', { method: 'POST' });
