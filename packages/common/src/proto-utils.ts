import * as proto from '@temporalio/proto';

export type History = proto.temporal.api.history.v1.IHistory;
export type Payload = proto.temporal.api.common.v1.IPayload;

/**
 * JSON representation of Temporal's {@link Payload} protobuf object
 */
export interface JSONPayload {
  /**
   * Mapping of key to base64 encoded value
   */
  metadata?: Record<string, string> | null;
  /**
   * base64 encoded value
   */
  data?: string | null;
}

/**
 * Convert a proto JSON representation of History to a valid History object
 */
export function historyFromJSON(history: unknown): History {
  function pascalCaseToConstantCase(s: string) {
    return s.replace(/[^\b][A-Z]/g, (m) => `${m[0]}_${m[1]}`).toUpperCase();
  }

  function fixEnumValue<O extends Record<string, any>>(obj: O, attr: keyof O, prefix: string) {
    return (
      obj[attr] && {
        [attr]: obj[attr].startsWith(prefix) ? obj[attr] : `${prefix}_${pascalCaseToConstantCase(obj[attr])}`,
      }
    );
  }

  // fromProto3JSON doesn't allow null values on 'bytes' fields. This turns out to be a problem for payloads.
  // Recursively descend on objects and array, and fix in-place any payload that has a null data field
  function fixPayloads<T>(e: T): T {
    function isPayload(p: any): p is JSONPayload {
      return p && typeof p === 'object' && 'metadata' in p && 'data' in p;
    }

    if (e && typeof e === 'object') {
      if (isPayload(e)) {
        if (e.data === null) {
          const { data: _data, ...rest } = e;
          return rest as T;
        }
        return e;
      }
      if (Array.isArray(e)) return e.map(fixPayloads) as T;
      return Object.fromEntries(Object.entries(e as object).map(([k, v]) => [k, fixPayloads(v)])) as T;
    }
    return e;
  }

  function fixHistoryEvent(e: Record<string, any>) {
    const type = Object.keys(e).find((k) => k.endsWith('EventAttributes'));
    if (!type) {
      throw new TypeError(`Missing attributes in history event: ${JSON.stringify(e)}`);
    }

    // Fix payloads with null data
    e = fixPayloads(e);

    return {
      ...e,
      ...fixEnumValue(e, 'eventType', 'EVENT_TYPE'),
      [type]: {
        ...e[type],
        ...(e[type].taskQueue && {
          taskQueue: { ...e[type].taskQueue, ...fixEnumValue(e[type].taskQueue, 'kind', 'TASK_QUEUE_KIND') },
        }),
        ...fixEnumValue(e[type], 'parentClosePolicy', 'PARENT_CLOSE_POLICY'),
        ...fixEnumValue(e[type], 'workflowIdReusePolicy', 'WORKFLOW_ID_REUSE_POLICY'),
        ...fixEnumValue(e[type], 'initiator', 'CONTINUE_AS_NEW_INITIATOR'),
        ...fixEnumValue(e[type], 'retryState', 'RETRY_STATE'),
        ...(e[type].childWorkflowExecutionFailureInfo && {
          childWorkflowExecutionFailureInfo: {
            ...e[type].childWorkflowExecutionFailureInfo,
            ...fixEnumValue(e[type].childWorkflowExecutionFailureInfo, 'retryState', 'RETRY_STATE'),
          },
        }),
      },
    };
  }

  function fixHistory(h: Record<string, any>) {
    return {
      events: h.events.map(fixHistoryEvent),
    };
  }

  if (typeof history !== 'object' || history == null || !Array.isArray((history as any).events)) {
    throw new TypeError('Invalid history, expected an object with an array of events');
  }
  return proto.temporal.api.history.v1.History.fromObject(fromProto3JSONCompatible(fixHistory(history))) as any;
}

/**
 * Convert an History object, e.g. as returned by `WorkflowClient.list().withHistory()`, to a JSON
 * string that adheres to the same norm as JSON history files produced by other Temporal tools.
 */
export function historyToJSON(history: History): string {
  const protoJson = proto.temporal.api.history.v1.History.toObject(
    proto.temporal.api.history.v1.History.fromObject(history),
    { bytes: String, enums: String, longs: String }
  );
  return JSON.stringify(toProto3JSONCompatible(protoJson), null, 2);
}

