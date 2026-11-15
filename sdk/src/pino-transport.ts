import { resolveConfig } from "./config";
import { OpenObserveTransport } from "./transport";
import type { OpenObserveOptions } from "./types";

/**
 * Punto de entrada compatible con `pino.transport({ target: "openobserve-pino-sdk/transport" })`.
 *
 * Permite instalar el `pino` oficial en el proyecto consumidor y añadir
 * OpenObserve como un transport/complemento estándar de Pino.
 */
export default function createPinoTransport(
  options: OpenObserveOptions = {},
): OpenObserveTransport {
  return new OpenObserveTransport(resolveConfig(options));
}
