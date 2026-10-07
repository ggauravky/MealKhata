export async function downloadMonthlyReport(month) {
  if (!navigator.onLine) {
    throw new Error('Connect to the internet to download this report.');
  }

  const endpoint = `/api/reports/monthly/${encodeURIComponent(month)}/report.pdf`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/pdf, application/json',
    },
    credentials: 'same-origin',
  });

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok || !contentType.includes('application/pdf')) {
    let serverMessage = 'Unable to generate monthly report.';
    try {
      const errorJson = await response.json();
      if (errorJson?.message) {
        serverMessage = errorJson.message;
      }
    } catch {
      // Non-JSON error body
      if (response.status === 401) {
        serverMessage = 'Please sign in to download monthly reports.';
      } else if (response.status === 403) {
        serverMessage = 'You do not have permission to download this report.';
      }
    }
    throw new Error(serverMessage);
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get('content-disposition') || '';
  const match = contentDisposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `MealKhata-Monthly-Report-${month}.pdf`;

  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Revoke object URL asynchronously after download trigger
  setTimeout(() => {
    window.URL.revokeObjectURL(blobUrl);
  }, 1000);

  return { filename, size: blob.size };
}
