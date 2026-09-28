export type CommandError = { code: string; message: string };

export type CommandResult<T> = { ok: true; data: T } | { ok: false; error: CommandError };

export function ok<T>(data: T): CommandResult<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): CommandResult<never> {
  return { ok: false, error: { code, message } };
}
