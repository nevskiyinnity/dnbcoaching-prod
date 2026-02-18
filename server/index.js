import * as Sentry from '@sentry/node';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { Resend } from 'resend';

// Initialize Sentry before anything else
Sentry.init({
  dsn: process.env.SENTRY_DSN || "",
  tracesSampleRate: 0.1,
  enabled: !!process.env.SENTRY_DSN,
});
import { getAllUsers, addUser, updateUser, deleteUser, generateCode, isCodeValid, getSetting, updateSetting } from './db.js';
import { hashPassword, verifyPassword, signToken, checkAdminAuth } from './auth.js';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isPrivateHostname(hostname) {
    // Remove brackets from IPv6
    const host = hostname.replace(/^\[|\]$/g, '');

    // IPv6 localhost
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;

    // Obvious hostnames
    if (host === 'localhost' || host.endsWith('.localhost')) return true;

    // Check for IPv4 patterns (may include port, but URL parsing strips port from hostname)
    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
        const [, a, b, c, d] = ipv4Match.map(Number);
        // 0.0.0.0
        if (a === 0 && b === 0 && c === 0 && d === 0) return true;
        // 127.0.0.0/8 (localhost)
        if (a === 127) return true;
        // 10.0.0.0/8 (private)
        if (a === 10) return true;
        // 172.16.0.0/12 (private)
        if (a === 172 && b >= 16 && b <= 31) return true;
        // 192.168.0.0/16 (private)
        if (a === 192 && b === 168) return true;
        // 169.254.0.0/16 (link-local / AWS metadata)
        if (a === 169 && b === 254) return true;
    }

    return false;
}

function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    // Allow base64 data URLs for images only
    if (url.startsWith('data:image/')) return true;
    // Allow HTTPS URLs only
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return false;
        // Block internal/private IPs to prevent SSRF
        if (isPrivateHostname(parsed.hostname)) return false;
        return true;
    } catch {
        return false;
    }
}

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — AI features will be unavailable');
}

// --- Admin Password Hash (compute once at module load) ---
let _adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || null;
let _adminPasswordHashPromise = null;

function getAdminPasswordHash() {
    if (_adminPasswordHash) return Promise.resolve(_adminPasswordHash);
    if (!process.env.ADMIN_PASSWORD) {
        throw new Error('Either ADMIN_PASSWORD_HASH or ADMIN_PASSWORD environment variable is required');
    }
    // Lazy initialization: hash once and cache the result
    if (!_adminPasswordHashPromise) {
        _adminPasswordHashPromise = hashPassword(process.env.ADMIN_PASSWORD).then(hash => {
            _adminPasswordHash = hash;
            return hash;
        });
    }
    return _adminPasswordHashPromise;
}
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const RESEND_API_KEY = process.env.VITE_RESEND_API_KEY;

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// CSRF origin validation for mutation requests
app.use((req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const origin = req.headers.origin;
        const host = req.headers.host;
        if (origin && host) {
            try {
                const originHost = new URL(origin).host;
                if (originHost !== host) {
                    return res.status(403).json({ error: 'CSRF validation failed: origin mismatch' });
                }
            } catch {
                return res.status(403).json({ error: 'CSRF validation failed: invalid origin' });
            }
        }
        // Allow non-browser requests (curl, etc.) that don't send Origin header
    }
    next();
});

// Middleware
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:8080'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../dist')));

// --- Rate Limiting ---
// Generic rate limiter factory. Each limiter uses an in-memory Map with
// inline cleanup on every check — suitable for serverless where timers
// may not survive across invocations.

const RATE_LIMIT_MAX_ENTRIES = 10000;

