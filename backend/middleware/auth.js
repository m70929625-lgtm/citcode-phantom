const rateLimit = require('express-rate-limit');
const { queryOne } = require('../config/database');

// Rate limiter for auth endpoints (login/register)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per window
    message: { error: 'Too many attempts. Please try again later.' }
});

// Middleware to check if user is authenticated
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    return res.status(401).json({ error: 'Authentication required' });
}

// Middleware to attach user to request if authenticated
function attachUser(req, res, next) {
    if (req.session && req.session.userId) {
        const user = queryOne('SELECT id, email, first_name, last_name FROM users WHERE id = ?', [req.session.userId]);
        if (user) {
            req.user = user;
        }
    }
    next();
}

module.exports = { authLimiter, requireAuth, attachUser };
