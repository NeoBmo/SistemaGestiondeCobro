"use client";

import { useCallback, useState } from "react";
import { postCommand, type ClientError } from "./command-client";

/** Los cuatro estados de una operación (frontend-design §5): reposo, carga, éxito y error. */
export type CommandState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ClientError };

export function useCommand<T = unknown>(url: string) {
  const [state, setState] = useState<CommandState<T>>({ status: "idle" });

  const run = useCallback(
    async (body: unknown): Promise<CommandState<T>> => {
      setState({ status: "loading" });
      const result = await postCommand<T>(url, body);
      const next: CommandState<T> = result.ok
        ? { status: "success", data: result.data }
        : { status: "error", error: result.error };
      setState(next);
      return next;
    },
    [url],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, run, reset };
}