function createRateLimiter(windowMs, maxRequests) {
    const store = new Map();

    return function checkRateLimit(key) {
        const now = Date.now();

        // Inline cleanup: remove all expired entries on every call
        for (const [k, entry] of store.entries()) {
            if (now - entry.windowStart > windowMs) store.delete(k);
        }

        // Evict oldest half if store grows too large (DoS protection)
        if (store.size > RATE_LIMIT_MAX_ENTRIES) {
            const entries = [...store.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
            for (let i = 0; i < entries.length / 2; i++) store.delete(entries[i][0]);
        }

        const entry = store.get(key);
        if (!entry || now - entry.windowStart > windowMs) {
            store.set(key, { count: 1, windowStart: now });
            return false;
        }
        entry.count++;
        return entry.count > maxRequests;
    };
}

// Chat rate limit: 20 requests per 5 minutes per access code
const checkChatRateLimit = createRateLimiter(5 * 60 * 1000, 20);

// Admin login rate limit: 5 attempts per 15 minutes per IP
const ADMIN_LOGIN_RATE_WINDOW = 15 * 60 * 1000;
const ADMIN_LOGIN_RATE_MAX = 5;
const checkAdminLoginRateLimit = createRateLimiter(ADMIN_LOGIN_RATE_WINDOW, ADMIN_LOGIN_RATE_MAX);

// --- API Routes ---

// Admin Login — returns JWT (rate limited: 5 attempts per 15 min per IP)
app.post('/api/admin/login', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    if (checkAdminLoginRateLimit(clientIp)) {
        return res.status(429).json({ success: false, message: 'Too many login attempts. Please try again later.' });
    }

    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ success: false, message: 'Password required' });
    }

    try {
        const storedHash = await getAdminPasswordHash();
        const valid = await verifyPassword(password, storedHash);

        if (!valid) {
            return res.status(401).json({ success: false, message: 'Invalid password' });
        }

        const token = signToken({ role: 'admin' });
        return res.status(200).json({ success: true, token });
    } catch (err) {
        logger.error('Admin login error', err);
        return res.status(500).json({ success: false, message: 'Authentication error' });
    }
});

