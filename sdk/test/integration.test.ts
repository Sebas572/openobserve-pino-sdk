import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createOpenObserveLogger } from "../src/index";
import { createOpenObserveSender } from "../src/index";

interface Received {
  url: string;
  authorization: string | null;
  contentType: string | null;
  body: Record<string, unknown>[];
}

let server: ReturnType<typeof Bun.serve>;
let received: Received[] = [];
let url: string;
let errorUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      received.push({
        url: request.url,
        authorization: request.headers.get("authorization"),
        contentType: request.headers.get("content-type"),
        body: (await request.json()) as Record<string, unknown>[],
      });
      return new Response("success", { status: 200 });
    },
  });
  url = `http://127.0.0.1:${server.port}/api/default/nodejs/_json`;
  errorUrl = `http://127.0.0.1:${server.port}/api/default/default/_json`;
});

afterAll(() => {
  server.stop();
});

describe("integración completa con el endpoint de OpenObserve", () => {
  test("envía los logs de Pino en un único lote con el formato esperado", async () => {
    received = [];

    const { logger, close } = createOpenObserveLogger({
      url,
      username: "usuario",
      password: "clave",
      stdout: false,
      base: { env: "test" },
      batchSize: 50,
      flushInterval: 60_000,
    });

    logger.info({ port: 3000, password: "secreto" }, "servidor iniciado correctamente");
    logger.error({ db: "postgres", code: "ECONNREFUSED" }, "conexión fallida");

    await close();

    // Dos peticiones: la del proyecto y la de errores.
    expect(received.length).toBe(2);

    const main = received.find((request) => request.url === url);
    const errors = received.find((request) => request.url === errorUrl);

    expect(main).toBeDefined();
    expect(main!.contentType).toBe("application/json");
    expect(main!.authorization).toBe(
      `Basic ${Buffer.from("usuario:clave").toString("base64")}`,
    );

    const body = main!.body;
    expect(body.length).toBe(2);

    // Level normalizado a texto (OpenObserve no entiende el 30 de Pino).
    expect(body[0]!.level).toBe("info");
    expect(body[1]!.level).toBe("error");

    // El mensaje real de Pino, no el campo "message" del metadata.
    expect(body[0]!.message).toBe("servidor iniciado correctamente");
    expect(body[1]!.message).toBe("conexión fallida");

    // El proyecto sale del stream de la URL.
    expect(body[0]!.project).toBe("nodejs");

    // Al endpoint de errores solo va el error.
    expect(errors).toBeDefined();
    expect(errors!.body.length).toBe(1);
    expect(errors!.body[0]!.message).toBe("conexión fallida");
    expect(errors!.body[0]!.project).toBe("nodejs");

    // Timestamp en microsegundos.
    const timestamp = body[0]!.timestamp as number;
    expect(timestamp).toBeGreaterThan(1_600_000_000_000_000);
    expect(timestamp).toBeLessThan(2_000_000_000_000_000);

    // Campos base y metadata.
    expect(body[0]!.env).toBe("test");
    expect(body[0]!.port).toBe(3000);

    // Redacción del campo sensible.
    expect(body[0]!.password).toBe("[REDACTED]");
  });

  test("el sender sin Pino produce el mismo formato", async () => {
    received = [];

    const sender = createOpenObserveSender({ url, username: "u", password: "p", stdout: false });
    await sender.send("warn", "aviso suelto", { jobId: "abc-123" });
    await sender.flush();
    await sender.close();

    expect(received.length).toBe(1);
    const body = received[0]!.body;
    expect(body.length).toBe(1);
    expect(body[0]!.level).toBe("warn");
    expect(body[0]!.message).toBe("aviso suelto");
    expect(body[0]!.jobId).toBe("abc-123");
    expect(body[0]!.project).toBe("nodejs");
  });

  test("varias llamadas de flush solo envían lo pendiente", async () => {
    received = [];

    const { logger, close } = createOpenObserveLogger({
      url,
      username: "u",
      password: "p",
      stdout: false,
      batchSize: 1,
      flushInterval: 60_000,
    });

    logger.info("uno");
    await new Promise((resolve) => setTimeout(resolve, 50));
    logger.info("dos");
    await new Promise((resolve) => setTimeout(resolve, 50));

    await close();

    // batchSize 1 -> un lote por log.
    expect(received.length).toBe(2);
    expect(received[0]!.body[0]!.message).toBe("uno");
    expect(received[1]!.body[0]!.message).toBe("dos");
  });
});
