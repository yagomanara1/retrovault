import type { ErrorCode, EventChannel, EventContract, IpcChannel, IpcInput, IpcOutput } from '@shared/ipc';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Chamada IPC tipada ponta a ponta. Lança ApiError com código estável. */
export async function call<C extends IpcChannel>(
  channel: C,
  ...args: IpcInput<C> extends void ? [] : [IpcInput<C>]
): Promise<IpcOutput<C>> {
  const result = await window.bridge.invoke(channel, args[0] as IpcInput<C>);
  if (!result.ok) throw new ApiError(result.error.code, result.error.message);
  return result.data;
}

export function onEvent<E extends EventChannel>(
  event: E,
  listener: (payload: EventContract[E]) => void,
): () => void {
  return window.bridge.on(event, listener);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Ocorreu um erro inesperado.';
}

export function isApiError(err: unknown, ...codes: ErrorCode[]): err is ApiError {
  return err instanceof ApiError && (codes.length === 0 || codes.includes(err.code));
}
