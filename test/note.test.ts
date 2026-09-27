import assert from "node:assert/strict";
import { test } from "node:test";
import { noteSections, sectionsToMarkdown, transcriptToText } from "../src/note.js";

test("plain, wrapped, structured and assessment/plan sections", () => {
  const record = {
    chiefComplaint: "Dolor de cabeza",
    historyOfPresentIllness: { content: "3 días de evolución", status: "completed" },
    vitalSigns: { content: { data: { bp: { title: "TA", content: "120/80" }, hr: { title: "FC", content: "72" } } } },
    assessmentPlan: { assessment: "Cefalea tensional", plan: { content: [{ content: "Acetaminofén" }, { content: "Control en 1 semana" }] } },
    customThing: { weird: [1, 2] },
  };
  const s = noteSections(record, ["chiefComplaint", "historyOfPresentIllness", "vitalSigns", "assessmentPlan"]);
  assert.deepEqual(s.map((x) => x.key), ["chiefComplaint", "historyOfPresentIllness", "vitalSigns", "assessmentPlan", "customThing"]);
  assert.equal(s[0].title, "Motivo de consulta");
  assert.equal(s[1].text, "3 días de evolución");
  assert.equal(s[2].text, "**TA:** 120/80\n**FC:** 72");
  assert.match(s[3].text, /Cefalea tensional/);
  assert.match(s[3].text, /- Acetaminofén\n- Control en 1 semana/);
  assert.match(s[4].text, /```json/); // unknown shapes are never dropped
  assert.equal(s[4].title, "Custom Thing");
});

test("template nodes drive order, titles and hidden sections", () => {
  const record = { a: "A", b: "B", c: "C" };
  const nodes = [
    { key: "b", order: 1, name: { es: "Be" } },
    { key: "a", order: 2, name: { default: "Aa" } },
    { key: "c", order: 3, hidden: true },
  ];
  const s = noteSections(record, undefined, { nodes, locale: "es" });
  assert.deepEqual(s.map((x) => [x.key, x.title]), [["b", "Be"], ["a", "Aa"]]);
});

test("pending sections render as status", () => {
  const md = sectionsToMarkdown(noteSections({ diagnosis: { status: "processing" } }));
  assert.match(md, /## Diagnóstico\n\n_\(processing\)_/);
});

test("transcript shapes", () => {
  assert.equal(transcriptToText("hola"), "hola");
  assert.equal(transcriptToText([{ speaker: "Médico", text: "Hola" }, { text: "Buenas" }]), "Médico: Hola\nBuenas");
  assert.equal(transcriptToText({ segments: ["a", "b"] }), "a\nb");
  assert.equal(transcriptToText(null), "");
});

test("real server shape: titles from server, empty sections stay empty", () => {
  const record = {
    identification: {
      title: "Identificación",
      type: "structured",
      status: "completed",
      content: { data: { name: { title: "Nombre", content: "" }, age: { title: "Edad", content: "" } }, order: ["name", "age"] },
    },
    chiefComplaint: { title: "Motivo de la consulta", type: "text", status: "completed", content: "Dolor" },
    labs: { title: "Laboratorios", type: "text", status: "completed", content: "" },
    assessmentPlan: {
      title: "Análisis y plan",
      type: "structured",
      status: "completed",
      content: {
        data: { assessment: { title: "Análisis", content: "Cefalea" }, plan: { title: "Plan", content: [{ content: "Reposo" }, { content: "Control" }] } },
        order: ["assessment", "plan"],
      },
    },
  };
  const s = noteSections(record);
  assert.equal(s[0].text, "");
  assert.equal(s[1].title, "Motivo de la consulta");
  assert.equal(s[2].text, "");
  assert.equal(s[3].text, "**Análisis:** Cefalea\n\n**Plan:**\n- Reposo\n- Control");
  assert.ok(!s.some((x) => x.text.includes("```")));
});

import { toCountryName } from "../src/countries.js";

test("country: ISO code, enum value and plain name map to the CountryName enum", () => {
  assert.equal(toCountryName("CO"), "COLOMBIA");
  assert.equal(toCountryName("br"), "BRAZIL");
  assert.equal(toCountryName("COLOMBIA"), "COLOMBIA");
  assert.equal(toCountryName("costa rica"), "COSTA_RICA");
  assert.equal(toCountryName("México"), "MEXICO");
  assert.throws(() => toCountryName("Narnia"), /País desconocido/);
});
