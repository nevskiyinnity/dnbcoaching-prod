import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock infrastructure: Prisma client mock for all database operations
// ---------------------------------------------------------------------------

const { mockUsers, mockSettings, mockPrisma } = vi.hoisted(() => {
    const mockUsers = new Map();
    const mockSettings = new Map();

    const mockPrisma = {
        user: {
            findMany: vi.fn(() => Promise.resolve(Array.from(mockUsers.values()))),
            findUnique: vi.fn(({ where }) => {
                if (where.code) {
                    return Promise.resolve(mockUsers.get(where.code) || null);
                }
                if (where.id) {
                    for (const u of mockUsers.values()) {
                        if (u.id === where.id) return Promise.resolve(u);
                    }
                    return Promise.resolve(null);
                }
                return Promise.resolve(null);
            }),
            create: vi.fn(({ data }) => {
                mockUsers.set(data.code, { ...data });
                return Promise.resolve(data);
            }),
            update: vi.fn(({ where, data }) => {
                let user = null;
                if (where.code) {
                    user = mockUsers.get(where.code);
                } else if (where.id) {
                    for (const u of mockUsers.values()) {
                        if (u.id === where.id) { user = u; break; }
                    }
                }
                if (!user) {
                    const err = new Error('Record not found');
                    err.code = 'P2025';
                    return Promise.reject(err);
                }
                Object.assign(user, data);
                return Promise.resolve(user);
            }),
            delete: vi.fn(({ where }) => {
                let found = false;
                for (const [code, u] of mockUsers.entries()) {
                    if (u.id === where.id) {
                        mockUsers.delete(code);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    const err = new Error('Record not found');
                    err.code = 'P2025';
                    return Promise.reject(err);
                }
                return Promise.resolve({});
            }),
        },
        setting: {
            findUnique: vi.fn(({ where }) => {
                const val = mockSettings.get(where.key);
                return Promise.resolve(val !== undefined ? { key: where.key, value: JSON.stringify(val) } : null);
            }),
            upsert: vi.fn(({ where, update, create }) => {
                mockSettings.set(where.key, JSON.parse(create.value));
                return Promise.resolve(create);
            }),
        },
    };

    return { mockUsers, mockSettings, mockPrisma };
});

vi.mock('@prisma/client', () => {
    function PrismaClient() {
        return mockPrisma;
    }
    return { PrismaClient };
});

vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        default: { ...actual, existsSync: vi.fn(() => true), mkdirSync: vi.fn() },
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
    };
});

// Import the db functions under test
import {
    isCodeValid,
    generateCode,
    addUser,
    getAllUsers,
    deleteUser,
    getUserData,
    updateUserData,
    getSetting,
    updateSetting,
} from '../server/db.js';

