import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET environment variable is required');
    }
    return secret;
}
const JWT_EXPIRES_IN = '24h';

export async function hashPassword(password) {
    return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}

export function signToken(payload) {
    return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
    return jwt.verify(token, getJwtSecret());
}

export function checkAdminAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const token = authHeader.slice(7);
    try {
        const decoded = verifyToken(token);
        req.admin = decoded;
        next();
    } catch {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
}