// Admin Users CRUD
app.get('/api/admin/users', checkAdminAuth, async (req, res) => {
    try {
        const users = await getAllUsers();
        res.json({ users });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.post('/api/admin/users', checkAdminAuth, async (req, res) => {
    try {
        const { name, expiryDate } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });

        const code = generateCode();
        const newUser = {
            id: crypto.randomUUID(),
            name: name.trim(),
            code,
            expiryDate: expiryDate || null,
            createdAt: new Date().toISOString(),
        };

        await addUser(newUser);
        res.status(201).json({ user: newUser });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.put('/api/admin/users', checkAdminAuth, async (req, res) => {
    try {
        const { id, name, expiryDate } = req.body;
        if (!id) return res.status(400).json({ message: 'User ID is required' });

        const success = await updateUser(id, { name: name?.trim(), expiryDate });
        if (!success) return res.status(404).json({ message: 'User not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.delete('/api/admin/users', checkAdminAuth, async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ message: 'User ID is required' });

        const success = await deleteUser(id);
        if (!success) return res.status(404).json({ message: 'User not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.post('/api/admin/users/reset', checkAdminAuth, async (req, res) => {
    try {
        await updateSetting('min_auth_ts', Date.now());
        res.json({ success: true, message: 'All sessions invalidated (timestamp update)' });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// Escape HTML special characters to prevent XSS in email templates
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Contact Form
app.post('/api/contact', async (req, res) => {
    const { name, email, message } = req.body;

    // Basic validation locally
    if (!name || !email || !message) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    if (!RESEND_API_KEY) {
        logger.error('VITE_RESEND_API_KEY is not set');
        return res.status(500).json({ message: 'Server configuration error' });
    }

    const resend = new Resend(RESEND_API_KEY);

    try {
        const safeName = escapeHtml(name);
        const safeEmail = escapeHtml(email);
        const safeMessage = escapeHtml(message);

        const { data, error } = await resend.emails.send({
            from: 'site@dnbcoaching.com',
            to: ['info@dnbcoaching.com'],
            subject: `New message from ${safeName}`,
            replyTo: email,
            html: `<p>Name: ${safeName}</p><p>Email: ${safeEmail}</p><p>Message: ${safeMessage}</p>`,
        });

        if (error) {
            logger.error('Resend error', error);
            return res.status(500).json({ message: 'Error sending email', error });
        }

        res.json({ message: 'Message sent successfully!', data });
    } catch (e) {
        logger.error('Contact error', e);
        res.status(500).json({ message: 'An unexpected error occurred.' });
    }
});

// Chat API
import { SYSTEM_PROMPT } from '../config/constants.js';

// --- Sync API ---
import { getUserData, updateUserData } from './db.js';

app.get('/api/sync', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).json({ message: 'Code required' });

    // Simple validation (same as chat)
    const validation = await isCodeValid(code);
    if (!validation.valid) return res.status(401).json({ message: validation.reason });

    const data = await getUserData(code);
    // Inject system settings
    if (data) {
        data.__sys = {
            minAuth: await getSetting('min_auth_ts', 0)
        };
    }
    res.json(data || {});
});

app.post('/api/sync', async (req, res) => {
    const { code, data } = req.body;
    if (!code || !data) return res.status(400).json({ message: 'Code and data required' });

    const validation = await isCodeValid(code);
    if (!validation.valid) return res.status(401).json({ message: validation.reason });

    const success = await updateUserData(code, data);
    if (success) {
        res.json({ success: true });
    } else {
        res.status(500).json({ message: 'Failed to update data' });
    }
});

const LANGUAGE_INSTRUCTIONS = {
    nl: 'Spreek standaard Nederlands en schrijf in de toon van een coach. ECHTER: als de gebruiker in een andere taal (bijv. Engels) tegen je spreekt, antwoord dan in DIE taal.',
    en: 'Responde by default in English in a friendly coaching tone. HOWEVER: if the user speaks to you in another language (e.g. Dutch), respond in THAT language.',
};

app.post('/api/chat', async (req, res) => {
    if (!OPENAI_API_KEY) return res.status(500).json({ message: 'Missing OPENAI_API_KEY' });

    try {
        if (!req.body) {
            logger.error('[CRITICAL] req.body is undefined. Middleware failure?');
            return res.status(400).json({ message: 'Request body is missing' });
        }
        const { messages: rawMessages, code, name, lang, validateOnly } = req.body;

        // Validation
        const codestr = (code || '').trim();
        if (validateOnly) {
            const v = await isCodeValid(codestr);
            if (!v.valid) return res.status(401).json({ valid: false, message: v.reason || 'Invalid code' });
            return res.status(200).json({ valid: true, userName: v.user?.name });
        }

        if (!codestr) return res.status(401).json({ message: 'Access code required' });
        const validation = await isCodeValid(codestr);
        if (!validation.valid) return res.status(401).json({ message: validation.reason });

        if (checkChatRateLimit(codestr)) {
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }

        // Validate and format messages
        const VALID_ROLES = new Set(['user', 'assistant', 'system']);
        const MAX_MESSAGE_LENGTH = 4000;
        const MAX_MESSAGES = 50;

        if (rawMessages !== undefined && !Array.isArray(rawMessages)) {
            return res.status(400).json({ error: 'messages must be an array' });
        }

        const messagesArr = Array.isArray(rawMessages) ? rawMessages : [];

        // Validate structure of each message before filtering
        for (const msg of messagesArr) {
            if (!msg || typeof msg !== 'object') {
                return res.status(400).json({ error: 'Each message must be an object with role and content' });
            }
            if (typeof msg.role !== 'string' || !VALID_ROLES.has(msg.role)) {
                return res.status(400).json({ error: `Invalid message role: "${msg.role}". Must be one of: user, assistant, system` });
            }
            if (typeof msg.content !== 'string') {
                return res.status(400).json({ error: 'Message content must be a string' });
            }
            if (msg.content.length > MAX_MESSAGE_LENGTH) {
                return res.status(400).json({ error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.` });
            }
        }

        // Keep only user and assistant messages for the OpenAI call
        const userMessages = messagesArr
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role, content: m.content }));

        if (userMessages.length > MAX_MESSAGES) {
            return res.status(400).json({ error: `Too many messages. Maximum ${MAX_MESSAGES} allowed.` });
        }

        // Handle image if present (attach to the last user message or add as new)
        const { image } = req.body;
        if (image && !isValidImageUrl(image)) {
            return res.status(400).json({ error: 'Invalid image URL format' });
        }
        if (image) {
            // New multimodal message logic
            const lastMsg = userMessages[userMessages.length - 1];
            if (lastMsg && lastMsg.role === 'user') {
                // Remove [Image Uploaded] marker if present to avoid duplication in text
                const textContent = lastMsg.content.replace(' [Image Uploaded]', '');
                lastMsg.content = [
                    { type: "text", text: textContent },
                    { type: "image_url", image_url: { url: image } }
                ];
            } else {
                // Fallback if no user message found (shouldn't happen with current frontend logic)
                userMessages.push({
                    role: 'user',
                    content: [
                        { type: "image_url", image_url: { url: image } }
                    ]
                });
            }
        }

        const language = lang === 'en' ? 'en' : 'nl';
        const intro = name ? { role: 'user', content: `Mijn naam is ${name}. Spreek me persoonlijk aan.` } : null;

        const chatMessages = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'system', content: LANGUAGE_INSTRUCTIONS[language] },
            ...(intro ? [intro] : []),
            ...userMessages
        ];

        // OpenAI Call
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: chatMessages,
            }),
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`OpenAI error: ${resp.status} ${text}`);
        }

        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content ?? '';
        res.json({ message: content });

    } catch (e) {
        logger.error('Chat error', e);
        res.status(500).json({ message: `Chat error: ${e.message}` });
    }
});


// Sentry error handler — must be after all routes and before other error handlers
Sentry.setupExpressErrorHandler(app);

// Catch-all for SPA handling (only in non-serverless mode)
if (!process.env.VERCEL) {
    app.use((req, res) => {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    });

    app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`);
    });
}

// Export for Vercel serverless functions
export default app;