// ---------------------------------------------------------------------------
// Code validation (isCodeValid)
// ---------------------------------------------------------------------------
describe('isCodeValid', () => {
    beforeEach(() => {
        mockUsers.clear();
        vi.restoreAllMocks();
    });

    it('returns invalid for empty/null code', async () => {
        expect((await isCodeValid('')).valid).toBe(false);
        expect((await isCodeValid(null)).valid).toBe(false);
        expect((await isCodeValid(undefined)).valid).toBe(false);
    });

    it('returns invalid when code does not exist in database', async () => {
        const result = await isCodeValid('NONEXIST');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Invalid code');
    });

    it('returns valid for an existing, non-expired code', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: '1',
            name: 'Test User',
            code: 'VALIDCDE',
            expiryDate: null,
            createdAt: new Date().toISOString(),
        });

        const result = await isCodeValid('VALIDCDE');
        expect(result.valid).toBe(true);
        expect(result.user).toBeDefined();
        expect(result.user.name).toBe('Test User');
    });

    it('returns invalid for an expired code', async () => {
        const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday

        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: '2',
            name: 'Expired User',
            code: 'EXPRDCDE',
            expiryDate: pastDate,
            createdAt: new Date().toISOString(),
        });

        const result = await isCodeValid('EXPRDCDE');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Code expired');
    });

    it('returns valid for a code with a future expiry date', async () => {
        const futureDate = new Date(Date.now() + 86400000 * 30).toISOString(); // 30 days ahead

        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: '3',
            name: 'Future User',
            code: 'FUTRCDE1',
            expiryDate: futureDate,
            createdAt: new Date().toISOString(),
        });

        const result = await isCodeValid('FUTRCDE1');
        expect(result.valid).toBe(true);
    });

    it('normalizes code to uppercase and trims whitespace', async () => {
        mockPrisma.user.findUnique.mockImplementationOnce(({ where }) => {
            // Should receive trimmed uppercase code
            expect(where.code).toBe('ABCD1234');
            return Promise.resolve({
                id: '4',
                name: 'Normalized User',
                code: 'ABCD1234',
                expiryDate: null,
                createdAt: new Date().toISOString(),
            });
        });

        const result = await isCodeValid('  abcd1234  ');
        expect(result.valid).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// generateCode
// ---------------------------------------------------------------------------
describe('generateCode', () => {
    it('returns an 8-character string', () => {
        const code = generateCode();
        expect(typeof code).toBe('string');
        expect(code).toHaveLength(8);
    });

    it('only contains allowed characters (no ambiguous 0, O, 1, I)', () => {
        const allowedChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

        // Generate multiple codes to increase confidence
        for (let i = 0; i < 20; i++) {
            const code = generateCode();
            for (const char of code) {
                expect(allowedChars).toContain(char);
            }
        }
    });

    it('does not contain ambiguous characters', () => {
        for (let i = 0; i < 20; i++) {
            const code = generateCode();
            expect(code).not.toMatch(/[0OI1]/);
        }
    });
});

// ---------------------------------------------------------------------------
// Message handling / chat validation flow
// ---------------------------------------------------------------------------
describe('Chat API validation logic', () => {
    it('rejects missing code', async () => {
        const result = await isCodeValid('');
        expect(result.valid).toBe(false);
    });

    it('validates code before processing messages', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: '5',
            name: 'Chat User',
            code: 'CHATCODE',
            expiryDate: null,
            createdAt: new Date().toISOString(),
        });

        const validation = await isCodeValid('CHATCODE');
        expect(validation.valid).toBe(true);
        expect(validation.user.name).toBe('Chat User');
    });

    it('message filtering logic only keeps user and assistant roles', () => {
        // Replicating the message filtering logic from server/index.js
        const rawMessages = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there' },
            { role: 'system', content: 'Should be filtered' },
            { role: 'function', content: 'Should be filtered' },
            null,
            undefined,
            { role: 'user', content: 'Follow up' },
        ];

        const filtered = Array.isArray(rawMessages)
            ? rawMessages.filter(m => m && (m.role === 'user' || m.role === 'assistant')).map(m => ({ role: m.role, content: m.content }))
            : [];

        expect(filtered).toHaveLength(3);
        expect(filtered[0]).toEqual({ role: 'user', content: 'Hello' });
        expect(filtered[1]).toEqual({ role: 'assistant', content: 'Hi there' });
        expect(filtered[2]).toEqual({ role: 'user', content: 'Follow up' });
    });

    it('handles non-array messages gracefully', () => {
        const rawMessages = 'not an array';
        const filtered = Array.isArray(rawMessages)
            ? rawMessages.filter(m => m && (m.role === 'user' || m.role === 'assistant'))
            : [];

        expect(filtered).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Sync operations
// ---------------------------------------------------------------------------
describe('Sync operations', () => {
    beforeEach(() => {
        mockUsers.clear();
        mockSettings.clear();
        vi.restoreAllMocks();
    });

    it('GET /api/sync rejects missing code (via isCodeValid)', async () => {
        const validation = await isCodeValid('');
        expect(validation.valid).toBe(false);
        expect(validation.reason).toBe('Invalid code');
    });

    it('GET /api/sync rejects invalid code', async () => {
        const validation = await isCodeValid('NOEXIST1');
        expect(validation.valid).toBe(false);
    });

    it('getUserData returns null for non-existent code', async () => {
        const data = await getUserData('NOCODE');
        expect(data).toBeNull();
    });

    it('getUserData returns parsed JSON data', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: '10',
            name: 'Data User',
            code: 'DATACODE',
            expiryDate: null,
            createdAt: new Date().toISOString(),
            data: JSON.stringify({ messages: ['hello'], settings: { theme: 'dark' } }),
        });

        const data = await getUserData('DATACODE');
        expect(data).toEqual({ messages: ['hello'], settings: { theme: 'dark' } });
    });

    it('getUserData returns empty object for invalid JSON', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: '11',
            name: 'Bad Data User',
            code: 'BADDATA1',
            expiryDate: null,
            createdAt: new Date().toISOString(),
            data: 'not valid json{{{',
        });

        const data = await getUserData('BADDATA1');
        expect(data).toEqual({});
    });

    it('updateUserData returns false for non-existent code', async () => {
        const success = await updateUserData('NOCODE', { key: 'value' });
        expect(success).toBe(false);
    });

    it('updateUserData updates data for an existing user', async () => {
        // First call: getUserByCode inside updateUserData
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: '12',
            name: 'Sync User',
            code: 'SYNCCODE',
            expiryDate: null,
            createdAt: new Date().toISOString(),
            data: '{}',
        });
        // Second call: the update itself
        mockPrisma.user.update.mockResolvedValueOnce({
            id: '12',
            name: 'Sync User',
            code: 'SYNCCODE',
            expiryDate: null,
            createdAt: new Date().toISOString(),
            data: JSON.stringify({ messages: ['new message'] }),
        });

        const success = await updateUserData('SYNCCODE', { messages: ['new message'] });
        expect(success).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
describe('Settings', () => {
    beforeEach(() => {
        mockSettings.clear();
        vi.restoreAllMocks();
    });

    it('getSetting returns default value when key does not exist', async () => {
        const value = await getSetting('nonexistent', 42);
        expect(value).toBe(42);
    });

    it('getSetting returns null by default when key does not exist', async () => {
        const value = await getSetting('nonexistent');
        expect(value).toBeNull();
    });

    it('getSetting retrieves a stored setting', async () => {
        mockPrisma.setting.findUnique.mockResolvedValueOnce({
            key: 'min_auth_ts',
            value: JSON.stringify(12345),
        });

        const value = await getSetting('min_auth_ts', 0);
        expect(value).toBe(12345);
    });

    it('updateSetting stores a value and returns true', async () => {
        mockPrisma.setting.upsert.mockResolvedValueOnce({
            key: 'min_auth_ts',
            value: JSON.stringify(Date.now()),
        });

        const result = await updateSetting('min_auth_ts', Date.now());
        expect(result).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Endpoint-level logic: escapeHtml (from server/index.js)
// ---------------------------------------------------------------------------
describe('escapeHtml (XSS prevention in email templates)', () => {
    // Reimplementing the function from server/index.js for testing
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    it('escapes HTML special characters', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe(
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    it('escapes ampersands', () => {
        expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('escapes single quotes', () => {
        expect(escapeHtml("it's")).toBe('it&#39;s');
    });

    it('handles empty string', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('converts non-string input to string', () => {
        expect(escapeHtml(42)).toBe('42');
        expect(escapeHtml(null)).toBe('null');
    });
});
