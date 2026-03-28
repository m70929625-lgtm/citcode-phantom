import { useState, useEffect } from 'react';
import { X, Save, Key, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import GlassCard from './GlassCard';
import { getSettings, updateSettings, updateAwsCredentials } from '../hooks/useApi';

export default function SettingsPanel({ onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const [awsAccessKey, setAwsAccessKey] = useState('');
  const [awsSecretKey, setAwsSecretKey] = useState('');
  const [awsRegion, setAwsRegion] = useState('us-east-1');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await getSettings();
      setAwsRegion(data.awsRegion || 'us-east-1');
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      if ((awsAccessKey && !awsSecretKey) || (!awsAccessKey && awsSecretKey)) {
        throw new Error('Enter both AWS access key and secret key');
      }

      await updateSettings({
        aws_region: awsRegion
      });

      let successMessage = 'AWS region saved successfully.';

      if (awsAccessKey && awsSecretKey) {
        const awsResponse = await updateAwsCredentials({
          accessKeyId: awsAccessKey,
          secretAccessKey: awsSecretKey,
          region: awsRegion
        });

        successMessage = awsResponse.awsConnected
          ? 'Settings saved and AWS connection verified.'
          : 'Settings saved, but AWS connection could not be verified.';
      }

      setAwsAccessKey('');
      setAwsSecretKey('');
      await onSaved?.();
      setMessage({ type: 'success', text: successMessage });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative flex w-full max-w-xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 p-6">
          <h2 className="text-xl font-semibold text-apple-gray-800">AWS settings</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
          >
            <X className="w-4 h-4 text-apple-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 text-apple-blue animate-spin" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* AWS Credentials */}
              <GlassCard className="p-5 border-apple-blue/20">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-apple-orange/10 flex items-center justify-center">
                    <Key className="w-5 h-5 text-apple-orange" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-apple-gray-800">AWS credentials and region</h3>
                    <p className="text-xs text-apple-gray-500">Add the account details used for monitoring and cost checks.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-apple-gray-700 mb-1.5">
                      AWS Access Key ID
                    </label>
                    <input
                      type="text"
                      value={awsAccessKey}
                      onChange={(e) => setAwsAccessKey(e.target.value)}
                      placeholder="AKIA..."
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-apple-blue focus:ring-2 focus:ring-apple-blue/20 outline-none transition-all text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-apple-gray-700 mb-1.5">
                      AWS Secret Access Key
                    </label>
                    <input
                      type="password"
                      value={awsSecretKey}
                      onChange={(e) => setAwsSecretKey(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-apple-blue focus:ring-2 focus:ring-apple-blue/20 outline-none transition-all text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-apple-gray-700 mb-1.5">
                      Region
                    </label>
                    <select
                      value={awsRegion}
                      onChange={(e) => setAwsRegion(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:border-apple-blue focus:ring-2 focus:ring-apple-blue/20 outline-none transition-all text-sm bg-white"
                    >
                      <option value="us-east-1">US East (N. Virginia)</option>
                      <option value="us-east-2">US East (Ohio)</option>
                      <option value="us-west-1">US West (N. California)</option>
                      <option value="us-west-2">US West (Oregon)</option>
                      <option value="eu-west-1">EU (Ireland)</option>
                      <option value="eu-central-1">EU (Frankfurt)</option>
                      <option value="ap-south-1">Asia Pacific (Mumbai)</option>
                      <option value="ap-south-2">Asia Pacific (Hyderabad)</option>
                      <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
                      <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
                    </select>
                  </div>
                  <div className="rounded-xl bg-apple-blue/5 p-4 text-sm text-apple-gray-700">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-apple-blue flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium mb-1">Local setup note</p>
                        <p className="text-apple-gray-600">
                          Credentials are stored by the backend for this local app and the secret key is not returned to the browser. For production, use IAM roles or environment-based secrets.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </GlassCard>

              {/* Message */}
              {message && (
                <div className={`flex items-center gap-2 p-4 rounded-xl ${
                  message.type === 'success' ? 'bg-apple-green/10 text-apple-green' : 'bg-apple-red/10 text-apple-red'
                }`}>
                  {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                  <span className="text-sm font-medium">{message.text}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 bg-white/95 p-6 backdrop-blur">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-apple-gray-600 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-apple-blue text-white hover:bg-apple-blueHover transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save AWS settings
          </button>
        </div>
      </div>
    </div>
  );
}
