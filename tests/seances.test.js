// Postes à séances (seances.js) : calcul du mois, opérations sur les séances, paiements
// comptés dans le mois où l'argent arrive, impayés des mois passés, sauvegarde partielle.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isSeancesItem, monthOfDate, seancesOfItem, seancesValue, recomputeItem, monthsNeeded,
  ajouterSeance, modifierSeance, payerSeance, annulerPaiement, supprimerSeance, arrieres, elevesOf,
  seancesATarifer, appliquerTarif, datesRecurrentes, programmerSeances, seancesSerie, supprimerSeances,
  MAX_PROGRAMMATION, seancesFutures, seancesATraiter, payerEtFaire, marquerFaites
} from "../seances.js";
import { computeTotals, saveMonthChanges, monthPath } from "../budget-core.js";
import { createFakeFirestore } from "./helpers/fake-firestore.js";

const ETU = "etu";
const etude = { id: ETU, label: "Etude", type: "income", owner: "marwa", gestion: "seances" };
const salaire = { id: "sal", label: "Salaire", type: "income", owner: "marwa" };
const catalog = { items: [etude, salaire] };
const seance = (date, prix, extra = {}) => ({ itemId: ETU, eleveId: "lina", date, prix, ...extra });
const empty = () => ({ values: {} });

describe("poste à séances : calcul du mois", () => {
  test("isSeancesItem / monthOfDate", () => {
    assert.equal(isSeancesItem(etude), true);
    assert.equal(isSeancesItem(salaire), false);
    assert.equal(isSeancesItem(null), false);
    assert.equal(monthOfDate("2026-10-07T18:00"), "2026-10");
    assert.equal(monthOfDate("2026-11-03"), "2026-11");
  });

  test("mois sans séance ni paiement : null (saisie manuelle inchangée)", () => {
    const d = { values: { [ETU]: { amount: 400, received: 100, receivedCash: 0, paid: false } } };
    assert.equal(seancesValue(d, ETU), null);
    assert.deepEqual(recomputeItem(d, ETU), []);
    assert.deepEqual(d.values[ETU], { amount: 400, received: 100, receivedCash: 0, paid: false });
  });

  test("prévu = séances non annulées, à venir = non payées, encaissé = paiements du mois", () => {
    const d = {
      values: {},
      seances: {
        a: seance("2026-10-07T18:00", 25, { statut: "faite", paiement: { mode: "especes", date: "2026-10-07" } }),
        b: seance("2026-10-09T17:30", 30, { statut: "faite", paiement: null }),
        c: seance("2026-10-18T10:00", 25, { statut: "annulee", paiement: null }),
        d: seance("2026-10-28T18:00", 30, { statut: "prevue", paiement: null }),
        x: { itemId: "autre", date: "2026-10-01T10:00", prix: 99, statut: "faite", paiement: null }
      },
      paiementsSeances: {
        a: { itemId: ETU, prix: 25, mode: "especes", date: "2026-10-07", seanceMois: "2026-10" },
        z: { itemId: ETU, prix: 40, mode: "virement", date: "2026-10-02", seanceMois: "2026-09" }
      }
    };
    assert.deepEqual(seancesValue(d, ETU), { amount: 85, received: 65, receivedCash: 25, recuSeances: 65, aVenir: 60, paid: false });
    assert.deepEqual(seancesOfItem(d, ETU).map((s) => s.id), ["a", "b", "c", "d"]);
  });

  test("tout payé : paid = true ; arrondi au centime", () => {
    const d = { values: {}, seances: { a: seance("2026-10-07T18:00", 0.1, { statut: "faite", paiement: { mode: "virement", date: "2026-10-07" } }), b: seance("2026-10-08T18:00", 0.2, { statut: "faite", paiement: { mode: "virement", date: "2026-10-08" } }) },
      paiementsSeances: { a: { itemId: ETU, prix: 0.1, mode: "virement", date: "2026-10-07" }, b: { itemId: ETU, prix: 0.2, mode: "virement", date: "2026-10-08" } } };
    assert.deepEqual(seancesValue(d, ETU), { amount: 0.3, received: 0.3, receivedCash: 0, recuSeances: 0.3, aVenir: 0, paid: true });
  });

  test("dernière séance supprimée : retour en saisie manuelle à 0, `aVenir` retiré", () => {
    const docs = { "2026-10": empty() };
    ajouterSeance(docs, "s1", seance("2026-10-07T18:00", 25));
    assert.equal(docs["2026-10"].values[ETU].aVenir, 25);
    const ch = supprimerSeance(docs, "2026-10", "s1");
    assert.deepEqual(docs["2026-10"].values[ETU], { amount: 0, received: 0, receivedCash: 0, paid: false });
    assert.ok(ch["2026-10"].includes(`values.${ETU}.aVenir`));
  });
});

