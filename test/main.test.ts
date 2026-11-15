import { afterAll, beforeAll, describe, expect, test } from "bun:test";

/**
 * Ejecuta `main.ts` contra un OpenObserve simulado en local y comprueba los
 * lotes que se envían. No sale nada a la red.
 */

interface Received {
  url: string;
  body: Record<string, unknown>[];
}

let mock: ReturnType<typeof Bun.serve>;
let received: Received[] = [];

beforeAll(() => {
  mock = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      received.push({
        url: new URL(request.url).pathname,
        body: (await request.json()) as Record<string, unknown>[],
      });
      return new Response("success", { status: 200 });
    },
  });

  // main.ts crea su logger al importarse, así que el entorno debe estar listo
  // antes del import (los imports estáticos se evalúan antes que el código).
  process.env.OPENOBSERVE_URL = `http://127.0.0.1:${mock.port}/api/default/voltary/_json`;
  process.env.OPENOBSERVE_USERNAME = "test";
  process.env.OPENOBSERVE_PASSWORD = "test";
});

afterAll(() => {
  mock.stop();
});

/** Espera a que se cumpla la condición, o agota el tiempo. */
async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("tiempo agotado esperando la condición");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("main.ts", () => {
  test("envía los logs con el formato que espera OpenObserve", async () => {
    received = [];

    await import("../main.ts");

    // main.ts no cierra el logger: el lote sale solo, por el temporizador de
    // vaciado o por el hook de salida del proceso.
    await waitFor(() => received.length >= 2);

    const main = received.find((request) => request.url === "/api/default/voltary/_json");
    const errors = received.find((request) => request.url === "/api/default/default/_json");

    // Endpoint principal: todos los logs.
    expect(main).toBeDefined();
    expect(main!.body.length).toBe(4);
    expect(main!.body.map((entry) => entry.level)).toEqual(["info", "info", "warn", "error"]);
    expect(main!.body.map((entry) => entry.message)).toEqual([
      "iniciando la aplicación",
      "servidor iniciado",
      "reintentando la petición",
      "no se pudo conectar a la base de datos",
    ]);

    // Endpoint de errores: solo los de nivel error.
    expect(errors).toBeDefined();
    expect(errors!.body.length).toBe(1);
    expect(errors!.body[0]!.level).toBe("error");
    expect(errors!.body[0]!.message).toBe("no se pudo conectar a la base de datos");

    // El campo project sale del stream de la URL, sin declararlo.
    for (const request of received) {
      for (const entry of request.body) {
        expect(entry.project).toBe("voltary");
      }
    }

    // El metadata llega intacto.
    expect(main!.body[1]!.puerto).toBe(3000);
    expect(main!.body[3]!.codigo).toBe("ECONNREFUSED");

    // Timestamps en microsegundos.
    for (const request of received) {
      for (const entry of request.body) {
        const timestamp = entry.timestamp as number;
        expect(timestamp).toBeGreaterThan(1_600_000_000_000_000);
        expect(timestamp).toBeLessThan(2_000_000_000_000_000);
      }
    }
  });
});
