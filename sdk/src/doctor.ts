import { resolveConfig } from "./config";
import type { OpenObserveOptions } from "./types";

/** Resultado de la comprobación de un endpoint. */
export interface EndpointCheck {
  /** URL comprobada (no incluye credenciales). */
  url: string;
  /** true si respondió con un 2xx. */
  ok: boolean;
  /** Código de estado HTTP, si hubo respuesta. */
  status?: number;
  /** Cuerpo de la respuesta (truncado a 500 caracteres). */
  body?: string;
  /** Error de red, si la petición no llegó a completarse. */
  error?: string;
  /** Tiempo que tardó la petición, en ms. */
  durationMs: number;
}

/** Resultado de la comprobación de conectividad con OpenObserve. */
export interface OpenObserveCheck {
  /** Endpoint del proyecto (el del `.env`). */
  project: EndpointCheck;
  /** Endpoint de errores, si la URL permite derivarlo. */
  errors?: EndpointCheck;
}

/**
 * Comprueba si los endpoints de OpenObserve aceptan los logs.
 *
 * Envía un registro de prueba a cada endpoint y devuelve el estado HTTP y el
 * cuerpo de la respuesta, que es lo que dice si el problema son las
 * credenciales, la URL o el formato del payload.
 *
 * ```ts
 * const report = await checkOpenObserve();
 * console.log(report.project.status, report.project.body);
 * ```
 */
export async function checkOpenObserve(
  options: OpenObserveOptions = {},
): Promise<OpenObserveCheck> {
  const config = resolveConfig(options);

  const project = await probe(config.url, config.authHeader, config.headers, config.timeout);

  const errors = config.errorUrl
    ? await probe(config.errorUrl, config.authHeader, config.headers, config.timeout)
    : undefined;

  return { project, errors };
}

/** Envía un registro de prueba y devuelve el resultado. */
async function probe(
  url: string,
  authHeader: string,
  extraHeaders: Record<string, string>,
  timeout: number,
): Promise<EndpointCheck> {
  const payload = [
    {
      _check: "openobserve-sdk",
      level: "info",
      message: "comprobación de conectividad",
      timestamp: Date.now() * 1000,
    },
  ];

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (authHeader) headers.Authorization = authHeader;

  const started = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeout),
    });

    return {
      url,
      ok: response.ok,
      status: response.status,
      body: (await response.text().catch(() => "")).slice(0, 500),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      error: (error as Error).message,
      durationMs: Date.now() - started,
    };
  }
}