describe("rétrocompatibilité : encaissé saisi à la main avant la première séance", () => {
  test("gardé comme base, le reste estimé est remplacé par les séances", () => {
    const docs = { "2026-10": { values: { [ETU]: { amount: 510, received: 280, receivedCash: 200, paid: false } } } };
    const ch = ajouterSeance(docs, "s1", seance("2026-10-28T18:00", 30));
    const d = docs["2026-10"];
    assert.deepEqual(d.seancesBase, { [ETU]: { amount: 280, received: 280, receivedCash: 200 } });
    assert.deepEqual(d.values[ETU], { amount: 310, received: 280, receivedCash: 200, recuSeances: 0, aVenir: 30, paid: false });
    assert.ok(ch["2026-10"].includes(`seancesBase.${ETU}`));
  });

  test("pas de base si rien n'avait été encaissé, ni une deuxième fois", () => {
    const docs = { "2026-10": { values: { [ETU]: { amount: 510, paid: false } } } };
    ajouterSeance(docs, "s1", seance("2026-10-07T18:00", 25));
    assert.equal(docs["2026-10"].seancesBase, undefined);
    assert.deepEqual(docs["2026-10"].values[ETU], { amount: 25, received: 0, receivedCash: 0, recuSeances: 0, aVenir: 25, paid: false });
    // Mois déjà calculé : un nouvel encaissé ne crée pas de base après coup.
    const d2 = { "2026-11": { values: { [ETU]: { amount: 0, received: 50, receivedCash: 0, aVenir: 0, paid: false } } } };
    ajouterSeance(d2, "s2", seance("2026-11-03T18:00", 25));
    assert.equal(d2["2026-11"].seancesBase, undefined);
  });

  test("les autres postes du mois ne sont pas touchés", () => {
    const docs = { "2026-10": { values: { sal: { amount: 2000, received: 2000, paid: true } } } };
    const ch = ajouterSeance(docs, "s1", seance("2026-10-07T18:00", 25));
    assert.deepEqual(docs["2026-10"].values.sal, { amount: 2000, received: 2000, paid: true });
    assert.ok(ch["2026-10"].every((p) => !p.startsWith("values.sal")));
  });
});

