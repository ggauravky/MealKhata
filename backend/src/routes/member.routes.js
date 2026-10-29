import { Router } from 'express';
import { requireAdminOrAbove, requireSuperAdmin } from '../middleware/authorize.js';
import { memberService } from '../members/member.service.js';
import { memberAccountService } from '../members/memberAccount.service.js';

export function createMemberRouter({
  service = memberService,
  accountService = memberAccountService,
} = {}) {
  const router = Router();

  router.get('/', requireAdminOrAbove, async (_req, res, next) => {
    try {
      const members = await service.listMembers();
      return res.json({ success: true, data: members });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/legacy-conflicts', requireSuperAdmin, async (_req, res, next) => {
    try {
      const conflicts = await accountService.auditLegacyConflicts();
      return res.json({ success: true, data: conflicts });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:memberId', requireAdminOrAbove, async (req, res, next) => {
    try {
      const member = await service.findMemberById(req.params.memberId);
      if (!member) {
        return res.status(404).json({ success: false, message: 'Member not found.' });
      }
      return res.json({ success: true, data: member });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:memberId/provision', requireSuperAdmin, async (req, res, next) => {
    try {
      const account = await accountService.provisionAccount({
        memberId: req.params.memberId,
        email: req.body?.email,
        newPassword: req.body?.newPassword,
        currentPassword: req.body?.currentPassword,
        actor: req.auth,
      });
      return res.status(201).json({ success: true, data: account });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:memberId/email', requireSuperAdmin, async (req, res, next) => {
    try {
      const account = await accountService.changeEmail({
        memberId: req.params.memberId,
        email: req.body?.email,
        currentPassword: req.body?.currentPassword,
        actor: req.auth,
      });
      return res.json({ success: true, data: account });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:memberId/reset-password', requireSuperAdmin, async (req, res, next) => {
    try {
      const account = await accountService.resetPassword({
        memberId: req.params.memberId,
        newPassword: req.body?.newPassword,
        currentPassword: req.body?.currentPassword,
        actor: req.auth,
      });
      return res.json({ success: true, data: account });
    } catch (error) {
      return next(error);
    }
  });

  for (const [path, active] of [['activate', true], ['deactivate', false]]) {
    router.post(`/:memberId/${path}`, requireSuperAdmin, async (req, res, next) => {
      try {
        const account = await accountService.setAccountActive({
          memberId: req.params.memberId,
          active,
          currentPassword: req.body?.currentPassword,
          actor: req.auth,
        });
        return res.json({ success: true, data: account });
      } catch (error) {
        return next(error);
      }
    });
  }

  return router;
}

export const memberRouter = createMemberRouter();
