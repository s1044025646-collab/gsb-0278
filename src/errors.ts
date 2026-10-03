export type ErrorCode =
  | "INVALID_TEXT"
  | "TEXT_TOO_LONG"
  | "NOT_FOUND"
  | "INDEX_NOT_BUILT"
  | "BAD_PARAM"
  | "FRAGMENT_TOO_LONG"
  | "INTERNAL";

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function toErrorBody(err: unknown): { status: number; body: object } {
  if (err instanceof ApiError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { error: { code: "INTERNAL", message } } };
}
