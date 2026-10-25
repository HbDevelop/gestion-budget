// Investissement matériel (materiel.js) : valeur qui baisse avec le temps, ventes, estimations,
// montants par mois pour le budget, bilan et séries pour l'onglet Analyse.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { valeurAu, achatsDe, montantsParMois, bilanMateriel, serieMateriel, finDeMois } from "../materiel.js";

const sono = { owner: "marwa", nom: "Sono", date: "2026-01-01", prix: 1000, duree: 5, residuel: 20 };

describe("investissement matériel", () => {
  test("valeur : prix d'achat, puis baisse linéaire jusqu'à la revente minimale", () => {
    assert.equal(valeurAu(sono, "2025-12-31"), 0);
    assert.equal(valeurAu(sono, "2026-01-01"), 1000);
    assert.equal(valeurAu(sono, "2027-01-01"), 840.11); // 1000 − 800 / 5 ans × 365 jours (année de 365,25 j)
    assert.equal(valeurAu(sono, "2036-01-01"), 200);
    // Réglages par défaut : 5 ans, 20 %.
    assert.equal(valeurAu({ date: "2026-01-01", prix: 1000 }, "2036-01-01"), 200);
  });

  test("estimation saisie à la main : la valeur repart de là, au même rythme", () => {
    const a = { ...sono, estimation: { valeur: 700, date: "2026-07-01" } };
    assert.equal(valeurAu(a, "2026-06-30"), valeurAu(sono, "2026-06-30"));
    assert.equal(valeurAu(a, "2026-07-01"), 700);
    assert.equal(valeurAu(a, "2027-07-01"), 540.11);
    assert.equal(valeurAu({ ...sono, estimation: { valeur: 150, date: "2026-07-01" } }, "2030-01-01"), 150);
  });

  test("vente : plus de valeur, argent récupéré compté à part", () => {
    const a = { ...sono, vente: { prix: 600, date: "2027-03-15" } };
    assert.ok(valeurAu(a, "2027-03-14") > 0);
    assert.equal(valeurAu(a, "2027-03-15"), 0);
    const b = bilanMateriel([{ id: "x", ...a }], "2027-06-01");
    assert.deepEqual(b, { investi: 1000, valeur: 0, recupere: 600, perte: 400, gardes: 0, vendus: 1 });
  });

  test("achats d'une personne, montants par mois, bilan, séries", () => {
    const materiel = {
      s: sono,
      m: { owner: "marwa", nom: "Micros", date: "2026-01-20", prix: 300, duree: 5, residuel: 20 },
      p: { owner: "habib", nom: "Perceuse", date: "2026-02-03", prix: 100 },
      f: { owner: "marwa", nom: "Enceinte prévue", date: "2026-12-10", prix: 500 }
    };
    const marwa = achatsDe(materiel, "marwa");
    assert.deepEqual(marwa.map((a) => a.id), ["s", "m", "f"]);
    assert.deepEqual(achatsDe(materiel, ["habib", "marwa"]).map((a) => a.id), ["s", "m", "p", "f"]);
    assert.deepEqual(montantsParMois(marwa), { "2026-01": 1300, "2026-12": 500 });
    const b = bilanMateriel(marwa, "2026-01-31");
    assert.equal(b.investi, 1300);
    assert.equal(b.gardes, 2);
    assert.ok(b.valeur < 1300 && b.valeur > 1280);
    assert.equal(finDeMois("2026-02"), "2026-02-28");
    const s = serieMateriel(marwa, ["2025-12", "2026-01", "2026-12"]);
    assert.deepEqual(s.investi, [0, 1300, 1800]);
    assert.equal(s.valeur[0], 0);
    assert.ok(s.valeur[2] < 1800);
  });
});
