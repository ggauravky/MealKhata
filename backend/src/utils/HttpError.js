export class HttpError extends Error {
  constructor(statusCode, message, options) {
    super(message, options);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.expose = true;
  }
}
