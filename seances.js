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
// - `seancesEstimation.<itemId>` = montant estimé à la main avant la première séance du mois,
//   rétabli si toutes les séances du mois sont retirées (ex. série programmée puis supprimée).
//
// À partir de là, values.<itemId> du mois est recalculé (recomputeItem) :
// - amount : si le mois a des séances, la somme des séances non annulées (+ base) ; sinon le
//   montant saisi à la main est gardé (estimation dans Prévisions).
// - received / receivedCash : base + paiements arrivés ce mois (`recuSeances` = leur total).
// - aVenir : séances du mois pas encore payées ; sans séance, montant − encaissé manuel (base).
// Le reste de l'appli (totaux, Prévisions, Historique, Analyse) continue de lire values comme
// pour n'importe quel revenu. Un mois jamais touché par les séances reste en saisie manuelle.
// Même version que l'import de budget-core.js dans app.js (un seul module chargé, pas de cache périmé).
import { setItemValue, receivedOf, cashOf, virementOf } from "./budget-core.js?v=3";

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
  // Dernière séance retirée : retour à l'estimation manuelle d'avant les séances (0 sinon).
  const extra = [];
  let estimation = 0;
  if (sansSeance && data.seancesEstimation && itemId in data.seancesEstimation) {
    estimation = data.seancesEstimation[itemId] || 0;
    const rest = { ...data.seancesEstimation };
    delete rest[itemId];
    data.seancesEstimation = rest;
    extra.push(`seancesEstimation.${itemId}`);
  }
  const v = seancesValue(data, itemId, sansSeance ? { ...prev, amount: estimation } : prev);
  let next;
  if (v) {
    next = { ...prev, ...v };
  } else if (typeof prev.aVenir === "number") {
    // Plus aucune séance ni paiement : retour en saisie manuelle (montant gardé, sauf s'il
    // venait des séances retirées).
    next = { ...prev, amount: sansSeance ? estimation : (prev.amount || 0), received: 0, receivedCash: 0, paid: false };
    delete next.aVenir;
    delete next.recuSeances;
  } else {
    return extra;
  }
  return [...extra, ...setItemValue(data, itemId, next)];
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

// Première séance d'un mois pour ce poste : son montant estimé à la main est mémorisé.
function rememberEstimation(data, itemId) {
  if (hasSeances(data, itemId)) return [];
  if (data.seancesEstimation && itemId in data.seancesEstimation) return [];
  const v = data.values && data.values[itemId];
  data.seancesEstimation = { ...(data.seancesEstimation || {}), [itemId]: (v && v.amount) || 0 };
  return [`seancesEstimation.${itemId}`];
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
  if (op === "programmer") args.dates.forEach((d) => out.add(monthOfDate(d)));
  if (op === "supprimerListe" || op === "faites") args.seances.forEach((s) => out.add(s.mois));
  return [...out];
}

export function ajouterSeance(docs, id, seance) {
  const s = { eleveId: null, statut: "prevue", paiement: null, ...seance };
  validate(s);
  const mid = monthOfDate(s.date);
  const d = docFor(docs, mid);
  const changes = {};
  addChanges(changes, mid, ensureBase(d, s.itemId));
  addChanges(changes, mid, rememberEstimation(d, s.itemId));
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
  // Une séance doit être faite pour être payée : une fois payée, elle ne repasse pas « pas faite »
  // sans annuler d'abord le paiement.
  if (before.statut === "faite" && s.statut !== "faite" && s.paiement) {
    throw new Error("Séance payée : annuler d'abord le paiement pour la marquer non faite");
  }
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
    addChanges(changes, dest, rememberEstimation(to, s.itemId));
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
  if (s.statut !== "faite") throw new Error("Marquer d'abord la séance faite pour enregistrer son paiement");
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

// ---- Programmation automatique (séances récurrentes) ----
export const MAX_PROGRAMMATION = 200;

// Dates des séances d'une programmation : chaque jour de la semaine de `jours` (0 = dimanche,
// 1 = lundi… comme Date.getDay) à `heure` ("HH:MM"), du `du` au `au` inclus ("AAAA-MM-JJ").
// Calcul en UTC : pas de décalage au changement d'heure été / hiver.
export function datesRecurrentes({ jours, heure, du, au }) {
  if (!Array.isArray(jours) || !jours.length || jours.some((j) => !(Number.isInteger(j) && j >= 0 && j <= 6))) {
    throw new Error("Choisir au moins un jour de la semaine");
  }
  if (!/^\d{2}:\d{2}$/.test(heure || "")) throw new Error("Heure invalide");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(du || "") || !/^\d{4}-\d{2}-\d{2}$/.test(au || "")) throw new Error("Période invalide");
  if (au < du) throw new Error("La date de fin est avant la date de début");
  const [y1, m1, d1] = du.split("-").map(Number);
  const [y2, m2, d2] = au.split("-").map(Number);
  const fin = Date.UTC(y2, m2 - 1, d2);
  const out = [];
  for (let t = Date.UTC(y1, m1 - 1, d1); t <= fin; t += 86400000) {
    const d = new Date(t);
    if (!jours.includes(d.getUTCDay())) continue;
    out.push(`${d.toISOString().slice(0, 10)}T${heure}`);
    if (out.length > MAX_PROGRAMMATION) throw new Error(`Trop de séances d'un coup (maximum ${MAX_PROGRAMMATION})`);
  }
  return out;
}

