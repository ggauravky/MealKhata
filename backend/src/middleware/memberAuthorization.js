import { ROLES } from '../auth/permissions.js';

export function authorizeMemberResource({ source = 'body', field = 'memberId' } = {}) {
  return function checkMemberResourcePermission(req, res, next) {
    if (!req.auth?.authenticated) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const targetMemberId = req[source]?.[field];

    if (req.auth.role === ROLES.MEMBER) {
      if (targetMemberId !== req.auth.memberId) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to perform this action for another member.',
        });
      }
    }

    return next();
  };
}
