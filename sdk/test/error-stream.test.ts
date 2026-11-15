import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { resolveConfig } from "../src/config";
import { OpenObserveTransport } from "../src/transport";

/**
 * Estas pruebas controlan las variables de entorno porque en la máquina de
 * desarrollo puede haber un OPENOBSERVE_URL exportado, y las variables del
 * entorno tienen prioridad sobre las opciones explícitas.
 */
const ENV_KEYS = [
  "OPENOBSERVE_URL",
  "OPENOBSERVE_BASE_URL",
  "OPENOBSERVE_ORG",
  "OPENOBSERVE_STREAM",
];

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterAll(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

interface Captured {
  url: string;
  body: Record<string, unknown>[];
}

/** Fetch falso que registra las peticiones y devuelve 200. */
function fakeFetch() {
  const captured: Captured[] = [];

  const fn = (async (url: string, init: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init.body)) as Record<string, unknown>[],
    });
    return new Response("", { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  return { fn, captured };
}

const MAIN = "https://observe.altasg2.org/api/default/ssc/_json";
const ERRORS = "https://observe.altasg2.org/api/default/default/_json";

describe("endpoint de errores", () => {
  test("se deriva solo: el stream default de la misma organización", () => {
    const config = resolveConfig({ url: MAIN, username: "u", password: "p" });
    expect(config.errorUrl).toBe(ERRORS);
  });

  test("se deriva también cuando la URL se construye por partes", () => {
    const config = resolveConfig({
      baseUrl: "https://observe.altasg2.org",
      org: "default",
      stream: "ssc",
      username: "u",
      password: "p",
    });

    expect(config.url).toBe(MAIN);
    expect(config.errorUrl).toBe(ERRORS);
  });

  test("si la URL no tiene forma /api/{org}/{stream}/_json no hay segundo endpoint", () => {
    const config = resolveConfig({
      url: "https://otro.test/ingesta",
      username: "u",
      password: "p",
    });

    expect(config.errorUrl).toBeUndefined();
  });

  test("los errores van a los dos endpoints y el resto solo al principal", async () => {
    const { fn, captured } = fakeFetch();
    const transport = new OpenObserveTransport(
      resolveConfig({
        url: MAIN,
        username: "u",
        password: "p",
        fetch: fn,
        flushInterval: 60_000,
      }),
    );

    const line = (level: number, msg: string) =>
      `${JSON.stringify({ level, time: Date.now(), msg })}\n`;

    transport.write(line(30, "info normal"));
    transport.write(line(40, "un warning"));
    transport.write(line(50, "un error"));

    await transport.flush();

    const main = captured.find((request) => request.url === MAIN);
    const errors = captured.find((request) => request.url === ERRORS);

    // Al endpoint principal va todo.
    expect(main).toBeDefined();
    expect(main!.body.map((entry) => entry.message)).toEqual([
      "info normal",
      "un warning",
      "un error",
    ]);

    // Al endpoint de errores solo los de nivel error.
    expect(errors).toBeDefined();
    expect(errors!.body.map((entry) => entry.message)).toEqual(["un error"]);
    expect(errors!.body[0]!.level).toBe("error");

    await transport.close();
  });

  test("sin errores en el lote no se llama al endpoint de errores", async () => {
    const { fn, captured } = fakeFetch();
    const transport = new OpenObserveTransport(
      resolveConfig({
        url: MAIN,
        username: "u",
        password: "p",
        fetch: fn,
        flushInterval: 60_000,
      }),
    );

    transport.write(`${JSON.stringify({ level: 30, time: Date.now(), msg: "info" })}\n`);
    await transport.flush();

    expect(captured.length).toBe(1);
    expect(captured[0]!.url).toBe(MAIN);

    await transport.close();
  });

  test("solo el nivel error va al endpoint de errores", async () => {
    const { fn, captured } = fakeFetch();
    const transport = new OpenObserveTransport(
      resolveConfig({
        url: MAIN,
        username: "u",
        password: "p",
        fetch: fn,
        flushInterval: 60_000,
      }),
    );

    transport.write(`${JSON.stringify({ level: 60, time: Date.now(), msg: "fatal" })}\n`);
    transport.write(`${JSON.stringify({ level: 40, time: Date.now(), msg: "warn" })}\n`);

    await transport.flush();

    expect(captured.length).toBe(1);
    expect(captured[0]!.url).toBe(MAIN);

    await transport.close();
  });
});

describe("campo project", () => {
  test("se saca del stream de la URL, sin declararlo", () => {
    const config = resolveConfig({ url: MAIN, username: "u", password: "p" });

    expect(config.project).toBe("ssc");
    expect(config.base.project).toBe("ssc");
  });

  test("también cuando la URL se construye por partes", () => {
    const config = resolveConfig({
      baseUrl: "https://observe.altasg2.org",
      org: "default",
      stream: "voltary",
      username: "u",
      password: "p",
    });

    expect(config.base.project).toBe("voltary");
  });

  test("si la URL no es reconocible, no se añade el campo", () => {
    const config = resolveConfig({
      url: "https://otro.test/ingesta",
      username: "u",
      password: "p",
    });

    expect(config.project).toBeUndefined();
    expect(config.base.project).toBeUndefined();
  });
});
