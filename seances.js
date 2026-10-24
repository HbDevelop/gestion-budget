// Postes « à séances » (ex. cours particuliers) : logique pure, sans DOM ni Firebase,
// importée par app.js et par les tests (tests/seances.test.js).
//
// Un revenu du catalogue devient un poste à séances avec `gestion: "seances"` ; il porte alors
// la liste de ses élèves (`eleves: [{ id, nom, tarif, actif }]`).
//
// Données, dans les documents months/<AAAA-MM> :
// - `seances.<id>` = { itemId, eleveId, date: "AAAA-MM-JJTHH:MM", prix, statut, paiement }
//   rangée dans le mois de SA DATE. statut : "prevue" | "faite" | "annulee".
//   paiement : null, ou { mode: "virement" | "especes", date: "AAAA-MM-JJ" }.
// - `paiementsSeances.<id>` = { itemId, prix, mode, date, seanceMois } rangé dans le mois où
//   l'ARGENT ARRIVE (date du paiement), qui peut être après le mois de la séance.
// - `seancesBase.<itemId>` = { amount, received, receivedCash } : ce qui avait été saisi à la
//   main sur le mois avant d'y enregistrer la première séance (conservé tel quel).
//
// À partir de là, values.<itemId> du mois est recalculé (recomputeItem) :
// - amount : si le mois a des séances, la somme des séances non annulées (+ base) ; sinon le
//   montant saisi à la main est gardé (estimation dans Prévisions).
// - received / receivedCash : base + paiements arrivés ce mois (`recuSeances` = leur total).
// - aVenir : séances du mois pas encore payées ; sans séance, montant − encaissé manuel (base).
// Le reste de l'appli (totaux, Prévisions, Historique, Analyse) continue de lire values comme
// pour n'importe quel revenu. Un mois jamais touché par les séances reste en saisie manuelle.
// Même version que l'import de budget-core.js dans app.js (un seul module chargé, pas de cache périmé).
import { setItemValue, receivedOf, cashOf } from "./budget-core.js?v=3";

export const GESTION_SEANCES = "seances";
export const STATUTS = ["prevue", "faite", "annulee"];
export const MODES = ["virement", "especes"];

export function isSeancesItem(item) { return !!(item && item.gestion === GESTION_SEANCES); }

export function monthOfDate(date) { return String(date).slice(0, 7); }

const cents = (n) => Math.round(n * 100) / 100;

