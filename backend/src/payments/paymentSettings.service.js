import { HttpError } from '../utils/HttpError.js';
import {
  MAX_RECEIVER_NAME_LENGTH,
  MAX_UPI_ID_LENGTH,
  PAYMENT_SETTINGS_KEY,
} from './payment.constants.js';
import { paymentSettingsRepository } from './paymentSettings.repository.js';
import { serializePaymentSettings } from './paymentSettings.serializer.js';

const MAX_RETRIES = 12;
function containsControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || code === 127;
  });
}

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

export function normalizeReceiverName(value) {
  if (typeof value !== 'string' || containsControlCharacter(value)) {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized && normalized.length <= MAX_RECEIVER_NAME_LENGTH
    ? normalized
    : null;
}

export function normalizeUpiId(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  const parts = normalized.split('@');
  return normalized.length <= MAX_UPI_ID_LENGTH &&
    parts.length === 2 &&
    parts.every(Boolean) &&
    !/\s/u.test(normalized) &&
    !containsControlCharacter(normalized)
    ? normalized
    : undefined;
}

export function normalizeReceiverMobile(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  let normalized = String(value).trim().replace(/[\s()-]/g, '');
  if (normalized.startsWith('+91')) normalized = normalized.slice(3);
  else if (normalized.startsWith('91') && normalized.length === 12) normalized = normalized.slice(2);
  else if (normalized.startsWith('0') && normalized.length === 11) normalized = normalized.slice(1);

  return /^[6-9]\d{9}$/.test(normalized) ? normalized : undefined;
}

function selectReceiver(source) {
  return {
    receiverName: source.receiverName,
    upiId: source.upiId ?? null,
    receiverMobile: source.receiverMobile ?? null,
  };
}

function sameReceiver(left, right) {
  return left.receiverName === right.receiverName &&
    (left.upiId ?? null) === (right.upiId ?? null) &&
    (left.receiverMobile ?? null) === (right.receiverMobile ?? null);
}

export function createPaymentSettingsService({ repository = paymentSettingsRepository } = {}) {
  return Object.freeze({
    async getSettings() {
      try {
        return serializePaymentSettings(await repository.findPrimary());
      } catch (error) {
        throw new HttpError(503, 'Payment receiver settings are temporarily unavailable.', { cause: error });
      }
    },

    async updateSettings({ receiverName, upiId, receiverMobile, actorRole, changedAt = new Date() }) {
      const receiver = { receiverName, upiId, receiverMobile };

      try {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
          const current = await repository.findPrimary();

          if (current && sameReceiver(current, receiver)) {
            return { changed: false, data: serializePaymentSettings(current) };
          }

          const change = {
            changedAt,
            actorRole,
            from: current ? selectReceiver(current) : null,
            to: receiver,
          };

          if (!current) {
            try {
              const created = await repository.create({
                key: PAYMENT_SETTINGS_KEY,
                ...receiver,
                revision: 1,
                changes: [change],
              });
              return { changed: true, data: serializePaymentSettings(created) };
            } catch (error) {
              if (isDuplicateKeyError(error)) continue;
              throw error;
            }
          }

          const updated = await repository.updateIfCurrent({ current, receiver, change });
          if (updated) {
            return { changed: true, data: serializePaymentSettings(updated) };
          }
        }

        throw new Error('Concurrent payment settings updates did not settle');
      } catch (error) {
        throw new HttpError(503, 'Unable to save payment receiver settings. Please try again.', { cause: error });
      }
    },
  });
}

export const paymentSettingsService = createPaymentSettingsService();
