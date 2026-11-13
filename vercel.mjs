function exactOrigin(value, { secure = false } = {}) {
  try {
    const url = new URL(value);
    return url.origin === value && !url.username && !url.password
      && (secure ? url.protocol === 'https:' : ['https:', 'http:'].includes(url.protocol));
  } catch { return false; }
}

/** Vercel evaluates this configuration at build time; each deployment pins one backend origin. */
export function createVercelConfig(environment = process.env) {
  const stage = environment.VERCEL_ENV || 'development';
  if (!['development', 'preview', 'production'].includes(stage)) {
    throw new Error('Unknown Vercel deployment environment');
  }
  const backendOrigin = environment.MEALKHATA_BACKEND_ORIGIN
    || (stage === 'development' ? 'http://localhost:5000' : null);
  if (!backendOrigin) throw new Error('MEALKHATA_BACKEND_ORIGIN is required for deployed frontend builds');
  if (!exactOrigin(backendOrigin, { secure: stage !== 'development' })) {
    throw new Error('Backend must be an exact HTTPS origin without credentials');
  }
  if (stage === 'preview') {
    const productionOrigin = environment.MEALKHATA_PRODUCTION_BACKEND_ORIGIN;
    if (environment.MEALKHATA_BACKEND_ENV !== 'preview'
      || !exactOrigin(productionOrigin, { secure: true })) {
      throw new Error('Preview requires an independently configured production backend origin and preview backend identity');
    }
    if (backendOrigin === productionOrigin) {
      throw new Error('Preview backend must be distinct from production backend');
    }
  }
  if (stage === 'production' && environment.MEALKHATA_BACKEND_ENV !== 'production') {
    throw new Error('Production frontend requires production backend identity');
  }
  if (stage !== 'development' && environment.VITE_SOCKET_URL !== backendOrigin) {
    throw new Error('Deployed frontend requires its authenticated socket URL (VITE_SOCKET_URL) to equal its backend origin');
  }
  return {
    framework: 'vite', installCommand: 'npm ci',
    buildCommand: 'npm run build --workspace frontend', outputDirectory: 'frontend/dist',
    rewrites: [
      { source: '/api/:path*', destination: `${backendOrigin}/api/:path*` },
      { source: '/(.*)', destination: '/index.html' },
    ],
    headers: [
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] },
      { source: '/manifest.webmanifest', headers: [{ key: 'Content-Type',
        value: 'application/manifest+json; charset=utf-8' }] },
    ],
  };
}

export const config = createVercelConfig();