describe("opérations", () => {
  test("ajouter : valeurs par défaut et validation", () => {
    const docs = { "2026-10": empty() };
    ajouterSeance(docs, "s1", seance("2026-10-07T18:00", 25));
    assert.deepEqual(docs["2026-10"].seances.s1, { itemId: ETU, eleveId: "lina", date: "2026-10-07T18:00", prix: 25, statut: "prevue", paiement: null });
    assert.throws(() => ajouterSeance(docs, "s2", seance("2026-10-07", 25)), /Date/);
    assert.throws(() => ajouterSeance(docs, "s3", seance("2026-10-07T18:00", -1)), /Prix/);
    assert.throws(() => ajouterSeance(docs, "s4", seance("2026-11-07T18:00", 25)), /non chargé/);
  });

  test("annuler une séance : sort du prévu (la prévision baisse)", () => {
    const docs = { "2026-12": empty() };
    ajouterSeance(docs, "s1", seance("2026-12-02T18:00", 30));
    ajouterSeance(docs, "s2", seance("2026-12-09T18:00", 30));
    assert.equal(docs["2026-12"].values[ETU].amount, 60);
    modifierSeance(docs, "2026-12", "s2", { statut: "annulee" });
    assert.equal(docs["2026-12"].values[ETU].amount, 30);
    assert.equal(docs["2026-12"].values[ETU].aVenir, 30);
    modifierSeance(docs, "2026-12", "s2", { statut: "prevue" });
    assert.equal(docs["2026-12"].values[ETU].amount, 60);
  });

  test("payer le même mois, en espèces", () => {
    const docs = { "2026-10": empty() };
    ajouterSeance(docs, "s1", seance("2026-10-07T18:00", 25, { statut: "faite" }));
    const ch = payerSeance(docs, "2026-10", "s1", "especes", "2026-10-07");
    const d = docs["2026-10"];
    assert.deepEqual(d.seances.s1.paiement, { mode: "especes", date: "2026-10-07" });
    assert.deepEqual(d.paiementsSeances.s1, { itemId: ETU, prix: 25, mode: "especes", date: "2026-10-07", seanceMois: "2026-10" });
    assert.deepEqual(d.values[ETU], { amount: 25, received: 25, receivedCash: 25, recuSeances: 25, aVenir: 0, paid: true });
    assert.deepEqual(Object.keys(ch), ["2026-10"]);
  });

  test("séance d'octobre payée en novembre : encaissé compté en novembre", () => {
    const docs = { "2026-10": empty(), "2026-11": { values: { [ETU]: { amount: 400, paid: false } } } };
    ajouterSeance(docs, "s1", seance("2026-10-30T18:00", 30, { statut: "faite" }));
    const ch = payerSeance(docs, "2026-10", "s1", "virement", "2026-11-03");
    assert.deepEqual(docs["2026-10"].values[ETU], { amount: 30, received: 0, receivedCash: 0, recuSeances: 0, aVenir: 0, paid: true });
    // Novembre n'a pas de séance : son montant estimé à la main (400 €) reste à venir, et les
    // 30 € de la séance d'octobre s'ajoutent à son encaissé.
    assert.deepEqual(docs["2026-11"].values[ETU], { amount: 400, received: 30, receivedCash: 0, recuSeances: 30, aVenir: 400, paid: false });
    assert.deepEqual(Object.keys(ch).sort(), ["2026-10", "2026-11"]);
    assert.deepEqual(monthsNeeded("payer", { mois: "2026-10", date: "2026-11-03" }).sort(), ["2026-10", "2026-11"]);
    // Annuler le paiement remet les deux mois comme avant.
    annulerPaiement(docs, "2026-10", "s1");
    assert.equal(docs["2026-10"].values[ETU].aVenir, 30);
    assert.deepEqual(docs["2026-11"].values[ETU], { amount: 400, received: 0, receivedCash: 0, paid: false });
    assert.equal(docs["2026-11"].paiementsSeances.s1, undefined);
  });

  test("règles : pas de paiement double, pas d'annulation ni de suppression d'une séance payée", () => {
    const docs = { "2026-10": empty() };
    ajouterSeance(docs, "s1", seance("2026-10-07T18:00", 25));
    payerSeance(docs, "2026-10", "s1", "virement", "2026-10-08");
    assert.throws(() => payerSeance(docs, "2026-10", "s1", "virement", "2026-10-08"), /déjà payée/);
    assert.throws(() => modifierSeance(docs, "2026-10", "s1", { statut: "annulee" }), /paiement/);
    assert.throws(() => supprimerSeance(docs, "2026-10", "s1"), /paiement/);
    assert.throws(() => payerSeance(docs, "2026-10", "s1", "cheque", "2026-10-08"), /Mode/);
    ajouterSeance(docs, "s2", seance("2026-10-09T18:00", 25, { statut: "annulee" }));
    assert.throws(() => payerSeance(docs, "2026-10", "s2", "virement", "2026-10-09"), /annulée/);
  });

  test("modifier le prix d'une séance payée : le paiement suit", () => {
    const docs = { "2026-10": empty(), "2026-11": empty() };
    ajouterSeance(docs, "s1", seance("2026-10-30T18:00", 30, { statut: "faite" }));
    payerSeance(docs, "2026-10", "s1", "virement", "2026-11-03");
    modifierSeance(docs, "2026-10", "s1", { prix: 35 });
    assert.equal(docs["2026-10"].values[ETU].amount, 35);
    assert.equal(docs["2026-11"].paiementsSeances.s1.prix, 35);
    assert.equal(docs["2026-11"].values[ETU].received, 35);
  });

  test("déplacer une séance sur un autre mois", () => {
    const docs = { "2026-10": empty(), "2026-11": empty() };
    ajouterSeance(docs, "s1", seance("2026-10-30T18:00", 30));
    ajouterSeance(docs, "s0", seance("2026-10-02T18:00", 30));
    const ch = modifierSeance(docs, "2026-10", "s1", { date: "2026-11-04T18:00" });
    assert.equal(docs["2026-10"].seances.s1, undefined);
    assert.equal(docs["2026-11"].seances.s1.date, "2026-11-04T18:00");
    assert.equal(docs["2026-10"].values[ETU].amount, 30);
    assert.equal(docs["2026-11"].values[ETU].amount, 30);
    assert.deepEqual(Object.keys(ch).sort(), ["2026-10", "2026-11"]);
    assert.deepEqual(monthsNeeded("modifier", { mois: "2026-10", patch: { date: "2026-11-04T18:00" } }).sort(), ["2026-10", "2026-11"]);
  });
});

describe("Prévisions sur un mois touché par les séances", () => {
  test("mois sans séance : le montant estimé reste modifiable, l'encaissé des séances est gardé", async () => {
    const { withIncomeAmount } = await import("../budget-core.js");
    const v = { amount: 400, received: 30, receivedCash: 0, recuSeances: 30, aVenir: 400, paid: false };
    assert.deepEqual(withIncomeAmount(etude, v, 350), { ...v, amount: 350, aVenir: 350 });
    assert.deepEqual(withIncomeAmount(etude, v, 0), { ...v, amount: 0, aVenir: 0, paid: false });
    // Avec une base manuelle (encaissé saisi avant les séances) : déduite du reste à venir.
    const w = { amount: 510, received: 310, receivedCash: 200, recuSeances: 30, aVenir: 230, paid: false };
    assert.equal(withIncomeAmount(etude, w, 600).aVenir, 320);
  });

  test("dernière séance retirée : le montant calculé retombe à 0, même avec un paiement d'un autre mois", () => {
    const docs = { "2026-11": empty() };
    ajouterSeance(docs, "s1", seance("2026-11-04T18:00", 30));
    docs["2026-11"].paiementsSeances = { s0: { itemId: ETU, prix: 25, mode: "especes", date: "2026-11-02", seanceMois: "2026-10" } };
    recomputeItem(docs["2026-11"], ETU);
    assert.equal(docs["2026-11"].values[ETU].amount, 30);
    supprimerSeance(docs, "2026-11", "s1");
    assert.deepEqual(docs["2026-11"].values[ETU], { amount: 0, received: 25, receivedCash: 25, recuSeances: 25, aVenir: 0, paid: false });
  });

  test("recalcul après une séance d'un autre mois payée : le montant manuel n'est pas écrasé", () => {
    const d = { values: { [ETU]: { amount: 400, received: 0, paid: false } },
      paiementsSeances: { s1: { itemId: ETU, prix: 30, mode: "virement", date: "2026-11-03", seanceMois: "2026-10" } } };
    recomputeItem(d, ETU);
    assert.equal(d.values[ETU].amount, 400);
    assert.equal(d.values[ETU].aVenir, 400);
  });
});

