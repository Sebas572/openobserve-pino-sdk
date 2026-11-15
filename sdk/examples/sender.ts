import { createOpenObserveSender } from "../src/index";

// API sin Pino, para proyectos que ya tienen su propio sistema de logs.
const sender = createOpenObserveSender();

await sender.send("info", "procesado correcto", { jobId: "abc-123" });
await sender.send("error", "no se pudo procesar", { jobId: "abc-123", reason: "timeout" });

// `flush()` fuerza el envío de lo pendiente.
await sender.flush();
await sender.close();
