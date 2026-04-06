const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { queryAll, queryOne, runSql } = require('../config/database');

const router = express.Router();

function normalizeQueryParams(params) {
    if (!params || typeof params !== 'object') return {};

    const normalized = {};
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '' || value === 'all') {
            continue;
        }
        normalized[key] = String(value);
    }
    return normalized;
}

router.get('/', (req, res) => {
    const userId = req.session.userId;
    const rows = queryAll(`
        SELECT * FROM saved_views
        WHERE user_id = ?
        ORDER BY is_default DESC, updated_at DESC
    `, [userId]);

    res.json({
        data: rows.map((row) => ({
            id: row.id,
            name: row.name,
            queryParams: row.query_params ? JSON.parse(row.query_params) : {},
            isDefault: Boolean(row.is_default),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }))
    });
});

router.post('/', (req, res) => {
    const userId = req.session.userId;
    const { name, queryParams = {}, isDefault = false } = req.body;

    if (!name || String(name).trim().length < 2) {
        return res.status(400).json({ error: 'View name must be at least 2 characters' });
    }

    if (isDefault) {
        runSql('UPDATE saved_views SET is_default = 0 WHERE user_id = ?', [userId]);
    }

    const id = `view_${uuidv4().slice(0, 8)}`;
    runSql(`
        INSERT INTO saved_views (id, user_id, name, query_params, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
        id,
        userId,
        String(name).trim(),
        JSON.stringify(normalizeQueryParams(queryParams)),
        isDefault ? 1 : 0,
        new Date().toISOString(),
        new Date().toISOString()
    ]);

    const row = queryOne('SELECT * FROM saved_views WHERE id = ? AND user_id = ?', [id, userId]);
    res.status(201).json({
        success: true,
        view: {
            id: row.id,
            name: row.name,
            queryParams: row.query_params ? JSON.parse(row.query_params) : {},
            isDefault: Boolean(row.is_default),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }
    });
});

router.put('/:id', (req, res) => {
    const userId = req.session.userId;
    const { name, queryParams, isDefault } = req.body;
    const id = req.params.id;

    const existing = queryOne('SELECT * FROM saved_views WHERE id = ? AND user_id = ?', [id, userId]);
    if (!existing) {
        return res.status(404).json({ error: 'Saved view not found' });
    }

    if (isDefault === true) {
        runSql('UPDATE saved_views SET is_default = 0 WHERE user_id = ?', [userId]);
    }

    const nextName = name ? String(name).trim() : existing.name;
    const nextParams = queryParams ? JSON.stringify(normalizeQueryParams(queryParams)) : existing.query_params;
    const nextDefault = typeof isDefault === 'boolean' ? (isDefault ? 1 : 0) : existing.is_default;

    runSql(`
        UPDATE saved_views
        SET name = ?, query_params = ?, is_default = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
    `, [nextName, nextParams, nextDefault, new Date().toISOString(), id, userId]);

    const row = queryOne('SELECT * FROM saved_views WHERE id = ? AND user_id = ?', [id, userId]);
    res.json({
        success: true,
        view: {
            id: row.id,
            name: row.name,
            queryParams: row.query_params ? JSON.parse(row.query_params) : {},
            isDefault: Boolean(row.is_default),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }
    });
});

router.delete('/:id', (req, res) => {
    const userId = req.session.userId;
    const id = req.params.id;
    const existing = queryOne('SELECT id FROM saved_views WHERE id = ? AND user_id = ?', [id, userId]);
    if (!existing) {
        return res.status(404).json({ error: 'Saved view not found' });
    }

    runSql('DELETE FROM saved_views WHERE id = ? AND user_id = ?', [id, userId]);
    res.json({ success: true });
});

module.exports = router;
