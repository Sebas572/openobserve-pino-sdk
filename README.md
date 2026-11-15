# openobserve-pino-sdk

Librería independiente (no oficial) creada para facilitar la conexión entre [Pino](https://getpino.io/) y [OpenObserve](https://openobserve.ai/).

- **Batching configurable**: agrupa logs por cantidad (`batchSize`) y/o por tiempo (`flushInterval`), o desactiva el temporizador para subir únicamente por paquetes.
- **Reintentos con backoff exponencial**: reintenta automáticamente ante errores de red, `429` y `5xx`.
- **Redacción de datos sensibles**: oculta claves como `password`, `token`, `authorization`, `secret`, `api_key`, etc.
- **Normalización automática**: convierte niveles de Pino a texto (`info`, `error`, etc.) y timestamps a microsegundos.
- **Stream de errores**: los logs de nivel `error` se envían a tu stream y también se replican al stream `default` de la misma organización.
- **Vaciado al salir**: envía los logs pendientes automáticamente al terminar el proceso (`SIGINT`, `SIGTERM`, `beforeExit`).

---

## Requisitos

- **Node.js** `>= 18` o **Bun**
- **Pino** `>= 9` (`peerDependency`)

---

## Instalación

Instala el paquete oficial de `pino` junto con `openobserve-pino-sdk`:

```bash
npm install pino openobserve-pino-sdk
# o con Bun
bun add pino openobserve-pino-sdk
# o con pnpm
pnpm add pino openobserve-pino-sdk
```

---

## Inicio rápido (`openObserveSetup`)

Conecta tu instancia oficial de `pino` con OpenObserve en una sola llamada:

```ts
import pino from "pino";
import { openObserveSetup } from "openobserve-pino-sdk";

const logger = openObserveSetup(
  pino,
  {
    url: "https://observe.tu-dominio.com/api/default/mi-proyecto/_json",
    username: "tu-usuario",
    password: "tu-password",
    batchSize: 300,       // sube en paquetes de 300 logs
    flushInterval: false, // desactiva el envío por tiempo (solo al llegar a 300 o al salir)
  },
  {
    level: "info",
    name: "mi-api",
    // cualquier otra opción nativa de Pino (serializers, formatters, redact, etc.)
  },
);

logger.info({ userId: 42 }, "sesión iniciada");
logger.error({ db: "postgres", code: "ECONNREFUSED" }, "conexión fallida");
```

### Usando variables de entorno (`.env`)

Crea un archivo `.env` en la raíz de tu proyecto con estas variables:

```env
OPENOBSERVE_URL=https://observe.tu-dominio.com/api/default/mi-proyecto/_json
OPENOBSERVE_USERNAME=tu-usuario
OPENOBSERVE_PASSWORD=tu-password

# Opcional: subir en paquetes de 300 logs sin temporizador
OPENOBSERVE_BATCH_SIZE=300
OPENOBSERVE_FLUSH_INTERVAL=0
```

Con el `.env` configurado, no necesitas pasar credenciales por código:

```ts
import pino from "pino";
import { openObserveSetup } from "openobserve-pino-sdk";

const logger = openObserveSetup(pino);

logger.info("aplicación iniciada");
```

---

## Uso como transport de Pino

También puedes usarlo con `pino.transport()` (en worker thread o combinado con otros targets):

```ts
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: {
    targets: [
      {
        target: "openobserve-pino-sdk/transport",
        options: {
          batchSize: 300,
          flushInterval: false,
        },
      },
      {
        target: "pino-pretty",
        options: { colorize: true },
      },
    ],
  },
});

logger.info("servidor listo");
```

---

## Otras APIs disponibles

| Función | Descripción |
| --- | --- |
| `openObserveSetup(pino, ooOptions?, pinoOptions?)` | Conecta tu instancia de `pino` con OpenObserve y devuelve el `Logger`. |
| `createOpenObserveLogger(options?)` | Crea un logger y devuelve `{ logger, flush, close }` para control manual del buffer. |
| `openObserveStream(options?)` | Devuelve únicamente el stream `OpenObserveTransport` para integrarlo en tu propio `pino.multistream(...)`. |
| `createOpenObserveSender(options?)` | Cliente ligero sin Pino (`send`, `flush`, `close`) para proyectos con otro logger. |
| `checkOpenObserve(options?)` | Envía un registro de prueba para diagnosticar URL, TLS y credenciales. |

---

## Configuración y variables de entorno

Las opciones pasadas por código tienen prioridad sobre las variables de entorno.

| Opción | Variable de entorno | Por defecto | Descripción |
| --- | --- | --- | --- |
| `url` | `OPENOBSERVE_URL` | `https://api.openobserve.ai/api/default/nodejs/_json` | Endpoint completo de ingesta JSON. |
| `baseUrl` | `OPENOBSERVE_BASE_URL` | — | Host base (se combina con `org` y `stream`). |
| `org` | `OPENOBSERVE_ORG` | `default` | Organización de OpenObserve. |
| `stream` | `OPENOBSERVE_STREAM` | `nodejs` | Stream destino (se añade como campo `project`). |
| `username` | `OPENOBSERVE_USERNAME` | — | Usuario de OpenObserve. |
| `password` | `OPENOBSERVE_PASSWORD` | — | Contraseña de OpenObserve. |
| `authKey` | `OPENOBSERVE_AUTH_KEY` | — | Clave Base64 (`usuario:contraseña`), alternativa a usuario/contraseña. |
| `batchSize` | `OPENOBSERVE_BATCH_SIZE` | `100` | Número de logs por paquete enviado. |
| `flushInterval` | `OPENOBSERVE_FLUSH_INTERVAL` | `2000` | Intervalo de envío en ms (`0` o `false` lo desactiva). |
| `level` | `LOG_LEVEL` | `info` | Nivel mínimo de log. |
| `maxRetries` | — | `3` | Reintentos ante error de red, `429` o `5xx`. |
| `retryDelay` | — | `500` | Espera inicial del backoff exponencial, en ms. |
| `timeout` | — | `10000` | Timeout por petición HTTP, en ms. |
| `maxBufferSize` | — | `batchSize * 20` | Límite máximo de logs en memoria. |
| `redact` | — | `DEFAULT_REDACT_KEYS` | Claves a sustituir por `"[REDACTED]"`, o `false` para desactivar. |
| `base` | — | `{}` | Campos adicionales comunes a todos los logs. |
| `stdout` | — | `true` | Escribe también en `stdout`. |
| `pretty` | — | `false` | Formatea `stdout` con `pino-pretty` (si está instalado). |
| `autoFlushOnExit` | — | `true` | Vacía el buffer automáticamente al terminar el proceso. |
| `allowAnonymous` | — | `false` | Permite enviar sin credenciales (útil detrás de un proxy). |

---

## Licencia

MIT
