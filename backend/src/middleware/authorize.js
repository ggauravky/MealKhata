import { ROLES, roleMeetsRequirement } from '../auth/permissions.js';

function reject(res, status, message) {
  return res.status(status).json({
    success: false,
    message,
  });
}

export function requireAuthenticated(req, res, next) {
  if (!req.auth?.authenticated) {
    return reject(res, 401, 'Authentication required.');
  }

  return next();
}

export function requireRole(requiredRole) {
  return function authorizeRole(req, res, next) {
    if (!req.auth?.authenticated) {
      return reject(res, 401, 'Authentication required.');
    }

    if (!roleMeetsRequirement(req.auth.role, requiredRole)) {
      return reject(res, 403, 'You do not have permission to perform this action.');
    }

    return next();
  };
}

export const requireAdminOrAbove = requireRole(ROLES.ADMIN);
export const requireSuperAdmin = requireRole(ROLES.SUPERADMIN);
