/**
 * Ejemplo mínimo de uso del SDK de OpenObserve.
 *
 *   bun run main.ts
 *
 * Las credenciales se leen del entorno (Bun carga el `.env` automáticamente):
 *   OPENOBSERVE_URL, OPENOBSERVE_USERNAME, OPENOBSERVE_PASSWORD
 */
import { createOpenObserveLogger } from "./sdk/src/index.ts";

// No hay nada que declarar: el SDK saca el proyecto del stream de la URL
// (OPENOBSERVE_URL=https://observe.altasg2.org/api/default/ssc/_json -> ssc)
// y lo añade a todos los registros en el campo `project`.
//
// Los logs de nivel error van además al stream `default` de la misma
// organización: https://observe.altasg2.org/api/default/default/_json
const { logger } = createOpenObserveLogger();

// Usarlo como un logger de Pino normal.
logger.info("iniciando la aplicación");
logger.info({ puerto: 3000 }, "servidor iniciado");
logger.warn({ reintentos: 2 }, "reintentando la petición");
logger.error({ db: "postgres", codigo: "ECONNREFUSED" }, "no se pudo conectar a la base de datos");

// No hace falta hacer nada más: al terminar el proceso, el SDK vacía el
// buffer y envía los logs que quedaban pendientes.