// Séances d'un poste dans un mois, triées par date.
export function seancesOfItem(data, itemId) {
  return Object.entries((data && data.seances) || {})
    .filter(([, s]) => s && s.itemId === itemId)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Paiements arrivés dans ce mois pour un poste.
export function paiementsOfItem(data, itemId) {
  return Object.entries((data && data.paiementsSeances) || {})
    .filter(([, p]) => p && p.itemId === itemId)
    .map(([id, p]) => ({ id, ...p }));
}

// Le mois a-t-il des séances (même annulées) pour ce poste ? Son montant est alors calculé
// et n'est plus modifiable à la main (Prévisions, Suivi).
export function hasSeances(data, itemId) { return seancesOfItem(data, itemId).length > 0; }

// Valeurs calculées du poste pour ce mois, ou null si le mois n'a ni séance, ni paiement,
// ni base manuelle pour ce poste (il reste alors en saisie manuelle). `prev` = valeur actuelle
// (son montant est gardé quand le mois n'a pas de séance).
export function seancesValue(data, itemId, prev = {}) {
  const ss = seancesOfItem(data, itemId);
  const ps = paiementsOfItem(data, itemId);
  const base = (data && data.seancesBase && data.seancesBase[itemId]) || null;
  if (!ss.length && !ps.length && !base) return null;
  const baseRecu = (base && base.received) || 0;
  let recuSeances = 0;
  let recuSeancesCash = 0;
  ps.forEach((p) => {
    recuSeances += p.prix || 0;
    if (p.mode === "especes") recuSeancesCash += p.prix || 0;
  });
  let amount;
  let aVenir;
  if (ss.length) {
    amount = (base && base.amount) || 0;
    aVenir = 0;
    ss.forEach((s) => {
      if (s.statut === "annulee") return;
      amount += s.prix || 0;
      if (!s.paiement) aVenir += s.prix || 0;
    });
  } else {
    amount = prev.amount || 0;
    aVenir = Math.max(0, amount - baseRecu);
  }
  amount = cents(amount);
  aVenir = cents(aVenir);
  return {
    amount,
    received: cents(baseRecu + recuSeances),
    receivedCash: cents(((base && base.receivedCash) || 0) + recuSeancesCash),
    recuSeances: cents(recuSeances),
    aVenir,
    paid: amount > 0 && aVenir === 0
  };
}

// Recalcule values.<itemId> du mois. Renvoie les chemins modifiés (sauvegarde partielle).
// `seanceRetiree` : on vient de retirer la dernière séance du mois ; son montant (calculé à
// partir des séances) retombe à 0 au lieu d'être gardé comme montant manuel.
export function recomputeItem(data, itemId, { seanceRetiree = false } = {}) {
  if (!data.values) data.values = {};
  const prev = data.values[itemId] || { amount: 0, paid: false };
  const sansSeance = seanceRetiree && !hasSeances(data, itemId);
  const v = seancesValue(data, itemId, sansSeance ? { ...prev, amount: 0 } : prev);
  let next;
  if (v) {
    next = { ...prev, ...v };
  } else if (typeof prev.aVenir === "number") {
    // Plus aucune séance ni paiement : retour en saisie manuelle (montant gardé, sauf s'il
    // venait des séances retirées).
    next = { ...prev, amount: sansSeance ? 0 : (prev.amount || 0), received: 0, receivedCash: 0, paid: false };
    delete next.aVenir;
    delete next.recuSeances;
  } else {
    return [];
  }
  return setItemValue(data, itemId, next);
}

// Premier passage d'un mois en mode séances : l'encaissé saisi à la main jusque-là est gardé
// comme base (sinon il disparaîtrait au profit des seules séances enregistrées).
function ensureBase(data, itemId) {
  const v = data.values && data.values[itemId];
  if (!v || typeof v.aVenir === "number") return [];
  if (data.seancesBase && data.seancesBase[itemId]) return [];
  const received = receivedOf(v);
  if (!received) return [];
  data.seancesBase = { ...(data.seancesBase || {}), [itemId]: { amount: received, received, receivedCash: cashOf(v) } };
  return [`seancesBase.${itemId}`];
}

// ---- Opérations ----
// `docs` = { "<AAAA-MM>": données du mois } : copies locales des mois concernés, déjà chargées
// (ou créées) par l'appelant — voir monthsNeeded. Chaque opération modifie ces copies et
// renvoie les chemins modifiés par mois : { "<AAAA-MM>": [chemins] }.

function addChanges(changes, mid, paths) {
  if (!paths.length) return changes;
  changes[mid] = [...(changes[mid] || []), ...paths];
  return changes;
}

function docFor(docs, mid) {
  const d = docs[mid];
  if (!d) throw new Error(`Mois ${mid} non chargé`);
  if (!d.values) d.values = {};
  return d;
}

function getSeance(docs, mid, id) {
  const d = docFor(docs, mid);
  const s = d.seances && d.seances[id];
  if (!s) throw new Error(`Séance ${id} introuvable dans ${mid}`);
  return s;
}

function validate(s) {
  if (!s.itemId) throw new Error("Poste manquant");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.date || "")) throw new Error("Date et heure invalides");
  if (!(typeof s.prix === "number" && s.prix >= 0)) throw new Error("Prix invalide");
  if (!STATUTS.includes(s.statut)) throw new Error("Statut invalide");
}