// Crée une séance « prévue » par date (`base` = { itemId, eleveId, prix, serieId }). Une date où
// l'élève a déjà une séance non annulée à la même heure est ignorée (pas de doublon).
// `newId()` fournit les identifiants. Renvoie { changes, creees, ignorees }.
export function programmerSeances(docs, base, dates, newId) {
  const changes = {};
  const creees = [];
  const ignorees = [];
  dates.forEach((date) => {
    const d = docFor(docs, monthOfDate(date));
    const doublon = Object.values(d.seances || {}).some((s) =>
      s && s.itemId === base.itemId && s.eleveId === base.eleveId && s.date === date && s.statut !== "annulee");
    if (doublon) { ignorees.push(date); return; }
    const c = ajouterSeance(docs, newId(), { ...base, date, statut: "prevue", paiement: null });
    Object.entries(c).forEach(([m, p]) => addChanges(changes, m, p));
    creees.push(date);
  });
  return { changes, creees, ignorees };
}

// Séances d'une série encore modifiables à partir de `depuis` ("AAAA-MM-JJTHH:MM" inclus) :
// prévues et non payées (celles faites ou payées restent). `months` = [{ id, data }].
export function seancesSerie(months, serieId, depuis) {
  const out = [];
  months.forEach(({ id, data }) => {
    Object.entries((data && data.seances) || {}).forEach(([sid, s]) => {
      if (!s || !serieId || s.serieId !== serieId) return;
      if (s.statut !== "prevue" || s.paiement || s.date < depuis) return;
      out.push({ id: sid, mois: id, ...s });
    });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Séances d'un élève après `depuis` ("AAAA-MM-JJTHH:MM" exclu), à supprimer avec lui : non
// payées (annulées comprises) ; les séances payées et celles déjà passées restent.
// `months` = [{ id, data }].
export function seancesFuturesEleve(months, itemId, eleveId, depuis) {
  const out = [];
  months.forEach(({ id, data }) => {
    Object.entries((data && data.seances) || {}).forEach(([sid, s]) => {
      if (!s || s.itemId !== itemId || s.eleveId !== eleveId) return;
      if (s.paiement || s.date <= depuis) return;
      out.push({ id: sid, mois: id, ...s });
    });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function supprimerSeances(docs, seances) {
  const changes = {};
  seances.forEach((s) => {
    Object.entries(supprimerSeance(docs, s.mois, s.id)).forEach(([m, p]) => addChanges(changes, m, p));
  });
  return changes;
}

// Séances des mois APRÈS `apresMois` pour les postes `itemIds` (annulées comprises, pour pouvoir
// les rétablir), triées par date : section « Prochains mois » du journal.
export function seancesFutures(months, apresMois, itemIds) {
  const out = [];
  months.forEach(({ id, data }) => {
    if (id <= apresMois) return;
    Object.entries((data && data.seances) || {}).forEach(([sid, s]) => {
      if (s && itemIds.includes(s.itemId)) out.push({ id: sid, mois: id, ...s });
    });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---- Saisie rapide (zone « À traiter » du Suivi) ----

// Séances déjà passées (date et heure <= `maintenant`, "AAAA-MM-JJTHH:MM") encore à traiter :
// pas encore marquées faites, ou pas encore payées. Séances du mois `data` (mois `mois`)
// + impayés des mois précédents (`arr`, voir arrieres). Triées de la plus ancienne à la plus
// récente. Les séances annulées sont ignorées.
export function seancesATraiter(data, mois, arr, itemId, maintenant) {
  const out = [];
  seancesOfItem(data, itemId).forEach((s) => {
    if (s.statut === "annulee" || s.date > maintenant) return;
    if (s.statut === "faite" && s.paiement) return;
    out.push({ ...s, mois });
  });
  (arr || []).forEach((s) => {
    if (s.itemId !== itemId || s.statut === "annulee" || s.paiement || s.date > maintenant) return;
    out.push({ ...s });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Plusieurs séances marquées faites d'un coup (`seances` = [{ id, mois }]).
export function marquerFaites(docs, seances) {
  const changes = {};
  seances.forEach((s) => {
    const cur = getSeance(docs, s.mois, s.id);
    if (cur.statut !== "prevue") return;
    Object.entries(modifierSeance(docs, s.mois, s.id, { statut: "faite" })).forEach(([m, p]) => addChanges(changes, m, p));
  });
  return changes;
}

// Élèves d'un poste (copie triée par nom, actifs d'abord). Un élève supprimé (`supprime`) est
// gardé dans item.eleves pour le nom de ses séances passées, mais n'est plus listé, sauf
// `avec` (l'élève d'une séance modifiée).
export function elevesOf(item, { avec = null } = {}) {
  return ((item && item.eleves) || []).filter((e) => !e.supprime || e.id === avec).sort((a, b) =>
    (a.actif === false) - (b.actif === false) || String(a.nom).localeCompare(String(b.nom), "fr"));
}

// ---- Analyse de l'activité (onglet Études) ----

const JOUR_MS = 86400000;
const jourUTC = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));

// Bilan de l'activité depuis son démarrage, pour les postes à séances `items` d'une personne.
// `months` = [{ id, data }] (tous les mois, triés), `maintenant` = "AAAA-MM-JJTHH:MM".
// L'argent reçu vient de values (comme le reste de l'appli : y compris les mois saisis à la
// main avant la première séance) ; le reste vient des séances elles-mêmes.
// Renvoie null si aucun mois n'a d'encaissé ni de séance.
export function statsActivite(months, items, maintenant) {
  const ids = items.map((it) => it.id);
  const cur = monthOfDate(maintenant);
  const seances = [];
  months.forEach(({ id, data }) => {
    Object.entries((data && data.seances) || {}).forEach(([sid, s]) => {
      if (s && ids.includes(s.itemId)) seances.push({ id: sid, mois: id, ...s });
    });
  });
  seances.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Démarrage : premier mois avec de l'argent reçu ou une séance.
  const recuDuMois = (data) => ids.reduce((acc, itemId) => {
    const v = data && data.values && data.values[itemId];
    acc.virement += virementOf(v);
    acc.especes += cashOf(v);
    return acc;
  }, { virement: 0, especes: 0 });
  const debutRecu = months.find(({ id, data }) => {
    if (id > cur) return false;
    const r = recuDuMois(data);
    return r.virement + r.especes > 0;
  });
  const debuts = [debutRecu && debutRecu.id, seances.length && seances[0].mois].filter(Boolean).sort();
  if (!debuts.length) return null;
  const debut = debuts[0];

  // Mois par mois : du démarrage au dernier mois qui a une séance prévue (ou au mois en cours).
  const fin = seances.reduce((m, s) => (s.statut !== "annulee" && s.mois > m ? s.mois : m), cur);
  const parMois = {};
  months.forEach(({ id, data }) => {
    if (id < debut || id > fin) return;
    const r = recuDuMois(data);
    parMois[id] = { id, virement: cents(r.virement), especes: cents(r.especes), aEncaisser: 0, faites: 0, annulees: 0, prevues: 0 };
  });
  for (let id = debut; id <= fin; id = addMonthId(id, 1)) {
    if (!parMois[id]) parMois[id] = { id, virement: 0, especes: 0, aEncaisser: 0, faites: 0, annulees: 0, prevues: 0 };
  }

  // Par élève, fiabilité, rythme, à venir.
  const nomOf = {};
  const statutOf = {};
  items.forEach((it) => (it.eleves || []).forEach((e) => {
    nomOf[`${it.id}|${e.id}`] = e.nom;
    statutOf[`${it.id}|${e.id}`] = e.supprime ? "supprime" : e.actif === false ? "inactif" : "actif";
  }));
  const eleves = {};
  const eleveOf = (s) => {
    const k = `${s.itemId}|${s.eleveId || ""}`;
    if (!eleves[k]) {
      eleves[k] = {
        itemId: s.itemId, eleveId: s.eleveId || null, nom: nomOf[k] || "Sans élève", statut: statutOf[k] || "actif",
        faites: 0, annulees: 0, passees: 0, paye: 0, impaye: 0, premiere: null, derniere: null, prochaine: null
      };
    }
    return eleves[k];
  };
  // Élèves sans séance (ajoutés mais pas encore venus) : listés aussi, sauf les supprimés.
  items.forEach((it) => (it.eleves || []).forEach((e) => { if (!e.supprime) eleveOf({ itemId: it.id, eleveId: e.id }); }));

  let faites = 0, annulees = 0, passees = 0, sommeFaites = 0, aTraiter = 0;
  const impayes = { nombre: 0, total: 0 };
  const delais = [];
  const grille = Array.from({ length: 7 }, () => Array(24).fill(0));
  const aVenir = { nombre: 0, total: 0, prochaine: null, parMois: {} };

  seances.forEach((s) => {
    const e = eleveOf(s);
    const m = parMois[s.mois];
    const passee = s.date <= maintenant;
    if (s.statut === "annulee") {
      if (m) m.annulees += 1;
      if (passee) { annulees += 1; passees += 1; e.annulees += 1; e.passees += 1; }
      return;
    }
    // Rythme : jours et heures des séances non annulées (passées et prévues).
    grille[(new Date(jourUTC(s.date)).getUTCDay() + 6) % 7][+s.date.slice(11, 13)] += 1;
    if (m && !s.paiement) m.aEncaisser = cents(m.aEncaisser + (s.prix || 0));
    if (s.paiement) {
      e.paye = cents(e.paye + (s.prix || 0));
      delais.push(Math.round((jourUTC(s.paiement.date) - jourUTC(s.date)) / JOUR_MS));
    }
    if (passee) {
      passees += 1;
      e.passees += 1;
      if (!e.premiere) e.premiere = s.date;
      e.derniere = s.date;
      if (!s.paiement) {
        impayes.nombre += 1;
        impayes.total = cents(impayes.total + (s.prix || 0));
        e.impaye = cents(e.impaye + (s.prix || 0));
      }
      if (s.statut === "prevue") aTraiter += 1;
    } else {
      if (m) m.prevues += 1;
      if (!e.prochaine) e.prochaine = s.date;
      aVenir.nombre += 1;
      aVenir.total = cents(aVenir.total + (s.prix || 0));
      if (!aVenir.prochaine) aVenir.prochaine = { date: s.date, nom: e.nom, prix: s.prix };
      const pm = aVenir.parMois[s.mois] || (aVenir.parMois[s.mois] = { id: s.mois, nombre: 0, total: 0 });
      pm.nombre += 1;
      pm.total = cents(pm.total + (s.prix || 0));
    }
    if (s.statut === "faite") {
      faites += 1;
      sommeFaites += s.prix || 0;
      e.faites += 1;
      if (m) m.faites += 1;
    }
  });

  const mois = Object.values(parMois).sort((a, b) => (a.id < b.id ? -1 : 1));
  const virement = cents(mois.reduce((t, m) => t + (m.id <= cur ? m.virement : 0), 0));
  const especes = cents(mois.reduce((t, m) => t + (m.id <= cur ? m.especes : 0), 0));
  // Moyenne mensuelle sur les mois terminés (le mois en cours n'est pas complet).
  const termines = mois.filter((m) => m.id < cur);
  const moyenneMois = termines.length ? cents(termines.reduce((t, m) => t + m.virement + m.especes, 0) / termines.length) : null;

  const top = [];
  grille.forEach((heures, jour) => heures.forEach((n, heure) => { if (n) top.push({ jour, heure, n }); }));
  top.sort((a, b) => b.n - a.n || a.jour - b.jour || a.heure - b.heure);

  return {
    debut,
    debutSeances: seances.length ? seances[0].date : null,
    nbMois: monthsBetween(debut, cur) + 1,
    totaux: {
      encaisse: cents(virement + especes), virement, especes,
      faites, prixMoyen: faites ? cents(sommeFaites / faites) : null, moyenneMois
    },
    mois,
    eleves: Object.values(eleves)
      .map((e) => ({ ...e, tauxAnnulation: e.passees ? e.annulees / e.passees : null }))
      .sort((a, b) => (a.statut === "supprime") - (b.statut === "supprime") || b.paye - a.paye || a.nom.localeCompare(b.nom, "fr")),
    fiabilite: {
      tauxAnnulation: passees ? annulees / passees : null, annulees, passees, impayes, aTraiter,
      delaiMoyen: delais.length ? Math.round((delais.reduce((t, d) => t + d, 0) / delais.length) * 10) / 10 : null
    },
    rythme: { grille, top: top.slice(0, 3) },
    aVenir: { ...aVenir, parMois: Object.values(aVenir.parMois).sort((a, b) => (a.id < b.id ? -1 : 1)) }
  };
}

function addMonthId(id, delta) {
  const [y, m] = id.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function monthsBetween(a, b) {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
