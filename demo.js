// Compte de démo : quand le compte Google connecté est le compte de démo, l'appli ne lit ni
// n'écrit rien dans Firestore. Elle travaille sur un jeu de données fictif, généré en mémoire à
// chaque connexion (les modifications faites pendant la démo disparaissent à la déconnexion ou au
// rechargement). Le compte de démo ne doit PAS figurer dans les règles Firestore : même en
// contournant l'appli, il n'a ainsi aucun accès aux vraies données.

// Empreinte SHA-256 de l'adresse du compte de démo (en minuscules) : l'adresse elle-même ne
// figure pas dans ce dépôt public. Pour changer de compte de démo, remplacer cette empreinte.
const DEMO_EMAIL_SHA256 = "5a9a5a55347a1790fdc806a05bca35535ef6e9510ee492a16dbd638bd8eb1264";

// Prénoms fictifs affichés à la place des espaces réels, dans l'ordre de SPACES.
export const DEMO_LABELS = ["Thomas", "Léa"];

export async function isDemoEmail(email) {
  if (!email || !window.crypto?.subtle) return false;
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === DEMO_EMAIL_SHA256;
}

function monthId(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(id, delta) {
  const [y, m] = id.split("-").map(Number);
  return monthId(new Date(y, m - 1 + delta, 1));
}

// Générateur pseudo-aléatoire à graine fixe : la démo montre les mêmes chiffres à chaque fois.
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Jeu de données fictif d'un couple : 15 mois passés, le mois en cours, 11 mois de prévisions.
// `owners` = clés des deux espaces (SPACES) : on réutilise les vraies clés pour que toute
// l'appli fonctionne à l'identique, seuls les prénoms affichés changent (DEMO_LABELS).
function buildDemoData(owners) {
  const [a, b] = owners;
  const rnd = seeded(42);
  const cur = monthId(new Date());
  const first = addMonths(cur, -15);
  const ids = Array.from({ length: 27 }, (_, i) => addMonths(first, i));
  const month = (id) => Number(id.slice(5));

  const item = (id, label, type, owner, extra = {}) => ({ id, label, type, owner, retiredAt: null, ...extra });
  const items = [
    item("d-sal-a", "Salaire", "income", a),
    item("d-prime-a", "Prime annuelle", "income", a, { exceptionnel: true }),
    item("d-reprise-a", "Virement de l'épargne", "income", a, { role: "epargne_out" }),
    item("d-sal-b", "Salaire", "income", b),
    item("d-caf-b", "Allocations familiales", "income", b),
    item("d-loyer", "Loyer", "regulieres", a),
    item("d-elec", "Électricité", "regulieres", a),
    item("d-box", "Box internet", "regulieres", a),
    item("d-mob-a", "Forfait mobile", "regulieres", a),
    item("d-assu-auto", "Assurance voiture", "regulieres", a),
    item("d-essence", "Essence", "regulieres", a),
    item("d-abos", "Abonnements", "regulieres", a),
    item("d-courses", "Courses", "regulieres", b),
    item("d-creche", "Crèche", "regulieres", b),
    item("d-mutuelle", "Mutuelle", "regulieres", b),
    item("d-transport", "Transport en commun", "regulieres", b),
    item("d-mob-b", "Forfait mobile", "regulieres", b),
    item("d-vacances", "Vacances", "occasionnelles", a),
    item("d-auto", "Entretien voiture", "occasionnelles", a),
    item("d-cadeaux", "Cadeaux", "occasionnelles", a),
    item("d-vet-a", "Vêtements", "occasionnelles", a),
    item("d-sante", "Santé (non remboursé)", "occasionnelles", b),
    item("d-sport", "Sport / Club", "occasionnelles", b),
    item("d-vet-b", "Vêtements", "occasionnelles", b),
    item("d-ep-a", "Épargne", "capital", a, { role: "epargne" }),
    item("d-inv-a", "Investissement", "capital", a, { role: "investissement" }),
    item("d-ep-b", "Épargne", "capital", b, { role: "epargne" })
  ];

  const round = (v) => Math.round(v * 100) / 100;
  const between = (min, max) => round(min + rnd() * (max - min));
  const amountsFor = (id) => {
    const m = month(id);
    return {
      "d-sal-a": 3150, "d-prime-a": m === 3 ? 2500 : 0, "d-reprise-a": id === addMonths(cur, -8) ? 600 : 0,
      "d-sal-b": 2480, "d-caf-b": 141.99,
      "d-loyer": 1180, "d-elec": m >= 11 || m <= 2 ? 112 : 74, "d-box": 29.99, "d-mob-a": 12.99,
      "d-assu-auto": 54.3, "d-essence": between(90, 145), "d-abos": 27.98,
      "d-courses": between(410, 530), "d-creche": 380, "d-mutuelle": 42.5, "d-transport": 86.4, "d-mob-b": 9.99,
      "d-vacances": m === 7 ? 1400 : m === 8 ? 950 : m === 2 ? 450 : 0,
      "d-auto": m === 4 || m === 10 ? between(250, 420) : 0,
      "d-cadeaux": m === 12 ? 380 : 0,
      "d-vet-a": rnd() < 0.35 ? between(40, 120) : 0,
      "d-sante": rnd() < 0.4 ? between(20, 75) : 0,
      "d-sport": m === 9 ? 240 : 0,
      "d-vet-b": rnd() < 0.4 ? between(35, 110) : 0,
      "d-ep-a": 450, "d-inv-a": 250, "d-ep-b": 300
    };
  };

  const months = {};
  ids.forEach((id) => {
    const amounts = amountsFor(id);
    const values = {};
    Object.entries(amounts).forEach(([itemId, amount], i) => {
      if (!amount) return;
      const income = itemId.startsWith("d-sal") || itemId.startsWith("d-caf") || itemId.startsWith("d-prime") || itemId.startsWith("d-reprise");
      // Mois passés : tout est payé / reçu. Mois en cours : salaires reçus, environ la moitié des
      // dépenses payées. Mois futurs : rien encore.
      const done = id < cur || (id === cur && (income ? itemId.startsWith("d-sal") : i % 2 === 0));
      values[itemId] = income ? { amount, received: done ? amount : 0, receivedCash: 0, paid: done } : { amount, paid: done };
    });
    months[id] = { values };
    if (id <= cur) {
      months[id].bankBalances = { [a]: id === cur ? 1842.5 : between(900, 2400), [b]: id === cur ? 2215.3 : between(1200, 2800) };
      months[id].cashBalances = { [a]: 60, [b]: 35 };
    }
  });

  const settings = {
    byScope: {
      [a]: {
        epargneBase: 9500, epargneStart: first, epargneTaux: 3,
        investissementBase: 4200, investissementStart: first, investissementRendement: 5
      },
      // Même mois de départ pour l'investissement (même sans versement) : sinon le total Famille
      // ne démarrerait qu'au mois de départ par défaut et ferait un saut sur la courbe.
      [b]: { epargneBase: 5200, epargneStart: first, epargneTaux: 2.4, investissementBase: 0, investissementStart: first }
    },
    plans: {
      [`pee-${a}`]: { type: "pee", owner: a, solde: 6800, au: addMonths(cur, -2), versement: 100, abondement: 150, rendement: 4, dispo: addMonths(cur, 30) },
      [`per-${b}`]: { type: "per", owner: b, solde: 3100, au: addMonths(cur, -1), versement: 50, abondement: 50, rendement: 3.5, dispo: null }
    }
  };

  return { "meta/catalog": { items }, "meta/settings": settings, months };
}

// Stockage en mémoire qui imite les quelques appels Firestore utilisés par l'appli, adressés par
// chemin ("meta/catalog", "months/2026-10"...).
export function createDemoStore(owners) {
  const data = buildDemoData(owners);
  const docs = { "meta/catalog": data["meta/catalog"], "meta/settings": data["meta/settings"] };
  Object.entries(data.months).forEach(([id, d]) => { docs[`months/${id}`] = d; });
  const clone = (v) => (v == null ? v : structuredClone(v));
  const snap = (path) => ({ id: path.split("/").pop(), exists: () => docs[path] != null, data: () => clone(docs[path]) });
  const deepMerge = (target, src) => {
    Object.entries(src).forEach(([k, v]) => {
      if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object") deepMerge(target[k], v);
      else target[k] = v;
    });
    return target;
  };
  return {
    async getDoc(path) { return snap(path); },
    async setDoc(path, value, opts) {
      docs[path] = opts && opts.merge && docs[path] ? deepMerge(docs[path], clone(value)) : clone(value);
    },
    // Champs à chemin pointé ("byScope.<owner>.epargneTaux"), comme updateDoc de Firestore.
    async updateDoc(path, fields) {
      if (!docs[path]) throw Object.assign(new Error("Document introuvable"), { code: "not-found" });
      Object.entries(clone(fields)).forEach(([key, v]) => {
        const parts = key.split(".");
        let o = docs[path];
        parts.slice(0, -1).forEach((p) => { o = o[p] = o[p] && typeof o[p] === "object" ? o[p] : {}; });
        o[parts[parts.length - 1]] = v;
      });
    },
    // Seule collection lue en entier par l'appli : les mois, triés par identifiant.
    async getDocs(collectionPath) {
      const prefix = collectionPath + "/";
      const list = Object.keys(docs).filter((p) => p.startsWith(prefix)).sort().map(snap);
      return { forEach: (f) => list.forEach(f) };
    }
  };
}
