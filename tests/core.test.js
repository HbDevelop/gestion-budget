// Calculs du budget (budget-core.js) : comportement de référence, à ne pas changer sans le vouloir.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  monthId, addMonths, isActiveAt, inScope, receivedOf, cashOf, virementOf, withIncomeAmount,
  bankBalancesOf, bankFor, cashFor, sumBankBalances, computeTotals, cloneForNewMonth
} from "../budget-core.js";

const item = (id, type, owner, extra = {}) => ({ id, label: id, type, owner, retiredAt: null, ...extra });
const catalog = {
  items: [
    item("sal-h", "income", "habib"),
    item("rep-h", "income", "habib", { role: "epargne_out" }),
    item("etu-h", "income", "habib"),
    item("zero-h", "income", "habib"),
    item("sal-m", "income", "marwa"),
    item("loyer", "regulieres", "habib"),
    item("sport", "occasionnelles", "marwa"),
    item("part", "regulieres", "habib", { role: "partagee" }),
    item("ep-h", "capital", "habib", { role: "epargne" }),
    item("inv-m", "capital", "marwa", { role: "investissement" })
  ]
};
const month = () => ({
  values: {
    "sal-h": { amount: 3000, received: 3000, receivedCash: 0, paid: true },
    "rep-h": { amount: 500, received: 0, paid: false },
    "etu-h": { amount: 1000, received: 400, receivedCash: 150, paid: false },
    // Revenu remis à 0 qui garde un ancien encaissé en espèces (données d'avant le correctif).
    "zero-h": { amount: 0, received: 50, receivedCash: 50, paid: false },
    "sal-m": { amount: 2000, paid: true },          // ancien format : pas de `received`
    "loyer": { amount: 1200, paid: true },
    "sport": { amount: 100, paid: false },
    "part": { amount: 60, paid: false },             // partagée, montantTotal par défaut
    "ep-h": { amount: 300, paid: false },
    "inv-m": { amount: 200, paid: true }
  },
  bankBalances: { habib: 1500, marwa: 800 },
  cashBalances: { habib: 40, marwa: 10 }
});