// Mois à charger avant une opération (mois de la séance, mois du paiement…).
export function monthsNeeded(op, args) {
  const out = new Set();
  if (op === "ajouter") out.add(monthOfDate(args.seance.date));
  if (op === "modifier") {
    out.add(args.mois);
    if (args.patch && args.patch.date) out.add(monthOfDate(args.patch.date));
    if (args.paiement) out.add(monthOfDate(args.paiement.date));
  }
  if (op === "payer") { out.add(args.mois); out.add(monthOfDate(args.date)); }
  if (op === "annulerPaiement") { out.add(args.mois); if (args.paiement) out.add(monthOfDate(args.paiement.date)); }
  if (op === "supprimer") out.add(args.mois);
  if (op === "tarif") args.seances.forEach((s) => { out.add(s.mois); if (s.paiement) out.add(monthOfDate(s.paiement.date)); });
  return [...out];
}

export function ajouterSeance(docs, id, seance) {
  const s = { eleveId: null, statut: "prevue", paiement: null, ...seance };
  validate(s);
  const mid = monthOfDate(s.date);
  const d = docFor(docs, mid);
  const changes = {};
  addChanges(changes, mid, ensureBase(d, s.itemId));
  d.seances = { ...(d.seances || {}), [id]: s };
  addChanges(changes, mid, [`seances.${id}`]);
  addChanges(changes, mid, recomputeItem(d, s.itemId));
  return changes;
}

// Modifie une séance (statut, prix, élève, date). Une séance payée ne peut pas être annulée
// (annuler d'abord le paiement). Un changement de date vers un autre mois la déplace.
export function modifierSeance(docs, mois, id, patch) {
  const before = getSeance(docs, mois, id);
  const s = { ...before, ...patch };
  validate(s);
  if (s.statut === "annulee" && s.paiement) throw new Error("Séance payée : annuler d'abord le paiement");
  const changes = {};
  const dest = monthOfDate(s.date);
  const from = docFor(docs, mois);
  if (dest === mois) {
    from.seances = { ...from.seances, [id]: s };
    addChanges(changes, mois, [`seances.${id}`]);
  } else {
    const to = docFor(docs, dest);
    const seances = { ...from.seances };
    delete seances[id];
    from.seances = seances;
    addChanges(changes, mois, [`seances.${id}`]);
    addChanges(changes, dest, ensureBase(to, s.itemId));
    to.seances = { ...(to.seances || {}), [id]: s };
    addChanges(changes, dest, [`seances.${id}`]);
    addChanges(changes, dest, recomputeItem(to, s.itemId));
  }
  addChanges(changes, mois, recomputeItem(from, s.itemId, { seanceRetiree: dest !== mois }));
  // Paiement déjà reçu : son prix et le mois de la séance suivent la séance.
  if (s.paiement) {
    const pm = monthOfDate(s.paiement.date);
    const pd = docFor(docs, pm);
    const p = pd.paiementsSeances && pd.paiementsSeances[id];
    if (p && (p.prix !== s.prix || p.seanceMois !== dest)) {
      pd.paiementsSeances = { ...pd.paiementsSeances, [id]: { ...p, prix: s.prix, seanceMois: dest } };
      addChanges(changes, pm, [`paiementsSeances.${id}`]);
      addChanges(changes, pm, recomputeItem(pd, s.itemId));
    }
  }
  return changes;
}

// Paiement reçu le `date` (AAAA-MM-JJ) : compté dans le mois de cette date.
export function payerSeance(docs, mois, id, mode, date) {
  if (!MODES.includes(mode)) throw new Error("Mode de paiement invalide");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("Date de paiement invalide");
  const s = getSeance(docs, mois, id);
  if (s.statut === "annulee") throw new Error("Séance annulée");
  if (s.paiement) throw new Error("Séance déjà payée");
  const changes = {};
  const d = docFor(docs, mois);
  d.seances = { ...d.seances, [id]: { ...s, paiement: { mode, date } } };
  addChanges(changes, mois, [`seances.${id}`]);
  const pm = monthOfDate(date);
  const pd = docFor(docs, pm);
  addChanges(changes, pm, ensureBase(pd, s.itemId));
  pd.paiementsSeances = { ...(pd.paiementsSeances || {}), [id]: { itemId: s.itemId, prix: s.prix, mode, date, seanceMois: mois } };
  addChanges(changes, pm, [`paiementsSeances.${id}`]);
  addChanges(changes, pm, recomputeItem(pd, s.itemId));
  if (pm !== mois) addChanges(changes, mois, recomputeItem(d, s.itemId));
  return changes;
}

