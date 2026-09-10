import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

export const TEST_CREDENTIALS = Object.freeze({
  admin: Object.freeze({
    email: 'admin.test@mealkhata.local',
    password: randomBytes(24).toString('base64url'),
  }),
  superadmin: Object.freeze({
    email: 'superadmin.test@mealkhata.local',
    password: randomBytes(24).toString('base64url'),
  }),
});

process.env.NODE_ENV = 'test';
process.env.PORT = '5000';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/mealkhata-test-not-connected';
process.env.APP_TIMEZONE = 'Asia/Kolkata';
process.env.ADMIN_EMAIL = TEST_CREDENTIALS.admin.email;
process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(TEST_CREDENTIALS.admin.password, 12);
process.env.SUPERADMIN_EMAIL = TEST_CREDENTIALS.superadmin.email;
process.env.SUPERADMIN_PASSWORD_HASH = await bcrypt.hash(TEST_CREDENTIALS.superadmin.password, 12);
process.env.AUTH_JWT_SECRET = 'test-only-jwt-secret-with-at-least-forty-eight-characters';
process.env.APP_ORIGIN = 'http://localhost:5173';
