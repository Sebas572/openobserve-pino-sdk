import { DEFAULT_REDACT_KEYS, normalizeLevel } from "./payload";
import type { LogLevel, OpenObserveOptions } from "./types";

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
  /** Si está definido, solo se suben a OpenObserve los niveles incluidos. */
  includeLevels?: Set<string>;
  /** Si está definido, se excluyen estos niveles del envío a OpenObserve. */
  excludeLevels?: Set<string>;
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
 * URL principal, usando `errorStream` (por defecto `default`).
 *
 * `https://host/api/default/ssc/_json` → `https://host/api/default/default/_json`
 */
function resolveErrorUrl(mainUrl: string, errorStream: string | false): string | undefined {
  if (errorStream === false) return undefined;
  const match = mainUrl.match(/^(.*\/api\/[^/]+\/)([^/]+)(\/_json.*)$/);
  if (!match) return undefined;
  if (match[2] === errorStream) return undefined;
  return `${match[1]}${errorStream}${match[3]}`;
}

/** Resuelve cómo debe comportarse el stream secundario de errores. */
function resolveErrorStreamOption(explicit: string | boolean | undefined): string | false {
  if (explicit === false) return false;
  if (explicit === true) return ERROR_STREAM;
  if (typeof explicit === "string") {
    const trimmed = explicit.trim();
    return trimmed === "" ? false : trimmed;
  }

  const envValue = process.env.OPENOBSERVE_ERROR_STREAM?.trim();
  if (!envValue) return ERROR_STREAM;
  const lower = envValue.toLowerCase();
  if (lower === "false" || lower === "0" || lower === "no") return false;
  if (lower === "true" || lower === "1" || lower === "yes") return ERROR_STREAM;
  return envValue;
}

/** Resuelve si se añade automáticamente el campo `project` a los registros. */
function resolveIncludeProject(explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  const envValue = process.env.OPENOBSERVE_INCLUDE_PROJECT?.trim().toLowerCase();
  if (envValue === "false" || envValue === "0" || envValue === "no") return false;
  return true;
}

/** Reúne los campos comunes a todos los registros. */
function resolveBase(
  options: OpenObserveOptions,
  url: string,
  includeProject: boolean,
): Record<string, unknown> {
  const base: Record<string, unknown> = {};

  if (process.env.NODE_ENV) base.env = process.env.NODE_ENV;

  if (includeProject) {
    // El campo `project` dice de qué proyecto salió el log: es el stream de la
    // URL, así que no hay que declararlo.
    const project = streamFromUrl(url);
    if (project) base.project = project;
  }

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

/** Normaliza una lista de niveles desde opciones o variable de entorno separada por comas. */
function resolveLevelSet(
  explicit: (LogLevel | string)[] | undefined,
  envName: string,
): Set<string> | undefined {
  const list =
    explicit ??
    process.env[envName]
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  if (list === undefined) return undefined;
  return new Set(list.map((lvl) => String(normalizeLevel(lvl))));
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
  const errorStream = resolveErrorStreamOption(options.errorStream);
  const includeProject = resolveIncludeProject(options.includeProject);

  return {
    url,
    errorUrl: resolveErrorUrl(url, errorStream),
    project: includeProject ? streamFromUrl(url) : undefined,
    authHeader,
    headers: options.headers ?? {},
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    includeLevels: resolveLevelSet(options.includeLevels, "OPENOBSERVE_INCLUDE_LEVELS"),
    excludeLevels: resolveLevelSet(options.excludeLevels, "OPENOBSERVE_EXCLUDE_LEVELS"),
    batchSize,
    flushInterval,
    maxRetries: options.maxRetries ?? 3,
    retryDelay: options.retryDelay ?? 500,
    timeout: options.timeout ?? 10_000,
    maxBufferSize: options.maxBufferSize ?? batchSize * 20,
    redact: options.redact === false ? false : (options.redact ?? DEFAULT_REDACT_KEYS),
    base: resolveBase(options, url, includeProject),
    stdout: options.stdout ?? true,
    pretty: options.pretty ?? false,
    debug: options.debug ?? false,
    autoFlushOnExit: options.autoFlushOnExit ?? true,
    exitTimeout: options.exitTimeout ?? 10_000,
    fetch: options.fetch ?? globalThis.fetch,
  };
}
