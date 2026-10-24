// Faux Firestore en mémoire, avec la même interface que monthStore (app.js) :
// getDoc(path) / setDoc(path, value, opts) / updateDoc(path, fields) / deleteField().
// Il reproduit les règles de Firestore qui comptent ici, et refuse ce que Firestore refuse
// (valeur undefined, champ et parent dans la même mise à jour, document absent pour updateDoc).
// `writes` garde la trace de chaque écriture, pour vérifier ce qui est réellement envoyé.

const DELETE = Symbol("deleteField");

function assertNoUndefined(value, where) {
  if (value === undefined) throw new Error(`Valeur undefined refusée (${where})`);
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([k, v]) => assertNoUndefined(v, `${where}.${k}`));
  }
}

export function createFakeFirestore(initial = {}) {
  const docs = {};
  const writes = [];
  const clone = (v) => structuredClone(v);
  Object.entries(initial).forEach(([p, d]) => { docs[p] = clone(d); });

  return {
    writes,
    docs,
    deleteField() { return DELETE; },
    async getDoc(path) {
      const d = docs[path];
      return { id: path.split("/").pop(), exists: () => d !== undefined, data: () => (d === undefined ? undefined : clone(d)) };
    },
    async setDoc(path, value, opts) {
      assertNoUndefined(value, path);
      writes.push({ op: "set", path, value: clone(value) });
      if (opts && opts.merge) throw new Error("merge non utilisé pour les mois");
      docs[path] = clone(value);
    },
    async updateDoc(path, fields) {
      const keys = Object.keys(fields);
      keys.forEach((k) => {
        if (fields[k] !== DELETE) assertNoUndefined(fields[k], k);
        if (keys.some((o) => o !== k && k.startsWith(o + "."))) throw new Error(`Champ et parent dans la même mise à jour : ${k}`);
      });
      writes.push({ op: "update", path, fields: Object.fromEntries(keys.map((k) => [k, fields[k] === DELETE ? "<delete>" : clone(fields[k])])) });
      if (!docs[path]) throw Object.assign(new Error("No document to update"), { code: "not-found" });
      keys.forEach((k) => {
        const parts = k.split(".");
        const last = parts.pop();
        if (fields[k] === DELETE) {
          const o = parts.reduce((acc, p) => (acc && typeof acc[p] === "object" ? acc[p] : null), docs[path]);
          if (o) delete o[last];
          return;
        }
        let o = docs[path];
        parts.forEach((p) => { o = o[p] = o[p] && typeof o[p] === "object" ? o[p] : {}; });
        o[last] = clone(fields[k]);
      });
    }
  };
}
