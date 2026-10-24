// Sauvegarde partielle d'un mois (budget-core.js) : un enregistrement n'écrit que les champs
// modifiés, pour que deux appareils ouverts sur le même mois ne s'écrasent pas.
// Les scénarios tournent sur un faux Firestore ET sur le stockage du mode démo.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  monthPath, setItemValue, setBankBalance, setCashBalance, createChangeSet, monthPatch,
  saveMonthChanges, createMonth, saveForecastValue, zeroItemInMonths, withIncomeAmount
} from "../budget-core.js";
import { createDemoStore } from "../demo.js";
import { createFakeFirestore } from "./helpers/fake-firestore.js";

const M = "2099-03";
const income = { id: "sal", type: "income", owner: "habib" };
const expense = { id: "loyer", type: "regulieres", owner: "habib" };
const meta = (who) => ({ updatedAt: "2099-03-01T10:00:00.000Z", updatedBy: who });

const baseMonth = () => ({
  values: {
    sal: { amount: 3000, received: 0, receivedCash: 0, paid: false },
    loyer: { amount: 1200, paid: false },
    part: { amount: 60, paid: false, montantTotal: 120, remboursementRecu: false }
  },
  bankBalances: { habib: 1500, marwa: 800 },
  cashBalances: { habib: 40, marwa: 10 }
});

// Un "appareil" : sa copie locale du mois + ses modifications pas encore enregistrées,
// comme monthData / monthChanges dans app.js.
async function openMonth(store, id) {
  const snap = await store.getDoc(monthPath(id));
  const data = snap.exists() ? snap.data() : null;
  if (data && !data.values) data.values = {};
  return { id, data, changes: createChangeSet() };
}
function save(store, device, who = "test") {
  return saveMonthChanges(store, device.id, device.data, device.changes.take(), meta(who));
}
async function read(store, id) {
  const snap = await store.getDoc(monthPath(id));
  return snap.exists() ? snap.data() : null;
}
// Retire updatedAt/updatedBy pour comparer le contenu.
function content(d) {
  const { updatedAt, updatedBy, ...rest } = d;
  return rest;
}

const stores = {
  "faux Firestore": () => createFakeFirestore(),
  "stockage démo": () => createDemoStore(["habib", "marwa"])
};

