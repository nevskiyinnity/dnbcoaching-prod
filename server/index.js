import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { Resend } from 'resend';
import { getAllUsers, addUser, updateUser, deleteUser, generateCode, isCodeValid, getSetting, updateSetting } from './db.js';
import { hashPassword, verifyPassword, signToken, checkAdminAuth } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const RESEND_API_KEY = process.env.VITE_RESEND_API_KEY;

// Middleware
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:8080'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../dist')));

// --- API Routes ---

// Admin Login — returns JWT
app.post('/api/admin/login', async (req, res) => {
    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ success: false, message: 'Password required' });
    }

    try {
        // If no hash is configured, hash-compare against the plaintext env var as fallback
        const storedHash = ADMIN_PASSWORD_HASH || await hashPassword(process.env.ADMIN_PASSWORD || '');
        const valid = await verifyPassword(password, storedHash);

        if (!valid) {
            return res.status(401).json({ success: false, message: 'Invalid password' });
        }

        const token = signToken({ role: 'admin' });
        return res.status(200).json({ success: true, token });
    } catch {
        return res.status(500).json({ success: false, message: 'Authentication error' });
    }
});

// Admin Users CRUD
app.get('/api/admin/users', checkAdminAuth, (req, res) => {
    try {
        const users = getAllUsers();
        res.json({ users });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.post('/api/admin/users', checkAdminAuth, (req, res) => {
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

        addUser(newUser);
        res.status(201).json({ user: newUser });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.put('/api/admin/users', checkAdminAuth, (req, res) => {
    try {
        const { id, name, expiryDate } = req.body;
        if (!id) return res.status(400).json({ message: 'User ID is required' });

        const success = updateUser(id, { name: name?.trim(), expiryDate });
        if (!success) return res.status(404).json({ message: 'User not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.delete('/api/admin/users', checkAdminAuth, (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ message: 'User ID is required' });

        const success = deleteUser(id);
        if (!success) return res.status(404).json({ message: 'User not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.post('/api/admin/users/reset', checkAdminAuth, (req, res) => {
    try {
        updateSetting('min_auth_ts', Date.now());
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
        console.error('VITE_RESEND_API_KEY is not set');
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
            console.error('Resend error:', error);
            return res.status(500).json({ message: 'Error sending email', error });
        }

        res.json({ message: 'Message sent successfully!', data });
    } catch (e) {
        console.error('Contact error:', e);
        res.status(500).json({ message: 'An unexpected error occurred.' });
    }
});

// Chat API
import { SYSTEM_PROMPT } from '../config/constants.js';

// --- Sync API ---
import { getUserData, updateUserData } from './db.js';

app.get('/api/sync', (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).json({ message: 'Code required' });

    // Simple validation (same as chat)
    const validation = isCodeValid(code);
    if (!validation.valid) return res.status(401).json({ message: validation.reason });

    const data = getUserData(code);
    // Inject system settings
    if (data) {
        data.__sys = {
            minAuth: getSetting('min_auth_ts', 0)
        };
    }
    res.json(data || {});
});

app.post('/api/sync', (req, res) => {
    const { code, data } = req.body;
    if (!code || !data) return res.status(400).json({ message: 'Code and data required' });

    const validation = isCodeValid(code);
    if (!validation.valid) return res.status(401).json({ message: validation.reason });

    const success = updateUserData(code, data);
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
            console.error('[CRITICAL] req.body is undefined. Middleware failure?');
            return res.status(400).json({ message: 'Request body is missing' });
        }
        const { messages: rawMessages, code, name, lang, validateOnly } = req.body;

        // Validation
        const codestr = (code || '').trim();
        if (validateOnly) {
            const v = isCodeValid(codestr);
            if (!v.valid) return res.status(401).json({ valid: false, message: v.reason || 'Invalid code' });
            return res.status(200).json({ valid: true, userName: v.user?.name });
        }

        if (!codestr) return res.status(401).json({ message: 'Access code required' });
        const validation = isCodeValid(codestr);
        if (!validation.valid) return res.status(401).json({ message: validation.reason });

        // Format Messages
        const userMessages = Array.isArray(rawMessages)
            ? rawMessages.filter(m => m && (m.role === 'user' || m.role === 'assistant')).map(m => ({ role: m.role, content: m.content }))
            : [];

        // Handle image if present (attach to the last user message or add as new)
        const { image } = req.body;
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
        console.error('Chat error:', e);
        res.status(500).json({ message: `Chat error: ${e.message}` });
    }
});


// Catch-all for SPA handling
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
