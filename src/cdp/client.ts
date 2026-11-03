import { DEFAULTS } from '../config/constants.js';
import { InspectorError } from '../errors/errors.js';

export interface CdpClient {
  send: (method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number; sessionId?: string }) => Promise<any>;
  on: (method: string, handler: (params: any, sessionId?: string) => void) => () => boolean;
  close: () => void;
  socket: any;
}

export async function loadWebSocketCtor(): Promise<any> {
  if (typeof (globalThis as any).WebSocket === 'function') return (globalThis as any).WebSocket;
  throw new InspectorError(
    'Native WebSocket support is unavailable. Use Node.js 22+ with global WebSocket enabled.',
    'WEBSOCKET_UNAVAILABLE'
  );
}

export function addSocketListener(socket: any, type: string, handler: (event: any) => void): () => void {
  if (typeof socket.addEventListener !== 'function') {
    throw new InspectorError('A native EventTarget WebSocket is required', 'WEBSOCKET_UNSUPPORTED');
  }
  socket.addEventListener(type, handler);
  return () => socket.removeEventListener(type, handler);
}

export function extractSocketData(eventOrData: any): string | null {
  const data = eventOrData && typeof eventOrData === 'object' && 'data' in eventOrData
    ? eventOrData.data
    : eventOrData;
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  if (data && typeof data === 'object' && typeof (data as any).text === 'function') {
    // Blob-like object: callers cannot await inside the sync event handler;
    // Node's WebSocket delivers strings for text frames in practice.
    return null;
  }
  return data == null ? null : String(data);
}

export async function connectCdp(wsUrl: string, { commandTimeoutMs = DEFAULTS.timeoutMs } = {}): Promise<CdpClient> {
  const WebSocketCtor = await loadWebSocketCtor();
  const socket = new WebSocketCtor(wsUrl);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const removers: Array<() => void> = [];
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const off of removers) off();
      if (error) {
        try {
          socket.close();
        } catch {
          /* connecting socket */
        }
        reject(error);
      } else resolve();
    };
    const timer = setTimeout(() => {
      finish(new InspectorError('CDP connection timed out', 'CDP_CONNECT_TIMEOUT'));
    }, Math.min(commandTimeoutMs, 15_000));
    removers.push(addSocketListener(socket, 'open', () => finish()));
    removers.push(
      addSocketListener(socket, 'error', () => {
        finish(new InspectorError('CDP connection failed', 'CDP_CONNECT_FAILED'));
      })
    );
    removers.push(
      addSocketListener(socket, 'close', () => {
        finish(new InspectorError('CDP connection closed before opening', 'CDP_CONNECT_FAILED'));
      })
    );
  });

  let nextId = 1;
  const pending = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout; method: string }>();
  const listeners = new Map<string, Set<(params: any, sessionId?: string) => void>>();
  let closed = false;

  const dispatch = (method: string, params: any, sessionId?: string) => {
    const handlers = listeners.get(method);
    if (!handlers) return;
    for (const handler of Array.from(handlers)) {
      try {
        handler(params ?? {}, sessionId);
      } catch {
        // Listener errors must never break the CDP loop.
      }
    }
  };

  const onMessage = (eventOrData: any) => {
    const raw = extractSocketData(eventOrData);
    if (!raw) return;
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id)!;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        const error = new InspectorError(
          `CDP ${entry.method}: ${message.error.message} (code ${message.error.code})`,
          'CDP_COMMAND_FAILED'
        ) as any;
        error.cdpCode = message.error.code;
        error.cdpData = message.error.data;
        entry.reject(error);
      } else {
        entry.resolve(message.result ?? {});
      }
      return;
    }
    if (message.method) {
      dispatch(message.method, message.params, message.sessionId);
    }
  };

  const onClose = () => {
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new InspectorError('CDP connection closed', 'CDP_CLOSED'));
    }
    pending.clear();
  };

  addSocketListener(socket, 'message', onMessage);
  addSocketListener(socket, 'close', onClose);
  addSocketListener(socket, 'error', () => {
    // 'close' will reject pending commands.
  });

  const send = (method: string, params: Record<string, unknown> = {}, { timeoutMs = commandTimeoutMs, sessionId }: { timeoutMs?: number; sessionId?: string } = {}) =>
    new Promise<any>((resolve, reject) => {
      if (closed || socket.readyState !== 1) {
        reject(new InspectorError(`CDP is not connected (${method})`, 'CDP_CLOSED'));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new InspectorError(`CDP command timed out after ${timeoutMs}ms: ${method}`, 'CDP_TIMEOUT'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      const payload: any = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      try {
        socket.send(JSON.stringify(payload));
      } catch (error: any) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new InspectorError(`Failed to send CDP ${method}: ${error.message}`, 'CDP_SEND_FAILED'));
      }
    });

  const on = (method: string, handler: (params: any, sessionId?: string) => void) => {
    const set = listeners.get(method) ?? new Set();
    set.add(handler);
    listeners.set(method, set);
    return () => set.delete(handler);
  };

  const close = () => {
    try {
      socket.close();
    } catch {
      // ignored
    }
  };

  return { send, on, close, socket };
}

export async function evaluate(cdp: CdpClient, expression: string, options: { timeoutMs: number }, { timeoutMs = options.timeoutMs } = {}): Promise<any> {
  const result = await cdp.send(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: false,
      userGesture: false,
      includeCommandLineAPI: false,
    },
    { timeoutMs }
  );
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    const message =
      details.exception?.description ||
      details.text ||
      details.exception?.value ||
      'Runtime.evaluate failed';
    throw new InspectorError(`Page evaluation failed: ${String(message).slice(0, 500)}`, 'EVALUATION_FAILED');
  }
  return result.result?.value;
}
