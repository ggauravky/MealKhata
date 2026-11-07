/**
 * PDF download utilities for Phase 4: Lifetime Statement & Final Clearance
 */

function triggerBlobDownload(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
}

export async function downloadLifetimeStatementPdf(stayId, memberName = 'stay') {
  if (!navigator.onLine) {
    throw new Error('You are offline. Connect to the internet to download lifetime statements.');
  }

  const endpoint = `/api/stays/${stayId}/lifetime-statement.pdf`;
  const response = await fetch(endpoint, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/pdf',
    },
  });

  if (!response.ok) {
    let errorMessage = 'Failed to download lifetime statement.';
    try {
      const errJson = await response.json();
      if (errJson && errJson.message) errorMessage = errJson.message;
    } catch {
      // not json
    }
    throw new Error(errorMessage);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/pdf')) {
    throw new Error('Server returned an unexpected document format.');
  }

  const blob = await response.blob();
  const defaultFilename = `MealKhata-Lifetime-Statement-${memberName}-${stayId.slice(0, 8)}.pdf`;
  triggerBlobDownload(blob, defaultFilename);
}

export async function downloadClearancePdf(stayId, clearanceId, memberName = 'resident') {
  if (!navigator.onLine) {
    throw new Error('You are offline. Connect to the internet to download clearance certificates.');
  }

  const endpoint = `/api/stays/${stayId}/clearances/${clearanceId}.pdf`;
  const response = await fetch(endpoint, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/pdf',
    },
  });

  if (!response.ok) {
    let errorMessage = 'Failed to download clearance statement.';
    try {
      const errJson = await response.json();
      if (errJson && errJson.message) errorMessage = errJson.message;
    } catch {
      // not json
    }
    throw new Error(errorMessage);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/pdf')) {
    throw new Error('Server returned an unexpected document format.');
  }

  const blob = await response.blob();
  const defaultFilename = `MealKhata-Clearance-${memberName}-${clearanceId.slice(0, 8)}.pdf`;
  triggerBlobDownload(blob, defaultFilename);
}
