/**
 * PDF statement download utilities for Phase 3
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

export async function downloadMemberStatementPdf(month, memberId = null) {
  if (!navigator.onLine) {
    throw new Error('You are offline. Connect to the internet to download monthly statements.');
  }

  const endpoint = memberId
    ? `/api/finance/monthly/${month}/members/${memberId}/statement.pdf`
    : `/api/finance/monthly/${month}/my-statement.pdf`;

  const response = await fetch(endpoint, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/pdf',
    },
  });

  if (!response.ok) {
    let errorMessage = 'Failed to download statement.';
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
  const defaultFilename = `MealKhata-Personal-Statement-${memberId || 'my'}-${month}.pdf`;
  triggerBlobDownload(blob, defaultFilename);
}

export async function downloadHouseholdStatementPdf(month) {
  if (!navigator.onLine) {
    throw new Error('You are offline. Connect to the internet to download monthly statements.');
  }

  const response = await fetch(`/api/finance/monthly/${month}/household-statement.pdf`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/pdf',
    },
  });

  if (!response.ok) {
    let errorMessage = 'Failed to download household statement.';
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
  const filename = `MealKhata-Household-Statement-${month}.pdf`;
  triggerBlobDownload(blob, filename);
}
