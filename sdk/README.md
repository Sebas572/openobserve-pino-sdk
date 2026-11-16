# openobserve-pino-sdk

> **[English](#english)** | **[Español](#español)**

---

## English

Independent (unofficial) library built to simplify connecting [Pino](https://getpino.io/) with [OpenObserve](https://openobserve.ai/).

- **Configurable batching**: group logs by count (`batchSize`) and/or time (`flushInterval`), or disable the timer to upload strictly in batches.
- **Level filtering**: upload only specific levels (`includeLevels`) or everything except certain levels (`excludeLevels`).
- **Exponential backoff retries**: automatic retries on network errors, `429`, and `5xx`.
- **Sensitive data redaction**: masks keys like `password`, `token`, `authorization`, `secret`, `api_key`, etc.
- **Automatic normalization**: converts Pino numeric levels (`30` → `"info"`) and timestamps to microseconds.
- **Error stream**: `error` logs are sent to your stream and also replicated to the `default` stream of the same organization.
- **Flush on exit**: automatically flushes pending logs on process exit (`SIGINT`, `SIGTERM`, `beforeExit`).

### Requirements

- **Node.js** `>= 18` or **Bun**
- **Pino** `>= 9` (`peerDependency`)

### Installation

Install the official `pino` package alongside `openobserve-pino-sdk`:

```bash
npm install pino openobserve-pino-sdk
# or with Bun
bun add pino openobserve-pino-sdk
# or with pnpm
pnpm add pino openobserve-pino-sdk
```

### Quick Start (`openObserveSetup`)

Connect your official `pino` instance to OpenObserve in a single call:

```ts
import pino from "pino";
import { openObserveSetup } from "openobserve-pino-sdk";

const logger = openObserveSetup(
  pino,
  {
    url: "https://observe.your-domain.com/api/default/my-project/_json",
    username: "your-username",
    password: "your-password",
    batchSize: 300,       // upload in batches of 300 logs
    flushInterval: false, // disable time-based flushing (batch or exit only)
    // includeLevels: ["warn", "error", "fatal"],
    // excludeLevels: ["trace", "debug"],
  },
  {
    level: "info",
    name: "my-api",
    // any other native Pino options (serializers, formatters, redact, etc.)
  },
);

logger.info({ userId: 42 }, "session started");
logger.error({ db: "postgres", code: "ECONNREFUSED" }, "connection failed");
```

#### Using environment variables (`.env`)

Create a `.env` file in your project root:

```env
OPENOBSERVE_URL=https://observe.your-domain.com/api/default/my-project/_json
OPENOBSERVE_USERNAME=your-username
OPENOBSERVE_PASSWORD=your-password

# Optional: upload in batches of 300 logs without timer
OPENOBSERVE_BATCH_SIZE=300
OPENOBSERVE_FLUSH_INTERVAL=0

# Optional: level filtering (comma-separated)
# OPENOBSERVE_INCLUDE_LEVELS=warn,error,fatal
# OPENOBSERVE_EXCLUDE_LEVELS=trace,debug
```

With `.env` configured, no credentials are needed in code:

```ts
import pino from "pino";
import { openObserveSetup } from "openobserve-pino-sdk";

const logger = openObserveSetup(pino);

logger.info("application started");
```

### Using as a Pino Transport

You can also use it with `pino.transport()` (in a worker thread or combined with other targets):

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
    ],
  },
});

logger.info("server ready");
```

### Other Available APIs

| Function | Description |
| --- | --- |
| `openObserveSetup(pino, ooOptions?, pinoOptions?)` | Connects your `pino` instance to OpenObserve and returns the `Logger`. |
| `createOpenObserveLogger(options?)` | Creates a logger and returns `{ logger, flush, close }` for manual buffer control. |
| `openObserveStream(options?)` | Returns only the `OpenObserveTransport` stream for a custom `pino.multistream(...)`. |
| `createOpenObserveSender(options?)` | Lightweight client without Pino (`send`, `flush`, `close`) for projects using another logger. |
| `checkOpenObserve(options?)` | Sends a test record to diagnose URL, TLS, and credentials. |

### Configuration & Environment Variables

Options passed in code take precedence over environment variables.

| Option | Environment Variable | Default | Description |
| --- | --- | --- | --- |
| `url` | `OPENOBSERVE_URL` | `https://api.openobserve.ai/api/default/nodejs/_json` | Full JSON ingestion endpoint. |
| `baseUrl` | `OPENOBSERVE_BASE_URL` | — | Base host (combined with `org` and `stream`). |
| `org` | `OPENOBSERVE_ORG` | `default` | OpenObserve organization. |
| `stream` | `OPENOBSERVE_STREAM` | `nodejs` | Target stream (added as `project` field). |
| `username` | `OPENOBSERVE_USERNAME` | — | OpenObserve username. |
| `password` | `OPENOBSERVE_PASSWORD` | — | OpenObserve password. |
| `authKey` | `OPENOBSERVE_AUTH_KEY` | — | Base64 key (`username:password`), alternative to username/password. |
| `batchSize` | `OPENOBSERVE_BATCH_SIZE` | `100` | Number of logs per uploaded batch. |
| `flushInterval` | `OPENOBSERVE_FLUSH_INTERVAL` | `2000` | Flush interval in ms (`0` or `false` disables it). |
| `includeLevels` | `OPENOBSERVE_INCLUDE_LEVELS` | — | Allowlist: only upload these levels (comma-separated in `.env`). |
| `excludeLevels` | `OPENOBSERVE_EXCLUDE_LEVELS` | — | Denylist: upload all except these levels (comma-separated in `.env`). |
| `level` | `LOG_LEVEL` | `info` | Minimum log level. |
| `maxRetries` | — | `3` | Retries on network error, `429`, or `5xx`. |
| `retryDelay` | — | `500` | Initial exponential backoff delay, in ms. |
| `timeout` | — | `10000` | HTTP request timeout, in ms. |
| `maxBufferSize` | — | `batchSize * 20` | Maximum logs kept in memory. |
| `redact` | — | `DEFAULT_REDACT_KEYS` | Keys replaced with `"[REDACTED]"`, or `false` to disable. |
| `base` | — | `{}` | Common fields added to every log. |
| `stdout` | — | `true` | Also writes to `stdout`. |
| `pretty` | — | `false` | Formats `stdout` with `pino-pretty` (if installed). |
| `autoFlushOnExit` | — | `true` | Automatically flushes buffer on process exit. |
| `allowAnonymous` | — | `false` | Allows sending without credentials (useful behind a proxy). |