describe("impayés des mois passés et totaux", () => {
  const months = [
    { id: "2026-08", data: { seances: { a: seance("2026-08-20T18:00", 25, { statut: "faite" }) } } },
    { id: "2026-09", data: { seances: {
      b: seance("2026-09-10T18:00", 30, { statut: "faite", paiement: { mode: "virement", date: "2026-09-10" } }),
      c: seance("2026-09-12T18:00", 30, { statut: "annulee" }),
      d: seance("2026-09-29T18:00", 30, { statut: "prevue" }),
      e: { itemId: "autre", date: "2026-09-01T10:00", prix: 99, statut: "faite", paiement: null }
    } } },
    { id: "2026-10", data: { seances: { f: seance("2026-10-07T18:00", 25) } } }
  ];

  test("arrieres : non annulées, non payées, mois strictement avant", () => {
    const r = arrieres(months, "2026-10", [ETU]);
    assert.deepEqual(r.parPoste, { [ETU]: 55 });
    assert.deepEqual(r.liste.map((s) => [s.id, s.mois]), [["a", "2026-08"], ["d", "2026-09"]]);
    assert.deepEqual(arrieres(months, "2026-08", [ETU]).liste, []);
  });

  test("computeTotals : à venir des séances + impayés passés ; encaissé compté même à montant 0", () => {
    const data = { values: {
      [ETU]: { amount: 0, received: 30, receivedCash: 10, aVenir: 0, paid: false },
      sal: { amount: 2000, received: 0, receivedCash: 0, paid: false }
    } };
    const t = computeTotals(catalog, data, "marwa");
    assert.equal(t.revenusAVenir, 2000);
    assert.equal(t.especesRecues, 10);
    assert.equal(t.virementsRecus, 20);
    const t2 = computeTotals(catalog, data, "marwa", { arrieres: { [ETU]: 55 } });
    assert.equal(t2.revenusAVenir, 2055);
    assert.equal(t2.soldeProjete - t.soldeProjete, 55);
    // Impayés d'un poste hors de l'espace affiché : ignorés.
    assert.equal(computeTotals(catalog, data, "habib", { arrieres: { [ETU]: 55 } }).revenusAVenir, 0);
  });

  test("computeTotals : poste calculé, à venir = séances non payées (pas montant − encaissé)", () => {
    const data = { values: { [ETU]: { amount: 85, received: 65, receivedCash: 25, aVenir: 60, paid: false } } };
    assert.equal(computeTotals(catalog, data, "marwa").revenusAVenir, 60);
  });
});

describe("élèves", () => {
  test("actifs d'abord, puis par nom", () => {
    const item = { eleves: [{ id: "1", nom: "Zoé", tarif: 20 }, { id: "2", nom: "adam", tarif: 30, actif: false }, { id: "3", nom: "Lina", tarif: 25 }] };
    assert.deepEqual(elevesOf(item).map((e) => e.nom), ["Lina", "Zoé", "adam"]);
    assert.deepEqual(elevesOf({}), []);
  });
});

describe("sauvegarde partielle des opérations", () => {
  test("seuls les champs touchés partent en base ; un autre appareil n'est pas écrasé", async () => {
    const store = createFakeFirestore({
      [monthPath("2026-10")]: { values: { sal: { amount: 2000, paid: false }, [ETU]: { amount: 510, received: 280, receivedCash: 200, paid: false } } },
      [monthPath("2026-11")]: { values: { sal: { amount: 2000, paid: false } } }
    });
    const load = async (id) => (await store.getDoc(monthPath(id))).data();
    const docs = { "2026-10": await load("2026-10"), "2026-11": await load("2026-11") };
    // Un autre appareil modifie le salaire entre-temps.
    await store.updateDoc(monthPath("2026-10"), { "values.sal.paid": true });

    const ch = {};
    const merge = (c) => Object.entries(c).forEach(([m, p]) => { ch[m] = [...(ch[m] || []), ...p]; });
    merge(ajouterSeance(docs, "s1", seance("2026-10-30T18:00", 30, { statut: "faite" })));
    merge(payerSeance(docs, "2026-10", "s1", "especes", "2026-11-02"));
    for (const [m, paths] of Object.entries(ch)) {
      await saveMonthChanges(store, m, docs[m], paths, { updatedAt: "t", updatedBy: "u" });
    }

    const oct = (await store.getDoc(monthPath("2026-10"))).data();
    const nov = (await store.getDoc(monthPath("2026-11"))).data();
    assert.equal(oct.values.sal.paid, true, "modif de l'autre appareil conservée");
    assert.deepEqual(oct.values[ETU], { amount: 310, received: 280, receivedCash: 200, recuSeances: 0, aVenir: 0, paid: true });
    assert.deepEqual(oct.seancesBase[ETU], { amount: 280, received: 280, receivedCash: 200 });
    assert.equal(oct.seances.s1.paiement.date, "2026-11-02");
    assert.deepEqual(nov.values[ETU], { amount: 0, received: 30, receivedCash: 30, recuSeances: 30, aVenir: 0, paid: false });
    assert.equal(nov.values.sal.amount, 2000);
    assert.equal(nov.paiementsSeances.s1.seanceMois, "2026-10");
  });
});

