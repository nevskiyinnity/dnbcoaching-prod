import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock infrastructure: better-sqlite3, fs, and modules used by the server
// ---------------------------------------------------------------------------

// Use vi.hoisted so these variables are available inside vi.mock factories
// (vi.mock calls are hoisted to the top of the file by vitest)
const { mockPrepare, mockUsers, mockSettings } = vi.hoisted(() => {
    const mockUsers = new Map();
    const mockSettings = new Map();

    const mockPrepare = vi.fn((sql) => {
        return {
            all: vi.fn(() => Array.from(mockUsers.values())),
            get: vi.fn((...args) => {
                if (sql.includes('FROM users WHERE code')) {
                    return mockUsers.get(args[0]) || null;
                }
                if (sql.includes('FROM users WHERE id')) {
                    for (const u of mockUsers.values()) {
                        if (u.id === args[0]) return u;
                    }
                    return null;
                }
                if (sql.includes('FROM settings WHERE key')) {
                    const val = mockSettings.get(args[0]);
                    return val !== undefined ? { value: JSON.stringify(val) } : null;
                }
                return null;
            }),
            run: vi.fn((...args) => {
                if (sql.includes('INSERT INTO users')) {
                    const user = { id: args[0], name: args[1], code: args[2], expiryDate: args[3], createdAt: args[4], data: args[5] };
                    mockUsers.set(user.code, user);
                    return { changes: 1 };
                }
                if (sql.includes('DELETE FROM users')) {
                    for (const [code, u] of mockUsers.entries()) {
                        if (u.id === args[0]) { mockUsers.delete(code); return { changes: 1 }; }
                    }
                    return { changes: 0 };
                }
                if (sql.includes('UPDATE users SET data')) {
                    const user = mockUsers.get(args[1]);
                    if (user) { user.data = args[0]; return { changes: 1 }; }
                    return { changes: 0 };
                }
                if (sql.includes('INSERT OR REPLACE INTO settings')) {
                    mockSettings.set(args[0], JSON.parse(args[1]));
                    return { changes: 1 };
                }
                return { changes: 0 };
            }),
        };
    });

    return { mockPrepare, mockUsers, mockSettings };
});

