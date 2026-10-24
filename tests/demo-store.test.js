// Stockage en mémoire du mode démo (demo.js) : doit se comporter comme les appels Firestore utilisés.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createDemoStore } from "../demo.js";
import { monthId, addMonths } from "../budget-core.js";

const cur = monthId(new Date());
const newStore = () => createDemoStore(["habib", "marwa"]);

describe("demoStore", () => {
  test("getDoc : catalogue, réglages, mois existant et absent", async () => {
    const s = newStore();
    const cat = await s.getDoc("meta/catalog");
    assert.equal(cat.exists(), true);
    assert.equal(cat.id, "catalog");
    assert.ok(cat.data().items.length > 10);
    assert.ok(cat.data().items.every((it) => ["habib", "marwa"].includes(it.owner)));
    assert.equal((await s.getDoc("meta/settings")).exists(), true);

    const m = await s.getDoc(`months/${cur}`);
    assert.equal(m.exists(), true);
    assert.equal(m.id, cur);
    assert.ok(Object.keys(m.data().values).length > 0);

    const none = await s.getDoc("months/1999-01");
    assert.equal(none.exists(), false);
    assert.equal(none.data(), undefined);
  });

  test("getDoc renvoie une copie : la modifier ne touche pas le stockage", async () => {
    const s = newStore();
    const d = (await s.getDoc(`months/${cur}`)).data();
    d.values = {};
    assert.notDeepEqual((await s.getDoc(`months/${cur}`)).data().values, {});
  });

  test("setDoc remplace le document ; merge fusionne en profondeur", async () => {
    const s = newStore();
    await s.setDoc("months/1999-01", { values: { a: { amount: 1 } }, bankBalances: { habib: 3 } });
    assert.deepEqual((await s.getDoc("months/1999-01")).data(), { values: { a: { amount: 1 } }, bankBalances: { habib: 3 } });

    await s.setDoc("months/1999-01", { values: { b: { amount: 2 } } });
    assert.deepEqual((await s.getDoc("months/1999-01")).data(), { values: { b: { amount: 2 } } });

    await s.setDoc("months/1999-01", { values: { c: { amount: 3 } }, x: 1 }, { merge: true });
    assert.deepEqual((await s.getDoc("months/1999-01")).data(), { values: { b: { amount: 2 }, c: { amount: 3 } }, x: 1 });
  });

  test("setDoc copie la valeur : la modifier ensuite ne touche pas le stockage", async () => {
    const s = newStore();
    const v = { values: { a: { amount: 1 } } };
    await s.setDoc("months/1999-01", v);
    v.values.a.amount = 99;
    assert.equal((await s.getDoc("months/1999-01")).data().values.a.amount, 1);
  });

  test("updateDoc : chemins pointés, comme Firestore", async () => {
    const s = newStore();
    await s.setDoc("months/1999-01", { values: { a: { amount: 1, paid: true }, b: { amount: 2 } }, bankBalances: { habib: 3 } });
    await s.updateDoc("months/1999-01", {
      "values.a": { amount: 10 },              // remplace l'objet du poste en entier
      "values.c.amount": 5,                    // crée les niveaux manquants
      "bankBalances.marwa": 7,
      updatedBy: "test"
    });
    assert.deepEqual((await s.getDoc("months/1999-01")).data(), {
      values: { a: { amount: 10 }, b: { amount: 2 }, c: { amount: 5 } },
      bankBalances: { habib: 3, marwa: 7 },
      updatedBy: "test"
    });
  });

  test("updateDoc sur un document absent : erreur not-found, rien n'est créé", async () => {
    const s = newStore();
    await assert.rejects(s.updateDoc("months/1999-01", { "values.a": { amount: 1 } }), { code: "not-found" });
    assert.equal((await s.getDoc("months/1999-01")).exists(), false);
  });

  test("getDocs : les mois triés par identifiant", async () => {
    const s = newStore();
    await s.setDoc("months/1999-01", { values: {} });
    const ids = [];
    (await s.getDocs("months")).forEach((d) => ids.push(d.id));
    assert.equal(ids[0], "1999-01");
    assert.deepEqual(ids, [...ids].sort());
    assert.ok(ids.includes(cur));
    assert.ok(ids.includes(addMonths(cur, -15)));
    assert.ok(ids.includes(addMonths(cur, 11)));
    assert.ok(!ids.some((id) => id.includes("/")), "seulement la collection demandée");
  });

  test("deux stores de démo sont indépendants", async () => {
    const a = newStore();
    const b = newStore();
    await a.setDoc(`months/${cur}`, { values: {} });
    assert.ok(Object.keys((await b.getDoc(`months/${cur}`)).data().values).length > 0);
  });
});
