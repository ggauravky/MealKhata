import { api } from './api.js';
import { urlBase64ToUint8Array } from '../pwa/pushHelpers.js';

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getExistingPushSubscription() {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function subscribeDeviceToPush(vapidPublicKey) {
  if (!isPushSupported()) {
    throw new Error('Push messaging is not supported in this browser.');
  }

  const registration = await navigator.serviceWorker.ready;
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
}

export async function unsubscribeDeviceFromPush() {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      return await subscription.unsubscribe();
    }
    return false;
  } catch {
    return false;
  }
}

export async function fetchVapidPublicKey() {
  const response = await api.get('/api/push/public-key');
  return response.data?.publicKey || null;
}

export async function fetchPushStatus(endpoint) {
  const response = await api.post('/api/push/subscriptions/status', { endpoint });
  return response.data;
}

export async function registerPushOnServer(subscription, preferences = { morning: true, night: true }) {
  const response = await api.post('/api/push/subscriptions', {
    subscription: subscription.toJSON ? subscription.toJSON() : subscription,
    preferences,
  });
  return response.data;
}

export async function updatePushPreferencesOnServer(endpoint, preferences) {
  const response = await api.patch('/api/push/subscriptions/preferences', {
    endpoint,
    preferences,
  });
  return response.data;
}

export async function deletePushFromServer(endpoint) {
  const response = await api.delete('/api/push/subscriptions', {
    endpoint,
  });
  return response.data;
}
