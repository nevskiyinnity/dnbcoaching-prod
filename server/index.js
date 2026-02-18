import * as Sentry from '@sentry/node';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { Resend } from 'resend';
import { Webhook } from 'svix';

// Initialize Sentry before anything else
Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://727264aa963af7acda22d6b709c49e78@o4510908954836992.ingest.de.sentry.io/4510908981051472",
  tracesSampleRate: 0.1,
  enableLogs: true,
  enabled: true,
});
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import {
    getAllUsers, addUser, updateUser, deleteUser,
    getUserByClerkId, upsertUserByClerkId, deleteUserByClerkId,
    getUserDataByClerkId, updateUserDataByClerkId,
    getSetting, updateSetting,
} from './db.js';
import { clerkAuth, checkAdminAuth, getClerkUserId } from './auth.js';
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

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — AI features will be unavailable');
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
    }
    next();
});

// Middleware
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:8080'],
}));

// Webhook route MUST be before express.json() to get raw body
app.post('/api/webhooks/clerk', express.raw({ type: 'application/json' }), async (req, res) => {
    const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
    if (!CLERK_WEBHOOK_SECRET) {
        logger.error('CLERK_WEBHOOK_SECRET is not set');
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    const svixId = req.headers['svix-id'];
    const svixTimestamp = req.headers['svix-timestamp'];
    const svixSignature = req.headers['svix-signature'];

    if (!svixId || !svixTimestamp || !svixSignature) {
        return res.status(400).json({ error: 'Missing svix headers' });
    }

    const wh = new Webhook(CLERK_WEBHOOK_SECRET);
    let evt;

    try {
        evt = wh.verify(req.body, {
            'svix-id': svixId,
            'svix-timestamp': svixTimestamp,
            'svix-signature': svixSignature,
        });
    } catch (err) {
        logger.error('Webhook verification failed', err);
        return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const eventType = evt.type;
    const data = evt.data;

    try {
        if (eventType === 'user.created' || eventType === 'user.updated') {
            const clerkId = data.id;
            const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || 'User';
            const email = data.email_addresses?.[0]?.email_address || null;
            const role = data.public_metadata?.role || 'user';

            await upsertUserByClerkId(clerkId, {
                id: clerkId,
                name,
                email,
                role,
                createdAt: new Date(data.created_at).toISOString(),
            });

            logger.info(`Clerk webhook: ${eventType} synced`, { clerkId, name, email });
        } else if (eventType === 'user.deleted') {
            const clerkId = data.id;
            await deleteUserByClerkId(clerkId);
            logger.info(`Clerk webhook: user.deleted`, { clerkId });
        }
    } catch (err) {
        logger.error('Webhook handler error', err);
        return res.status(500).json({ error: 'Webhook handler error' });
    }

    return res.status(200).json({ received: true });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../dist')));

// Attach Clerk auth to all subsequent routes
app.use(clerkAuth);

// --- Rate Limiting (Upstash Redis with in-memory fallback) ---

const upstashRedis = process.env.UPSTASH_REDIS_REST_URL
    ? new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL,
          token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : undefined;

const chatUpstashLimiter = upstashRedis
    ? new Ratelimit({
          redis: upstashRedis,
          limiter: Ratelimit.slidingWindow(20, '300 s'),
          analytics: true,
          prefix: 'dnb-coaching:chat-ratelimit',
      })
    : null;

const RATE_LIMIT_MAX_ENTRIES = 10000;

function createRateLimiter(windowMs, maxRequests) {
    const store = new Map();

    return function checkRateLimit(key) {
        const now = Date.now();
        for (const [k, entry] of store.entries()) {
            if (now - entry.windowStart > windowMs) store.delete(k);
        }
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

const inMemoryChatLimiter = createRateLimiter(5 * 60 * 1000, 20);

async function checkChatRateLimit(key) {
    if (!chatUpstashLimiter) return inMemoryChatLimiter(key);
    try {
        const { success } = await chatUpstashLimiter.limit(key);
        return !success;
    } catch {
        return inMemoryChatLimiter(key);
    }
}

// --- API Routes ---

// Health check (public)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// --- Admin Routes (protected by Clerk + admin role) ---

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
        const { name, email, role } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });

        const newUser = {
            id: crypto.randomUUID(),
            name: name.trim(),
            email: email || null,
            role: role || 'user',
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
        const { id, name, email, role } = req.body;
        if (!id) return res.status(400).json({ message: 'User ID is required' });

        const success = await updateUser(id, { name: name?.trim(), email, role });
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

// Escape HTML special characters to prevent XSS in email templates
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Contact Form (public)
app.post('/api/contact', async (req, res) => {
    const { name, email, message } = req.body;

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

// --- Chat API (requires Clerk auth) ---
import { SYSTEM_PROMPT } from '../config/constants.js';

app.get('/api/sync', async (req, res) => {
    const userId = getClerkUserId(req);
    if (!userId) return res.status(401).json({ message: 'Not authenticated' });

    const data = await getUserDataByClerkId(userId);
    res.json(data || {});
});

app.post('/api/sync', async (req, res) => {
    const userId = getClerkUserId(req);
    if (!userId) return res.status(401).json({ message: 'Not authenticated' });

    const { data } = req.body;
    if (!data) return res.status(400).json({ message: 'Data required' });

    const success = await updateUserDataByClerkId(userId, data);
    if (success) {
        res.json({ success: true });
    } else {
        res.status(500).json({ message: 'Failed to update data' });
    }
});

// Get current user info
app.get('/api/me', async (req, res) => {
    const userId = getClerkUserId(req);
    if (!userId) return res.status(401).json({ message: 'Not authenticated' });

    const user = await getUserByClerkId(userId);
    if (!user) return res.status(404).json({ message: 'User not found in database' });

    res.json({ user: { id: user.id, clerkId: user.clerkId, name: user.name, email: user.email, role: user.role } });
});

const LANGUAGE_INSTRUCTIONS = {
    nl: 'Spreek standaard Nederlands en schrijf in de toon van een coach. ECHTER: als de gebruiker in een andere taal (bijv. Engels) tegen je spreekt, antwoord dan in DIE taal.',
    en: 'Responde by default in English in a friendly coaching tone. HOWEVER: if the user speaks to you in another language (e.g. Dutch), respond in THAT language.',
};

app.post('/api/chat', async (req, res) => {
    if (!OPENAI_API_KEY) return res.status(500).json({ message: 'Missing OPENAI_API_KEY' });

    // Require Clerk authentication
    const userId = getClerkUserId(req);
    if (!userId) return res.status(401).json({ message: 'Not authenticated' });

    try {
        if (!req.body) {
            logger.error('[CRITICAL] req.body is undefined. Middleware failure?');
            return res.status(400).json({ message: 'Request body is missing' });
        }
        const { messages: rawMessages, name, lang } = req.body;

        if (await checkChatRateLimit(userId)) {
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

        const userMessages = messagesArr
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role, content: m.content }));

        if (userMessages.length > MAX_MESSAGES) {
            return res.status(400).json({ error: `Too many messages. Maximum ${MAX_MESSAGES} allowed.` });
        }

        // Handle image if present
        const { image } = req.body;
        if (image && !isValidImageUrl(image)) {
            return res.status(400).json({ error: 'Invalid image URL format' });
        }
        if (image) {
            const lastMsg = userMessages[userMessages.length - 1];
            if (lastMsg && lastMsg.role === 'user') {
                const textContent = lastMsg.content.replace(' [Image Uploaded]', '');
                lastMsg.content = [
                    { type: "text", text: textContent },
                    { type: "image_url", image_url: { url: image } }
                ];
            } else {
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