export function annulerPaiement(docs, mois, id) {
  const s = getSeance(docs, mois, id);
  if (!s.paiement) return {};
  const changes = {};
  const pm = monthOfDate(s.paiement.date);
  const pd = docFor(docs, pm);
  const pays = { ...(pd.paiementsSeances || {}) };
  delete pays[id];
  pd.paiementsSeances = pays;
  addChanges(changes, pm, [`paiementsSeances.${id}`]);
  addChanges(changes, pm, recomputeItem(pd, s.itemId));
  const d = docFor(docs, mois);
  d.seances = { ...d.seances, [id]: { ...s, paiement: null } };
  addChanges(changes, mois, [`seances.${id}`]);
  addChanges(changes, mois, recomputeItem(d, s.itemId));
  return changes;
}

// Suppression (saisie erronée). Une séance payée doit d'abord perdre son paiement.
export function supprimerSeance(docs, mois, id) {
  const s = getSeance(docs, mois, id);
  if (s.paiement) throw new Error("Séance payée : annuler d'abord le paiement");
  const d = docFor(docs, mois);
  const seances = { ...d.seances };
  delete seances[id];
  d.seances = seances;
  const changes = {};
  addChanges(changes, mois, [`seances.${id}`]);
  addChanges(changes, mois, recomputeItem(d, s.itemId, { seanceRetiree: true }));
  return changes;
}

// Séances non annulées et pas encore payées des mois AVANT `avantMois`, pour les postes
// `itemIds` : à encaisser, comptées dans les revenus à venir du mois en cours.
// `months` = [{ id, data }]. Renvoie { parPoste: { itemId: total }, liste: [séances] }.
export function arrieres(months, avantMois, itemIds) {
  const parPoste = {};
  const liste = [];
  months.forEach(({ id, data }) => {
    if (id >= avantMois) return;
    Object.entries((data && data.seances) || {}).forEach(([sid, s]) => {
      if (!s || !itemIds.includes(s.itemId) || s.statut === "annulee" || s.paiement) return;
      parPoste[s.itemId] = cents((parPoste[s.itemId] || 0) + (s.prix || 0));
      liste.push({ id: sid, mois: id, ...s });
    });
  });
  liste.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { parPoste, liste };
}

// Nouveau tarif d'un élève : séances à repasser au nouveau prix. Seulement les séances non
// payées (l'argent reçu ne change pas) et non annulées, dont le prix est encore l'ancien tarif
// (un prix ajusté à la main est gardé). `depuis` (AAAA-MM-JJ) : seulement à partir de ce jour.
// `months` = [{ id, data }]. Renvoie les séances (avec leur mois).
export function seancesATarifer(months, itemId, eleveId, ancienTarif, { depuis = null } = {}) {
  const out = [];
  months.forEach(({ id, data }) => {
    Object.entries((data && data.seances) || {}).forEach(([sid, s]) => {
      if (!s || s.itemId !== itemId || s.eleveId !== eleveId) return;
      if (s.paiement || s.statut === "annulee") return;
      if (typeof ancienTarif === "number" && s.prix !== ancienTarif) return;
      if (depuis && s.date.slice(0, 10) < depuis) return;
      out.push({ id: sid, mois: id, ...s });
    });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Applique `prix` aux séances données (voir seancesATarifer) ; mêmes recalculs que modifierSeance.
export function appliquerTarif(docs, seances, prix) {
  if (!(typeof prix === "number" && prix >= 0)) throw new Error("Prix invalide");
  const changes = {};
  seances.forEach((s) => {
    Object.entries(modifierSeance(docs, s.mois, s.id, { prix })).forEach(([m, p]) => addChanges(changes, m, p));
  });
  return changes;
}

// Élèves d'un poste (copie triée par nom, actifs d'abord).
export function elevesOf(item) {
  return [...((item && item.eleves) || [])].sort((a, b) =>
    (a.actif === false) - (b.actif === false) || String(a.nom).localeCompare(String(b.nom), "fr"));
}
