import type { Logger } from "pino";

/** Niveles de log soportados por OpenObserve. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Configuración del SDK. Todos los campos son opcionales: si faltan, se leen
 * del entorno (`OPENOBSERVE_*`, `LOG_LEVEL`, `SERVICE_NAME`, `NODE_ENV`).
 */
export interface OpenObserveOptions {
  /** Endpoint completo de ingesta JSON. Tiene prioridad sobre `baseUrl`/`org`/`stream`. */
  url?: string;
  /** Host base de OpenObserve, p. ej. "https://observe.flexzin.space". */
  baseUrl?: string;
  /** Organización de OpenObserve. Por defecto "default". */
  org?: string;
  /** Nombre del stream de destino. Por defecto "nodejs". */
  stream?: string;
  /** Usuario de OpenObserve. */
  username?: string;
  /** Contraseña de OpenObserve. */
  password?: string;
  /** Clave ya codificada en Base64 ("usuario:contraseña"). Alternativa a username/password. */
  authKey?: string;
  /** Permite trabajar sin credenciales (p. ej. detrás de un proxy que añade la cabecera). */
  allowAnonymous?: boolean;
  /** Cabeceras HTTP adicionales. */
  headers?: Record<string, string>;
  /** Nivel mínimo de Pino. Por defecto "info" o el valor de LOG_LEVEL. */
  level?: string;
  /** Lista blanca: si se define, solo se suben a OpenObserve los logs con alguno de estos niveles. */
  includeLevels?: (LogLevel | string)[];
  /** Lista negra: si se define, se suben todos los logs excepto los que tengan alguno de estos niveles. */
  excludeLevels?: (LogLevel | string)[];
  /** Nº máximo de entradas por petición (tamaño del paquete). Por defecto 100 o `OPENOBSERVE_BATCH_SIZE`. */
  batchSize?: number;
  /** Cada cuánto se vacía el buffer, en ms (`0` o `false` desactiva el temporizador para subir solo por paquete). Por defecto 2000 o `OPENOBSERVE_FLUSH_INTERVAL`. */
  flushInterval?: number | false;
  /** Nº de reintentos ante error de red o respuesta 5xx/429. Por defecto 3. */
  maxRetries?: number;
  /** Delay base del backoff exponencial, en ms. Por defecto 500. */
  retryDelay?: number;
  /** Timeout de cada petición, en ms. Por defecto 10000. */
  timeout?: number;
  /** Nº máximo de entradas en memoria. Por defecto `batchSize * 20`. */
  maxBufferSize?: number;
  /** Claves cuyo valor se sustituye por "[REDACTED]". `false` desactiva la redacción. */
  redact?: string[] | false;
  /** Campos comunes a todos los logs. */
  base?: Record<string, unknown>;
  /** Escribe también en stdout. Por defecto true. */
  stdout?: boolean;
  /** Formatea stdout con pino-pretty (debe estar instalado). Por defecto false. */
  pretty?: boolean;
  /** Diagnóstico interno del SDK por stderr. Por defecto false. */
  debug?: boolean;
  /** Vacía el buffer automáticamente al terminar el proceso. Por defecto true. */
  autoFlushOnExit?: boolean;
  /** Espera máxima del envío automático al salir, en ms. Por defecto 10000. */
  exitTimeout?: number;
  /** Implementación de fetch a utilizar. Útil para tests. */
  fetch?: typeof globalThis.fetch;
}

/** Logger de Pino conectado a OpenObserve, con control del ciclo de vida del buffer. */
export interface OpenObserveLogger {
  /** Instancia de Pino ya conectada a OpenObserve. */
  logger: Logger;
  /** Fuerza el envío de las entradas pendientes. */
  flush(): Promise<void>;
  /** Vacía el buffer y libera los recursos. */
  close(): Promise<void>;
}

/** Envío directo a OpenObserve sin depender de Pino. */
export interface OpenObserveSender {
  /** Encola una entrada. No bloquea: se envía en el próximo vaciado del buffer. */
  send(level: LogLevel | string, message: string, metadata?: Record<string, unknown>): Promise<void>;
  /** Fuerza el envío de las entradas pendientes. */
  flush(): Promise<void>;
  /** Vacía el buffer y libera los recursos. */
  close(): Promise<void>;
}
