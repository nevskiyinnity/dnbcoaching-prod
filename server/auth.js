import { clerkMiddleware, getAuth } from '@clerk/express';

// Clerk Express middleware — attach Clerk auth to all requests
export const clerkAuth = clerkMiddleware();

// Middleware to protect admin routes — requires an authenticated Clerk session
// with the "admin" role stored in publicMetadata
export function checkAdminAuth(req, res, next) {
    const auth = getAuth(req);

    if (!auth || !auth.userId) {
        return res.status(401).json({ message: 'Unauthorized — not signed in' });
    }

    // For admin routes, we check sessionClaims for role
    // Clerk publicMetadata.role === 'admin' is mapped into sessionClaims via Clerk Dashboard
    const role = auth.sessionClaims?.metadata?.role || auth.sessionClaims?.publicMetadata?.role;
    if (role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden — admin access required' });
    }

    req.admin = { userId: auth.userId, role: 'admin' };
    next();
}

// Helper to extract the authenticated Clerk userId from a request
export function getClerkUserId(req) {
    const auth = getAuth(req);
    return auth?.userId || null;
}