describe("changement de tarif d'un élève", () => {
  // Noah (30 €) : une séance payée, une annulée, un impayé passé, une au prix ajusté, deux à venir.
  const build = () => {
    const docs = { "2026-09": empty(), "2026-10": empty(), "2026-11": empty() };
    const noah = (date, prix, extra) => ({ itemId: ETU, eleveId: "noah", date, prix, ...extra });
    ajouterSeance(docs, "paye", noah("2026-09-10T18:00", 30, { statut: "faite" }));
    payerSeance(docs, "2026-09", "paye", "virement", "2026-09-10");
    ajouterSeance(docs, "impaye", noah("2026-09-24T18:00", 30, { statut: "faite" }));
    ajouterSeance(docs, "annulee", noah("2026-10-20T18:00", 30, { statut: "annulee" }));
    ajouterSeance(docs, "ajuste", noah("2026-10-27T18:00", 20));
    ajouterSeance(docs, "oct", noah("2026-10-30T18:00", 30));
    ajouterSeance(docs, "nov", noah("2026-11-06T18:00", 30));
    ajouterSeance(docs, "lina", seance("2026-11-06T17:00", 30));
    return docs;
  };
  const list = (docs) => Object.entries(docs).map(([id, data]) => ({ id, data }));

  test("à venir seulement : non payées, non annulées, au prix de l'ancien tarif, à partir du jour donné", () => {
    const docs = build();
    assert.deepEqual(seancesATarifer(list(docs), ETU, "noah", 30, { depuis: "2026-10-24" }).map((s) => s.id), ["oct", "nov"]);
    assert.deepEqual(seancesATarifer(list(docs), ETU, "noah", 30).map((s) => s.id), ["impaye", "oct", "nov"]);
    // Sans ancien tarif connu : toutes les non payées non annulées, prix ajusté compris.
    assert.deepEqual(seancesATarifer(list(docs), ETU, "noah", null).map((s) => s.id), ["impaye", "ajuste", "oct", "nov"]);
  });

  test("appliquer : prix, prévu et reste dû recalculés sur chaque mois ; le reste intact", () => {
    const docs = build();
    const cibles = seancesATarifer(list(docs), ETU, "noah", 30);
    assert.deepEqual(monthsNeeded("tarif", { seances: cibles }).sort(), ["2026-09", "2026-10", "2026-11"]);
    const ch = appliquerTarif(docs, cibles, 35);
    assert.equal(docs["2026-09"].seances.impaye.prix, 35);
    assert.equal(docs["2026-09"].seances.paye.prix, 30, "séance payée inchangée");
    assert.equal(docs["2026-10"].seances.ajuste.prix, 20, "prix ajusté gardé");
    assert.equal(docs["2026-10"].seances.annulee.prix, 30);
    assert.equal(docs["2026-11"].seances.lina.prix, 30, "autre élève inchangé");
    assert.deepEqual([docs["2026-09"].values[ETU].amount, docs["2026-09"].values[ETU].aVenir], [65, 35]);
    assert.deepEqual([docs["2026-10"].values[ETU].amount, docs["2026-10"].values[ETU].aVenir], [55, 55]);
    assert.deepEqual([docs["2026-11"].values[ETU].amount, docs["2026-11"].values[ETU].aVenir], [65, 65]);
    assert.deepEqual(Object.keys(ch).sort(), ["2026-09", "2026-10", "2026-11"]);
    assert.throws(() => appliquerTarif(docs, cibles, -5), /Prix/);
    assert.deepEqual(appliquerTarif(docs, [], 40), {});
  });
});

