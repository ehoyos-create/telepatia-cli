import assert from "node:assert/strict";
import { test } from "node:test";
import { pick, prune } from "../src/output.js";

test("prune drops empty values recursively but keeps false and 0", () => {
  const v = { a: null, b: "", c: [], d: {}, e: { f: null }, g: false, h: 0, i: [{ j: null, k: 1 }], l: "x" };
  assert.deepEqual(prune(v), { g: false, h: 0, i: [{ k: 1 }], l: "x" });
});

test("pick keeps dot-paths on objects and arrays", () => {
  const rows = [{ id: 1, status: "ok", patient: { fullName: "Ana", id: 9 }, extra: true }, { id: 2, status: "x" }];
  assert.deepEqual(pick(rows, ["id", "patient.fullName"]), [{ id: 1, patient: { fullName: "Ana" } }, { id: 2 }]);
});

test("pick reaches into wrapper objects", () => {
  const page = { totalCount: 2, patients: [{ id: 1, fullName: "Ana", ids: [] }, { id: 2 }] };
  assert.deepEqual(pick(page, ["id"]), { totalCount: 2, patients: [{ id: 1 }, { id: 2 }] });
});
