import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVercelConfig } from '../../vercel.mjs';

test('Vercel routing binds production and preview to separate approved API origins', () => {
  const development = createVercelConfig({ VERCEL_ENV: 'development' });
  assert.equal(development.rewrites[0].destination, 'http://localhost:5000/api/:path*');
  const production = createVercelConfig({ VERCEL_ENV: 'production',
    MEALKHATA_BACKEND_ORIGIN: 'https://api.example.test',
    MEALKHATA_BACKEND_ENV: 'production', VITE_RUNTIME_PROFILE: 'v3',
    VITE_SOCKET_URL: 'https://api.example.test' });
  assert.equal(production.rewrites[0].destination, 'https://api.example.test/api/:path*');
  const preview = createVercelConfig({ VERCEL_ENV: 'preview',
    MEALKHATA_BACKEND_ORIGIN: 'https://preview-api.example.test',
    MEALKHATA_PRODUCTION_BACKEND_ORIGIN: 'https://api.example.test',
    MEALKHATA_BACKEND_ENV: 'preview', VITE_RUNTIME_PROFILE: 'v3',
    VITE_SOCKET_URL: 'https://preview-api.example.test' });
  assert.equal(preview.rewrites[0].destination, 'https://preview-api.example.test/api/:path*');
  assert.throws(() => createVercelConfig({ VERCEL_ENV: 'preview',
    MEALKHATA_BACKEND_ORIGIN: 'https://api.example.test',
    MEALKHATA_PRODUCTION_BACKEND_ORIGIN: 'https://api.example.test',
    MEALKHATA_BACKEND_ENV: 'preview', VITE_RUNTIME_PROFILE: 'v3',
    VITE_SOCKET_URL: 'https://api.example.test' }), /distinct/);
  assert.throws(() => createVercelConfig({ VERCEL_ENV: 'production' }), /required/);
  assert.throws(() => createVercelConfig({ VERCEL_ENV: 'preview' }),
    /MEALKHATA_BACKEND_ORIGIN is required/);
  assert.throws(() => createVercelConfig({ VERCEL_ENV: 'preview',
    MEALKHATA_BACKEND_ORIGIN: 'https://preview-api.example.test',
    MEALKHATA_BACKEND_ENV: 'production', VITE_RUNTIME_PROFILE: 'v3',
    VITE_SOCKET_URL: 'https://preview-api.example.test' }), /preview/);
  assert.throws(() => createVercelConfig({ VERCEL_ENV: 'preview',
    MEALKHATA_BACKEND_ORIGIN: 'https://preview-api.example.test',
    MEALKHATA_PRODUCTION_BACKEND_ORIGIN: 'https://api.example.test',
    MEALKHATA_BACKEND_ENV: 'preview', VITE_RUNTIME_PROFILE: 'v3',
    VITE_SOCKET_URL: 'https://api.example.test' }), /socket/);
});
