import { describe, expect, test } from "bun:test";
import pino from "pino";
import { resolveConfig } from "../src/config";
import { openObserveSetup } from "../src/logger";
import createPinoTransport from "../src/pino-transport";
import { OpenObserveTransport } from "../src/transport";

interface Captured {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** Crea un fetch falso que registra las peticiones y devuelve la respuesta indicada. */
function fakeFetch(responses: Array<{ status: number } | Error>) {
  const captured: Captured[] = [];

  const fn = (async (url: string, init: RequestInit) => {
    captured.push({
      url: String(url),
      body: String(init.body),
      headers: init.headers as Record<string, string>,
    });

    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response("", { status: next?.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;

  return { fn, captured };
}

function makeConfig(fetchImpl: typeof globalThis.fetch, overrides = {}) {
  return resolveConfig({
    url: "https://example.test/api/default/nodejs/_json",
    username: "user",
    password: "pass",
    fetch: fetchImpl,
    flushInterval: 60_000,
    ...overrides,
  });
}

describe("OpenObserveTransport", () => {
  test("agrupa varias entradas en un único lote", async () => {
    const { fn, captured } = fakeFetch([{ status: 200 }]);
    const transport = new OpenObserveTransport(makeConfig(fn));

    transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "uno" })}\n`);
    transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "dos" })}\n`);

    await transport.flush();

    expect(captured.length).toBe(1);
    const body = JSON.parse(captured[0]!.body);
    expect(body.length).toBe(2);
    expect(body[0].message).toBe("uno");
    expect(body[1].message).toBe("dos");
    expect(body[0].level).toBe("info");

    await transport.close();
  });

  test("envía la cabecera Authorization en Base64", async () => {
    const { fn, captured } = fakeFetch([{ status: 200 }]);
    const transport = new OpenObserveTransport(makeConfig(fn));

    transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "hola" })}\n`);
    await transport.flush();

    const expected = `Basic ${Buffer.from("user:pass").toString("base64")}`;
    expect(captured[0]!.headers.Authorization).toBe(expected);

    await transport.close();
  });

  test("reintenta ante errores de red y entrega el lote", async () => {
    const { fn, captured } = fakeFetch([
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      { status: 200 },
    ]);
    const transport = new OpenObserveTransport(makeConfig(fn, { retryDelay: 1 }));

    transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "hola" })}\n`);
    await transport.flush();

    expect(captured.length).toBe(3);
    await transport.close();
  });

  test("no reintenta ante un 400", async () => {
    const { fn, captured } = fakeFetch([{ status: 400 }]);
    const transport = new OpenObserveTransport(makeConfig(fn, { retryDelay: 1 }));

    transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "hola" })}\n`);
    await transport.flush();

    expect(captured.length).toBe(1);
    await transport.close();
  });

  test("descarta las entradas más antiguas cuando el buffer se llena", async () => {
    const { fn, captured } = fakeFetch([{ status: 200 }]);
    // batchSize mayor que maxBufferSize: el buffer se llena antes de poder vaciarse.
    const transport = new OpenObserveTransport(
      makeConfig(fn, { batchSize: 10, maxBufferSize: 2, flushInterval: 60_000 }),
    );

    transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "a" })}\n`);
    transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "b" })}\n`);
    transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "c" })}\n`);

    await transport.flush();

    const body = JSON.parse(captured[0]!.body);
    expect(body.length).toBe(2);
    expect(body[0].message).toBe("b");
    expect(body[1].message).toBe("c");

    await transport.close();
  });

  test("ignora las líneas que no son JSON", async () => {
    const { fn, captured } = fakeFetch([{ status: 200 }]);
    const transport = new OpenObserveTransport(makeConfig(fn));

    transport.write("esto no es json\n");
    transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "hola" })}\n`);
    await transport.flush();

    const body = JSON.parse(captured[0]!.body);
    expect(body.length).toBe(1);
    expect(body[0].message).toBe("hola");

    await transport.close();
  });

  test("createPinoTransport y stream.end() vacían el buffer automáticamente (_final)", async () => {
    const { fn, captured } = fakeFetch([{ status: 200 }]);
    const stream = createPinoTransport({
      url: "https://example.test/api/default/nodejs/_json",
      username: "u",
      password: "p",
      batchSize: 100,
      flushInterval: 60_000,
      fetch: fn,
    });

    stream.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "al-cerrar" })}\n`);

    await new Promise<void>((resolve, reject) => {
      stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });

    expect(captured.length).toBe(1);
    const body = JSON.parse(captured[0]!.body);
    expect(body[0].message).toBe("al-cerrar");
  });

  test("openObserveSetup conecta el pino oficial con opciones de OpenObserve y de Pino", async () => {
    const { fn, captured } = fakeFetch([{ status: 200 }]);

    const logger = openObserveSetup(
      pino,
      {
        url: "https://example.test/api/default/ssc/_json",
        username: "u",
        password: "p",
        batchSize: 1,
        stdout: false,
        autoFlushOnExit: false,
        fetch: fn,
      },
      {
        level: "debug",
        name: "api-pagos",
      },
    );

    logger.debug({ orderId: 99 }, "pago iniciado");

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(captured.length).toBe(1);
    const body = JSON.parse(captured[0]!.body);
    expect(body[0]).toMatchObject({
      level: "debug",
      message: "pago iniciado",
      name: "api-pagos",
      project: "ssc",
      orderId: 99,
    });
  });

  test("con batchSize: 300 y flushInterval: false sube exactamente un paquete de 300 logs", async () => {
    const { fn, captured } = fakeFetch([{ status: 200 }]);
    const transport = new OpenObserveTransport(
      resolveConfig({
        url: "https://example.test/api/default/nodejs/_json",
        username: "u",
        password: "p",
        batchSize: 300,
        flushInterval: false,
        fetch: fn,
      }),
    );

    for (let i = 0; i < 299; i++) {
      transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: `log-${i}` })}\n`);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(captured.length).toBe(0);
    expect(transport.pendingCount()).toBe(299);

    transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "log-299" })}\n`);
    await transport.flush();

    expect(captured.length).toBe(1);
    const body = JSON.parse(captured[0]!.body);
    expect(body.length).toBe(300);
    expect(body[0].message).toBe("log-0");
    expect(body[299].message).toBe("log-299");

    await transport.close();
  });

  test("resolveConfig lee OPENOBSERVE_BATCH_SIZE y OPENOBSERVE_FLUSH_INTERVAL del entorno", () => {
    const prevBatch = process.env.OPENOBSERVE_BATCH_SIZE;
    const prevFlush = process.env.OPENOBSERVE_FLUSH_INTERVAL;
    process.env.OPENOBSERVE_BATCH_SIZE = "300";
    process.env.OPENOBSERVE_FLUSH_INTERVAL = "0";

    try {
      const cfg = resolveConfig({
        url: "https://example.test/api/default/nodejs/_json",
        username: "u",
        password: "p",
      });
      expect(cfg.batchSize).toBe(300);
      expect(cfg.flushInterval).toBe(0);
    } finally {
      if (prevBatch === undefined) delete process.env.OPENOBSERVE_BATCH_SIZE;
      else process.env.OPENOBSERVE_BATCH_SIZE = prevBatch;
      if (prevFlush === undefined) delete process.env.OPENOBSERVE_FLUSH_INTERVAL;
      else process.env.OPENOBSERVE_FLUSH_INTERVAL = prevFlush;
    }
  });
});
