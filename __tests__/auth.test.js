// Set JWT_SECRET before auth.js is imported (vi.hoisted runs before vi.mock hoisting)
vi.hoisted(() => {
    process.env.JWT_SECRET = 'test-secret';
});

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock @prisma/client before importing anything that uses db.js
vi.mock('@prisma/client', () => {
    const mockPrisma = {
        user: {
            findMany: vi.fn(() => Promise.resolve([])),
            findUnique: vi.fn(() => Promise.resolve(null)),
            create: vi.fn(() => Promise.resolve({})),
            update: vi.fn(() => Promise.resolve({})),
            delete: vi.fn(() => Promise.resolve({})),
        },
        setting: {
            findUnique: vi.fn(() => Promise.resolve(null)),
            upsert: vi.fn(() => Promise.resolve({})),
        },
    };
    function PrismaClient() {
        return mockPrisma;
    }
    return { PrismaClient };
});

// Mock fs.existsSync and fs.mkdirSync for the db.js DATA_DIR creation
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        default: {
            ...actual,
            existsSync: vi.fn(() => true),
            mkdirSync: vi.fn(),
            readFileSync: actual.readFileSync,
        },
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        readFileSync: actual.readFileSync,
    };
});

import { hashPassword, verifyPassword, signToken, verifyToken, checkAdminAuth } from '../server/auth.js';

// ---------------------------------------------------------------------------
// Security regression: no backdoor in db.js
// ---------------------------------------------------------------------------
describe('Security regression: no backdoor in db.js', () => {
    let dbSource;

    beforeAll(() => {
        const dbPath = path.join(__dirname, '..', 'server', 'db.js');
        dbSource = fs.readFileSync(dbPath, 'utf-8');
    });

    it('does NOT contain "DEVELOPMENTTESTING" backdoor string', () => {
        expect(dbSource).not.toContain('DEVELOPMENTTESTING');
    });

    it('does NOT contain any hardcoded backdoor codes', () => {
        // Check for common backdoor patterns
        expect(dbSource.toLowerCase()).not.toMatch(/backdoor/);
        expect(dbSource.toLowerCase()).not.toMatch(/master[_-]?key/);
        expect(dbSource.toLowerCase()).not.toMatch(/bypass[_-]?auth/);
    });

    it('isCodeValid function does not have hardcoded valid codes', () => {
        // Extract the isCodeValid function body
        const fnMatch = dbSource.match(
            /export\s+(?:async\s+)?function\s+isCodeValid\s*\([^)]*\)\s*\{[\s\S]*?\n\}/
        );
        expect(fnMatch).not.toBeNull();
        const fnBody = fnMatch[0];

        // Should not return { valid: true } without checking the database
        // The function should always call getUserByCode for validation
        expect(fnBody).toContain('getUserByCode');

        // Should not have hardcoded code comparisons like code === 'SOMETHING'
        expect(fnBody).not.toMatch(/===?\s*['"][A-Z0-9]{4,}['"]/);
    });

    it('code validation checks expiry dates', () => {
        const fnMatch = dbSource.match(
            /export\s+(?:async\s+)?function\s+isCodeValid\s*\([^)]*\)\s*\{[\s\S]*?\n\}/
        );
        expect(fnMatch).not.toBeNull();
        const fnBody = fnMatch[0];
        expect(fnBody).toContain('expiryDate');
        expect(fnBody).toContain('expired');
    });
});

// ---------------------------------------------------------------------------
// hashPassword & verifyPassword
// ---------------------------------------------------------------------------
describe('hashPassword', () => {
    it('produces a bcrypt hash string', async () => {
        const hash = await hashPassword('test-password');
        expect(typeof hash).toBe('string');
        // bcrypt hashes start with $2a$ or $2b$
        expect(hash).toMatch(/^\$2[ab]\$/);
    });

    it('produces different hashes for the same password (salted)', async () => {
        const hash1 = await hashPassword('same-password');
        const hash2 = await hashPassword('same-password');
        expect(hash1).not.toBe(hash2);
    });
});