for (const [name, makeStore] of Object.entries(stores)) {
  describe(`sauvegarde partielle (${name})`, () => {
    async function seeded(data = baseMonth(), id = M) {
      const store = makeStore();
      await store.setDoc(monthPath(id), data);
      return store;
    }

    test("deux appareils modifient des postes différents : les deux modifs survivent", async () => {
      const store = await seeded();
      const a = await openMonth(store, M);
      const b = await openMonth(store, M);

      a.changes.add(setItemValue(a.data, "loyer", { ...a.data.values.loyer, paid: true }));
      a.changes.add(setBankBalance(a.data, "habib", 300));
      await save(store, a, "a");

      // b n'a pas relu le mois : sa copie a encore loyer non payé et l'ancien solde.
      b.changes.add(setItemValue(b.data, "sal", { ...b.data.values.sal, received: 3000, paid: true }));
      b.changes.add(setCashBalance(b.data, "marwa", 25));
      await save(store, b, "b");

      const d = await read(store, M);
      assert.equal(d.values.loyer.paid, true, "la modif de a n'est pas écrasée par b");
      assert.equal(d.bankBalances.habib, 300, "le solde saisi sur a n'est pas écrasé par b");
      assert.equal(d.values.sal.received, 3000);
      assert.equal(d.values.sal.paid, true);
      assert.deepEqual(d.cashBalances, { habib: 40, marwa: 25 });
      assert.equal(d.updatedBy, "b");
    });

    test("même poste, champs différents : les deux modifs survivent", async () => {
      const store = await seeded();
      const a = await openMonth(store, M);
      const b = await openMonth(store, M);
      a.changes.add(setItemValue(a.data, "loyer", { ...a.data.values.loyer, paid: true }));
      await save(store, a);
      b.changes.add(setItemValue(b.data, "loyer", { ...b.data.values.loyer, amount: 1250 }));
      await save(store, b);
      assert.deepEqual((await read(store, M)).values.loyer, { amount: 1250, paid: true });
    });

    test("un enregistrement ne touche que les champs modifiés", async () => {
      const store = await seeded();
      const a = await openMonth(store, M);
      a.changes.add(setItemValue(a.data, "sal", withIncomeAmount(income, a.data.values.sal, 3100)));
      a.changes.add(setItemValue(a.data, "sal", withIncomeAmount(income, a.data.values.sal, 3200)));
      await save(store, a);

      const expected = baseMonth();
      expected.values.sal.amount = 3200;
      assert.deepEqual(content(await read(store, M)), expected);
      if (store.writes) {
        assert.deepEqual(store.writes.at(-1), {
          op: "update", path: monthPath(M),
          fields: { "values.sal.amount": 3200, ...meta("test") }
        });
      }
    });

    test("rien de modifié : aucune écriture", async () => {
      const store = await seeded();
      const before = store.writes ? store.writes.length : 0;
      const a = await openMonth(store, M);
      a.changes.add(setItemValue(a.data, "loyer", { ...a.data.values.loyer }));
      await save(store, a);
      if (store.writes) assert.equal(store.writes.length, before);
      assert.deepEqual(await read(store, M), baseMonth());
    });

    test("revenu remis à 0 : montant et encaissé effacés, rien d'autre", async () => {
      const data = baseMonth();
      data.values.sal = { amount: 3000, received: 1000, receivedCash: 200, paid: false };
      const store = await seeded(data);
      const a = await openMonth(store, M);
      a.changes.add(setItemValue(a.data, "sal", withIncomeAmount(income, a.data.values.sal, 0)));
      await save(store, a);
      const d = await read(store, M);
      assert.deepEqual(d.values.sal, { amount: 0, received: 0, receivedCash: 0, paid: false });
      assert.deepEqual(d.values.loyer, baseMonth().values.loyer);
    });

    test("poste sans valeur jusqu'ici : créé avec tous ses champs", async () => {
      const store = await seeded();
      const a = await openMonth(store, M);
      a.changes.add(setItemValue(a.data, "neuf", { amount: 0, paid: false, ...{ amount: 45 } }));
      await save(store, a);
      assert.deepEqual((await read(store, M)).values.neuf, { amount: 45, paid: false });
    });

    test("dépense partagée : montant total et remboursement", async () => {
      const store = await seeded();
      const a = await openMonth(store, M);
      const b = await openMonth(store, M);
      a.changes.add(setItemValue(a.data, "part", { ...a.data.values.part, montantTotal: 150 }));
      await save(store, a);
      b.changes.add(setItemValue(b.data, "part", { ...b.data.values.part, remboursementRecu: true }));
      await save(store, b);
      assert.deepEqual((await read(store, M)).values.part, { amount: 60, paid: false, montantTotal: 150, remboursementRecu: true });
    });

    test("ancien format bankBalance : converti sans perdre le solde, ancien champ supprimé", async () => {
      const store = await seeded({ values: {}, bankBalance: 900 });
      const a = await openMonth(store, M);
      a.changes.add(setBankBalance(a.data, "marwa", 50));
      await save(store, a);
      const d = await read(store, M);
      assert.deepEqual(d.bankBalances, { habib: 900, marwa: 50 });
      assert.equal("bankBalance" in d, false);
    });

    test("échec d'enregistrement d'un autre champ : rien n'est perdu au retry", async () => {
      const store = await seeded();
      const a = await openMonth(store, M);
      a.changes.add(setCashBalance(a.data, "habib", 12));
      const paths = a.changes.take();
      a.changes.add(paths); // comme saveMonth après une erreur
      await save(store, a);
      assert.equal((await read(store, M)).cashBalances.habib, 12);
    });

    test("mois supprimé entre-temps : recréé avec la copie locale", async () => {
      const store = await seeded();
      const a = await openMonth(store, M);
      a.changes.add(setItemValue(a.data, "loyer", { ...a.data.values.loyer, paid: true }));
      a.id = "2099-04"; // document absent : updateDoc échoue en not-found
      await save(store, a);
      const d = await read(store, "2099-04");
      assert.equal(d.values.loyer.paid, true);
      assert.equal(d.values.sal.amount, 3000);
    });

    test("création d'un mois neuf : document entier", async () => {
      const store = makeStore();
      const fresh = { values: { loyer: { amount: 1200, paid: false } }, bankBalances: {} };
      const res = await createMonth(store, "2099-05", fresh, meta("a"));
      assert.equal(res.created, true);
      assert.deepEqual(await read(store, "2099-05"), { ...fresh, ...meta("a") });
    });

    test("création d'un mois déjà créé sur un autre appareil : pas d'écrasement", async () => {
      const store = await seeded();
      const res = await createMonth(store, M, { values: {}, bankBalances: {} }, meta("b"));
      assert.equal(res.created, false);
      assert.deepEqual(res.data, baseMonth());
      assert.deepEqual(await read(store, M), baseMonth());
    });

    test("Prévisions sur un mois existant : seul le montant du poste est écrit", async () => {
      const store = await seeded();
      const forecast = await read(store, M); // copie chargée par l'écran Prévisions
      const a = await openMonth(store, M);
      a.changes.add(setItemValue(a.data, "loyer", { ...a.data.values.loyer, paid: true }));
      a.changes.add(setBankBalance(a.data, "habib", 99));
      await save(store, a);

      const data = await saveForecastValue(store, M, forecast, null, expense, "loyer", 1300, meta("b"));
      assert.equal(data, forecast, "la copie locale est mise à jour");
      assert.equal(forecast.values.loyer.amount, 1300);
      const d = await read(store, M);
      assert.deepEqual(d.values.loyer, { amount: 1300, paid: true }, "le « payé » de l'autre appareil reste");
      assert.equal(d.bankBalances.habib, 99);
    });

    test("Prévisions : revenu remis à 0 efface l'encaissé", async () => {
      const data = baseMonth();
      data.values.sal = { amount: 3000, received: 500, receivedCash: 100, paid: false };
      const store = await seeded(data);
      const forecast = await read(store, M);
      await saveForecastValue(store, M, forecast, null, income, "sal", 0, meta("b"));
      assert.deepEqual((await read(store, M)).values.sal, { amount: 0, received: 0, receivedCash: 0, paid: false });
    });

    test("Prévisions sur un mois neuf : créé à partir du mois source", async () => {
      const store = await seeded();
      const source = await read(store, M);
      const data = await saveForecastValue(store, "2099-06", null, source, expense, "loyer", 1400, meta("a"));
      const expected = {
        values: { sal: { amount: 3000, paid: false }, loyer: { amount: 1400, paid: false }, part: { amount: 60, paid: false } },
        bankBalances: {}
      };
      assert.deepEqual(data, expected);
      assert.deepEqual(await read(store, "2099-06"), { ...expected, ...meta("a") });
    });

    test("Prévisions sur un mois « neuf » créé entre-temps ailleurs : pas d'écrasement", async () => {
      const store = await seeded();
      const elsewhere = { values: { loyer: { amount: 1200, paid: true } }, bankBalances: { marwa: 5 } };
      await store.setDoc(monthPath("2099-07"), elsewhere);
      const source = await read(store, M);
      const data = await saveForecastValue(store, "2099-07", null, source, income, "sal", 3100, meta("b"));
      const d = await read(store, "2099-07");
      assert.deepEqual(content(d), {
        values: { loyer: { amount: 1200, paid: true }, sal: { amount: 3100, paid: false } },
        bankBalances: { marwa: 5 }
      });
      assert.deepEqual(data.values, d.values);
    });

    test("suppression d'un poste : montant remis à 0 sur les mois concernés, rien d'autre", async () => {
      const store = await seeded();
      const n = baseMonth();
      n.values.loyer.amount = 1250;
      await store.setDoc(monthPath("2099-04"), n);
      const monthsById = { [M]: await read(store, M), "2099-04": await read(store, "2099-04") };

      // Entre-temps, un autre appareil coche le loyer et saisit un solde sur M.
      const a = await openMonth(store, M);
      a.changes.add(setItemValue(a.data, "loyer", { ...a.data.values.loyer, paid: true }));
      a.changes.add(setBankBalance(a.data, "marwa", 7));
      await save(store, a);

      await zeroItemInMonths(store, [M, "2099-04"], monthsById, "loyer", meta("b"));
      const d3 = await read(store, M);
      const d4 = await read(store, "2099-04");
      assert.deepEqual(d3.values.loyer, { amount: 0, paid: true });
      assert.equal(d3.bankBalances.marwa, 7);
      assert.deepEqual(d4.values.loyer, { amount: 0, paid: false });
      assert.deepEqual(d4.values.sal, baseMonth().values.sal);
      assert.equal(monthsById[M].values.loyer.amount, 0, "copies locales à jour");
    });
  });
}

