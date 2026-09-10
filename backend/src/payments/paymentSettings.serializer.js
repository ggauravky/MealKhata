function serializeDate(value) {
  return value ? new Date(value).toISOString() : null;
}

export function serializePaymentSettings(document) {
  if (!document) {
    return {
      configured: false,
      receiverName: null,
      upiId: null,
      receiverMobile: null,
      revision: 0,
      updatedAt: null,
    };
  }

  return {
    configured: true,
    receiverName: document.receiverName,
    upiId: document.upiId ?? null,
    receiverMobile: document.receiverMobile ?? null,
    revision: document.revision,
    updatedAt: serializeDate(document.updatedAt),
  };
}
