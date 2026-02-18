import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

const prisma = new PrismaClient();

export { prisma };

export async function getAllUsers() {
    return prisma.user.findMany();
}

export async function getUserByCode(code) {
    return prisma.user.findUnique({ where: { code } });
}

export async function addUser(user) {
    await prisma.user.create({
        data: {
            id: user.id,
            name: user.name,
            code: user.code,
            expiryDate: user.expiryDate || null,
            createdAt: user.createdAt,
            data: user.data || '{}',
        },
    });
}

export async function updateUser(id, updates) {
    const data = {};

    if (updates.name !== undefined) {
        data.name = updates.name;
    }

    if (updates.expiryDate !== undefined) {
        data.expiryDate = updates.expiryDate;
    }

    if (updates.data !== undefined) {
        data.data = typeof updates.data === 'string' ? updates.data : JSON.stringify(updates.data);
    }

    if (Object.keys(data).length === 0) return true;

    try {
        await prisma.user.update({ where: { id }, data });
        return true;
    } catch (e) {
        // P2025 = Record not found
        if (e.code === 'P2025') return false;
        throw e;
    }
}

export async function deleteUser(id) {
    try {
        await prisma.user.delete({ where: { id } });
        return true;
    } catch (e) {
        if (e.code === 'P2025') return false;
        throw e;
    }
}

export async function getUserData(code) {
    const user = await getUserByCode(code);
    if (!user || !user.data) return null;
    try {
        return JSON.parse(user.data);
    } catch {
        return {};
    }
}

export async function updateUserData(code, data) {
    const user = await getUserByCode(code);
    if (!user) return false;
    const str = JSON.stringify(data);
    try {
        await prisma.user.update({
            where: { code },
            data: { data: str },
        });
        return true;
    } catch (e) {
        if (e.code === 'P2025') return false;
        throw e;
    }
}

export async function isCodeValid(code) {
    const clean = (code || '').trim().toUpperCase();
    if (!clean) return { valid: false, reason: 'Invalid code' };

    const user = await getUserByCode(clean);
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
    for (let i = 0; i < 8; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// --- Settings for System-wide controls ---

export async function getSetting(key, defaultValue = null) {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row ? JSON.parse(row.value) : defaultValue;
}

export async function updateSetting(key, value) {
    const str = JSON.stringify(value);
    await prisma.setting.upsert({
        where: { key },
        update: { value: str },
        create: { key, value: str },
    });
    return true;
}
