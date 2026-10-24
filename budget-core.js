// Logique pure du budget (calculs, formats de données d'un mois), sans DOM ni Firebase :
// importée par app.js dans le navigateur ET par les tests (tests/, `npm test` sous Node).
import { SPACES } from "./firebase-config.js";

// Espace de repli (même valeur que FALLBACK_OWNER dans app.js) : voir bankBalancesOf.
const FALLBACK_OWNER = SPACES[0].key;

export function monthId(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(id, delta) {
  const [y, m] = id.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthId(d);
}

// Un poste est actif pour un mois donné s'il n'a jamais été retiré, ou s'il a été retiré
// après ce mois (permet de garder les postes retirés visibles dans l'historique passé).
export function isActiveAt(item, monthIdStr) {
  return !item.retiredAt || monthIdStr < item.retiredAt;
}

// Un poste est dans le périmètre du scope courant : soit on regarde la famille entière,
// soit uniquement les postes d'un espace précis.
export function inScope(item, scope) {
  return scope === "famille" || item.owner === scope;
}

// Dépense "partagée" : le compte de l'espace est débité du montant TOTAL, mais une autre
// personne rembourse sa part en dehors de l'appli (espèces, virement...). Le poste garde son
// montant net habituel (utilisé partout : Prévisions, Historique, cartes résumé) — seul le
// Suivi du mois (mois en cours) a besoin du montant total réel + du statut du remboursement,
// pour que "Charges à venir" / "Reste à vivre réel" / l'allocation journalière restent justes
// entre la date du remboursement et la date du prélèvement.
export function isShared(item) { return !!(item && item.role === "partagee"); }

// Solde bancaire : format { habib, marwa }. L'ancien format (un seul nombre) est rattaché à
// l'espace de repli et converti à la première écriture ; en vue "Famille" on somme tout.
export function bankBalancesOf(data) {
  if (!data) return {};
  if (data.bankBalances && typeof data.bankBalances === "object") return data.bankBalances;
  if (typeof data.bankBalance === "number") return { [FALLBACK_OWNER]: data.bankBalance };
  return {};
}

// Montant d'un revenu déjà encaissé. Nouveau champ `received` (partiel) ; à défaut,
// on retombe sur l'ancien booléen `paid` (tout ou rien).
export function receivedOf(v) {
  if (!v) return 0;
  if (typeof v.received === "number") return v.received;
  return v.paid ? (v.amount || 0) : 0;
}
// Part de l'encaissé reçue en espèces (`receivedCash`) : elle n'arrive pas sur le compte,
// mais c'est de l'argent disponible. Le reste de `received` est du virement.
export function cashOf(v) {
  if (!v || typeof v.receivedCash !== "number") return 0;
  return Math.min(v.receivedCash, receivedOf(v));
}
export function virementOf(v) { return Math.max(0, receivedOf(v) - cashOf(v)); }
// Nouveau montant d'un poste. Un revenu remis à 0 n'est plus affiché dans le Suivi : son
// encaissé (virement/espèces) n'y serait plus modifiable, on l'efface donc avec le montant.
export function withIncomeAmount(item, v, amount) {
  const next = { ...v, amount };
  if (item && item.type === "income" && !amount) {
    next.received = 0;
    next.receivedCash = 0;
    next.paid = false;
  }
  return next;
}
// Somme de tous les soldes bancaires du mois, quelle que soit la clé — y compris d'anciens
// seaux orphelins (ex. "commun") pas encore réaffectés à une personne.
export function sumBankBalances(data) {
  return Object.values(bankBalancesOf(data)).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
}
export function bankFor(data, scope) {
  if (scope === "famille") return sumBankBalances(data);
  return bankBalancesOf(data)[scope] || 0;
}
// Solde espèces (argent liquide en main), saisi à la main comme le solde bancaire :
// format { habib, marwa }. Il s'ajoute au solde bancaire dans l'argent disponible.
export function cashBalancesOf(data) {
  return (data && data.cashBalances && typeof data.cashBalances === "object") ? data.cashBalances : {};
}
export function cashFor(data, scope) {
  const all = cashBalancesOf(data);
  if (scope === "famille") return Object.values(all).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
  return all[scope] || 0;
}

export function computeTotals(cat, data, scope = "famille") {
  const values = (data && data.values) || {};
  let totalIncome = 0;
  let epargneIn = 0;          // "Virement de l'épargne" : reprise sur la réserve, pas un vrai revenu
  let revenusAVenir = 0;      // revenus du mois pas encore cochés "reçu"
  let especesRecues = 0;      // revenus déjà encaissés en espèces (hors compte bancaire)
  const byGroup = { regulieres: 0, occasionnelles: 0, capital: 0 };
  let chargesAVenir = 0;      // charges réelles (régulières/occasionnelles) pas encore payées
  let capitalAVenir = 0;      // épargne/investissement du mois pas encore fait(e)
  cat.items.forEach((item) => {
    if (!inScope(item, scope)) return;
    const v = values[item.id];
    const amount = (v && v.amount) || 0;
    if (item.type === "income") {
      totalIncome += amount;
      if (item.role === "epargne_out") epargneIn += amount;
      revenusAVenir += Math.max(0, amount - receivedOf(v));
      // Seulement les revenus prévus ce mois (montant > 0), comme ceux affichés dans le Suivi :
      // un poste remis à 0 garde son ancien `receivedCash` en base, invisible et non modifiable.
      if (amount > 0) especesRecues += cashOf(v);
    } else {
      byGroup[item.type] = (byGroup[item.type] || 0) + amount;
      if (isShared(item)) {
        // Le compte est débité du montant TOTAL (pas juste la part nette `amount`) tant que
        // ce n'est pas payé ; la part remboursée par l'autre personne est un revenu à venir
        // tant que le remboursement n'est pas reçu. `amount` (net) continue seul d'alimenter
        // byGroup/Dépenses/Prévisions ci-dessus : rien ne change de ce côté-là.
        // Par défaut (tant que le montant total réel n'est pas saisi) : une dépense partagée
        // se répartit à 50/50, donc le montant total = le double de la part nette (`amount`).
        const montantTotal = (v && v.montantTotal != null) ? v.montantTotal : amount * 2;
        const partAutre = Math.max(0, montantTotal - amount);
        if (!v || !v.paid) chargesAVenir += montantTotal;
        if (!v || !v.remboursementRecu) revenusAVenir += partAutre;
      } else if (!v || !v.paid) {
        if (item.type === "capital") capitalAVenir += amount;
        else chargesAVenir += amount;
      }
    }
  });
  const totalExpenses = byGroup.regulieres + byGroup.occasionnelles + byGroup.capital;
  // Dépenses réelles : hors épargne/investissement, qui ne sont pas de l'argent perdu mais
  // du patrimoine qu'on range ailleurs (compte épargne, etc.), pas une charge de vie.
  const depensesReelles = byGroup.regulieres + byGroup.occasionnelles;
  const revenusReels = totalIncome - epargneIn;   // revenus hors reprise sur l'épargne
  // Solde / reste à vivre : ici on réintègre la reprise sur l'épargne (totalIncome, pas
  // revenusReels) — l'argent transféré comble vraiment le mois, donc le solde doit refléter
  // la trésorerie réelle et ne pas plonger dans le négatif à cause de ça. Le fait que ce
  // mois s'appuie sur l'épargne reste visible via la note sur la carte "Revenus".
  const balance = totalIncome - totalExpenses;
  const bankBalance = bankFor(data, scope);
  // Reste à vivre réel / solde projeté : l'épargne/investissement pas encore fait(e) quittera
  // quand même le compte courant, donc on la déduit toujours ici (sinon on risque de la
  // "dépenser" par erreur) — seul l'affichage "Charges à venir" la distingue des vraies factures.
  const aVenirTotal = chargesAVenir + capitalAVenir;
  // Argent disponible = compte + espèces en main (solde espèces saisi à la main, qui tient
  // compte du liquide déjà dépensé). `especesRecues` reste affiché pour info seulement :
  // l'ajouter en plus compterait deux fois le liquide déjà inclus dans le solde espèces.
  const cashBalance = cashFor(data, scope);
  const disponible = bankBalance + cashBalance;
  const resteAVivreReel = disponible - aVenirTotal;
  // Solde projeté fin de mois : + les revenus encore à encaisser. Chiffre stable qui ne
  // saute pas selon la date à laquelle le salaire (ou les versements de l'Etude) tombent.
  const soldeProjete = disponible + revenusAVenir - aVenirTotal;
  return { totalIncome, revenusReels, epargneIn, revenusAVenir, especesRecues, byGroup, totalExpenses, depensesReelles, balance, chargesAVenir, capitalAVenir, resteAVivreReel, soldeProjete, bankBalance, cashBalance };
}

// Nouveau mois : mêmes montants que le mois source, rien de payé/reçu, soldes à saisir.
export function cloneForNewMonth(prev) {
  const values = {};
  Object.entries((prev && prev.values) || {}).forEach(([id, v]) => {
    values[id] = { amount: v.amount || 0, paid: false };
  });
  return { values, bankBalances: {} };
}
