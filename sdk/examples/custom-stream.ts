import pino from "pino";
import { openObserveStream } from "../src/index";

// Solo el stream, para integrarlo en tu propio `pino.multistream`.
const stream = openObserveStream({ batchSize: 50, flushInterval: 1000 });

const logger = pino(
  { level: "debug" },
  pino.multistream([
    // Ojo: `pino.multistream` asigna "info" a las entradas sin nivel
    // explícito, y descartaría los logs debug/trace.
    { level: "trace", stream },
    { level: "trace", stream: process.stdout },
  ]),
);

logger.debug("este log llega a OpenObserve con level=debug");
logger.info("este llega con level=info");

await stream.close();
