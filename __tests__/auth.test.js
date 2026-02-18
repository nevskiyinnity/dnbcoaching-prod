import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock @clerk/express before importing auth module
vi.mock('@clerk/express', () => ({
    clerkMiddleware: vi.fn(() => (req, res, next) => next()),
    getAuth: vi.fn(() => ({ userId: null, sessionClaims: null })),
}));

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

import { getAuth } from '@clerk/express';
import { clerkAuth, checkAdminAuth, getClerkUserId } from '../server/auth.js';

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
        expect(dbSource.toLowerCase()).not.toMatch(/backdoor/);
        expect(dbSource.toLowerCase()).not.toMatch(/master[_-]?key/);
        expect(dbSource.toLowerCase()).not.toMatch(/bypass[_-]?auth/);
    });

    it('does not contain hardcoded authentication shortcuts', () => {
        // The new auth uses Clerk, so db.js should not have any auth bypass logic
        expect(dbSource.toLowerCase()).not.toMatch(/hardcoded/);
        // Exclude known Prisma error codes (P2025 etc.) from the check
        const stripped = dbSource.replace(/e\.code\s*===?\s*'P\d{4}'/g, '');
        expect(stripped).not.toMatch(/===?\s*['"][A-Z0-9]{4,}['"]/);
    });
});

// ---------------------------------------------------------------------------
// clerkAuth middleware
// ---------------------------------------------------------------------------
describe('clerkAuth middleware', () => {
    it('is a function (Express middleware)', () => {
        expect(typeof clerkAuth).toBe('function');
    });
});

// ---------------------------------------------------------------------------
// checkAdminAuth middleware
// ---------------------------------------------------------------------------
describe('checkAdminAuth', () => {
    function createMockReqRes() {
        const req = { headers: {} };
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
        };
        const next = vi.fn();
        return { req, res, next };
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns 401 when no userId is present (not signed in)', () => {
        getAuth.mockReturnValue({ userId: null, sessionClaims: null });
        const { req, res, next } = createMockReqRes();

        checkAdminAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('not signed in') }));
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when user is signed in but not admin', () => {
        getAuth.mockReturnValue({
            userId: 'user_123',
            sessionClaims: { metadata: { role: 'user' } },
        });
        const { req, res, next } = createMockReqRes();

        checkAdminAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('admin') }));
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 when sessionClaims has no role', () => {
        getAuth.mockReturnValue({
            userId: 'user_123',
            sessionClaims: { metadata: {} },
        });
        const { req, res, next } = createMockReqRes();

        checkAdminAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when user has admin role via metadata', () => {
        getAuth.mockReturnValue({
            userId: 'user_admin_123',
            sessionClaims: { metadata: { role: 'admin' } },
        });
        const { req, res, next } = createMockReqRes();

        checkAdminAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.admin).toBeDefined();
        expect(req.admin.userId).toBe('user_admin_123');
        expect(req.admin.role).toBe('admin');
    });

    it('calls next() when user has admin role via publicMetadata', () => {
        getAuth.mockReturnValue({
            userId: 'user_admin_456',
            sessionClaims: { publicMetadata: { role: 'admin' } },
        });
        const { req, res, next } = createMockReqRes();

        checkAdminAuth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.admin).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// getClerkUserId helper
// ---------------------------------------------------------------------------
describe('getClerkUserId', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns userId when authenticated', () => {
        getAuth.mockReturnValue({ userId: 'user_test_789' });
        const req = {};
        expect(getClerkUserId(req)).toBe('user_test_789');
    });

    it('returns null when not authenticated', () => {
        getAuth.mockReturnValue({ userId: null });
        const req = {};
        expect(getClerkUserId(req)).toBeNull();
    });

    it('returns null when getAuth returns null', () => {
        getAuth.mockReturnValue(null);
        const req = {};
        expect(getClerkUserId(req)).toBeNull();
    });
});
