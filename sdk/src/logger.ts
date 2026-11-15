import { createRequire } from "node:module";
import pino, { type Logger, type LoggerOptions } from "pino";
import { resolveConfig } from "./config";
import { installExitHooks } from "./exit";
import { buildRecord } from "./payload";
import { OpenObserveTransport } from "./transport";
import type { OpenObserveLogger, OpenObserveOptions, OpenObserveSender } from "./types";

/**
 * Crea un stream formateado con pino-pretty.
 * Si la dependencia no está instalada, cae de vuelta a NDJSON en stdout.
 */
function createPrettyStream(): NodeJS.WritableStream {
  try {
    const requireModule = createRequire(import.meta.url);
    const mod = requireModule("pino-pretty");
    const pretty = (mod.default ?? mod) as (
      options: Record<string, unknown>,
    ) => NodeJS.WritableStream;

    return pretty({
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    });
  } catch (error) {
    console.warn(
      "[openobserve-sdk] no se pudo cargar pino-pretty; se escribirá NDJSON en stdout:",
      (error as Error).message,
    );
    return process.stdout;
  }
}

/**
 * Conecta una instancia externa de `pino` con OpenObserve y devuelve el
 * logger junto con `flush` y `close`.
 */
function setupPinoWithOpenObserve(
  pinoFactory: typeof pino,
  options: OpenObserveOptions = {},
  pinoOptions: LoggerOptions = {},
): OpenObserveLogger {
  const config = resolveConfig(options);
  const transport = new OpenObserveTransport(config);

  // multistream asigna "info" a las entradas sin nivel explícito, lo que
  // descartaría los logs debug/trace. Se fija "trace" para que el filtro lo
  // marque el nivel del propio logger de Pino.
  const streams: { level: string; stream: NodeJS.WritableStream }[] = [];

  if (config.stdout) {
    streams.push({ level: "trace", stream: config.pretty ? createPrettyStream() : process.stdout });
  }
  streams.push({ level: "trace", stream: transport });

  const logger = pinoFactory(
    {
      // No se pasa `base` a Pino por defecto: sustituiría su base (pid y
      // hostname). Los campos comunes los añade el transporte a cada registro.
      timestamp: pinoFactory.stdTimeFunctions.epochTime,
      ...pinoOptions,
      level: pinoOptions.level ?? config.level,
    },
    pinoFactory.multistream(streams),
  );

  // El buffer se vacía solo al terminar el proceso, así que no hace falta
  // llamar a `close()` a mano en un script.
  const hooks = config.autoFlushOnExit
    ? installExitHooks(transport, config.exitTimeout)
    : null;

  return {
    logger,
    flush: () => transport.flush(),
    close: async () => {
      hooks?.uninstall();
      await transport.close();
    },
  };
}

/**
 * Conecta el `pino` oficial de tu proyecto con OpenObserve en una sola llamada.
 *
 * ```ts
 * import pino from "pino";
 * import { openObserveSetup } from "openobserve-pino-sdk";
 *
 * const logger = openObserveSetup(
 *   pino,
 *   { url: "...", username: "...", password: "..." },
 *   { level: "debug", name: "mi-api" },
 * );
 *
 * logger.info("listo");
 * ```
 */
export function openObserveSetup(
  pinoFactory: typeof pino,
  options: OpenObserveOptions = {},
  pinoOptions: LoggerOptions = {},
): Logger {
  return setupPinoWithOpenObserve(pinoFactory, options, pinoOptions).logger;
}

/**
 * Crea un logger de Pino que envía los logs a OpenObserve.
 *
 * ```ts
 * const { logger, flush, close } = createOpenObserveLogger();
 * logger.info({ userId: 42 }, "sesión iniciada");
 * await close(); // vacía el buffer y libera los recursos
 * ```
 *
 * Importante: `logger.flush()` de Pino no funciona con `pino.multistream`
 * (no implementa `flush`), así que usa el `flush()` que devuelve esta función.
 */
export function createOpenObserveLogger(options: OpenObserveOptions = {}): OpenObserveLogger {
  return setupPinoWithOpenObserve(pino, options);
}

/**
 * Crea únicamente el stream de OpenObserve, para integrarlo en un
 * `pino.multistream` propio:
 *
 * ```ts
 * const stream = openObserveStream();
 * const logger = pino(pino.multistream([{ stream }, { stream: process.stdout }]));
 * ```
 */
export function openObserveStream(options: OpenObserveOptions = {}): OpenObserveTransport {
  return new OpenObserveTransport(resolveConfig(options));
}

/**
 * API sin Pino: encola entradas sueltas en OpenObserve.
 * Útil para proyectos que ya tienen su propio logger.
 */
export function createOpenObserveSender(options: OpenObserveOptions = {}): OpenObserveSender {
  const config = resolveConfig(options);
  const transport = new OpenObserveTransport(config);

  const hooks = config.autoFlushOnExit
    ? installExitHooks(transport, config.exitTimeout)
    : null;

  return {
    async send(level, message, metadata = {}) {
      // `msg` se descarta: el mensaje explícito siempre gana.
      const { msg: _ignored, ...rest } = metadata;
      const record = buildRecord(
        { ...rest, level, message },
        { base: config.base, redact: config.redact },
      );
      transport.pushRecord(record);
    },
    flush: () => transport.flush(),
    close: async () => {
      hooks?.uninstall();
      await transport.close();
    },
  };
}
