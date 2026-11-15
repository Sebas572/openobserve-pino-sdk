import { Writable } from "node:stream";
import { ERROR_LEVEL, type ResolvedConfig } from "./config";
import { buildRecord } from "./payload";

/** Espera el tiempo indicado en ms. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stream de escritura que acumula las entradas de Pino y las envía a
 * OpenObserve en lotes.
 *
 * A diferencia del stream de `pino.ts` original (que hacía una petición HTTP
 * por línea y sin esperar), este:
 * - agrupa hasta `batchSize` entradas o cada `flushInterval` ms,
 * - serializa las peticiones para no saturar la red,
 * - reintenta con backoff exponencial ante errores de red y respuestas 5xx/429,
 * - acota el buffer para que una caída de OpenObserve no consuma toda la RAM.
 */
export class OpenObserveTransport extends Writable {
  private readonly config: ResolvedConfig;
  private buffer: Record<string, unknown>[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Cadena de peticiones: mantiene el orden y evita ráfagas concurrentes. */
  private pending: Promise<void> = Promise.resolve();
  private droppedCount = 0;
  private isClosed = false;

  constructor(config: ResolvedConfig) {
    super({ decodeStrings: true });
    this.config = config;

    if (config.flushInterval > 0) {
      this.timer = setInterval(() => {
        void this.flush();
      }, config.flushInterval);
      // El temporizador no debe mantener vivo el proceso.
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  /**
   * Pino escribe una línea JSON terminada en `\n` por llamada, pero aceptamos
   * varias en un mismo chunk por si el stream se serializa de otra forma.
   */
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      for (const line of chunk.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          this.debug("línea ignorada: no es JSON válido");
          continue;
        }

        if (parsed === null || typeof parsed !== "object") continue;

        this.enqueue(
          buildRecord(parsed as Record<string, unknown>, {
            base: this.config.base,
            redact: this.config.redact,
          }),
        );
      }
    } catch (error) {
      this.debug("error procesando el chunk:", error);
    }

    callback();
  }

  /**
   * Encola un registro ya normalizado.
   * Lo usa el sender sin Pino para no pasar por el parseo de líneas JSON.
   */
  pushRecord(record: Record<string, unknown>): void {
    this.enqueue(record);
  }

  /**
   * Variante síncrona de `flush`, que es la que invocan `pino.multistream.end()`
   * y `logger.fatal()`. No puede esperar al envío, así que lo dispara y sigue.
   */
  flushSync(): void {
    void this.drain();
  }

  /** Nº de entradas que siguen en el buffer sin enviar. */
  pendingCount(): number {
    return this.buffer.length;
  }

