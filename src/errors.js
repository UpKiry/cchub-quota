export class AppError extends Error {
  constructor(message, { exitCode = 1, cause, status, responseBody } = {}) {
    super(message, { cause });
    this.name = "AppError";
    this.exitCode = exitCode;
    this.status = status;
    this.responseBody = responseBody;
  }
}

export function asErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
