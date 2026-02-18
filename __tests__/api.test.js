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

// ---------------------------------------------------------------------------
// SSRF Prevention: isValidImageUrl (from server/index.js)
// ---------------------------------------------------------------------------
describe('isValidImageUrl (SSRF prevention)', () => {
    // Reimplementing the function from server/index.js for direct testing
    function isValidImageUrl(url) {
        if (!url || typeof url !== 'string') return false;
        // Allow base64 data URLs for images only
        if (url.startsWith('data:image/')) return true;
        // Allow HTTPS URLs only
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }

    it('accepts data:image/png base64 URLs', () => {
        expect(isValidImageUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')).toBe(true);
    });

    it('accepts data:image/jpeg base64 URLs', () => {
        expect(isValidImageUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
    });

    it('accepts data:image/gif base64 URLs', () => {
        expect(isValidImageUrl('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP==')).toBe(true);
    });

    it('accepts data:image/webp base64 URLs', () => {
        expect(isValidImageUrl('data:image/webp;base64,UklGRlYAAABXRUJQ')).toBe(true);
    });

    it('accepts HTTPS URLs', () => {
        expect(isValidImageUrl('https://example.com/image.png')).toBe(true);
    });

    it('accepts HTTPS URLs with paths and query params', () => {
        expect(isValidImageUrl('https://cdn.example.com/images/photo.jpg?w=800&h=600')).toBe(true);
    });

    it('rejects HTTP URLs (no plaintext http)', () => {
        expect(isValidImageUrl('http://example.com/image.png')).toBe(false);
    });

    it('rejects file:// protocol URLs', () => {
        expect(isValidImageUrl('file:///etc/passwd')).toBe(false);
    });

    it('rejects file:// protocol for Windows paths', () => {
        expect(isValidImageUrl('file:///C:/Windows/system32/config/sam')).toBe(false);
    });

    it('rejects javascript: protocol URLs', () => {
        expect(isValidImageUrl('javascript:alert(1)')).toBe(false);
    });

    it('rejects ftp:// protocol URLs', () => {
        expect(isValidImageUrl('ftp://server/file')).toBe(false);
    });

    it('rejects data: URLs that are not images (data:text/html)', () => {
        expect(isValidImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    });

    it('rejects data:application/javascript URLs', () => {
        expect(isValidImageUrl('data:application/javascript;base64,YWxlcnQoMSk=')).toBe(false);
    });

    it('returns false for null input', () => {
        expect(isValidImageUrl(null)).toBe(false);
    });

    it('returns false for undefined input', () => {
        expect(isValidImageUrl(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isValidImageUrl('')).toBe(false);
    });

    it('returns false for non-string input (number)', () => {
        expect(isValidImageUrl(12345)).toBe(false);
    });

    it('returns false for non-string input (object)', () => {
        expect(isValidImageUrl({ url: 'https://evil.com' })).toBe(false);
    });

    it('returns false for a bare string with no protocol', () => {
        expect(isValidImageUrl('example.com/image.png')).toBe(false);
    });

    it('rejects gopher:// protocol', () => {
        expect(isValidImageUrl('gopher://internal:70/')).toBe(false);
    });

    it('rejects dict:// protocol', () => {
        expect(isValidImageUrl('dict://attacker:11111/')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Rate Limiting: checkChatRateLimit (from server/index.js)
// ---------------------------------------------------------------------------
describe('checkChatRateLimit (rate limiting)', () => {
    // Reimplementing the rate-limiting logic from server/index.js for direct testing
    const chatRateLimit = new Map();
    const CHAT_RATE_WINDOW = 5 * 60 * 1000; // 5 minutes
    const CHAT_RATE_MAX = 20;
    const CHAT_RATE_MAX_ENTRIES = 10000;

    function checkChatRateLimit(code) {
        const now = Date.now();
        for (const [key, entry] of chatRateLimit.entries()) {
            if (now - entry.windowStart > CHAT_RATE_WINDOW) chatRateLimit.delete(key);
        }
        if (chatRateLimit.size > CHAT_RATE_MAX_ENTRIES) {
            const entries = [...chatRateLimit.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
            for (let i = 0; i < entries.length / 2; i++) chatRateLimit.delete(entries[i][0]);
        }
        const entry = chatRateLimit.get(code);
        if (!entry || now - entry.windowStart > CHAT_RATE_WINDOW) {
            chatRateLimit.set(code, { count: 1, windowStart: now });
            return false;
        }
        entry.count++;
        return entry.count > CHAT_RATE_MAX;
    }

    beforeEach(() => {
        chatRateLimit.clear();
    });

    it('allows the first request', () => {
        expect(checkChatRateLimit('USER1')).toBe(false);
    });

    it('allows requests up to the limit (20 per 5 min)', () => {
        for (let i = 0; i < CHAT_RATE_MAX; i++) {
            expect(checkChatRateLimit('USER2')).toBe(false);
        }
    });

    it('blocks request #21 within the same window', () => {
        for (let i = 0; i < CHAT_RATE_MAX; i++) {
            checkChatRateLimit('USER3');
        }
        // The 21st request should be rate limited
        expect(checkChatRateLimit('USER3')).toBe(true);
    });

    it('blocks all subsequent requests after the limit', () => {
        for (let i = 0; i < CHAT_RATE_MAX; i++) {
            checkChatRateLimit('USER4');
        }
        // Requests 21, 22, 23 should all be blocked
        expect(checkChatRateLimit('USER4')).toBe(true);
        expect(checkChatRateLimit('USER4')).toBe(true);
        expect(checkChatRateLimit('USER4')).toBe(true);
    });

    it('rate limits are per-code (different codes have independent limits)', () => {
        for (let i = 0; i < CHAT_RATE_MAX; i++) {
            checkChatRateLimit('USER5');
        }
        // USER5 is now rate limited
        expect(checkChatRateLimit('USER5')).toBe(true);
        // USER6 should still be allowed
        expect(checkChatRateLimit('USER6')).toBe(false);
    });

    it('allows requests again after the window expires', () => {
        // Manually set a window that has already expired
        chatRateLimit.set('USER7', {
            count: CHAT_RATE_MAX + 5,
            windowStart: Date.now() - CHAT_RATE_WINDOW - 1000, // expired 1 second ago
        });

        // Should be allowed because window has expired
        expect(checkChatRateLimit('USER7')).toBe(false);
    });

    it('resets the counter after window expiry', () => {
        chatRateLimit.set('USER8', {
            count: CHAT_RATE_MAX,
            windowStart: Date.now() - CHAT_RATE_WINDOW - 1, // just expired
        });

        // First request after expiry starts a new window
        expect(checkChatRateLimit('USER8')).toBe(false);
        // Should be on count 1 now, so 19 more are allowed
        const entry = chatRateLimit.get('USER8');
        expect(entry.count).toBe(1);
    });

    it('cleans up expired entries on each call', () => {
        chatRateLimit.set('EXPIRED1', {
            count: 5,
            windowStart: Date.now() - CHAT_RATE_WINDOW - 10000,
        });
        chatRateLimit.set('EXPIRED2', {
            count: 10,
            windowStart: Date.now() - CHAT_RATE_WINDOW - 5000,
        });

        // Make a request with a fresh code, which triggers cleanup
        checkChatRateLimit('FRESH1');

        // Expired entries should have been cleaned up
        expect(chatRateLimit.has('EXPIRED1')).toBe(false);
        expect(chatRateLimit.has('EXPIRED2')).toBe(false);
        expect(chatRateLimit.has('FRESH1')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Message Validation: MAX_MESSAGE_LENGTH and MAX_MESSAGES (from server/index.js)
// ---------------------------------------------------------------------------
describe('Message validation (length and count limits)', () => {
    const MAX_MESSAGE_LENGTH = 4000;
    const MAX_MESSAGES = 50;

    // Replicating the validation logic from the /api/chat endpoint
    function validateMessages(rawMessages) {
        const userMessages = Array.isArray(rawMessages)
            ? rawMessages.filter(m => m && (m.role === 'user' || m.role === 'assistant')).map(m => ({ role: m.role, content: m.content }))
            : [];

        if (userMessages.length > MAX_MESSAGES) {
            return { valid: false, error: `Too many messages. Maximum ${MAX_MESSAGES} allowed.` };
        }
        for (const msg of userMessages) {
            if (typeof msg.content === 'string' && msg.content.length > MAX_MESSAGE_LENGTH) {
                return { valid: false, error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.` };
            }
        }
        return { valid: true, messages: userMessages };
    }

    it('accepts a message within 4000 characters', () => {
        const messages = [{ role: 'user', content: 'a'.repeat(4000) }];
        const result = validateMessages(messages);
        expect(result.valid).toBe(true);
    });

    it('rejects a message exceeding 4000 characters', () => {
        const messages = [{ role: 'user', content: 'a'.repeat(4001) }];
        const result = validateMessages(messages);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('4000');
    });

    it('accepts exactly 50 messages', () => {
        const messages = Array.from({ length: 50 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${i}`,
        }));
        const result = validateMessages(messages);
        expect(result.valid).toBe(true);
        expect(result.messages).toHaveLength(50);
    });

    it('rejects 51 messages', () => {
        const messages = Array.from({ length: 51 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${i}`,
        }));
        const result = validateMessages(messages);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('50');
    });

    it('rejects when any single message in a batch exceeds the limit', () => {
        const messages = [
            { role: 'user', content: 'Short message' },
            { role: 'assistant', content: 'Also short' },
            { role: 'user', content: 'x'.repeat(4001) }, // This one is too long
        ];
        const result = validateMessages(messages);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('4000');
    });

    it('accepts messages at exactly the boundary (4000 chars)', () => {
        const messages = [
            { role: 'user', content: 'b'.repeat(4000) },
            { role: 'assistant', content: 'c'.repeat(4000) },
        ];
        const result = validateMessages(messages);
        expect(result.valid).toBe(true);
    });

    it('filters out system/function roles before counting', () => {
        const messages = Array.from({ length: 50 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${i}`,
        }));
        // Add system messages that should be filtered out
        messages.push({ role: 'system', content: 'System message' });
        messages.push({ role: 'function', content: 'Function result' });

        const result = validateMessages(messages);
        // Only 50 user/assistant messages counted, system/function are filtered
        expect(result.valid).toBe(true);
        expect(result.messages).toHaveLength(50);
    });

    it('handles empty array gracefully', () => {
        const result = validateMessages([]);
        expect(result.valid).toBe(true);
        expect(result.messages).toHaveLength(0);
    });

    it('handles non-array input gracefully', () => {
        const result = validateMessages(null);
        expect(result.valid).toBe(true);
        expect(result.messages).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// SessionStorage verification: useBotAuth uses sessionStorage, not localStorage
// ---------------------------------------------------------------------------
describe('useBotAuth sessionStorage verification', () => {
    let hookSource;

    beforeAll(async () => {
        const fs = await vi.importActual('fs');
        const path = await vi.importActual('path');
        const hookPath = path.join(__dirname, '..', 'src', 'hooks', 'useBotAuth.ts');
        hookSource = fs.readFileSync(hookPath, 'utf-8');
    });

    it('uses sessionStorage for storing access codes', () => {
        expect(hookSource).toContain('sessionStorage');
    });

    it('does NOT use localStorage anywhere in the hook', () => {
        expect(hookSource).not.toContain('localStorage');
    });

    it('stores bot_user_code in sessionStorage', () => {
        expect(hookSource).toContain('sessionStorage.setItem("bot_user_code"');
    });

    it('stores bot_user_name in sessionStorage', () => {
        expect(hookSource).toContain('sessionStorage.setItem("bot_user_name"');
    });

    it('stores bot_login_ts in sessionStorage', () => {
        expect(hookSource).toContain('sessionStorage.setItem("bot_login_ts"');
    });

    it('clears all session keys on logout', () => {
        expect(hookSource).toContain('sessionStorage.removeItem("bot_user_code")');
        expect(hookSource).toContain('sessionStorage.removeItem("bot_user_name")');
        expect(hookSource).toContain('sessionStorage.removeItem("bot_name")');
        expect(hookSource).toContain('sessionStorage.removeItem("bot_lang")');
    });

    it('reads initial state from sessionStorage', () => {
        expect(hookSource).toContain('sessionStorage.getItem("bot_user_code")');
        expect(hookSource).toContain('sessionStorage.getItem("bot_user_name")');
    });
});