describe("monthPatch / createChangeSet", () => {
  test("valeur actuelle de chaque chemin, suppression si absent, parent prioritaire", () => {
    const DEL = Symbol("del");
    const data = { values: { a: { amount: 1, paid: true } }, bankBalances: { habib: 3 } };
    assert.deepEqual(monthPatch(data, ["values.a.amount", "values.a", "bankBalances.habib", "bankBalance", "values.a.amount"], DEL), {
      "values.a": { amount: 1, paid: true },
      "bankBalances.habib": 3,
      bankBalance: DEL
    });
  });

  test("chemins voisins qui ne sont pas parents (values.a / values.ab)", () => {
    const data = { values: { a: { amount: 1 }, ab: { amount: 2 } } };
    assert.deepEqual(monthPatch(data, ["values.a", "values.ab.amount"], null), { "values.a": { amount: 1 }, "values.ab.amount": 2 });
  });

  test("createChangeSet : sans doublon, vidé par take()", () => {
    const c = createChangeSet();
    c.add(["x", "y"]);
    c.add(["x"]);
    assert.equal(c.size, 2);
    assert.deepEqual(c.take(), ["x", "y"]);
    assert.equal(c.size, 0);
    assert.deepEqual(c.take(), []);
  });

  test("setItemValue : chemins des seuls champs changés", () => {
    const data = { values: { a: { amount: 1, paid: false, received: 0 } } };
    assert.deepEqual(setItemValue(data, "a", { amount: 1, paid: true }), ["values.a.paid", "values.a.received"]);
    assert.deepEqual(data.values.a, { amount: 1, paid: true });
    assert.deepEqual(setItemValue({}, "b", { amount: 2, paid: false }), ["values.b.amount", "values.b.paid"]);
  });

  test("setBankBalance / setCashBalance : mêmes données qu'avant", () => {
    const d = { bankBalances: { habib: 1 } };
    assert.deepEqual(setBankBalance(d, "marwa", 2), ["bankBalances.marwa"]);
    assert.deepEqual(d, { bankBalances: { habib: 1, marwa: 2 } });

    const legacy = { bankBalance: 5 };
    assert.deepEqual(setBankBalance(legacy, "marwa", 2), ["bankBalances.habib", "bankBalances.marwa", "bankBalance"]);
    assert.deepEqual(legacy, { bankBalances: { habib: 5, marwa: 2 } });

    const empty = {};
    assert.deepEqual(setBankBalance(empty, "habib", 4), ["bankBalances.habib"]);
    assert.deepEqual(empty, { bankBalances: { habib: 4 } });

    const c = { cashBalances: { habib: 1 } };
    assert.deepEqual(setCashBalance(c, "marwa", 3), ["cashBalances.marwa"]);
    assert.deepEqual(c, { cashBalances: { habib: 1, marwa: 3 } });
    const c2 = {};
    setCashBalance(c2, "habib", 0);
    assert.deepEqual(c2, { cashBalances: { habib: 0 } });
  });
});
