const USD_TO_INR_RATE = 83;

export function formatNumber(num, decimals = 0) {
  if (num === null || num === undefined) return '-';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function formatCurrency(amount, currency = 'INR', decimals = 2, options = {}) {
  if (amount === null || amount === undefined) return '-';
  const { convertFromUsd = currency === 'INR' } = options;

  const convertedAmount = convertFromUsd && currency === 'INR'
    ? amount * USD_TO_INR_RATE
    : amount;

  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(convertedAmount);
}

export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(decimals)}%`;
}

export function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDateShort(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatRelativeTime(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDateShort(dateString);
}

export function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function getScoreColor(score) {
  if (score >= 0.8) return 'text-apple-red';
  if (score >= 0.6) return 'text-apple-orange';
  if (score >= 0.4) return 'text-yellow-600';
  return 'text-apple-green';
}

export function getScoreBgColor(score) {
  if (score >= 0.8) return 'bg-apple-red/10 border-apple-red/30';
  if (score >= 0.6) return 'bg-apple-orange/10 border-apple-orange/30';
  if (score >= 0.4) return 'bg-yellow-50 border-yellow-200';
  return 'bg-apple-green/10 border-apple-green/30';
}

export function getAnomalyTypeLabel(type) {
  const labels = {
    IDLE_INSTANCE: 'Idle Instance',
    ZOMBIE_INSTANCE: 'Zombie Instance',
    COST_SPIKE: 'Cost Spike',
    RESOURCE_BURN: 'Resource Burn',
    SCHEDULED_WASTE: 'Scheduled Waste',
    ANOMALY: 'Anomaly',
  };
  return labels[type] || type;
}

export function getAnomalyTypeColor(type) {
  const colors = {
    IDLE_INSTANCE: 'bg-blue-100 text-blue-700 border-blue-200',
    ZOMBIE_INSTANCE: 'bg-purple-100 text-purple-700 border-purple-200',
    COST_SPIKE: 'bg-red-100 text-red-700 border-red-200',
    RESOURCE_BURN: 'bg-orange-100 text-orange-700 border-orange-200',
    SCHEDULED_WASTE: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    ANOMALY: 'bg-gray-100 text-gray-700 border-gray-200',
  };
  return colors[type] || colors.ANOMALY;
}
