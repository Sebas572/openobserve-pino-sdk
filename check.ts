/**
 * Comprobación de conectividad con OpenObserve.
 *
 *   bun run check.ts
 *
 * Envía un registro de prueba a cada endpoint y muestra el estado HTTP y la
 * respuesta, que es lo que permite saber si el problema son las credenciales,
 * la URL o el formato del payload. No imprime las credenciales.
 */
import { checkOpenObserve } from "./sdk/src/index.ts";

const report = await checkOpenObserve();

function show(title: string, result: { url: string; ok: boolean; status?: number; body?: string; error?: string; durationMs: number }) {
  console.log(`\n=== ${title} ===`);
  console.log("URL       :", result.url);
  console.log("Correcto  :", result.ok);
  console.log("Estado    :", result.status ?? "(sin respuesta)");
  console.log("Respuesta :", result.body ?? "(vacía)");
  console.log("Error     :", result.error ?? "(ninguno)");
  console.log("Duración  :", `${result.durationMs} ms`);
}

show("Endpoint del proyecto", report.project);
if (report.errors) show("Endpoint de errores", report.errors);

const failed = [report.project, report.errors].filter(
  (result): result is NonNullable<typeof result> => result !== undefined && !result.ok,
);

if (failed.length > 0) {
  console.log("\nAlgún endpoint no aceptó el registro de prueba.");
  console.log("Causas habituales:");
  console.log("  401/403 -> usuario o contraseña incorrectos (OPENOBSERVE_USERNAME / OPENOBSERVE_PASSWORD).");
  console.log("  404    -> la URL no es correcta: revisa OPENOBSERVE_URL y el nombre del stream.");
  console.log("  400    -> el endpoint rechazó el formato del payload.");
  console.log("  error  -> no hay conexión o el certificado TLS no es válido.");
}
