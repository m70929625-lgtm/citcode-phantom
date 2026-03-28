const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { queryOne, runSql } = require('../config/database');
const { authLimiter, requireAuth } = require('../middleware/auth');
const loggerService = require('../services/loggerService');

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
