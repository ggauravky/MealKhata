export function apiNotFound(req, res) {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
  });
}

export function notFound(req, res) {
  res.status(404).json({
    success: false,
    message: 'Resource not found',
  });
}
