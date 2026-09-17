export class DatabaseOperationError extends Error {
  constructor(operation: string, path: string, cause: unknown) {
    super(`${operation} ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'DatabaseOperationError';
    this.cause = cause;
  }
}

export function logDatabaseError(operation: string, path: string, cause: unknown) {
  console.error(`[Relay Firebase] ${operation} ${path} failed`, cause);
  return new DatabaseOperationError(operation, path, cause);
}
