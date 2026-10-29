import { describe, expect, it } from "vitest";

import type { ConfigFieldDefinition } from "@/lib/config-definition-api";
import { validateFieldValue } from "./config-field-validation";
import { parseRawFields, tokenizeJson } from "./config-raw";

function def(over: Partial<ConfigFieldDefinition>): ConfigFieldDefinition {
  return {
    id: "d",
    fieldName: "F",
    dataType: "string",
    allowedValues: [],
    required: false,
    unknownSpec: false,
    description: null,
    unit: null,
    stOverridable: false,
    category: null,
    sensitive: false,
    restartRequired: false,
    defaultValue: null,
    supportedModels: [],
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("validateFieldValue", () => {
  it("accepts empty values (required is checked elsewhere)", () => {
    expect(validateFieldValue(def({ dataType: "integer" }), "")).toBeNull();
    expect(validateFieldValue(def({ dataType: "integer" }), undefined)).toBeNull();
  });

  it("checks integer and decimal separately", () => {
    expect(validateFieldValue(def({ dataType: "integer" }), "8080")).toBeNull();
    expect(validateFieldValue(def({ dataType: "integer" }), "80.5")).toBe("ต้องเป็นจำนวนเต็ม");
    expect(validateFieldValue(def({ dataType: "decimal" }), "80.5")).toBeNull();
    expect(validateFieldValue(def({ dataType: "decimal" }), "abc")).toBe("ต้องเป็นตัวเลข");
  });

  it("checks allowed values", () => {
    const d = def({ allowedValues: ["TCP", "UDP"] });
    expect(validateFieldValue(d, "TCP")).toBeNull();
    expect(validateFieldValue(d, "FTP")).toContain("TCP, UDP");
  });

  it("checks json object vs array", () => {
    expect(validateFieldValue(def({ dataType: "json" }), '{"a":1}')).toBeNull();
    expect(validateFieldValue(def({ dataType: "json" }), "[1]")).toContain("JSON object");
    expect(validateFieldValue(def({ dataType: "array" }), "[1]")).toBeNull();
    expect(validateFieldValue(def({ dataType: "array" }), "{")).toBe("ไม่ใช่ JSON ที่ถูกต้อง");
  });
});

describe("parseRawFields", () => {
  const defs = [def({ fieldName: "A" }), def({ fieldName: "B" })];

  it("parses a known object", () => {
    expect(parseRawFields('{"A": 1}', defs)).toEqual({ ok: true, fields: { A: 1 } });
  });

  it("rejects bad json, arrays and unknown fields", () => {
    expect(parseRawFields("{", defs).ok).toBe(false);
    expect(parseRawFields("[]", defs)).toMatchObject({ ok: false });
    const unknown = parseRawFields('{"Z": 1}', defs);
    expect(unknown).toMatchObject({ ok: false });
    expect(!unknown.ok && unknown.error).toContain("Z");
  });
});

describe("tokenizeJson", () => {
  it("splits keys, strings, numbers and literals and keeps the text intact", () => {
    const text = '{"a": 1, "b": "x", "c": true}';
    const tokens = tokenizeJson(text);
    expect(tokens.map((t) => t.text).join("")).toBe(text);
    expect(tokens.filter((t) => t.kind === "key").map((t) => t.text)).toEqual(['"a"', '"b"', '"c"']);
    expect(tokens.some((t) => t.kind === "number" && t.text === "1")).toBe(true);
    expect(tokens.some((t) => t.kind === "literal" && t.text === "true")).toBe(true);
  });
});

describe("maskSensitiveFields", () => {
  it("replaces only sensitive values", async () => {
    const { maskSensitiveFields, SENSITIVE_MASK } = await import("./config-raw");
    const defs = [def({ fieldName: "PW", sensitive: true }), def({ fieldName: "PORT" })];
    expect(maskSensitiveFields({ PW: "s3cret", PORT: 80 }, defs)).toEqual({
      PW: SENSITIVE_MASK,
      PORT: 80,
    });
  });
});
