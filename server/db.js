import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const DATA_DIR = path.resolve(process.cwd(), '.data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'dnbcoaching.db'));

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    expiryDate TEXT,
    createdAt TEXT NOT NULL,
    data TEXT
  )
`);

// Migration: Add data column if missing (for existing dbs)
try {
    const columns = db.prepare('PRAGMA table_info(users)').all();
    const hasData = columns.some(c => c.name === 'data');
    if (!hasData) {
        db.exec('ALTER TABLE users ADD COLUMN data TEXT');
        console.log('Migrated DB: Added data column');
    }
} catch (e) {
    console.error('Migration error:', e);
}

export function getAllUsers() {
    return db.prepare('SELECT * FROM users').all();
}

export function getUserByCode(code) {
    return db.prepare('SELECT * FROM users WHERE code = ?').get(code);
}

export function addUser(user) {
    const stmt = db.prepare('INSERT INTO users (id, name, code, expiryDate, createdAt, data) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(user.id, user.name, user.code, user.expiryDate, user.createdAt, user.data || '{}');
}

export function updateUser(id, updates) {
    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
        fields.push('name = ?');
        values.push(updates.name);
    }

    if (updates.expiryDate !== undefined) {
        fields.push('expiryDate = ?');
        values.push(updates.expiryDate);
    }

    // Allow updating data directly via this method if needed, but updateUserData is preferred
    if (updates.data !== undefined) {
        fields.push('data = ?');
        values.push(typeof updates.data === 'string' ? updates.data : JSON.stringify(updates.data));
    }

    if (fields.length === 0) return true;

    values.push(id);
    const stmt = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`);
    const info = stmt.run(...values);
    return info.changes > 0;
}

export function deleteUser(id) {
    const stmt = db.prepare('DELETE FROM users WHERE id = ?');
    const info = stmt.run(id);
    return info.changes > 0;
}

export function getUserData(code) {
    const user = getUserByCode(code);
    if (!user || !user.data) return null;
    try {
        return JSON.parse(user.data);
    } catch {
        return {};
    }
}

export function updateUserData(code, data) {
    const user = getUserByCode(code);
    if (!user) return false;
    const str = JSON.stringify(data);
    const stmt = db.prepare('UPDATE users SET data = ? WHERE code = ?');
    const info = stmt.run(str, code);
    return info.changes > 0;
}

export function isCodeValid(code) {
    const clean = (code || '').trim().toUpperCase();
    if (!clean) return { valid: false, reason: 'Invalid code' };

    // Hardcoded dev code
    if (clean === 'DEVELOPMENTTESTING') {
        return {
            valid: true,
            user: {
                id: 'dev-user',
                name: 'Dev Tester',
                code: 'DEVELOPMENTTESTING',
                expiryDate: null
            }
        };
    }

    const user = getUserByCode(clean);
    if (!user) return { valid: false, reason: 'Invalid code' };

    if (user.expiryDate) {
        const expiry = new Date(user.expiryDate);
        const now = new Date();
        if (now > expiry) {
            return { valid: false, user, reason: 'Code expired' };
        }
    }

    return { valid: true, user };
}

export function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    // Check collision (simplified, just retry loop could be better but this is fine)
    for (let attempt = 0; attempt < 10; attempt++) {
        code = '';
        for (let i = 0; i < 8; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        const existing = getUserByCode(code);
        if (!existing) return code;
    }
    return code; // Fallback
}

// --- Settings for System-wide controls ---
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

export function getSetting(key, defaultValue = null) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : defaultValue;
}

export function updateSetting(key, value) {
    const str = JSON.stringify(value);
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    stmt.run(key, str);
    return true;
}
