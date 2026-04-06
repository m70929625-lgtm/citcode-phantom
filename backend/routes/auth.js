const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { queryOne, runSql } = require('../config/database');
const { authLimiter, requireAuth } = require('../middleware/auth');
const loggerService = require('../services/loggerService');
const userSettingsService = require('../services/userSettingsService');

const RESET_TOKEN_EXPIRY_MINUTES = 15;

function hashResetToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function getResetTokenExpiry() {
    return new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString();
}

function getForgotPasswordResponse(resetToken = null) {
    const response = {
        message: 'If an account exists for this email, password reset instructions have been generated.'
    };

    if (resetToken && process.env.NODE_ENV !== 'production') {
        response.resetToken = resetToken;
        response.expiresInMinutes = RESET_TOKEN_EXPIRY_MINUTES;
    }

    return response;
}

// ============================================
// ROUTE: Register new account
// ============================================
router.post('/register', authLimiter, async (req, res) => {
    try {
        const { email, password, confirmPassword } = req.body;

        // Validation
        if (!email || !password || !confirmPassword) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        if (!email.includes('@')) {
            return res.status(400).json({ error: 'Invalid email address' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Passwords do not match' });
        }

        // Check if user already exists
        const existing = queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create user
        const userId = uuidv4();
        runSql(
            'INSERT INTO users (id, email, password_hash, auth_provider) VALUES (?, ?, ?, ?)',
            [userId, email.toLowerCase(), passwordHash, 'email']
        );

        Object.entries(userSettingsService.DEFAULT_SETTINGS).forEach(([key, value]) => {
            userSettingsService.setUserSetting(userId, key, value);
        });

        // Create session
        req.session.userId = userId;

        loggerService.info('auth', 'New account registered', { email });

        res.status(201).json({
            message: 'Account created successfully',
            user: { id: userId, email: email.toLowerCase() }
        });
    } catch (error) {
        loggerService.error('auth', 'Registration failed', { error: error.message });
        res.status(500).json({ error: 'Registration failed' });
    }
});

// ============================================
// ROUTE: Login
// ============================================
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = queryOne('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (!user.password_hash) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Create session
        req.session.userId = user.id;

        loggerService.info('auth', 'User logged in', { email });

        res.json({
            message: 'Login successful',
            user: { id: user.id, email: user.email, first_name: user.first_name }
        });
    } catch (error) {
        loggerService.error('auth', 'Login failed', { error: error.message });
        res.status(500).json({ error: 'Login failed' });
    }
});

// ============================================
// ROUTE: Request password reset
// ============================================
router.post('/forgot-password', authLimiter, async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Valid email is required' });
        }

        const normalizedEmail = email.toLowerCase();
        const user = queryOne('SELECT id, email FROM users WHERE email = ?', [normalizedEmail]);

        if (!user) {
            loggerService.info('auth', 'Password reset requested for unknown email', { email: normalizedEmail });
            return res.json(getForgotPasswordResponse());
        }

        const now = new Date().toISOString();
        runSql('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [now, user.id]);

        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashResetToken(resetToken);

        runSql(
            'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
            [uuidv4(), user.id, tokenHash, getResetTokenExpiry()]
        );

        loggerService.info('auth', 'Password reset token generated', { email: normalizedEmail });

        res.json(getForgotPasswordResponse(resetToken));
    } catch (error) {
        loggerService.error('auth', 'Forgot password request failed', { error: error.message });
        res.status(500).json({ error: 'Failed to start password reset' });
    }
});

// ============================================
// ROUTE: Reset password using token
// ============================================
router.post('/reset-password', authLimiter, async (req, res) => {
    try {
        const { token, password, confirmPassword } = req.body;

        if (!token || !password || !confirmPassword) {
            return res.status(400).json({ error: 'Token, password and confirmation are required' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Passwords do not match' });
        }

        const tokenHash = hashResetToken(token);
        const tokenRecord = queryOne(
            'SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL',
            [tokenHash]
        );

        if (!tokenRecord) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const expiresAt = new Date(tokenRecord.expires_at);
        if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
            runSql('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?', [new Date().toISOString(), tokenRecord.id]);
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const user = queryOne('SELECT id, email FROM users WHERE id = ?', [tokenRecord.user_id]);
        if (!user) {
            return res.status(400).json({ error: 'Invalid reset token' });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const now = new Date().toISOString();

        runSql('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, now, user.id]);
        runSql('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [now, user.id]);

        loggerService.info('auth', 'Password reset successful', { email: user.email });

        res.json({ message: 'Password reset successful. Please sign in with your new password.' });
    } catch (error) {
        loggerService.error('auth', 'Password reset failed', { error: error.message });
        res.status(500).json({ error: 'Password reset failed' });
    }
});

// ============================================
// ROUTE: Logout
// ============================================
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ message: 'Logged out successfully' });
    });
});

// ============================================
// ROUTE: Get current user
// ============================================
router.get('/me', requireAuth, (req, res) => {
    const user = queryOne('SELECT id, email, first_name, last_name FROM users WHERE id = ?', [req.session.userId]);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
});

module.exports = router;