describe("programmation automatique", () => {
  test("chaque mardi à 18h, bornes incluses, sur plusieurs mois", () => {
    // 2026-10-27 et 2026-11-03 sont des mardis.
    assert.deepEqual(datesRecurrentes({ jours: [2], heure: "18:00", du: "2026-10-27", au: "2026-11-17" }),
      ["2026-10-27T18:00", "2026-11-03T18:00", "2026-11-10T18:00", "2026-11-17T18:00"]);
    assert.deepEqual(datesRecurrentes({ jours: [2], heure: "18:00", du: "2026-10-28", au: "2026-11-02" }), []);
  });

  test("plusieurs jours par semaine, changement d'heure et d'année sans décalage", () => {
    // Fin de l'heure d'été le 25/10/2026 : les dates restent justes (calcul en UTC).
    assert.deepEqual(datesRecurrentes({ jours: [6, 1], heure: "10:30", du: "2026-10-24", au: "2026-10-27" }),
      ["2026-10-24T10:30", "2026-10-26T10:30"]);
    assert.deepEqual(datesRecurrentes({ jours: [0], heure: "09:00", du: "2026-12-26", au: "2027-01-05" }),
      ["2026-12-27T09:00", "2027-01-03T09:00"]);
  });

  test("validations", () => {
    assert.throws(() => datesRecurrentes({ jours: [], heure: "18:00", du: "2026-10-01", au: "2026-10-31" }), /jour/);
    assert.throws(() => datesRecurrentes({ jours: [7], heure: "18:00", du: "2026-10-01", au: "2026-10-31" }), /jour/);
    assert.throws(() => datesRecurrentes({ jours: [2], heure: "18h", du: "2026-10-01", au: "2026-10-31" }), /Heure/);
    assert.throws(() => datesRecurrentes({ jours: [2], heure: "18:00", du: "2026-10-31", au: "2026-10-01" }), /fin/);
    assert.throws(() => datesRecurrentes({ jours: [0, 1, 2, 3, 4, 5, 6], heure: "18:00", du: "2026-01-01", au: "2026-12-31" }),
      new RegExp(String(MAX_PROGRAMMATION)));
  });

  test("création dans chaque mois, prévu recalculé, doublons ignorés", () => {
    const docs = { "2026-10": empty(), "2026-11": { values: { [ETU]: { amount: 500, paid: false } } } };
    ajouterSeance(docs, "deja", seance("2026-11-03T18:00", 30));
    const dates = datesRecurrentes({ jours: [2], heure: "18:00", du: "2026-10-27", au: "2026-11-17" });
    assert.deepEqual(monthsNeeded("programmer", { dates }).sort(), ["2026-10", "2026-11"]);
    let n = 0;
    const r = programmerSeances(docs, { itemId: ETU, eleveId: "lina", prix: 30, serieId: "serie1" }, dates, () => `p${++n}`);
    assert.deepEqual(r.creees, ["2026-10-27T18:00", "2026-11-10T18:00", "2026-11-17T18:00"]);
    assert.deepEqual(r.ignorees, ["2026-11-03T18:00"]);
    assert.deepEqual(docs["2026-10"].seances.p1, { itemId: ETU, eleveId: "lina", prix: 30, serieId: "serie1", date: "2026-10-27T18:00", statut: "prevue", paiement: null });
    assert.equal(docs["2026-10"].values[ETU].amount, 30);
    // Novembre : l'estimation manuelle (500 €) est remplacée par les séances (3 × 30 €).
    assert.equal(docs["2026-11"].values[ETU].amount, 90);
    assert.deepEqual(Object.keys(r.changes).sort(), ["2026-10", "2026-11"]);
  });

  test("supprimer les suivantes d'une série : seulement prévues et non payées, à partir de la date", () => {
    const docs = { "2026-10": empty(), "2026-11": empty() };
    let n = 0;
    const dates = datesRecurrentes({ jours: [2], heure: "18:00", du: "2026-10-20", au: "2026-11-17" });
    programmerSeances(docs, { itemId: ETU, eleveId: "lina", prix: 30, serieId: "s1" }, dates, () => `p${++n}`);
    // p1 = 20/10 (faite), p2 = 27/10 (payée), p3 = 03/11, p4 = 10/11 (annulée), p5 = 17/11
    modifierSeance(docs, "2026-10", "p1", { statut: "faite" });
    payerSeance(docs, "2026-10", "p2", "especes", "2026-10-27");
    modifierSeance(docs, "2026-11", "p4", { statut: "annulee" });
    ajouterSeance(docs, "autre", seance("2026-11-24T18:00", 30));
    const list = (d) => Object.entries(d).map(([id, data]) => ({ id, data }));
    const cibles = seancesSerie(list(docs), "s1", "2026-10-20T18:00");
    assert.deepEqual(cibles.map((s) => s.id), ["p3", "p5"]);
    assert.deepEqual(seancesSerie(list(docs), "s1", "2026-11-04T00:00").map((s) => s.id), ["p5"]);
    assert.deepEqual(seancesSerie(list(docs), undefined, "2026-01-01T00:00"), []);
    assert.deepEqual(monthsNeeded("supprimerListe", { seances: cibles }), ["2026-11"]);
    supprimerSeances(docs, cibles);
    assert.deepEqual(Object.keys(docs["2026-11"].seances).sort(), ["autre", "p4"]);
    assert.equal(docs["2026-11"].values[ETU].amount, 30);
    assert.ok(docs["2026-10"].seances.p1 && docs["2026-10"].seances.p2);
  });
});

