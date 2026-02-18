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
                if (where.clerkId) {
                    for (const u of mockUsers.values()) {
                        if (u.clerkId === where.clerkId) return Promise.resolve(u);
                    }
                    return Promise.resolve(null);
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
                mockUsers.set(data.id, { ...data });
                return Promise.resolve(data);
            }),
            update: vi.fn(({ where, data }) => {
                let user = null;
                if (where.clerkId) {
                    for (const u of mockUsers.values()) {
                        if (u.clerkId === where.clerkId) { user = u; break; }
                    }
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
            upsert: vi.fn(({ where, update, create }) => {
                let existing = null;
                if (where.clerkId) {
                    for (const u of mockUsers.values()) {
                        if (u.clerkId === where.clerkId) { existing = u; break; }
                    }
                }
                if (existing) {
                    Object.assign(existing, update);
                    return Promise.resolve(existing);
                }
                mockUsers.set(create.id, { ...create });
                return Promise.resolve(create);
            }),
            delete: vi.fn(({ where }) => {
                let found = false;
                if (where.clerkId) {
                    for (const [key, u] of mockUsers.entries()) {
                        if (u.clerkId === where.clerkId) {
                            mockUsers.delete(key);
                            found = true;
                            break;
                        }
                    }
                } else if (where.id) {
                    for (const [key, u] of mockUsers.entries()) {
                        if (u.id === where.id) {
                            mockUsers.delete(key);
                            found = true;
                            break;
                        }
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
    addUser,
    getAllUsers,
    deleteUser,
    getUserByClerkId,
    upsertUserByClerkId,
    deleteUserByClerkId,
    getUserDataByClerkId,
    updateUserDataByClerkId,
    getSetting,
    updateSetting,
} from '../server/db.js';

// ---------------------------------------------------------------------------
// User CRUD (Clerk-based)
// ---------------------------------------------------------------------------
describe('getUserByClerkId', () => {
    beforeEach(() => {
        mockUsers.clear();
        vi.restoreAllMocks();
    });

    it('returns null for null/empty clerkId', async () => {
        expect(await getUserByClerkId(null)).toBeNull();
        expect(await getUserByClerkId('')).toBeNull();
    });

    it('returns null when clerkId does not exist in database', async () => {
        const result = await getUserByClerkId('user_nonexistent');
        expect(result).toBeNull();
    });

    it('returns user for an existing clerkId', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: 'user_123',
            clerkId: 'user_123',
            name: 'Test User',
            email: 'test@example.com',
            role: 'user',
            createdAt: new Date().toISOString(),
        });

        const result = await getUserByClerkId('user_123');
        expect(result).toBeDefined();
        expect(result.name).toBe('Test User');
    });
});

describe('upsertUserByClerkId', () => {
    beforeEach(() => {
        mockUsers.clear();
        vi.restoreAllMocks();
    });

    it('creates a new user when clerkId does not exist', async () => {
        const result = await upsertUserByClerkId('user_new_123', {
            id: 'user_new_123',
            name: 'New User',
            email: 'new@example.com',
            role: 'user',
            createdAt: new Date().toISOString(),
        });

        expect(mockPrisma.user.upsert).toHaveBeenCalled();
    });

    it('updates an existing user when clerkId exists', async () => {
        // Seed an existing user
        mockUsers.set('user_existing', {
            id: 'user_existing',
            clerkId: 'user_existing',
            name: 'Old Name',
            email: 'old@example.com',
            role: 'user',
            createdAt: new Date().toISOString(),
        });

        await upsertUserByClerkId('user_existing', {
            name: 'Updated Name',
            email: 'updated@example.com',
            role: 'admin',
        });

        expect(mockPrisma.user.upsert).toHaveBeenCalled();
    });
});

describe('deleteUserByClerkId', () => {
    beforeEach(() => {
        mockUsers.clear();
        vi.restoreAllMocks();
    });

    it('returns false when clerkId does not exist', async () => {
        const result = await deleteUserByClerkId('user_nonexistent');
        expect(result).toBe(false);
    });

    it('deletes an existing user and returns true', async () => {
        mockUsers.set('uid1', {
            id: 'uid1',
            clerkId: 'user_to_delete',
            name: 'Delete Me',
        });

        const result = await deleteUserByClerkId('user_to_delete');
        expect(result).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Sync operations (Clerk-based)
// ---------------------------------------------------------------------------
describe('Sync operations', () => {
    beforeEach(() => {
        mockUsers.clear();
        mockSettings.clear();
        vi.restoreAllMocks();
    });

    it('getUserDataByClerkId returns null for non-existent clerkId', async () => {
        const data = await getUserDataByClerkId('user_nonexistent');
        expect(data).toBeNull();
    });

    it('getUserDataByClerkId returns parsed JSON data', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: '10',
            clerkId: 'user_10',
            name: 'Data User',
            email: null,
            role: 'user',
            createdAt: new Date().toISOString(),
            data: JSON.stringify({ messages: ['hello'], settings: { theme: 'dark' } }),
        });

        const data = await getUserDataByClerkId('user_10');
        expect(data).toEqual({ messages: ['hello'], settings: { theme: 'dark' } });
    });

    it('getUserDataByClerkId returns empty object for invalid JSON', async () => {
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: '11',
            clerkId: 'user_11',
            name: 'Bad Data User',
            email: null,
            role: 'user',
            createdAt: new Date().toISOString(),
            data: 'not valid json{{{',
        });

        const data = await getUserDataByClerkId('user_11');
        expect(data).toEqual({});
    });

    it('updateUserDataByClerkId returns false for non-existent clerkId', async () => {
        const success = await updateUserDataByClerkId('user_nonexistent', { key: 'value' });
        expect(success).toBe(false);
    });

    it('updateUserDataByClerkId updates data for an existing user', async () => {
        // First call: getUserByClerkId inside updateUserDataByClerkId
        mockPrisma.user.findUnique.mockResolvedValueOnce({
            id: '12',
            clerkId: 'user_12',
            name: 'Sync User',
            email: null,
            role: 'user',
            createdAt: new Date().toISOString(),
            data: '{}',
        });
        // Second call: the update itself
        mockPrisma.user.update.mockResolvedValueOnce({
            id: '12',
            clerkId: 'user_12',
            name: 'Sync User',
            data: JSON.stringify({ messages: ['new message'] }),
        });

        const success = await updateUserDataByClerkId('user_12', { messages: ['new message'] });
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
    function isPrivateHostname(hostname) {
        const host = hostname.replace(/^\[|\]$/g, '');
        if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
        if (host === 'localhost' || host.endsWith('.localhost')) return true;
        const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (ipv4Match) {
            const [, a, b, c, d] = ipv4Match.map(Number);
            if (a === 0 && b === 0 && c === 0 && d === 0) return true;
            if (a === 127) return true;
            if (a === 10) return true;
            if (a === 172 && b >= 16 && b <= 31) return true;
            if (a === 192 && b === 168) return true;
            if (a === 169 && b === 254) return true;
        }
        return false;
    }

    function isValidImageUrl(url) {
        if (!url || typeof url !== 'string') return false;
        if (url.startsWith('data:image/')) return true;
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:') return false;
            if (isPrivateHostname(parsed.hostname)) return false;
            return true;
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

    // SSRF: private/internal IP blocking
    it('rejects localhost (127.0.0.1)', () => {
        expect(isValidImageUrl('https://127.0.0.1/image.png')).toBe(false);
    });

    it('rejects localhost (127.0.0.255)', () => {
        expect(isValidImageUrl('https://127.0.0.255/image.png')).toBe(false);
    });

    it('rejects 10.x.x.x private range', () => {
        expect(isValidImageUrl('https://10.0.0.1/image.png')).toBe(false);
        expect(isValidImageUrl('https://10.255.255.255/image.png')).toBe(false);
    });

    it('rejects 192.168.x.x private range', () => {
        expect(isValidImageUrl('https://192.168.0.1/image.png')).toBe(false);
        expect(isValidImageUrl('https://192.168.1.100/image.png')).toBe(false);
    });

    it('rejects 172.16.0.0/12 private range', () => {
        expect(isValidImageUrl('https://172.16.0.1/image.png')).toBe(false);
        expect(isValidImageUrl('https://172.31.255.255/image.png')).toBe(false);
    });

    it('allows 172.15.x.x (not in private range)', () => {
        expect(isValidImageUrl('https://172.15.0.1/image.png')).toBe(true);
    });

    it('allows 172.32.x.x (not in private range)', () => {
        expect(isValidImageUrl('https://172.32.0.1/image.png')).toBe(true);
    });

    it('rejects 169.254.x.x link-local (AWS metadata)', () => {
        expect(isValidImageUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
        expect(isValidImageUrl('https://169.254.0.1/image.png')).toBe(false);
    });

    it('rejects 0.0.0.0', () => {
        expect(isValidImageUrl('https://0.0.0.0/image.png')).toBe(false);
    });

    it('rejects localhost hostname', () => {
        expect(isValidImageUrl('https://localhost/image.png')).toBe(false);
        expect(isValidImageUrl('https://sub.localhost/image.png')).toBe(false);
    });

    it('rejects IPv6 localhost [::1]', () => {
        expect(isValidImageUrl('https://[::1]/image.png')).toBe(false);
    });

    it('allows legitimate public HTTPS URLs', () => {
        expect(isValidImageUrl('https://cdn.example.com/image.png')).toBe(true);
        expect(isValidImageUrl('https://8.8.8.8/image.png')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Rate Limiting: checkChatRateLimit (from server/index.js)
// ---------------------------------------------------------------------------
describe('checkChatRateLimit (rate limiting)', () => {
    const chatRateLimit = new Map();
    const CHAT_RATE_WINDOW = 5 * 60 * 1000;
    const CHAT_RATE_MAX = 20;
    const CHAT_RATE_MAX_ENTRIES = 10000;

    function checkChatRateLimit(userId) {
        const now = Date.now();
        for (const [key, entry] of chatRateLimit.entries()) {
            if (now - entry.windowStart > CHAT_RATE_WINDOW) chatRateLimit.delete(key);
        }
        if (chatRateLimit.size > CHAT_RATE_MAX_ENTRIES) {
            const entries = [...chatRateLimit.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
            for (let i = 0; i < entries.length / 2; i++) chatRateLimit.delete(entries[i][0]);
        }
        const entry = chatRateLimit.get(userId);
        if (!entry || now - entry.windowStart > CHAT_RATE_WINDOW) {
            chatRateLimit.set(userId, { count: 1, windowStart: now });
            return false;
        }
        entry.count++;
        return entry.count > CHAT_RATE_MAX;
    }

    beforeEach(() => {
        chatRateLimit.clear();
    });

    it('allows the first request', () => {
        expect(checkChatRateLimit('user_1')).toBe(false);
    });

    it('allows requests up to the limit (20 per 5 min)', () => {
        for (let i = 0; i < CHAT_RATE_MAX; i++) {
            expect(checkChatRateLimit('user_2')).toBe(false);
        }
    });

    it('blocks request #21 within the same window', () => {
        for (let i = 0; i < CHAT_RATE_MAX; i++) {
            checkChatRateLimit('user_3');
        }
        expect(checkChatRateLimit('user_3')).toBe(true);
    });

    it('blocks all subsequent requests after the limit', () => {
        for (let i = 0; i < CHAT_RATE_MAX; i++) {
            checkChatRateLimit('user_4');
        }
        expect(checkChatRateLimit('user_4')).toBe(true);
        expect(checkChatRateLimit('user_4')).toBe(true);
        expect(checkChatRateLimit('user_4')).toBe(true);
    });

    it('rate limits are per-userId (different users have independent limits)', () => {
        for (let i = 0; i < CHAT_RATE_MAX; i++) {
            checkChatRateLimit('user_5');
        }
        expect(checkChatRateLimit('user_5')).toBe(true);
        expect(checkChatRateLimit('user_6')).toBe(false);
    });

    it('allows requests again after the window expires', () => {
        chatRateLimit.set('user_7', {
            count: CHAT_RATE_MAX + 5,
            windowStart: Date.now() - CHAT_RATE_WINDOW - 1000,
        });

        expect(checkChatRateLimit('user_7')).toBe(false);
    });

    it('resets the counter after window expiry', () => {
        chatRateLimit.set('user_8', {
            count: CHAT_RATE_MAX,
            windowStart: Date.now() - CHAT_RATE_WINDOW - 1,
        });

        expect(checkChatRateLimit('user_8')).toBe(false);
        const entry = chatRateLimit.get('user_8');
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

        checkChatRateLimit('FRESH1');

        expect(chatRateLimit.has('EXPIRED1')).toBe(false);
        expect(chatRateLimit.has('EXPIRED2')).toBe(false);
        expect(chatRateLimit.has('FRESH1')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Message Validation: MAX_MESSAGE_LENGTH and MAX_MESSAGES (from server/index.js)
// ---------------------------------------------------------------------------
describe('Message validation (length and count limits)', () => {
    const VALID_ROLES = new Set(['user', 'assistant', 'system']);
    const MAX_MESSAGE_LENGTH = 4000;
    const MAX_MESSAGES = 50;

    function validateMessages(rawMessages) {
        if (rawMessages !== undefined && !Array.isArray(rawMessages)) {
            return { valid: false, error: 'messages must be an array' };
        }
        const messagesArr = Array.isArray(rawMessages) ? rawMessages : [];

        for (const msg of messagesArr) {
            if (!msg || typeof msg !== 'object') {
                return { valid: false, error: 'Each message must be an object with role and content' };
            }
            if (typeof msg.role !== 'string' || !VALID_ROLES.has(msg.role)) {
                return { valid: false, error: `Invalid message role: "${msg.role}". Must be one of: user, assistant, system` };
            }
            if (typeof msg.content !== 'string') {
                return { valid: false, error: 'Message content must be a string' };
            }
            if (msg.content.length > MAX_MESSAGE_LENGTH) {
                return { valid: false, error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.` };
            }
        }

        const userMessages = messagesArr
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role, content: m.content }));

        if (userMessages.length > MAX_MESSAGES) {
            return { valid: false, error: `Too many messages. Maximum ${MAX_MESSAGES} allowed.` };
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
            { role: 'user', content: 'x'.repeat(4001) },
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

    it('filters out system roles before counting user/assistant messages', () => {
        const messages = Array.from({ length: 50 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `Message ${i}`,
        }));
        messages.push({ role: 'system', content: 'System message' });

        const result = validateMessages(messages);
        expect(result.valid).toBe(true);
        expect(result.messages).toHaveLength(50);
    });

    it('rejects messages with invalid roles like function', () => {
        const messages = [
            { role: 'user', content: 'Hello' },
            { role: 'function', content: 'Invalid role' },
        ];
        const result = validateMessages(messages);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid message role');
    });

    it('handles empty array gracefully', () => {
        const result = validateMessages([]);
        expect(result.valid).toBe(true);
        expect(result.messages).toHaveLength(0);
    });

    it('rejects non-array input (null)', () => {
        const result = validateMessages(null);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('must be an array');
    });

    it('handles undefined input gracefully (no messages field)', () => {
        const result = validateMessages(undefined);
        expect(result.valid).toBe(true);
        expect(result.messages).toHaveLength(0);
    });

    it('rejects message with non-string content', () => {
        const result = validateMessages([{ role: 'user', content: 12345 }]);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('content must be a string');
    });

    it('rejects null message objects in array', () => {
        const result = validateMessages([null, { role: 'user', content: 'Hello' }]);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('must be an object');
    });
});

// ---------------------------------------------------------------------------
// useBotAuth: Clerk-based verification
// ---------------------------------------------------------------------------
describe('useBotAuth Clerk-based verification', () => {
    let hookSource;

    beforeAll(async () => {
        const fs = await vi.importActual('fs');
        const path = await vi.importActual('path');
        const hookPath = path.join(__dirname, '..', 'src', 'hooks', 'useBotAuth.ts');
        hookSource = fs.readFileSync(hookPath, 'utf-8');
    });

    it('imports from @clerk/clerk-react', () => {
        expect(hookSource).toContain('@clerk/clerk-react');
    });

    it('uses useUser hook from Clerk', () => {
        expect(hookSource).toContain('useUser');
    });

    it('uses useAuth hook from Clerk', () => {
        expect(hookSource).toContain('useAuth');
    });

    it('does NOT contain jsonwebtoken references', () => {
        expect(hookSource).not.toContain('jsonwebtoken');
        expect(hookSource).not.toContain('jwt');
    });

    it('does NOT contain access code login logic', () => {
        expect(hookSource).not.toContain('validateOnly');
        expect(hookSource).not.toContain('bot_user_code');
    });

    it('calls clerk.signOut() on logout', () => {
        expect(hookSource).toContain('signOut');
    });

    it('uses sessionStorage for preferences (name, lang)', () => {
        expect(hookSource).toContain('sessionStorage');
    });
});

// ---------------------------------------------------------------------------
// Security: server/auth.js uses Clerk, not JWT
// ---------------------------------------------------------------------------
describe('Security: auth module uses Clerk', () => {
    let authSource;

    beforeAll(async () => {
        const fs = await vi.importActual('fs');
        const path = await vi.importActual('path');
        const authPath = path.join(__dirname, '..', 'server', 'auth.js');
        authSource = fs.readFileSync(authPath, 'utf-8');
    });

    it('imports from @clerk/express', () => {
        expect(authSource).toContain('@clerk/express');
    });

    it('does NOT import jsonwebtoken', () => {
        expect(authSource).not.toContain('jsonwebtoken');
    });

    it('does NOT import bcryptjs', () => {
        expect(authSource).not.toContain('bcryptjs');
    });

    it('does NOT contain JWT_SECRET references', () => {
        expect(authSource).not.toContain('JWT_SECRET');
    });

    it('exports checkAdminAuth function', () => {
        expect(authSource).toContain('export function checkAdminAuth');
    });

    it('exports clerkAuth middleware', () => {
        expect(authSource).toContain('export const clerkAuth');
    });
});
