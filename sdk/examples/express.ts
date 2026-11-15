import express from "express";
import { createOpenObserveLogger } from "../src/index";

const { logger, close } = createOpenObserveLogger();

const app = express();

app.get("/pedidos/:id", (req, res) => {
  logger.info({ pedidoId: req.params.id }, "pedido solicitado");
  res.json({ ok: true });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: { message: err.message, stack: err.stack } }, "error no controlado");
  res.status(500).json({ error: "internal_error" });
});

const server = app.listen(3000, () => {
  logger.info({ port: 3000 }, "servidor escuchando");
});

// Apagado ordenado: primero dejamos de aceptar peticiones, luego vaciamos el buffer.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "apagando");
    server.close(async () => {
      await close();
      process.exit(0);
    });
  });
}
