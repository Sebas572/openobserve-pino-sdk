import type { OpenObserveTransport } from "./transport";

/** Hooks de salida del proceso instalados por el SDK. */
export interface ExitHooks {
  /** Desinstala los hooks (lo hace `close()` automáticamente). */
  uninstall(): void;
}

/**
 * Instala los hooks que vacían el buffer de OpenObserve al terminar el
 * proceso, para que no haya que llamar a `close()` a mano.
 *
 * El patrón es el mismo que usa Pino (`on-exit-leak-free`):
 *
 * - `beforeExit`: el proceso va a salir pero el event loop sigue vivo, así que
 *   se puede hacer el envío asíncrono. La petición en vuelo mantiene vivo el
 *   proceso hasta que termina.
 * - `exit`: ya no hay event loop, solo queda avisar si se quedó algo sin enviar
 *   (típicamente porque el código hizo `process.exit()`).
 * - Señales: si el proceso no tiene ya un handler propio para SIGINT/SIGTERM,
 *   se instalan para poder vaciar el buffer antes de morir. Si ya hay uno, no
 *   se interfiere.
 *
 * @param transport  Transporte cuyo buffer hay que vaciar.
 * @param maxWaitMs  Espera máxima por el envío al salir, en ms.
 */
export function installExitHooks(
  transport: OpenObserveTransport,
  maxWaitMs: number,
): ExitHooks {
  const onBeforeExit = () => {
    void transport.flushWithTimeout(maxWaitMs);
  };

  const onExit = () => {
    const pending = transport.pendingCount();
    if (pending > 0) {
      console.error(
        `[openobserve-sdk] el proceso termina con ${pending} log(s) sin enviar. ` +
          "Si usas process.exit(), llama a flush() antes.",
      );
    }
  };

  process.on("beforeExit", onBeforeExit);
  process.on("exit", onExit);

  // Señales: solo si nadie las está gestionando ya.
  const signalHandlers = new Map<NodeJS.Signals, () => void>();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    if (process.listenerCount(signal) > 0) continue;

    const handler = () => {
      void transport.flushWithTimeout(maxWaitMs).finally(() => {
        // Se retira el handler y se vuelve a lanzar la señal para que el
        // proceso termine con el comportamiento por defecto (código 130/143).
        process.removeListener(signal, handler);
        process.kill(process.pid, signal);
      });
    };

    process.on(signal, handler);
    signalHandlers.set(signal, handler);
  }

  return {
    uninstall() {
      process.removeListener("beforeExit", onBeforeExit);
      process.removeListener("exit", onExit);

      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
      signalHandlers.clear();
    },
  };
}
