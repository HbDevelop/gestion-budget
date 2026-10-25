// Calendrier scolaire zone C et jours fériés (calendrier.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { VACANCES, joursFeries, vacancesDu, infoJour, vacancesDuMois, feriesDuMois, prochainesVacances, lendemain } from "../calendrier.js";

describe("calendrier scolaire (zone C) et jours fériés", () => {
  test("périodes bien formées et dans l'ordre", () => {
    VACANCES.forEach((v, i) => {
      assert.ok(v.du <= v.au, v.nom);
      if (i) assert.ok(VACANCES[i - 1].au < v.du, v.nom);
    });
  });

  test("Toussaint 2026 : du samedi 17 octobre au dimanche 1er novembre, reprise le 2", () => {
    assert.equal(vacancesDu("2026-10-16"), null);
    assert.equal(vacancesDu("2026-10-17T10:30").court, "Toussaint");
    assert.equal(vacancesDu("2026-11-01").court, "Toussaint");
    assert.equal(vacancesDu("2026-11-02"), null);
    assert.equal(lendemain("2026-11-01"), "2026-11-02");
    assert.equal(lendemain("2026-12-31"), "2027-01-01");
  });

  test("jours fériés, dont ceux qui dépendent de Pâques", () => {
    const f = joursFeries(2027);
    assert.equal(f["2027-03-29"], "Lundi de Pâques"); // Pâques 2027 : 28 mars
    assert.equal(f["2027-05-06"], "Ascension");
    assert.equal(f["2027-05-17"], "Lundi de Pentecôte");
    assert.equal(joursFeries(2026)["2026-04-06"], "Lundi de Pâques"); // Pâques 2026 : 5 avril
    assert.equal(Object.keys(f).length, 11);
  });

  test("infoJour : férié, vacances, les deux, ou rien", () => {
    assert.deepEqual(infoJour("2026-11-11"), { ferie: "Armistice 1918", vacances: null });
    assert.equal(infoJour("2026-11-01").ferie, "Toussaint");
    assert.equal(infoJour("2026-11-01").vacances.court, "Toussaint");
    assert.equal(infoJour("2026-10-13T18:30"), null);
  });

  test("vacances et fériés d'un mois, prochaines vacances", () => {
    assert.deepEqual(vacancesDuMois("2026-10").map((v) => v.court), ["Toussaint"]);
    assert.deepEqual(vacancesDuMois("2026-12").map((v) => v.court), ["Noël"]);
    assert.deepEqual(vacancesDuMois("2027-01").map((v) => v.court), ["Noël"]);
    assert.deepEqual(vacancesDuMois("2026-09"), []);
    assert.deepEqual(feriesDuMois("2026-11").map((f) => f.jour), ["2026-11-01", "2026-11-11"]);
    assert.equal(prochainesVacances("2026-10-25").court, "Toussaint");
    assert.equal(prochainesVacances("2026-11-02").court, "Noël");
  });
});