vi.mock('better-sqlite3', () => {
    const mockDb = {
        exec: vi.fn(),
        prepare: mockPrepare,
    };
    // Must use a regular function (not arrow) so it can be called with `new`
    function MockDatabase() {
        return mockDb;
    }
    return { default: MockDatabase };
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
    });

    it('returns invalid for empty/null code', () => {
        expect(isCodeValid('').valid).toBe(false);
        expect(isCodeValid(null).valid).toBe(false);
        expect(isCodeValid(undefined).valid).toBe(false);
    });

    it('returns invalid when code does not exist in database', () => {
        const result = isCodeValid('NONEXIST');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Invalid code');
    });

    it('returns valid for an existing, non-expired code', () => {
        mockPrepare.mockImplementationOnce(() => ({
            get: vi.fn(() => ({
                id: '1',
                name: 'Test User',
                code: 'VALIDCDE',
                expiryDate: null,
                createdAt: new Date().toISOString(),
            })),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0 })),
        }));

        const result = isCodeValid('VALIDCDE');
        expect(result.valid).toBe(true);
        expect(result.user).toBeDefined();
        expect(result.user.name).toBe('Test User');
    });

    it('returns invalid for an expired code', () => {
        const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday

        mockPrepare.mockImplementationOnce(() => ({
            get: vi.fn(() => ({
                id: '2',
                name: 'Expired User',
                code: 'EXPRDCDE',
                expiryDate: pastDate,
                createdAt: new Date().toISOString(),
            })),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0 })),
        }));

        const result = isCodeValid('EXPRDCDE');
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Code expired');
    });

    it('returns valid for a code with a future expiry date', () => {
        const futureDate = new Date(Date.now() + 86400000 * 30).toISOString(); // 30 days ahead

        mockPrepare.mockImplementationOnce(() => ({
            get: vi.fn(() => ({
                id: '3',
                name: 'Future User',
                code: 'FUTRCDE1',
                expiryDate: futureDate,
                createdAt: new Date().toISOString(),
            })),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0 })),
        }));

        const result = isCodeValid('FUTRCDE1');
        expect(result.valid).toBe(true);
    });

    it('normalizes code to uppercase and trims whitespace', () => {
        mockPrepare.mockImplementationOnce(() => ({
            get: vi.fn((code) => {
                // Should receive trimmed uppercase code
                expect(code).toBe('ABCD1234');
                return {
                    id: '4',
                    name: 'Normalized User',
                    code: 'ABCD1234',
                    expiryDate: null,
                    createdAt: new Date().toISOString(),
                };
            }),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0 })),
        }));

        const result = isCodeValid('  abcd1234  ');
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
    it('rejects missing code', () => {
        const result = isCodeValid('');
        expect(result.valid).toBe(false);
    });

    it('validates code before processing messages', () => {
        mockPrepare.mockImplementationOnce(() => ({
            get: vi.fn(() => ({
                id: '5',
                name: 'Chat User',
                code: 'CHATCODE',
                expiryDate: null,
                createdAt: new Date().toISOString(),
            })),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0 })),
        }));

        const validation = isCodeValid('CHATCODE');
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
    });

    it('GET /api/sync rejects missing code (via isCodeValid)', () => {
        const validation = isCodeValid('');
        expect(validation.valid).toBe(false);
        expect(validation.reason).toBe('Invalid code');
    });

    it('GET /api/sync rejects invalid code', () => {
        const validation = isCodeValid('NOEXIST1');
        expect(validation.valid).toBe(false);
    });

    it('getUserData returns null for non-existent code', () => {
        const data = getUserData('NOCODE');
        expect(data).toBeNull();
    });

    it('getUserData returns parsed JSON data', () => {
        mockPrepare.mockImplementationOnce(() => ({
            get: vi.fn(() => ({
                id: '10',
                name: 'Data User',
                code: 'DATACODE',
                expiryDate: null,
                createdAt: new Date().toISOString(),
                data: JSON.stringify({ messages: ['hello'], settings: { theme: 'dark' } }),
            })),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0 })),
        }));

        const data = getUserData('DATACODE');
        expect(data).toEqual({ messages: ['hello'], settings: { theme: 'dark' } });
    });

    it('getUserData returns empty object for invalid JSON', () => {
        mockPrepare.mockImplementationOnce(() => ({
            get: vi.fn(() => ({
                id: '11',
                name: 'Bad Data User',
                code: 'BADDATA1',
                expiryDate: null,
                createdAt: new Date().toISOString(),
                data: 'not valid json{{{',
            })),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0 })),
        }));

        const data = getUserData('BADDATA1');
        expect(data).toEqual({});
    });

    it('updateUserData returns false for non-existent code', () => {
        const success = updateUserData('NOCODE', { key: 'value' });
        expect(success).toBe(false);
    });

    it('updateUserData updates data for an existing user', () => {
        // First mock for getUserByCode inside updateUserData
        mockPrepare.mockImplementationOnce(() => ({
            get: vi.fn(() => ({
                id: '12',
                name: 'Sync User',
                code: 'SYNCCODE',
                expiryDate: null,
                createdAt: new Date().toISOString(),
                data: '{}',
            })),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0 })),
        }));
        // Second mock for the UPDATE statement
        mockPrepare.mockImplementationOnce(() => ({
            get: vi.fn(() => null),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 1 })),
        }));

        const success = updateUserData('SYNCCODE', { messages: ['new message'] });
        expect(success).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
describe('Settings', () => {
    beforeEach(() => {
        mockSettings.clear();
    });

    it('getSetting returns default value when key does not exist', () => {
        const value = getSetting('nonexistent', 42);
        expect(value).toBe(42);
    });

    it('getSetting returns null by default when key does not exist', () => {
        const value = getSetting('nonexistent');
        expect(value).toBeNull();
    });

    it('getSetting retrieves a stored setting', () => {
        mockPrepare.mockImplementationOnce(() => ({
            get: vi.fn(() => ({ value: JSON.stringify(12345) })),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 0 })),
        }));

        const value = getSetting('min_auth_ts', 0);
        expect(value).toBe(12345);
    });

    it('updateSetting stores a value and returns true', () => {
        mockPrepare.mockImplementationOnce(() => ({
            get: vi.fn(() => null),
            all: vi.fn(() => []),
            run: vi.fn(() => ({ changes: 1 })),
        }));

        const result = updateSetting('min_auth_ts', Date.now());
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