describe("estimation manuelle d'un mois", () => {
  test("mémorisée à la première séance, rétablie quand toutes ses séances sont retirées", () => {
    const docs = { "2026-11": { values: { [ETU]: { amount: 500, paid: false } } } };
    ajouterSeance(docs, "a", seance("2026-11-03T18:00", 30));
    ajouterSeance(docs, "b", seance("2026-11-10T18:00", 30));
    assert.deepEqual(docs["2026-11"].seancesEstimation, { [ETU]: 500 });
    assert.equal(docs["2026-11"].values[ETU].amount, 60);
    supprimerSeance(docs, "2026-11", "a");
    assert.equal(docs["2026-11"].values[ETU].amount, 30, "il reste une séance");
    const ch = supprimerSeance(docs, "2026-11", "b");
    assert.deepEqual(docs["2026-11"].values[ETU], { amount: 500, received: 0, receivedCash: 0, paid: false });
    assert.deepEqual(docs["2026-11"].seancesEstimation, {});
    assert.ok(ch["2026-11"].includes(`seancesEstimation.${ETU}`));
    // Nouvelle première séance : l'estimation (500 €) est de nouveau mémorisée.
    ajouterSeance(docs, "c", seance("2026-11-17T18:00", 30));
    assert.deepEqual(docs["2026-11"].seancesEstimation, { [ETU]: 500 });
  });

  test("séance déplacée vers un autre mois : estimation rétablie au départ, mémorisée à l'arrivée", () => {
    const docs = { "2026-11": { values: { [ETU]: { amount: 500, paid: false } } }, "2026-12": { values: { [ETU]: { amount: 250, paid: false } } } };
    ajouterSeance(docs, "a", seance("2026-11-24T18:00", 30));
    modifierSeance(docs, "2026-11", "a", { date: "2026-12-01T18:00" });
    assert.equal(docs["2026-11"].values[ETU].amount, 500);
    assert.equal(docs["2026-12"].values[ETU].amount, 30);
    assert.deepEqual(docs["2026-12"].seancesEstimation, { [ETU]: 250 });
  });

  test("avec un encaissé manuel (base) : estimation rétablie, encaissé gardé", () => {
    const docs = { "2026-10": { values: { [ETU]: { amount: 510, received: 280, receivedCash: 200, paid: false } } } };
    ajouterSeance(docs, "a", seance("2026-10-28T18:00", 30));
    supprimerSeance(docs, "2026-10", "a");
    assert.deepEqual(docs["2026-10"].values[ETU], { amount: 510, received: 280, receivedCash: 200, recuSeances: 0, aVenir: 230, paid: false });
  });
});

describe("séances des prochains mois", () => {
  test("mois strictement après, postes demandés, annulées comprises, triées par date", () => {
    const months = [
      { id: "2026-10", data: { seances: { a: seance("2026-10-30T18:00", 30) } } },
      { id: "2026-12", data: { seances: {
        d: seance("2026-12-08T18:00", 30),
        c: seance("2026-12-01T18:00", 30, { statut: "annulee" }),
        x: { itemId: "autre", date: "2026-12-02T10:00", prix: 99, statut: "prevue", paiement: null }
      } } },
      { id: "2026-11", data: { seances: { b: seance("2026-11-03T18:00", 30) } } },
      { id: "2026-09", data: {} }
    ];
    assert.deepEqual(seancesFutures(months, "2026-10", [ETU]).map((s) => [s.id, s.mois]),
      [["b", "2026-11"], ["c", "2026-12"], ["d", "2026-12"]]);
    assert.deepEqual(seancesFutures(months, "2026-12", [ETU]), []);
    assert.deepEqual(seancesFutures(months, "2026-10", []), []);
  });

  test("modifier l'heure d'une séance d'un mois futur : prévu de ce mois inchangé, date mise à jour", () => {
    const docs = { "2026-12": empty() };
    ajouterSeance(docs, "d", seance("2026-12-08T18:00", 30));
    const ch = modifierSeance(docs, "2026-12", "d", { date: "2026-12-08T17:00" });
    assert.equal(docs["2026-12"].seances.d.date, "2026-12-08T17:00");
    assert.equal(docs["2026-12"].values[ETU].amount, 30);
    assert.deepEqual(Object.keys(ch), ["2026-12"]);
  });
});

