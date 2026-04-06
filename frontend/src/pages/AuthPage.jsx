import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Shield, Mail, Lock, ArrowRight, CheckCircle, KeyRound } from 'lucide-react';

export default function AuthPage() {
    const { login, register, forgotPassword, resetPassword } = useAuth();
    const navigate = useNavigate();

    const [mode, setMode] = useState('signin'); // signin | signup | forgot | reset
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [resetToken, setResetToken] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState('');

    const clearMessages = () => {
        setError('');
        setSuccess('');
    };

    const switchMode = (nextMode) => {
        setMode(nextMode);
        clearMessages();
    };

    const handleSignIn = async (e) => {
        e.preventDefault();
        clearMessages();
        setLoading(true);
        try {
            await login(email, password);
            navigate('/');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSignUp = async (e) => {
        e.preventDefault();
        clearMessages();

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setLoading(true);
        try {
            await register(email, password, confirmPassword);
            navigate('/');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleForgotPassword = async (e) => {
        e.preventDefault();
        clearMessages();

        setLoading(true);
        try {
            const data = await forgotPassword(email);
            if (data.resetToken) {
                setResetToken(data.resetToken);
                setMode('reset');
                setSuccess(`Reset token generated. It expires in ${data.expiresInMinutes || 15} minutes.`);
            } else {
                setSuccess(data.message || 'If your account exists, reset instructions were generated.');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async (e) => {
        e.preventDefault();
        clearMessages();

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setLoading(true);
        try {
            const data = await resetPassword(resetToken, password, confirmPassword);
            setPassword('');
            setConfirmPassword('');
            setResetToken('');
            setMode('signin');
            setSuccess(data.message || 'Password reset successful. You can now sign in.');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const submitHandler = {
        signin: handleSignIn,
        signup: handleSignUp,
        forgot: handleForgotPassword,
        reset: handleResetPassword
    }[mode];

    const authTitle = {
        signin: 'Sign in to your account',
        signup: 'Create a new account',
        forgot: 'Forgot your password?',
        reset: 'Set a new password'
    }[mode];

    const submitText = {
        signin: 'Sign In',
        signup: 'Create Account',
        forgot: 'Generate Reset Token',
        reset: 'Reset Password'
    }[mode];

    const loadingText = {
        signin: 'Signing in...',
        signup: 'Creating account...',
        forgot: 'Generating token...',
        reset: 'Resetting password...'
    }[mode];

    const showEmail = mode === 'signin' || mode === 'signup' || mode === 'forgot';
    const showPassword = mode === 'signin' || mode === 'signup' || mode === 'reset';
    const showConfirmPassword = mode === 'signup' || mode === 'reset';
    const showResetToken = mode === 'reset';
    const inputClass = 'w-full rounded-2xl border border-white/85 bg-white/70 px-4 py-3 text-apple-gray-800 placeholder:text-apple-gray-400 shadow-[0_12px_26px_rgba(15,23,42,0.06)] transition focus:border-apple-blue/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-apple-blue/20';
    const iconInputClass = `${inputClass} pl-12`;

    return (
        <div className="min-h-screen px-4 py-10 sm:px-6">
            <div className="mx-auto w-full max-w-md">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[linear-gradient(135deg,#e9eef9_0%,#a8bff5_42%,#ffb26f_100%)] shadow-[0_18px_35px_rgba(15,23,42,0.16)]">
                        <Shield className="h-7 w-7 text-[#111318]" />
                    </div>
                    <p className="section-kicker">AWS monitoring</p>
                    <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-apple-gray-800">CloudCostGuard</h1>
                    <p className="mt-2 text-sm text-apple-gray-500">{authTitle}</p>
                </div>

                <div className="premium-panel rounded-[34px] p-6 sm:p-8">
                    <div className="relative z-[1]">
                    {(mode === 'signin' || mode === 'signup') && (
                        <div className="segment-shell mb-6 w-full">
                            <button
                                onClick={() => switchMode('signin')}
                                className={`segment-tab flex-1 justify-center ${
                                    mode === 'signin' ? 'segment-tab-active' : ''
                                }`}
                            >
                                Sign In
                            </button>
                            <button
                                onClick={() => switchMode('signup')}
                                className={`segment-tab flex-1 justify-center ${
                                    mode === 'signup' ? 'segment-tab-active' : ''
                                }`}
                            >
                                Sign Up
                            </button>
                        </div>
                    )}

                    {(mode === 'forgot' || mode === 'reset') && (
                        <button
                            onClick={() => switchMode('signin')}
                            className="mb-6 text-sm text-apple-gray-500 transition hover:text-apple-gray-700"
                        >
                            Back to Sign In
                        </button>
                    )}

                    <form onSubmit={submitHandler} className="space-y-5">
                        {showEmail && (
                            <div>
                                <label className="mb-2 block text-sm font-medium text-apple-gray-600">Email Address</label>
                                <div className="relative">
                                    <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-apple-gray-400" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className={iconInputClass}
                                        placeholder="you@example.com"
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        {showResetToken && (
                            <div>
                                <label className="mb-2 block text-sm font-medium text-apple-gray-600">Reset Token</label>
                                <div className="relative">
                                    <KeyRound className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-apple-gray-400" />
                                    <input
                                        type="text"
                                        value={resetToken}
                                        onChange={(e) => setResetToken(e.target.value)}
                                        className={`${iconInputClass} font-mono text-sm`}
                                        placeholder="Paste your reset token"
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        {showPassword && (
                            <div>
                                <label className="mb-2 block text-sm font-medium text-apple-gray-600">
                                    {mode === 'reset' ? 'New Password' : 'Password'}
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-apple-gray-400" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className={iconInputClass}
                                        placeholder="••••••••"
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        {showConfirmPassword && (
                            <div>
                                <label className="mb-2 block text-sm font-medium text-apple-gray-600">Confirm Password</label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-apple-gray-400" />
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className={iconInputClass}
                                        placeholder="••••••••"
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        {mode === 'signin' && (
                            <div className="text-right -mt-2">
                                <button
                                    type="button"
                                    onClick={() => switchMode('forgot')}
                                    className="text-sm text-apple-gray-500 transition hover:text-apple-gray-700"
                                >
                                    Forgot password?
                                </button>
                            </div>
                        )}

                        {error && (
                            <div className="rounded-2xl border border-apple-red/25 bg-apple-red/10 p-3">
                                <p className="text-sm text-apple-red">{error}</p>
                            </div>
                        )}

                        {success && (
                            <div className="flex items-start gap-2 rounded-2xl border border-apple-green/30 bg-apple-green/10 p-3">
                                <CheckCircle className="mt-0.5 h-4 w-4 text-apple-green" />
                                <p className="text-sm text-apple-green">{success}</p>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="primary-button w-full disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loading ? (
                                <>
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0f172a]/25 border-t-[#0f172a]" />
                                    {loadingText}
                                </>
                            ) : (
                                <>
                                    {submitText}
                                    <ArrowRight className="h-4 w-4" />
                                </>
                            )}
                        </button>
                    </form>

                    {(mode === 'signin' || mode === 'signup') && (
                        <div className="mt-6 text-center">
                            <button
                                onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                                className="text-sm text-apple-gray-500 transition hover:text-apple-gray-700"
                            >
                                {mode === 'signin'
                                    ? "Don't have an account? Sign Up"
                                    : 'Already have an account? Sign In'}
                            </button>
                        </div>
                    )}
                    </div>
                </div>
            </div>
        </div>
    );
}
