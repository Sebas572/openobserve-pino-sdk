import { DEFAULT_REDACT_KEYS } from "./payload";
import type { OpenObserveOptions } from "./types";

/** Endpoint por defecto de la nube pública de OpenObserve. */
const DEFAULT_URL = "https://api.openobserve.ai/api/default/nodejs/_json";

/** Stream donde además se acumulan los logs de error. */
export const ERROR_STREAM = "default";

/** Nivel que se envía también al stream de errores. */
export const ERROR_LEVEL = "error";

/** Configuración ya resuelta, con valores por defecto aplicados. */
export interface ResolvedConfig {
  /** Endpoint de ingesta JSON del proyecto. */
  url: string;
  /** Endpoint de errores: el mismo host y organización, stream `default`. */
  errorUrl?: string;
  /** Nombre del proyecto (el stream de la URL). */
  project?: string;
  /** Cabecera `Authorization` completa, o "" si se trabaja sin credenciales. */
  authHeader: string;
  /** Cabeceras HTTP adicionales. */
  headers: Record<string, string>;
  /** Nivel mínimo de Pino. */
  level: string;
  /** Nº máximo de entradas por petición. */
  batchSize: number;
  /** Intervalo de vaciado del buffer, en ms. */
  flushInterval: number;
  /** Nº de reintentos por petición fallida. */
  maxRetries: number;
  /** Delay base del backoff exponencial, en ms. */
  retryDelay: number;
  /** Timeout de cada petición, en ms. */
  timeout: number;
  /** Nº máximo de entradas en memoria. */
  maxBufferSize: number;
  /** Claves a redactar, o `false` para desactivarlo. */
  redact: string[] | false;
  /** Campos comunes a todos los registros. */
  base: Record<string, unknown>;
  /** Escribe también en stdout. */
  stdout: boolean;
  /** Formatea stdout con pino-pretty. */
  pretty: boolean;
  /** Diagnóstico interno por stderr. */
  debug: boolean;
  /** Vacía el buffer automáticamente al terminar el proceso. */
  autoFlushOnExit: boolean;
  /** Espera máxima del envío automático al salir, en ms. */
  exitTimeout: number;
  /** Implementación de fetch a utilizar. */
  fetch: typeof globalThis.fetch;
}

/** Construye el endpoint a partir de baseUrl + org + stream, si se proporcionan. */
function resolveUrl(options: OpenObserveOptions): string {
  const explicit = options.url ?? process.env.OPENOBSERVE_URL;
  if (explicit) return explicit;

  const base = options.baseUrl ?? process.env.OPENOBSERVE_BASE_URL;
  if (!base) return DEFAULT_URL;

  const org = options.org ?? process.env.OPENOBSERVE_ORG ?? "default";
  const stream = options.stream ?? process.env.OPENOBSERVE_STREAM ?? "nodejs";
  return `${base.replace(/\/+$/, "")}/api/${org}/${stream}/_json`;
}

/** Construye la cabecera `Authorization` a partir de usuario/contraseña o de una clave ya codificada. */
function resolveAuthHeader(options: OpenObserveOptions): string {
  const username = options.username ?? process.env.OPENOBSERVE_USERNAME;
  const password = options.password ?? process.env.OPENOBSERVE_PASSWORD;
  const authKey = options.authKey ?? process.env.OPENOBSERVE_AUTH_KEY;

  if (username && password) {
    return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }
  if (authKey) {
    return authKey.startsWith("Basic ") ? authKey : `Basic ${authKey}`;
  }
  return "";
}

/**
 * Extrae el nombre del stream de una URL de ingesta.
 * El stream es el nombre del proyecto: en
 * `https://host/api/default/ssc/_json` el proyecto es `ssc`.
 */
function streamFromUrl(url: string): string | undefined {
  return url.match(/\/api\/[^/]+\/([^/]+)\/_json/)?.[1];
}

/**
 * Devuelve la URL del stream de errores: el mismo host y organización que la
 * URL principal, pero con el stream `default`.
 *
 * `https://host/api/default/ssc/_json` → `https://host/api/default/default/_json`
 */
function resolveErrorUrl(mainUrl: string): string | undefined {
  const match = mainUrl.match(/^(.*\/api\/[^/]+\/)([^/]+)(\/_json.*)$/);
  if (!match) return undefined;
  return `${match[1]}${ERROR_STREAM}${match[3]}`;
}

/** Reúne los campos comunes a todos los registros. */
function resolveBase(options: OpenObserveOptions, url: string): Record<string, unknown> {
  const base: Record<string, unknown> = {};

  if (process.env.NODE_ENV) base.env = process.env.NODE_ENV;

  // El campo `project` dice de qué proyecto salió el log: es el stream de la
  // URL, así que no hay que declararlo.
  const project = streamFromUrl(url);
  if (project) base.project = project;

  Object.assign(base, options.base ?? {});

  return base;
}

/** Lee un entero no negativo de una variable de entorno si está definida y es válida. */
function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

/**
 * Combina las opciones explícitas con las variables de entorno y aplica los
 * valores por defecto.
 *
 * Lanza si no hay credenciales, porque fallar al arrancar es mejor que
 * perder los logs en silencio con un 401 en cada petición.
 */
export function resolveConfig(options: OpenObserveOptions = {}): ResolvedConfig {
  const authHeader = resolveAuthHeader(options);

  if (!authHeader && !options.allowAnonymous) {
    throw new Error(
      "[openobserve-sdk] Faltan las credenciales de OpenObserve. Define OPENOBSERVE_USERNAME y " +
        "OPENOBSERVE_PASSWORD (o OPENOBSERVE_AUTH_KEY), o pásalas por options. " +
        "Si el envío va a un proxy que añade la cabecera, usa { allowAnonymous: true }.",
    );
  }

  const rawBatchSize = options.batchSize ?? envInt("OPENOBSERVE_BATCH_SIZE") ?? 100;
  const batchSize = Math.max(1, Math.floor(rawBatchSize));
  const rawFlushInterval =
    options.flushInterval === false
      ? 0
      : (options.flushInterval ?? envInt("OPENOBSERVE_FLUSH_INTERVAL") ?? 2000);
  const flushInterval = Math.max(0, Math.floor(rawFlushInterval));
  const url = resolveUrl(options);

  return {
    url,
    errorUrl: resolveErrorUrl(url),
    project: streamFromUrl(url),
    authHeader,
    headers: options.headers ?? {},
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    batchSize,
    flushInterval,
    maxRetries: options.maxRetries ?? 3,
    retryDelay: options.retryDelay ?? 500,
    timeout: options.timeout ?? 10_000,
    maxBufferSize: options.maxBufferSize ?? batchSize * 20,
    redact: options.redact === false ? false : (options.redact ?? DEFAULT_REDACT_KEYS),
    base: resolveBase(options, url),
    stdout: options.stdout ?? true,
    pretty: options.pretty ?? false,
    debug: options.debug ?? false,
    autoFlushOnExit: options.autoFlushOnExit ?? true,
    exitTimeout: options.exitTimeout ?? 10_000,
    fetch: options.fetch ?? globalThis.fetch,
  };
}