describe("computeTotals", () => {
  test("espace habib", () => {
    assert.deepEqual(computeTotals(catalog, month(), "habib"), {
      totalIncome: 4500, revenusReels: 4000, epargneIn: 500,
      revenusAVenir: 1160,   // 500 reprise + 600 étude + 60 part de l'autre (dépense partagée)
      especesRecues: 150,    // le revenu à 0 € n'est pas compté
      byGroup: { regulieres: 1260, occasionnelles: 0, capital: 300 },
      totalExpenses: 1560, depensesReelles: 1260, balance: 2940,
      chargesAVenir: 120,    // partagée non payée : montant total par défaut = 2 × 60
      capitalAVenir: 300,
      resteAVivreReel: 1120, soldeProjete: 2280, bankBalance: 1500, cashBalance: 40
    });
  });

  test("espace marwa (ancien revenu sans `received`, payé = tout reçu)", () => {
    assert.deepEqual(computeTotals(catalog, month(), "marwa"), {
      totalIncome: 2000, revenusReels: 2000, epargneIn: 0, revenusAVenir: 0, especesRecues: 0,
      byGroup: { regulieres: 0, occasionnelles: 100, capital: 200 },
      totalExpenses: 300, depensesReelles: 100, balance: 1700,
      chargesAVenir: 100, capitalAVenir: 0,
      resteAVivreReel: 710, soldeProjete: 710, bankBalance: 800, cashBalance: 10
    });
  });

  test("vue famille = somme des espaces", () => {
    const fam = computeTotals(catalog, month(), "famille");
    assert.deepEqual(fam, {
      totalIncome: 6500, revenusReels: 6000, epargneIn: 500, revenusAVenir: 1160, especesRecues: 150,
      byGroup: { regulieres: 1260, occasionnelles: 100, capital: 500 },
      totalExpenses: 1860, depensesReelles: 1360, balance: 4640,
      chargesAVenir: 220, capitalAVenir: 300,
      resteAVivreReel: 1830, soldeProjete: 2990, bankBalance: 2300, cashBalance: 50
    });
    assert.deepEqual(computeTotals(catalog, month()), fam, "scope par défaut = famille");
  });

  test("espèces reçues : un revenu à montant 0 n'est pas compté, même avec un ancien receivedCash", () => {
    const data = { values: { "zero-h": { amount: 0, received: 80, receivedCash: 80 } } };
    assert.equal(computeTotals(catalog, data, "habib").especesRecues, 0);
    data.values["zero-h"].amount = 100;
    assert.equal(computeTotals(catalog, data, "habib").especesRecues, 80);
  });

  test("dépense partagée : montantTotal saisi et remboursement reçu", () => {
    const base = { values: { part: { amount: 60, montantTotal: 150, paid: false, remboursementRecu: false } } };
    let t = computeTotals(catalog, base, "habib");
    assert.equal(t.chargesAVenir, 150);
    assert.equal(t.revenusAVenir, 90);
    assert.equal(t.byGroup.regulieres, 60, "seule la part nette compte dans les dépenses");

    base.values.part.remboursementRecu = true;
    t = computeTotals(catalog, base, "habib");
    assert.equal(t.revenusAVenir, 0);
    assert.equal(t.chargesAVenir, 150);

    base.values.part.paid = true;
    t = computeTotals(catalog, base, "habib");
    assert.equal(t.chargesAVenir, 0);

    // montantTotal à 0 saisi explicitement : pas de repli sur 2 × amount
    t = computeTotals(catalog, { values: { part: { amount: 60, montantTotal: 0 } } }, "habib");
    assert.equal(t.chargesAVenir, 0);
    assert.equal(t.revenusAVenir, 0);
  });

  test("poste partagé sans valeur ce mois : rien à venir", () => {
    const t = computeTotals(catalog, { values: {} }, "habib");
    assert.equal(t.chargesAVenir, 0);
    assert.equal(t.revenusAVenir, 0);
  });

  test("capital à venir : épargne/investissement non fait(e)", () => {
    const data = { values: { "ep-h": { amount: 300, paid: false }, "inv-m": { amount: 200, paid: false } } };
    assert.equal(computeTotals(catalog, data, "famille").capitalAVenir, 500);
    assert.equal(computeTotals(catalog, data, "famille").chargesAVenir, 0);
    data.values["ep-h"].paid = true;
    assert.equal(computeTotals(catalog, data, "famille").capitalAVenir, 200);
  });

  test("ancien format bankBalance (nombre) : rattaché au premier espace", () => {
    const data = { values: {}, bankBalance: 900 };
    assert.equal(computeTotals(catalog, data, "habib").bankBalance, 900);
    assert.equal(computeTotals(catalog, data, "marwa").bankBalance, 0);
    assert.equal(computeTotals(catalog, data, "famille").bankBalance, 900);
  });

  test("mois absent : tout à zéro", () => {
    const t = computeTotals(catalog, null, "famille");
    assert.equal(t.totalIncome, 0);
    assert.equal(t.soldeProjete, 0);
    assert.equal(t.bankBalance, 0);
    assert.equal(t.cashBalance, 0);
  });
});

describe("soldes bancaires et espèces", () => {
  test("bankBalancesOf : nouveau format, ancien format, rien", () => {
    assert.deepEqual(bankBalancesOf({ bankBalances: { habib: 1, marwa: 2 } }), { habib: 1, marwa: 2 });
    assert.deepEqual(bankBalancesOf({ bankBalance: 7 }), { habib: 7 });
    assert.deepEqual(bankBalancesOf({ bankBalances: { marwa: 3 }, bankBalance: 7 }), { marwa: 3 }, "le nouveau format l'emporte");
    assert.deepEqual(bankBalancesOf({}), {});
    assert.deepEqual(bankBalancesOf(null), {});
  });

  test("famille : somme, y compris d'anciens seaux orphelins", () => {
    const data = { bankBalances: { habib: 100, marwa: 50, commun: 25, bad: "x" } };
    assert.equal(sumBankBalances(data), 175);
    assert.equal(bankFor(data, "famille"), 175);
    assert.equal(bankFor(data, "marwa"), 50);
    assert.equal(bankFor(data, "inconnu"), 0);
  });

  test("cashFor : par espace et famille", () => {
    const data = { cashBalances: { habib: 20, marwa: 5 } };
    assert.equal(cashFor(data, "habib"), 20);
    assert.equal(cashFor(data, "famille"), 25);
    assert.equal(cashFor({}, "famille"), 0);
    assert.equal(cashFor(null, "habib"), 0);
  });
});