describe('verifyPassword', () => {
    it('returns true for matching password', async () => {
        const hash = await hashPassword('correct-password');
        const result = await verifyPassword('correct-password', hash);
        expect(result).toBe(true);
    });

    it('returns false for wrong password', async () => {
        const hash = await hashPassword('correct-password');
        const result = await verifyPassword('wrong-password', hash);
        expect(result).toBe(false);
    });

    it('returns false for empty password against a real hash', async () => {
        const hash = await hashPassword('some-password');
        const result = await verifyPassword('', hash);
        expect(result).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// signToken & verifyToken
// ---------------------------------------------------------------------------
describe('signToken', () => {
    it('returns a JWT string', () => {
        const token = signToken({ role: 'admin' });
        expect(typeof token).toBe('string');
        // JWT has 3 dot-separated parts
        expect(token.split('.')).toHaveLength(3);
    });

    it('embeds the payload data', () => {
        const token = signToken({ role: 'admin', extra: 'data' });
        const decoded = verifyToken(token);
        expect(decoded.role).toBe('admin');
        expect(decoded.extra).toBe('data');
    });

    it('includes expiry claim', () => {
        const token = signToken({ role: 'admin' });
        const decoded = verifyToken(token);
        expect(decoded).toHaveProperty('exp');
        expect(decoded).toHaveProperty('iat');
        // exp should be in the future
        expect(decoded.exp).toBeGreaterThan(decoded.iat);
    });
});

describe('verifyToken', () => {
    it('returns decoded payload for a valid token', () => {
        const token = signToken({ role: 'admin' });
        const decoded = verifyToken(token);
        expect(decoded.role).toBe('admin');
    });

    it('throws for a tampered token', () => {
        const token = signToken({ role: 'admin' });
        // Tamper with the token payload
        const parts = token.split('.');
        parts[1] = parts[1] + 'tampered';
        const tampered = parts.join('.');

        expect(() => verifyToken(tampered)).toThrow();
    });

    it('throws for a completely invalid token', () => {
        expect(() => verifyToken('not.a.token')).toThrow();
        expect(() => verifyToken('')).toThrow();
        expect(() => verifyToken('random-string')).toThrow();
    });
});

// ---------------------------------------------------------------------------
// checkAdminAuth middleware
// ---------------------------------------------------------------------------
describe('checkAdminAuth', () => {
    function createMockReqRes(authHeader) {
        const req = {
            headers: authHeader !== undefined ? { authorization: authHeader } : {},
        };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        };
        const next = vi.fn();
        return { req, res, next };
    }

    it('calls next() for a valid Bearer token', () => {
        const token = signToken({ role: 'admin' });
        const { req, res, next } = createMockReqRes(`Bearer ${token}`);

        checkAdminAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.admin).toBeDefined();
        expect(req.admin.role).toBe('admin');
    });

    it('returns 401 when no authorization header is present', () => {
        const { req, res, next } = createMockReqRes(undefined);

        checkAdminAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ message: 'Unauthorized' });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when authorization header lacks Bearer prefix', () => {
        const token = signToken({ role: 'admin' });
        const { req, res, next } = createMockReqRes(`Token ${token}`);

        checkAdminAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for an invalid/tampered token', () => {
        const { req, res, next } = createMockReqRes('Bearer invalid.token.here');

        checkAdminAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ message: 'Invalid or expired token' });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for an empty Bearer value', () => {
        const { req, res, next } = createMockReqRes('Bearer ');

        checkAdminAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// JWT_SECRET required: getJwtSecret throws if JWT_SECRET is not set
// ---------------------------------------------------------------------------
describe('JWT_SECRET environment variable requirement', () => {
    it('throws an error when JWT_SECRET is not set', () => {
        const originalSecret = process.env.JWT_SECRET;
        delete process.env.JWT_SECRET;

        try {
            // signToken internally calls getJwtSecret which should throw
            expect(() => signToken({ role: 'admin' })).toThrow('JWT_SECRET environment variable is required');
        } finally {
            // Restore the secret so other tests continue to work
            process.env.JWT_SECRET = originalSecret;
        }
    });

    it('throws an error when JWT_SECRET is empty string', () => {
        const originalSecret = process.env.JWT_SECRET;
        process.env.JWT_SECRET = '';

        try {
            // Empty string is falsy, so getJwtSecret should throw
            expect(() => signToken({ role: 'admin' })).toThrow('JWT_SECRET environment variable is required');
        } finally {
            process.env.JWT_SECRET = originalSecret;
        }
    });

    it('verifyToken also throws when JWT_SECRET is not set', () => {
        const originalSecret = process.env.JWT_SECRET;
        // First sign a token with the secret present
        const token = signToken({ role: 'admin' });

        delete process.env.JWT_SECRET;
        try {
            expect(() => verifyToken(token)).toThrow('JWT_SECRET environment variable is required');
        } finally {
            process.env.JWT_SECRET = originalSecret;
        }
    });
});
