import { describe, expect, test } from "bun:test";
import {
  buildRecord,
  normalizeLevel,
  redactFields,
  toMicroseconds,
} from "../src/payload";

describe("toMicroseconds", () => {
  test("convierte segundos a microsegundos", () => {
    expect(toMicroseconds(1_793_497_628)).toBe(1_793_497_628_000_000);
  });

  test("convierte milisegundos a microsegundos", () => {
    expect(toMicroseconds(1_793_497_628_092)).toBe(1_793_497_628_092_000);
  });

  test("deja los microsegundos intactos", () => {
    expect(toMicroseconds(1_793_497_628_092_000)).toBe(1_793_497_628_092_000);
  });

  test("convierte nanosegundos a microsegundos", () => {
    expect(toMicroseconds(1_793_497_628_092_000_000)).toBe(1_793_497_628_092_000);
  });

  test("parsea fechas ISO", () => {
    const iso = "2026-01-01T00:00:00.000Z";
    expect(toMicroseconds(iso)).toBe(Date.parse(iso) * 1000);
  });

  test("usa la hora actual si no hay valor", () => {
    const before = Date.now() * 1000;
    const value = toMicroseconds(undefined);
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now() * 1000);
  });
});

describe("normalizeLevel", () => {
  test("convierte los códigos numéricos de Pino", () => {
    expect(normalizeLevel(10)).toBe("trace");
    expect(normalizeLevel(30)).toBe("info");
    expect(normalizeLevel(50)).toBe("error");
    expect(normalizeLevel(60)).toBe("fatal");
  });

  test("normaliza las variantes de texto", () => {
    expect(normalizeLevel("WARN")).toBe("warn");
    expect(normalizeLevel("warning")).toBe("warn");
  });

  test("cae en info si el nivel es desconocido", () => {
    expect(normalizeLevel(undefined)).toBe("info");
    expect(normalizeLevel(99)).toBe("info");
  });
});

describe("buildRecord", () => {
  test("normaliza el registro de Pino al formato de OpenObserve", () => {
    const record = buildRecord({
      level: 30,
      time: 1_793_497_628_092,
      pid: 1234,
      hostname: "host-1",
      msg: "servidor iniciado",
      port: 3000,
    });

    expect(record.level).toBe("info");
    expect(record.message).toBe("servidor iniciado");
    expect(record.timestamp).toBe(1_793_497_628_092_000);
    expect(record.port).toBe(3000);
    expect(record.pid).toBe(1234);
  });

  test("el mensaje real de Pino gana al campo message del usuario", () => {
    const record = buildRecord({
      level: 30,
      time: Date.now(),
      msg: "mensaje real",
      message: "campo del usuario",
    });

    expect(record.message).toBe("mensaje real");
  });

  test("el metadata no puede pisar level ni timestamp", () => {
    const record = buildRecord({
      level: 30,
      time: 1_793_497_628_092,
      msg: "hola",
    });

    expect(record.level).toBe("info");
    expect(record.timestamp).toBe(1_793_497_628_092_000);
  });

  test("añade los campos base sin pisar los del log", () => {
    const record = buildRecord(
      { level: 40, time: Date.now(), msg: "aviso" },
      { base: { service: "api", env: "prod" } },
    );

    expect(record.service).toBe("api");
    expect(record.env).toBe("prod");
    expect(record.level).toBe("warn");
  });

  test("redacta los campos sensibles", () => {
    const record = buildRecord({
      level: 30,
      time: Date.now(),
      msg: "login",
      password: "hunter2",
      user_password: "hunter2",
      token: "abc",
      port: 3000,
    });

    expect(record.password).toBe("[REDACTED]");
    expect(record.user_password).toBe("[REDACTED]");
    expect(record.token).toBe("[REDACTED]");
    expect(record.port).toBe(3000);
  });

  test("la redacción se puede desactivar", () => {
    const record = buildRecord(
      { level: 30, time: Date.now(), msg: "login", password: "hunter2" },
      { redact: false },
    );

    expect(record.password).toBe("hunter2");
  });
});

describe("redactFields", () => {
  test("no toca las claves normales", () => {
    const result = redactFields({ port: 3000, host: "localhost" }, ["password"]);
    expect(result).toEqual({ port: 3000, host: "localhost" });
  });

  test("recorre arrays y objetos anidados", () => {
    const result = redactFields(
      { users: [{ name: "ana", password: "x" }] },
      ["password"],
    );

    expect(result.users[0]?.password).toBe("[REDACTED]");
    expect(result.users[0]?.name).toBe("ana");
  });
});
