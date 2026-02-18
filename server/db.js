import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

const prisma = new PrismaClient();

export { prisma };

// --- User CRUD ---

export async function getAllUsers() {
    return prisma.user.findMany();
}

export async function getUserByClerkId(clerkId) {
    if (!clerkId) return null;
    return prisma.user.findUnique({ where: { clerkId } });
}

export async function getUserById(id) {
    return prisma.user.findUnique({ where: { id } });
}

export async function upsertUserByClerkId(clerkId, data) {
    return prisma.user.upsert({
        where: { clerkId },
        update: {
            name: data.name,
            email: data.email,
            role: data.role,
        },
        create: {
            id: data.id || clerkId,
            clerkId,
            name: data.name,
            email: data.email || null,
            role: data.role || 'user',
            createdAt: data.createdAt || new Date().toISOString(),
            data: '{}',
        },
    });
}

export async function addUser(user) {
    await prisma.user.create({
        data: {
            id: user.id,
            clerkId: user.clerkId || null,
            name: user.name,
            email: user.email || null,
            role: user.role || 'user',
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

    if (updates.email !== undefined) {
        data.email = updates.email;
    }

    if (updates.role !== undefined) {
        data.role = updates.role;
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

export async function deleteUserByClerkId(clerkId) {
    try {
        await prisma.user.delete({ where: { clerkId } });
        return true;
    } catch (e) {
        if (e.code === 'P2025') return false;
        throw e;
    }
}

// --- User Data (sync) ---

export async function getUserDataByClerkId(clerkId) {
    const user = await getUserByClerkId(clerkId);
    if (!user || !user.data) return null;
    try {
        return JSON.parse(user.data);
    } catch {
        return {};
    }
}

export async function updateUserDataByClerkId(clerkId, data) {
    const user = await getUserByClerkId(clerkId);
    if (!user) return false;
    const str = JSON.stringify(data);
    try {
        await prisma.user.update({
            where: { clerkId },
            data: { data: str },
        });
        return true;
    } catch (e) {
        if (e.code === 'P2025') return false;
        throw e;
    }
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
