export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, options = {}) {
  const hasBody = options.body !== undefined;
  const isFormData = options.body instanceof FormData;

  try {
    const response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(hasBody && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : null;

    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('mk:auth-expired'));
      }
      throw new ApiError(payload?.message || 'The request could not be completed.', response.status);
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError('Unable to reach the server. Check your connection and try again.');
  }
}

export const api = {
  get(path, options) {
    return request(path, { ...options, method: 'GET' });
  },
  post(path, body, options) {
    return request(path, {
      ...options,
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
  },
  patch(path, body, options) {
    return request(path, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },
  put(path, body, options) {
    return request(path, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
};