---

## Español

Librería independiente (no oficial) creada para facilitar la conexión entre [Pino](https://getpino.io/) y [OpenObserve](https://openobserve.ai/).

- **Batching configurable**: agrupa logs por cantidad (`batchSize`) y/o por tiempo (`flushInterval`), o desactiva el temporizador para subir únicamente por paquetes.
- **Filtro por niveles**: decide qué niveles subir (`includeLevels`) o cuáles excluir (`excludeLevels`).
- **Reintentos con backoff exponencial**: reintenta automáticamente ante errores de red, `429` y `5xx`.
- **Redacción de datos sensibles**: oculta claves como `password`, `token`, `authorization`, `secret`, `api_key`, etc.
- **Normalización automática**: convierte niveles numéricos de Pino (`30` → `"info"`) y timestamps a microsegundos.
- **Stream de errores**: los logs de nivel `error` se envían a tu stream y también se replican al stream `default` de la misma organización.
- **Vaciado al salir**: envía los logs pendientes automáticamente al terminar el proceso (`SIGINT`, `SIGTERM`, `beforeExit`).

### Requisitos

- **Node.js** `>= 18` o **Bun**
- **Pino** `>= 9` (`peerDependency`)

### Instalación

Instala el paquete oficial de `pino` junto con `openobserve-pino-sdk`:

```bash
npm install pino openobserve-pino-sdk
# o con Bun
bun add pino openobserve-pino-sdk
# o con pnpm
pnpm add pino openobserve-pino-sdk
```

### Inicio rápido (`openObserveSetup`)

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
    // includeLevels: ["warn", "error", "fatal"],
    // excludeLevels: ["trace", "debug"],
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

#### Usando variables de entorno (`.env`)

Crea un archivo `.env` en la raíz de tu proyecto con estas variables:

```env
OPENOBSERVE_URL=https://observe.tu-dominio.com/api/default/mi-proyecto/_json
OPENOBSERVE_USERNAME=tu-usuario
OPENOBSERVE_PASSWORD=tu-password

# Opcional: subir en paquetes de 300 logs sin temporizador
OPENOBSERVE_BATCH_SIZE=300
OPENOBSERVE_FLUSH_INTERVAL=0

# Opcional: filtrar qué niveles se suben (separados por coma)
# OPENOBSERVE_INCLUDE_LEVELS=warn,error,fatal
# OPENOBSERVE_EXCLUDE_LEVELS=trace,debug
```

Con el `.env` configurado, no necesitas pasar credenciales por código:

```ts
import pino from "pino";
import { openObserveSetup } from "openobserve-pino-sdk";

const logger = openObserveSetup(pino);

logger.info("aplicación iniciada");
```

### Uso como transport de Pino

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
    ],
  },
});

logger.info("servidor listo");
```

### Otras APIs disponibles

| Función | Descripción |
| --- | --- |
| `openObserveSetup(pino, ooOptions?, pinoOptions?)` | Conecta tu instancia de `pino` con OpenObserve y devuelve el `Logger`. |
| `createOpenObserveLogger(options?)` | Crea un logger y devuelve `{ logger, flush, close }` para control manual del buffer. |
| `openObserveStream(options?)` | Devuelve únicamente el stream `OpenObserveTransport` para integrarlo en tu propio `pino.multistream(...)`. |
| `createOpenObserveSender(options?)` | Cliente ligero sin Pino (`send`, `flush`, `close`) para proyectos con otro logger. |
| `checkOpenObserve(options?)` | Envía un registro de prueba para diagnosticar URL, TLS y credenciales. |

### Configuración y variables de entorno

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
| `includeLevels` | `OPENOBSERVE_INCLUDE_LEVELS` | — | Lista blanca: solo sube estos niveles (en `.env` separados por coma, ej. `warn,error`). |
| `excludeLevels` | `OPENOBSERVE_EXCLUDE_LEVELS` | — | Lista negra: sube todos excepto estos niveles (en `.env` separados por coma, ej. `trace,debug`). |
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

## License / Licencia

MIT