describe("encaissé des revenus", () => {
  test("receivedOf", () => {
    assert.equal(receivedOf(undefined), 0);
    assert.equal(receivedOf({ amount: 100, received: 40 }), 40);
    assert.equal(receivedOf({ amount: 100, received: 0, paid: true }), 0, "received prime sur paid");
    assert.equal(receivedOf({ amount: 100, paid: true }), 100, "ancien format : payé = tout reçu");
    assert.equal(receivedOf({ amount: 100, paid: false }), 0);
    assert.equal(receivedOf({ paid: true }), 0);
  });

  test("cashOf : borné par l'encaissé", () => {
    assert.equal(cashOf(undefined), 0);
    assert.equal(cashOf({ amount: 100, received: 40 }), 0);
    assert.equal(cashOf({ amount: 100, received: 40, receivedCash: 15 }), 15);
    assert.equal(cashOf({ amount: 100, received: 40, receivedCash: 60 }), 40);
    assert.equal(cashOf({ amount: 100, paid: true, receivedCash: 30 }), 30);
  });

  test("virementOf = encaissé - espèces", () => {
    assert.equal(virementOf({ amount: 100, received: 40, receivedCash: 15 }), 25);
    assert.equal(virementOf({ amount: 100, paid: true }), 100);
    assert.equal(virementOf(undefined), 0);
  });
});

describe("withIncomeAmount", () => {
  const income = { id: "s", type: "income" };
  const expense = { id: "d", type: "regulieres" };

  test("revenu remis à 0 : l'encaissé est effacé", () => {
    const v = { amount: 1000, received: 600, receivedCash: 100, paid: false, extra: "gardé" };
    assert.deepEqual(withIncomeAmount(income, v, 0), { amount: 0, received: 0, receivedCash: 0, paid: false, extra: "gardé" });
    assert.equal(v.amount, 1000, "l'objet d'origine n'est pas modifié");
  });

  test("simple baisse : l'encaissé est gardé", () => {
    const v = { amount: 1000, received: 600, receivedCash: 100, paid: false };
    assert.deepEqual(withIncomeAmount(income, v, 500), { amount: 500, received: 600, receivedCash: 100, paid: false });
  });

  test("dépense à 0 : rien d'autre ne change", () => {
    const v = { amount: 80, paid: true, montantTotal: 160, remboursementRecu: true };
    assert.deepEqual(withIncomeAmount(expense, v, 0), { amount: 0, paid: true, montantTotal: 160, remboursementRecu: true });
  });

  test("poste inconnu (catalogue absent) : seul le montant change", () => {
    assert.deepEqual(withIncomeAmount(undefined, { amount: 5, paid: true }, 0), { amount: 0, paid: true });
  });
});

describe("cloneForNewMonth", () => {
  test("mêmes montants, rien de payé, soldes vides", () => {
    const prev = {
      values: {
        a: { amount: 100, paid: true, received: 100, receivedCash: 20 },
        b: { amount: 0, paid: true },
        c: { paid: true, montantTotal: 50 }
      },
      bankBalances: { habib: 5 },
      cashBalances: { habib: 2 },
      updatedAt: "x"
    };
    assert.deepEqual(cloneForNewMonth(prev), {
      values: { a: { amount: 100, paid: false }, b: { amount: 0, paid: false }, c: { amount: 0, paid: false } },
      bankBalances: {}
    });
  });

  test("source absente ou sans values", () => {
    assert.deepEqual(cloneForNewMonth(null), { values: {}, bankBalances: {} });
    assert.deepEqual(cloneForNewMonth({}), { values: {}, bankBalances: {} });
  });
});

describe("utilitaires", () => {
  test("monthId / addMonths", () => {
    assert.equal(monthId(new Date(2026, 0, 15)), "2026-01");
    assert.equal(addMonths("2026-01", -1), "2025-12");
    assert.equal(addMonths("2026-12", 1), "2027-01");
    assert.equal(addMonths("2026-10", 0), "2026-10");
  });

  test("isActiveAt / inScope", () => {
    assert.equal(isActiveAt({ retiredAt: null }, "2026-10"), true);
    assert.equal(isActiveAt({ retiredAt: "2026-10" }, "2026-09"), true);
    assert.equal(isActiveAt({ retiredAt: "2026-10" }, "2026-10"), false);
    assert.equal(inScope({ owner: "habib" }, "famille"), true);
    assert.equal(inScope({ owner: "habib" }, "habib"), true);
    assert.equal(inScope({ owner: "habib" }, "marwa"), false);
  });
});
