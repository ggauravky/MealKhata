import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ROLES } from '../src/auth/permissions.js';
import { createSessionToken, SESSION_COOKIE_NAME } from '../src/auth/token.service.js';
import { createPushRouter } from '../src/routes/push.routes.js';
import { createPushSubscriptionService } from '../src/push/pushSubscription.service.js';
import {
  createReminderDispatchService,
  getLogicalTimeInTimeZone,
  isReminderDue,
} from '../src/push/reminderDispatch.service.js';
import { InMemoryPushSubscriptionRepository } from './helpers/inMemoryPushSubscriptionRepository.js';
import { InMemoryPushDeliveryRepository } from './helpers/inMemoryPushDeliveryRepository.js';

const ORIGIN = 'http://localhost:5173';

const VALID_SUBSCRIPTION = {
  endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test-endpoint-token-1234567890',
  expirationTime: null,
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9bP0...',
    auth: 'tBHItJI5svbpstqHCxY7Pw==',
  },
};

const VALID_SUBSCRIPTION_2 = {
  endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test-endpoint-token-0987654321',
  expirationTime: null,
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9bP0...',
    auth: 'tBHItJI5svbpstqHCxY7Pw==',
  },
};

async function cookieFor(role, memberId = null) {
  const token = await createSessionToken(role, { memberId });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe('Phase 9: Background Web Push Notifications & Smart Meal Reminders', () => {
  let subRepo;
  let deliveryRepo;
  let pushService;
  let pushRouter;
  let app;

  beforeEach(() => {
    subRepo = new InMemoryPushSubscriptionRepository();
    deliveryRepo = new InMemoryPushDeliveryRepository();
    pushService = createPushSubscriptionService({ repository: subRepo });
    pushRouter = createPushRouter({ service: pushService });
    app = createApp({ push: pushRouter });
  });

  describe('VAPID Public Key Endpoint', () => {
    test('GET /api/push/public-key returns 200 with publicKey only', async () => {
      const res = await request(app)
        .get('/api/push/public-key')
        .expect(200);

      assert.equal(res.body.success, true);
      assert.ok(typeof res.body.publicKey === 'string' && res.body.publicKey.length > 20);
      assert.equal(res.body.privateKey, undefined);
      assert.equal(res.body.vapidPrivateKey, undefined);
      assert.equal(res.body.subject, undefined);
    });
  });

  describe('Push Registration Authorization', () => {
    test('Viewer (unauthenticated) cannot register push subscription', async () => {
      const res = await request(app)
        .post('/api/push/subscriptions')
        .set('Origin', ORIGIN)
        .send({ subscription: VALID_SUBSCRIPTION })
        .expect(401);

      assert.equal(res.body.success, false);
    });

    test('Admin cannot register personal member push subscription', async () => {
      const adminCookie = await cookieFor(ROLES.ADMIN);
      const res = await request(app)
        .post('/api/push/subscriptions')
        .set('Origin', ORIGIN)
        .set('Cookie', adminCookie)
        .send({ subscription: VALID_SUBSCRIPTION })
        .expect(403);

      assert.equal(res.body.success, false);
      assert.match(res.body.message, /household members/i);
    });

    test('Super Admin cannot register personal member push subscription', async () => {
      const saCookie = await cookieFor(ROLES.SUPERADMIN);
      const res = await request(app)
        .post('/api/push/subscriptions')
        .set('Origin', ORIGIN)
        .set('Cookie', saCookie)
        .send({ subscription: VALID_SUBSCRIPTION })
        .expect(403);

      assert.equal(res.body.success, false);
    });

    test('Member can register own browser subscription', async () => {
      const gauravCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      const res = await request(app)
        .post('/api/push/subscriptions')
        .set('Origin', ORIGIN)
        .set('Cookie', gauravCookie)
        .send({
          subscription: VALID_SUBSCRIPTION,
          preferences: { morning: true, night: true },
        })
        .expect(201);

      assert.equal(res.body.success, true);
      assert.equal(res.body.registered, true);
      assert.deepEqual(res.body.preferences, { morning: true, night: true });
      assert.equal(res.body.keys, undefined);
      assert.equal(res.body.endpoint, undefined);

      // Verify server record is strictly bound to gaurav
      const stored = await subRepo.findByEndpoint(VALID_SUBSCRIPTION.endpoint);
      assert.ok(stored);
      assert.equal(stored.memberId, 'gaurav');
      assert.equal(stored.active, true);
    });

    test('Member ID cannot be spoofed in request body', async () => {
      const gauravCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      // Body maliciously claims to register for nikhil
      await request(app)
        .post('/api/push/subscriptions')
        .set('Origin', ORIGIN)
        .set('Cookie', gauravCookie)
        .send({
          memberId: 'nikhil',
          subscription: VALID_SUBSCRIPTION,
        })
        .expect(201);

      // Server must ignore body memberId and use authenticated req.auth.memberId ('gaurav')
      const stored = await subRepo.findByEndpoint(VALID_SUBSCRIPTION.endpoint);
      assert.equal(stored.memberId, 'gaurav');
    });
  });

  describe('Push Subscription Input Validation', () => {
    test('rejects missing or non-object subscription', async () => {
      const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      await request(app)
        .post('/api/push/subscriptions')
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send({})
        .expect(400);
    });

    test('rejects invalid or non-HTTPS endpoint', async () => {
      const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      await request(app)
        .post('/api/push/subscriptions')
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send({
          subscription: {
            endpoint: 'ftp://insecure.endpoint.example/push',
            keys: VALID_SUBSCRIPTION.keys,
          },
        })
        .expect(400);
    });

    test('rejects missing or malformed keys (p256dh, auth)', async () => {
      const cookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      await request(app)
        .post('/api/push/subscriptions')
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send({
          subscription: {
            endpoint: VALID_SUBSCRIPTION.endpoint,
            keys: { p256dh: 'short' }, // missing auth, p256dh too short
          },
        })
        .expect(400);
    });
  });

  describe('Account Switch Safety & Device Ownership', () => {
    test('status check returns registered for the owner member', async () => {
      await subRepo.upsertSubscription({
        memberId: 'gaurav',
        endpoint: VALID_SUBSCRIPTION.endpoint,
        keys: VALID_SUBSCRIPTION.keys,
        preferences: { morning: true, night: false },
      });

      const gauravCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      const res = await request(app)
        .post('/api/push/subscriptions/status')
        .set('Origin', ORIGIN)
        .set('Cookie', gauravCookie)
        .send({ endpoint: VALID_SUBSCRIPTION.endpoint })
        .expect(200);

      assert.equal(res.body.registered, true);
      assert.equal(res.body.belongsToAnotherAccount, false);
      assert.deepEqual(res.body.preferences, { morning: true, night: false });
    });

    test('status check by a different member returns neutral belongsToAnotherAccount without revealing owner identity', async () => {
      await subRepo.upsertSubscription({
        memberId: 'gaurav',
        endpoint: VALID_SUBSCRIPTION.endpoint,
        keys: VALID_SUBSCRIPTION.keys,
        preferences: { morning: true, night: true },
      });

      const nikhilCookie = await cookieFor(ROLES.MEMBER, 'nikhil');
      const res = await request(app)
        .post('/api/push/subscriptions/status')
        .set('Origin', ORIGIN)
        .set('Cookie', nikhilCookie)
        .send({ endpoint: VALID_SUBSCRIPTION.endpoint })
        .expect(200);

      assert.equal(res.body.registered, false);
      assert.equal(res.body.belongsToAnotherAccount, true);
      assert.equal(res.body.memberId, undefined);
      assert.equal(res.body.owner, undefined);
      assert.equal(res.body.preferences, null);
    });

    test('explicit registration by a new member reassigns the endpoint to the current member', async () => {
      await subRepo.upsertSubscription({
        memberId: 'gaurav',
        endpoint: VALID_SUBSCRIPTION.endpoint,
        keys: VALID_SUBSCRIPTION.keys,
      });

      const nikhilCookie = await cookieFor(ROLES.MEMBER, 'nikhil');
      await request(app)
        .post('/api/push/subscriptions')
        .set('Origin', ORIGIN)
        .set('Cookie', nikhilCookie)
        .send({
          subscription: VALID_SUBSCRIPTION,
          preferences: { morning: true, night: true },
        })
        .expect(201);

      const updated = await subRepo.findByEndpoint(VALID_SUBSCRIPTION.endpoint);
      assert.equal(updated.memberId, 'nikhil');
    });

    test('member can update device preferences (morning/night)', async () => {
      await subRepo.upsertSubscription({
        memberId: 'gaurav',
        endpoint: VALID_SUBSCRIPTION.endpoint,
        keys: VALID_SUBSCRIPTION.keys,
        preferences: { morning: true, night: true },
      });

      const gauravCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      const res = await request(app)
        .patch('/api/push/subscriptions/preferences')
        .set('Origin', ORIGIN)
        .set('Cookie', gauravCookie)
        .send({
          endpoint: VALID_SUBSCRIPTION.endpoint,
          preferences: { morning: false, night: true },
        })
        .expect(200);

      assert.equal(res.body.success, true);
      assert.deepEqual(res.body.preferences, { morning: false, night: true });
    });

    test('member cannot update another member subscription preferences', async () => {
      await subRepo.upsertSubscription({
        memberId: 'gaurav',
        endpoint: VALID_SUBSCRIPTION.endpoint,
        keys: VALID_SUBSCRIPTION.keys,
        preferences: { morning: true, night: true },
      });

      const nikhilCookie = await cookieFor(ROLES.MEMBER, 'nikhil');
      await request(app)
        .patch('/api/push/subscriptions/preferences')
        .set('Origin', ORIGIN)
        .set('Cookie', nikhilCookie)
        .send({
          endpoint: VALID_SUBSCRIPTION.endpoint,
          preferences: { morning: false, night: false },
        })
        .expect(404);
    });

    test('member can disable/remove own subscription', async () => {
      await subRepo.upsertSubscription({
        memberId: 'gaurav',
        endpoint: VALID_SUBSCRIPTION.endpoint,
        keys: VALID_SUBSCRIPTION.keys,
      });

      const gauravCookie = await cookieFor(ROLES.MEMBER, 'gaurav');
      const res = await request(app)
        .delete('/api/push/subscriptions')
        .set('Origin', ORIGIN)
        .set('Cookie', gauravCookie)
        .send({ endpoint: VALID_SUBSCRIPTION.endpoint })
        .expect(200);

      assert.equal(res.body.success, true);
      const remaining = await subRepo.findByEndpoint(VALID_SUBSCRIPTION.endpoint);
      assert.equal(remaining, null);
    });
  });

  describe('Reminder Dispatch Service & Smart Scheduling', () => {
    test('isReminderDue evaluates dispatch window correctly', () => {
      assert.equal(isReminderDue({ scheduledTime: '09:00', currentTime: '08:59' }), false);
      assert.equal(isReminderDue({ scheduledTime: '09:00', currentTime: '09:00' }), true);
      assert.equal(isReminderDue({ scheduledTime: '09:00', currentTime: '09:05' }), true);
      assert.equal(isReminderDue({ scheduledTime: '09:00', currentTime: '09:15' }), true);
      assert.equal(isReminderDue({ scheduledTime: '09:00', currentTime: '09:16' }), false);
    });

    test('getLogicalTimeInTimeZone formats Asia/Kolkata 24h time reliably', () => {
      // 03:30 UTC is 09:00 Asia/Kolkata
      const utcDate = new Date('2026-10-01T03:30:00.000Z');
      assert.equal(getLogicalTimeInTimeZone(utcDate, 'Asia/Kolkata'), '09:00');
    });

    test('dispatch does nothing if global reminder is disabled', async () => {
      const sentNotifications = [];
      const mockPush = {
        async sendNotification(sub, payload) {
          sentNotifications.push({ sub, payload });
        },
      };

      const mockSettings = {
        async getSettings() {
          return {
            reminders: {
              morning: { enabled: false, time: '09:00' },
              night: { enabled: true, time: '20:00' },
            },
          };
        },
      };

      const dispatchService = createReminderDispatchService({
        settingsService: mockSettings,
        subscriptions: subRepo,
        deliveries: deliveryRepo,
        push: mockPush,
      });

      const result = await dispatchService.dispatchReminders({
        now: new Date('2026-10-01T03:30:00.000Z'), // 09:00 Asia/Kolkata
      });

      assert.equal(result.attemptedCount, 0);
      assert.equal(result.sentCount, 0);
      assert.equal(sentNotifications.length, 0);
    });

    test('smart meal filter: skips member with status=skip, sends to member with taking or default taking', async () => {
      const sentNotifications = [];
      const mockPush = {
        async sendNotification(sub, payload) {
          sentNotifications.push({ sub, payload });
        },
      };

      const mockSettings = {
        async getSettings() {
          return {
            reminders: {
              morning: { enabled: true, time: '09:00' },
              night: { enabled: true, time: '20:00' },
            },
          };
        },
      };

      // Mock meal status: Gaurav = taking, Nikhil = skip, Devansh = taking
      const mockMeals = {
        async getDay() {
          return {
            meals: {
              morning: {
                gaurav: 'taking',
                nikhil: 'skip',
                devansh: 'taking',
              },
            },
          };
        },
      };

      // Register device for each member
      await subRepo.upsertSubscription({
        memberId: 'gaurav',
        endpoint: 'https://push.example.com/gaurav',
        keys: VALID_SUBSCRIPTION.keys,
        preferences: { morning: true, night: true },
      });
      await subRepo.upsertSubscription({
        memberId: 'nikhil',
        endpoint: 'https://push.example.com/nikhil',
        keys: VALID_SUBSCRIPTION.keys,
        preferences: { morning: true, night: true },
      });
      await subRepo.upsertSubscription({
        memberId: 'devansh',
        endpoint: 'https://push.example.com/devansh',
        keys: VALID_SUBSCRIPTION.keys,
        preferences: { morning: true, night: true },
      });

      const dispatchService = createReminderDispatchService({
        settingsService: mockSettings,
        meals: mockMeals,
        subscriptions: subRepo,
        deliveries: deliveryRepo,
        push: mockPush,
      });

      const result = await dispatchService.dispatchReminders({
        now: new Date('2026-10-01T03:30:00.000Z'), // 09:00 Asia/Kolkata
      });

      assert.equal(result.sentCount, 2);
      assert.equal(sentNotifications.length, 2);

      const sentMembers = sentNotifications.map((n) => n.sub.memberId);
      assert.ok(sentMembers.includes('gaurav'));
      assert.ok(sentMembers.includes('devansh'));
      assert.ok(!sentMembers.includes('nikhil'), 'Nikhil with Skip status must not receive reminder');
    });

    test('device preference filtering: suppresses push when morning preference is false', async () => {
      const sentNotifications = [];
      const mockPush = {
        async sendNotification(sub, payload) {
          sentNotifications.push({ sub, payload });
        },
      };

      const mockSettings = {
        async getSettings() {
          return {
            reminders: {
              morning: { enabled: true, time: '09:00' },
              night: { enabled: true, time: '20:00' },
            },
          };
        },
      };

      const mockMeals = {
        async getDay() {
          return {
            meals: {
              morning: { gaurav: 'taking' },
            },
          };
        },
      };

      // Device 1: Morning enabled
      await subRepo.upsertSubscription({
        memberId: 'gaurav',
        endpoint: 'https://push.example.com/gaurav-phone',
        keys: VALID_SUBSCRIPTION.keys,
        preferences: { morning: true, night: true },
      });

      // Device 2: Morning disabled
      await subRepo.upsertSubscription({
        memberId: 'gaurav',
        endpoint: 'https://push.example.com/gaurav-laptop',
        keys: VALID_SUBSCRIPTION_2.keys,
        preferences: { morning: false, night: true },
      });

      const dispatchService = createReminderDispatchService({
        settingsService: mockSettings,
        meals: mockMeals,
        subscriptions: subRepo,
        deliveries: deliveryRepo,
        push: mockPush,
      });

      const result = await dispatchService.dispatchReminders({
        now: new Date('2026-10-01T03:30:00.000Z'),
      });

      assert.equal(result.sentCount, 1);
      assert.equal(sentNotifications[0].sub.endpoint, 'https://push.example.com/gaurav-phone');
    });

    test('atomic deduplication: running dispatch twice in the same window produces no duplicate sends', async () => {
      const sentNotifications = [];
      const mockPush = {
        async sendNotification(sub, payload) {
          sentNotifications.push({ sub, payload });
        },
      };

      const mockSettings = {
        async getSettings() {
          return {
            reminders: {
              morning: { enabled: true, time: '09:00' },
            },
          };
        },
      };

      const mockMeals = {
        async getDay() {
          return {
            meals: { morning: { gaurav: 'taking' } },
          };
        },
      };

      await subRepo.upsertSubscription({
        memberId: 'gaurav',
        endpoint: VALID_SUBSCRIPTION.endpoint,
        keys: VALID_SUBSCRIPTION.keys,
        preferences: { morning: true, night: true },
      });

      const dispatchService = createReminderDispatchService({
        settingsService: mockSettings,
        meals: mockMeals,
        subscriptions: subRepo,
        deliveries: deliveryRepo,
        push: mockPush,
      });

      // First run at 09:00
      const firstRun = await dispatchService.dispatchReminders({
        now: new Date('2026-10-01T03:30:00.000Z'),
      });
      assert.equal(firstRun.sentCount, 1);
      assert.equal(sentNotifications.length, 1);

      // Second run 5 minutes later at 09:05 (still in due window)
      const secondRun = await dispatchService.dispatchReminders({
        now: new Date('2026-10-01T03:35:00.000Z'),
      });
      assert.equal(secondRun.sentCount, 0);
      assert.equal(sentNotifications.length, 1, 'No duplicate notification allowed');

      // Next day allowed
      const nextDayRun = await dispatchService.dispatchReminders({
        now: new Date('2026-10-02T03:30:00.000Z'),
      });
      assert.equal(nextDayRun.sentCount, 1);
      assert.equal(sentNotifications.length, 2);
    });

    test('expired subscription (410/404) deactivates subscription and does not halt execution', async () => {
      const mockPush = {
        async sendNotification() {
          const err = new Error('Subscription expired');
          err.statusCode = 410;
          err.isExpired = true;
          throw err;
        },
      };

      const mockSettings = {
        async getSettings() {
          return {
            reminders: { morning: { enabled: true, time: '09:00' } },
          };
        },
      };

      const mockMeals = {
        async getDay() {
          return {
            meals: { morning: { gaurav: 'taking' } },
          };
        },
      };

      await subRepo.upsertSubscription({
        memberId: 'gaurav',
        endpoint: VALID_SUBSCRIPTION.endpoint,
        keys: VALID_SUBSCRIPTION.keys,
        preferences: { morning: true, night: true },
      });

      const dispatchService = createReminderDispatchService({
        settingsService: mockSettings,
        meals: mockMeals,
        subscriptions: subRepo,
        deliveries: deliveryRepo,
        push: mockPush,
      });

      const result = await dispatchService.dispatchReminders({
        now: new Date('2026-10-01T03:30:00.000Z'),
      });

      assert.equal(result.expiredCount, 1);
      assert.equal(result.sentCount, 0);

      // Subscription should be deactivated
      const sub = await subRepo.findByEndpoint(VALID_SUBSCRIPTION.endpoint);
      assert.equal(sub.active, false);
    });
  });
});