describe("saisie rapide : séances passées à traiter", () => {
  const build = () => {
    const docs = { "2026-09": empty(), "2026-10": empty() };
    ajouterSeance(docs, "sept", seance("2026-09-29T18:00", 30, { statut: "faite" }));     // impayé passé
    ajouterSeance(docs, "fini", seance("2026-10-02T18:00", 25, { statut: "faite" }));
    payerSeance(docs, "2026-10", "fini", "especes", "2026-10-02");                          // faite et payée
    ajouterSeance(docs, "aConf", seance("2026-10-20T18:00", 25));                            // prévue passée
    ajouterSeance(docs, "nonPaye", seance("2026-10-22T18:00", 30, { statut: "faite" }));    // faite non payée
    ajouterSeance(docs, "annul", seance("2026-10-21T18:00", 30, { statut: "annulee" }));
    ajouterSeance(docs, "ceSoir", seance("2026-10-24T18:00", 25));                           // plus tard aujourd'hui
    ajouterSeance(docs, "futur", seance("2026-10-27T18:00", 25));
    return docs;
  };

  test("liste : passées non faites ou non payées, impayés des mois précédents, sans annulées ni futures", () => {
    const docs = build();
    const arr = arrieres([{ id: "2026-09", data: docs["2026-09"] }], "2026-10", [ETU]).liste;
    const l = seancesATraiter(docs["2026-10"], "2026-10", arr, ETU, "2026-10-24T14:00");
    assert.deepEqual(l.map((s) => [s.id, s.mois]), [["sept", "2026-09"], ["aConf", "2026-10"], ["nonPaye", "2026-10"]]);
    // Le soir venu, la séance de 18h entre dans la liste.
    assert.deepEqual(seancesATraiter(docs["2026-10"], "2026-10", arr, ETU, "2026-10-24T19:00").map((s) => s.id),
      ["sept", "aConf", "nonPaye", "ceSoir"]);
    assert.deepEqual(seancesATraiter(empty(), "2026-10", [], ETU, "2026-10-24T19:00"), []);
  });

  test("payer en un geste : une séance prévue passe aussi à faite ; reste dû et encaissé à jour", () => {
    const docs = build();
    const ch = payerEtFaire(docs, "2026-10", "aConf", "virement", "2026-10-24");
    const s = docs["2026-10"].seances.aConf;
    assert.equal(s.statut, "faite");
    assert.deepEqual(s.paiement, { mode: "virement", date: "2026-10-24" });
    assert.equal(docs["2026-10"].paiementsSeances.aConf.prix, 25);
    assert.deepEqual(Object.keys(ch), ["2026-10"]);
    // Séance déjà faite : seul le paiement change.
    payerEtFaire(docs, "2026-10", "nonPaye", "especes", "2026-10-24");
    assert.equal(docs["2026-10"].seances.nonPaye.statut, "faite");
    assert.equal(docs["2026-10"].values[ETU].receivedCash, 55);
    // Impayé de septembre payé aujourd'hui : compté en octobre.
    const ch2 = payerEtFaire(docs, "2026-09", "sept", "virement", "2026-10-24");
    assert.deepEqual(Object.keys(ch2).sort(), ["2026-09", "2026-10"]);
    assert.equal(docs["2026-10"].paiementsSeances.sept.seanceMois, "2026-09");
    assert.throws(() => payerEtFaire(docs, "2026-10", "fini", "virement", "2026-10-24"), /déjà payée/);
  });

  test("tout marquer fait : seulement les séances encore prévues", () => {
    const docs = build();
    const cibles = [{ id: "aConf", mois: "2026-10" }, { id: "nonPaye", mois: "2026-10" }, { id: "sept", mois: "2026-09" }];
    assert.deepEqual(monthsNeeded("faites", { seances: cibles }).sort(), ["2026-09", "2026-10"]);
    const ch = marquerFaites(docs, cibles);
    assert.equal(docs["2026-10"].seances.aConf.statut, "faite");
    assert.deepEqual(Object.keys(ch), ["2026-10"]);
    assert.deepEqual(marquerFaites(docs, cibles), {});
  });
});

describe("bascule faite / pas faite", () => {
  test("à tout moment, même payée : le paiement et l'encaissé sont gardés", () => {
    const docs = { "2026-10": empty() };
    ajouterSeance(docs, "a", seance("2026-10-05T18:00", 25, { statut: "faite" }));
    payerSeance(docs, "2026-10", "a", "especes", "2026-10-05");
    modifierSeance(docs, "2026-10", "a", { statut: "prevue" });
    assert.equal(docs["2026-10"].seances.a.statut, "prevue");
    assert.deepEqual(docs["2026-10"].seances.a.paiement, { mode: "especes", date: "2026-10-05" });
    assert.deepEqual([docs["2026-10"].values[ETU].amount, docs["2026-10"].values[ETU].receivedCash, docs["2026-10"].values[ETU].aVenir], [25, 25, 0]);
    modifierSeance(docs, "2026-10", "a", { statut: "faite" });
    assert.equal(docs["2026-10"].seances.a.statut, "faite");
  });

  test("séance passée remise « pas faite » : de nouveau dans la zone À traiter", () => {
    const docs = { "2026-10": empty() };
    ajouterSeance(docs, "a", seance("2026-10-05T18:00", 25, { statut: "faite" }));
    payerSeance(docs, "2026-10", "a", "virement", "2026-10-05");
    assert.deepEqual(seancesATraiter(docs["2026-10"], "2026-10", [], ETU, "2026-10-24T12:00"), []);
    modifierSeance(docs, "2026-10", "a", { statut: "prevue" });
    assert.deepEqual(seancesATraiter(docs["2026-10"], "2026-10", [], ETU, "2026-10-24T12:00").map((s) => s.id), ["a"]);
  });
});
