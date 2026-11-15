import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";

/**
 * Comprueba que el buffer se vacía solo al terminar el proceso, sin que
 * nadie llame a `close()`.
 */

const sdkUrl = pathToFileURL(`${import.meta.dir}/../sdk/src/index.ts`).href;

/** Código del proceso hijo: usa el SDK y cierra o no, según el caso. */
function buildScript(withClose: boolean): string {
  return `
import { createOpenObserveLogger } from "${sdkUrl}";

const { logger, close } = createOpenObserveLogger({
  url: process.env.OO_URL,
  username: "u",
  password: "p",
  stdout: false,
});

logger.info("mensaje de prueba");
${withClose ? "await close();" : "// sin close(): el SDK debería vaciar el buffer solo"}
`;
}

/** Ejecuta el script contra un OpenObserve simulado y devuelve los lotes recibidos. */
async function run(withClose: boolean): Promise<unknown[][]> {
  const received: unknown[][] = [];

  const mock = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      received.push((await request.json()) as unknown[]);
      return new Response("success", { status: 200 });
    },
  });

  const child = Bun.spawn(["bun", "-e", buildScript(withClose)], {
    env: {
      ...process.env,
      OO_URL: `http://127.0.0.1:${mock.port}/api/default/nodejs/_json`,
    },
    stdout: "ignore",
    stderr: "ignore",
  });

  await child.exited;
  // Margen para que llegue cualquier petición que hubiera salido volando.
  await new Promise((resolve) => setTimeout(resolve, 500));

  mock.stop();

  return received;
}

test("sin close() el lote se envía igualmente al terminar el proceso", async () => {
  const received = await run(false);

  expect(received.length).toBe(1);
  expect(received[0]![0]).toMatchObject({
    message: "mensaje de prueba",
    level: "info",
    project: "nodejs",
  });
});

test("con close() el lote también se envía", async () => {
  const received = await run(true);

  expect(received.length).toBe(1);
  expect(received[0]![0]).toMatchObject({
    message: "mensaje de prueba",
    level: "info",
    project: "nodejs",
  });
});
