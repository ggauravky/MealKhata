function serializeDate(value) {
  return value ? new Date(value).toISOString() : null;
}

export function serializeMonthlyRate(document, month) {
  if (!document) {
    return {
      month,
      configured: false,
      morningPricePaise: null,
      nightPricePaise: null,
      revision: 0,
      updatedAt: null,
    };
  }

  return {
    month,
    configured: true,
    morningPricePaise: document.morningPricePaise,
    nightPricePaise: document.nightPricePaise,
    revision: document.revision,
    updatedAt: serializeDate(document.updatedAt),
  };
}

