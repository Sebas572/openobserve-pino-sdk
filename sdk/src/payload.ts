import type { LogLevel } from "./types";

/** Códigos numéricos de nivel que usa Pino. */
const LEVEL_BY_CODE: Record<number, LogLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

/** Alias aceptados para cada nivel. */
const LEVEL_BY_NAME: Record<string, LogLevel> = {
  trace: "trace",
  debug: "debug",
  info: "info",
  warn: "warn",
  warning: "warn",
  error: "error",
  fatal: "fatal",
};

/** Claves que se redactan por defecto en todos los logs. */
export const DEFAULT_REDACT_KEYS = [
  "password",
  "passwd",
  "token",
  "authorization",
  "auth",
  "secret",
  "apikey",
  "api_key",
  "accesskey",
  "access_key",
  "privatekey",
  "private_key",
  "sessionid",
  "session_id",
  "cookie",
];

/**
 * Convierte cualquier marca de tiempo a microsegundos (unidad que espera
 * OpenObserve) deducindo la escala por magnitud.
 *
 * Pino cambia la escala según el `timestamp` configurado (`epochTime` en ms,
 * `unixTime` en s, `isoTime` en texto ISO), así que no podemos asumir una
 * única unidad: la deducimos del valor.
 */
export function toMicroseconds(value: unknown): number {
  if (value === undefined || value === null) return Date.now() * 1000;

  if (typeof value === "number") return scaleNumber(value);

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "") {
      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) return scaleNumber(numeric);

      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) return parsed * 1000; // ISO -> ms -> µs
    }
  }

  return Date.now() * 1000;
}

/** Deduce la escala de un epoch numérico y lo devuelve en microsegundos. */
function scaleNumber(value: number): number {
  const abs = Math.abs(value);
  if (abs >= 1e17) return Math.round(value / 1000); // ns -> µs
  if (abs >= 1e14) return Math.round(value); // µs
  if (abs >= 1e11) return Math.round(value * 1000); // ms -> µs
  return Math.round(value * 1e6); // s -> µs
}

/** Normaliza el nivel de Pino (numérico) al nombre de texto que usa OpenObserve. */
export function normalizeLevel(value: unknown): LogLevel | string {
  if (typeof value === "number") return LEVEL_BY_CODE[value] ?? "info";
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    return LEVEL_BY_NAME[key] ?? value;
  }
  return "info";
}

/** Indica si una clave debe ocultarse por coincidir con la lista de redacción. */
function isSensitive(key: string, patterns: string[]): boolean {
  const normalized = key.toLowerCase();
  const parts = normalized.split(/[_\-.\s]+/);
  return patterns.some((pattern) => {
    const needle = pattern.toLowerCase();
    return normalized === needle || parts.includes(needle);
  });
}

/**
 * Sustituye por "[REDACTED]" el valor de las claves sensibles.
 * Recorre objetos y arrays hasta `maxDepth` niveles para no alterar
 *ciclos ni disparar el coste de la serialización.
 */
export function redactFields<T>(value: T, patterns: string[], depth = 0): T {
  if (patterns.length === 0 || depth > 5) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactFields(item, patterns, depth + 1)) as unknown as T;
  }

  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitive(key, patterns)
        ? "[REDACTED]"
        : redactFields(item, patterns, depth + 1);
    }
    return output as unknown as T;
  }

  return value;
}

export interface BuildRecordOptions {
  /** Campos comunes a todos los registros. */
  base?: Record<string, unknown>;
  /** Claves a redactar, o `false` para desactivarlo. */
  redact?: string[] | false;
}

/**
 * Convierte una línea JSON de Pino en el registro que espera OpenObserve.
 *
 * Puntos clave:
 * - `level` numérico (30) pasa a texto ("info"), que es lo que OpenObserve
 *   usa para filtrar y agregar por nivel.
 * - `timestamp` se normaliza a microsegundos, sea cual sea la escala de origen.
 * - El mensaje se toma de `msg` (la clave por defecto de Pino) y cae en
 *   `message`, que es el campo que OpenObserve muestra.
 * - Los campos reserved (`level`, `message`, `timestamp`) se escriben AL
 *   FINAL para que el metadata del usuario no pueda pisarlos.
 */
export function buildRecord(
  raw: Record<string, unknown>,
  options: BuildRecordOptions = {},
): Record<string, unknown> {
  const { msg, message, time, timestamp, level, ...rest } = raw;

  const text =
    typeof msg === "string" ? msg : typeof message === "string" ? message : "";

  const record: Record<string, unknown> = {
    ...(options.base ?? {}),
    ...rest,
    level: normalizeLevel(level),
    message: text,
    timestamp: toMicroseconds(time ?? timestamp),
  };

  if (options.redact === false) return record;
  return redactFields(record, options.redact ?? DEFAULT_REDACT_KEYS);
}