  /**
   * Vacía el buffer esperando como máximo `maxWaitMs`.
   *
   * Se usa al terminar el proceso: si OpenObserve no responde, no se puede
   * dejar el proceso colgado esperando los reintentos. Devuelve `false` si se
   * agotó el tiempo (el envío sigue en curso, pero el proceso se va).
   */
  async flushWithTimeout(maxWaitMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), maxWaitMs);
      (timer as unknown as { unref?: () => void }).unref?.();
    });

    try {
      return await Promise.race([this.drain().then(() => true), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Añade una entrada al buffer, descartando las más antiguas si está lleno. */
  private enqueue(record: Record<string, unknown>): void {
    if (this.buffer.length >= this.config.maxBufferSize) {
      this.buffer.shift();
      this.droppedCount += 1;
      if (this.droppedCount === 1 || this.droppedCount % 100 === 0) {
        console.error(
          `[openobserve-sdk] buffer lleno (${this.config.maxBufferSize} entradas): ` +
            `${this.droppedCount} logs descartados. OpenObserve no responde o va lento.`,
        );
      }
    }

    this.buffer.push(record);

    if (this.buffer.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  /**
   * Vacía el buffer. Devuelve una promesa que resuelve cuando el lote se ha
   * enviado. Acepta también un callback para integrarse con `pino.multistream`.
   */
  flush(): Promise<void>;
  flush(callback: (error?: Error | null) => void): void;
  flush(callback?: (error?: Error | null) => void): Promise<void> | void {
    const promise = this.drain();

    if (callback) {
      promise.then(() => callback(), (error) => callback(error as Error));
      return;
    }

    return promise;
  }

  /** Cierra el buffer, vacía lo pendiente y libera el temporizador. */
  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.drain();
    this.end();
  }

  /**
   * Hook estándar de `Writable`: garantiza que al llamar a `stream.end()`
   * (por ejemplo, desde `pino.transport()` al cerrar el worker) se vacíe el
   * buffer antes de completar el cierre.
   */
  override _final(callback: (error?: Error | null) => void): void {
    this.isClosed = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.drain().then(
      () => callback(),
      (error) => callback(error as Error),
    );
  }

  /** Envía el lote pendiente y encadena la petición en la cola interna. */
  private drain(): Promise<void> {
    if (this.buffer.length === 0) return this.pending;

    const batch = this.buffer;
    this.buffer = [];

    this.pending = this.pending
      .then(() => this.sendBatch(batch))
      .catch((error) => {
        this.debug("fallo al enviar el lote:", error);
      });

    return this.pending;
  }

  /**
   * Envía un lote a OpenObserve.
   *
   * Todos los niveles van al endpoint principal. Si hay un endpoint de errores
   * configurado (`errorUrl`), los niveles de `errorLevels` van **además** a ese
   * segundo endpoint, para tener un stream collects de errores.
   */
  private async sendBatch(batch: Record<string, unknown>[]): Promise<void> {
    const sends: Promise<void>[] = [this.postWithRetry(this.config.url, batch)];

    if (this.config.errorUrl) {
      const errors = batch.filter((entry) => entry.level === ERROR_LEVEL);

      if (errors.length > 0) {
        sends.push(this.postWithRetry(this.config.errorUrl, errors));
      } else {
        this.debug(`nada que enviar a ${this.config.errorUrl}`);
      }
    }

    await Promise.all(sends);
  }

  /** Envía un lote a una URL, reintentando ante fallos transitorios. */
  private async postWithRetry(url: string, batch: Record<string, unknown>[]): Promise<void> {
    const payload = JSON.stringify(batch);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };
    if (this.config.authHeader) headers.Authorization = this.config.authHeader;

    let delay = this.config.retryDelay;
    let lastError: string | undefined;
    const started = Date.now();

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.config.fetch(url, {
          method: "POST",
          headers,
          body: payload,
          signal: AbortSignal.timeout(this.config.timeout),
        });

        if (response.ok) {
          this.debug(
            `lote enviado: ${batch.length} entradas a ${url} en ${Date.now() - started} ms`,
          );
          return;
        }

        const errorText = await response.text().catch(() => "");
        const retriable = response.status === 429 || response.status >= 500;

        if (!retriable) {
          // 4xx: el lote está mal formado, reintentar no va a ayudar.
          console.error(`[openobserve-sdk] HTTP ${response.status} en ${url}: ${errorText}`);
          return;
        }

        lastError = `HTTP ${response.status}: ${errorText}`;
      } catch (error) {
        lastError = (error as Error).message;
        this.debug(`intento ${attempt + 1} fallido:`, error);
      }

      if (attempt === this.config.maxRetries) break;

      await sleep(delay);
      delay = Math.min(delay * 2, 30_000);
    }

    console.error(
      `[openobserve-sdk] no se pudo enviar un lote de ${batch.length} entradas a ` +
        `${url} tras ${this.config.maxRetries + 1} intento(s)` +
        `${lastError ? `: ${lastError}` : ""}. Los logs se han perdido.`,
    );
  }

  /** Log de diagnóstico interno del SDK. */
  private debug(...args: unknown[]): void {
    if (!this.config.debug) return;
    console.error("[openobserve-sdk]", ...args);
  }
}
