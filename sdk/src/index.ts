/**
 * SDK de logs para OpenObserve basado en Pino.
 *
 * ```ts
 * import { createOpenObserveLogger } from "./sdk/src/index.ts";
 *
 * const { logger, close } = createOpenObserveLogger();
 * logger.info({ userId: 42 }, "sesión iniciada");
 * await close();
 * ```
 */

export {
  createOpenObserveLogger,
  openObserveSetup,
  openObserveStream,
  createOpenObserveSender,
} from "./logger";
export { OpenObserveTransport } from "./transport";
export { checkOpenObserve } from "./doctor";
export type { OpenObserveCheck, EndpointCheck } from "./doctor";
export { installExitHooks } from "./exit";
export type { ExitHooks } from "./exit";
export { resolveConfig } from "./config";
export type { ResolvedConfig } from "./config";
export {
  buildRecord,
  normalizeLevel,
  toMicroseconds,
  redactFields,
  DEFAULT_REDACT_KEYS,
} from "./payload";
export type { BuildRecordOptions } from "./payload";
export type {
  LogLevel,
  OpenObserveLogger,
  OpenObserveOptions,
  OpenObserveSender,
} from "./types";