/** Recursively convert bytes values to base64 strings for proto JSON compatibility. */
export function fixBuffers<T>(e: T): T {
  if (e && typeof e === 'object') {
    if (e instanceof Buffer) return e.toString('base64') as any;
    if (e instanceof Uint8Array) return Buffer.from(e).toString('base64') as any;
    if (Array.isArray(e)) return e.map(fixBuffers) as T;
    return Object.fromEntries(Object.entries(e as object).map(([k, v]) => [k, fixBuffers(v)])) as T;
  }
  return e;
}

/**
 * Convert from protobuf payload to JSON
 */
export function payloadToJSON(payload: Payload): JSONPayload {
  return proto.temporal.api.common.v1.Payload.toObject(proto.temporal.api.common.v1.Payload.fromObject(payload), {
    bytes: String,
    longs: String,
  }) as any;
}

/**
 * Convert from JSON to protobuf payload
 */
export function JSONToPayload(json: JSONPayload): Payload {
  return proto.temporal.api.common.v1.Payload.fromObject(json) as any;
}

function fromProto3JSONCompatible<T>(value: T, key?: string): T {
  if (typeof value === 'string') {
    if (key != null && isTimestampKey(key) && isTimestampJSON(value)) {
      return timestampFromJSON(value) as T;
    }
    if (key != null && isDurationKey(key) && isDurationJSON(value)) {
      return durationFromJSON(value) as T;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => fromProto3JSONCompatible(item, key)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        fromProto3JSONCompatible(entryValue, entryKey),
      ])
    ) as T;
  }

  return value;
}

function toProto3JSONCompatible<T>(value: T, key?: string): T {
  if (Array.isArray(value)) {
    return value.map((item) => toProto3JSONCompatible(item, key)) as T;
  }

  if (value && typeof value === 'object') {
    if (key != null && isTimestampKey(key) && isWellKnownTimeObject(value)) {
      return timestampToJSON(value) as T;
    }
    if (key != null && isDurationKey(key) && isWellKnownTimeObject(value)) {
      return durationToJSON(value) as T;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        toProto3JSONCompatible(entryValue, entryKey),
      ])
    ) as T;
  }

  return value;
}

function isTimestampKey(key: string): boolean {
  return key.endsWith('Time') || key.endsWith('Timestamp');
}

function isDurationKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.endsWith('duration') ||
    lower.endsWith('timeout') ||
    lower.endsWith('interval') ||
    lower.endsWith('backoff') ||
    lower.endsWith('delay')
  );
}

function isTimestampJSON(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value);
}

function isDurationJSON(value: string): boolean {
  return /^-?\d+(?:\.\d{1,9})?s$/.test(value);
}

function timestampFromJSON(value: string): { seconds: number; nanos: number } {
  const timestampMatch = value.match(/\.(\d{1,9})Z$/);
  const seconds = Math.floor(Date.parse(value) / 1000);
  const nanos = timestampMatch ? Number((timestampMatch[1] ?? '').padEnd(9, '0')) : 0;
  return { seconds, nanos };
}

function durationFromJSON(value: string): { seconds: number; nanos: number } {
  const match = value.match(/^(-?)(\d+)(?:\.(\d{1,9}))?s$/);
  if (match == null) {
    throw new TypeError(`Invalid duration: ${value}`);
  }
  const sign = match[1] === '-' ? -1 : 1;
  return {
    seconds: sign * Number(match[2] ?? 0),
    nanos: sign * Number((match[3] ?? '').padEnd(9, '0')),
  };
}

function timestampToJSON(value: Record<string, unknown>): string {
  const seconds = Number(value.seconds ?? 0);
  const nanos = Number(value.nanos ?? 0);
  const date = new Date(seconds * 1000);
  const base = date.toISOString().replace(/\.\d{3}Z$/, '');
  return nanos === 0 ? `${base}Z` : `${base}.${formatNanos(nanos)}Z`;
}

function durationToJSON(value: Record<string, unknown>): string {
  const seconds = Number(value.seconds ?? 0);
  const nanos = Number(value.nanos ?? 0);
  if (nanos === 0) return `${seconds}s`;

  const sign = seconds < 0 || nanos < 0 ? '-' : '';
  const absSeconds = Math.abs(seconds);
  const absNanos = Math.abs(nanos);
  return `${sign}${absSeconds}.${formatNanos(absNanos)}s`;
}

function formatNanos(nanos: number): string {
  return String(nanos).padStart(9, '0').replace(/0+$/, '');
}

function isWellKnownTimeObject(value: object): value is Record<string, unknown> {
  return 'seconds' in value || 'nanos' in value;
}
