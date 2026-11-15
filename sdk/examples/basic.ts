import { createOpenObserveLogger } from "../src/index";

// Las credenciales se leen del entorno:
//   OPENOBSERVE_URL, OPENOBSERVE_USERNAME, OPENOBSERVE_PASSWORD
const { logger, close } = createOpenObserveLogger();

logger.info({ port: 3000, env: "production" }, "servidor iniciado correctamente");
logger.warn({ retries: 2 }, "reintentando la operación");
logger.error({ db: "postgres", code: "ECONNREFUSED" }, "conexión fallida a la base de datos");

// `close()` vacía el buffer y espera a que se envíe todo.
await close();
