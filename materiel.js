// Investissement matériel (ex. sono, micros pour une activité) : logique pure, sans DOM ni
// Firebase, importée par app.js et les tests (tests/materiel.test.js).
//
// Un achat est rangé dans settings.materiel.<id> :
//   { owner, nom, date: "AAAA-MM-JJ", prix, duree (années), residuel (% du prix),
//     estimation: { valeur, date } | null, vente: { prix, date } | null }
// Ce n'est pas de l'argent disponible : il n'entre ni dans l'épargne ni dans l'autonomie.
// Sa valeur baisse de façon linéaire du prix d'achat jusqu'à la valeur résiduelle (revente
// minimale) en `duree` années ; une estimation saisie à la main (prix d'occasion constaté)
// repart de cette valeur, au même rythme. Un objet vendu ne vaut plus rien dans le suivi :
// l'argent de la vente est compté à part (récupéré).

export const MATERIEL_DEFAUT = { duree: 5, residuel: 20 };

const JOUR_MS = 86400000;
const jourUTC = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const cents = (n) => Math.round(n * 100) / 100;

// Dernier jour du mois "AAAA-MM" ("AAAA-MM-JJ").
export function finDeMois(mid) {
  const [y, m] = mid.split("-").map(Number);
  return `${mid}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

// Valeur estimée d'un achat le jour `jour` ("AAAA-MM-JJ").
export function valeurAu(a, jour) {
  if (!a || !a.date || jour < a.date) return 0;
  if (a.vente && a.vente.date && jour >= a.vente.date) return 0;
  const prix = a.prix || 0;
  const duree = a.duree > 0 ? a.duree : MATERIEL_DEFAUT.duree;
  const residuel = typeof a.residuel === "number" ? a.residuel : MATERIEL_DEFAUT.residuel;
  const plancher = prix * Math.min(100, Math.max(0, residuel)) / 100;
  const parJour = (prix - plancher) / (duree * 365.25);
  let depart = a.date;
  let v0 = prix;
  const e = a.estimation;
  if (e && e.date && typeof e.valeur === "number" && e.date >= a.date && e.date <= jour) {
    depart = e.date;
    v0 = e.valeur;
  }
  const jours = (jourUTC(jour) - jourUTC(depart)) / JOUR_MS;
  return cents(Math.max(Math.min(plancher, v0), v0 - parJour * jours));
}

// Achats d'une personne (`owner`), ou de toutes si `owners` est une liste ; triés par date.
export function achatsDe(materiel, owners) {
  const liste = Array.isArray(owners) ? owners : [owners];
  return Object.entries(materiel || {})
    .filter(([, a]) => a && liste.includes(a.owner))
    .map(([id, a]) => ({ id, ...a }))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

// Montant acheté par mois : { "AAAA-MM": total } (sert au poste « Investissement matériel » du
// budget, calculé à partir des achats).
export function montantsParMois(achats) {
  const out = {};
  achats.forEach((a) => {
    if (!a.date) return;
    const mid = a.date.slice(0, 7);
    out[mid] = cents((out[mid] || 0) + (a.prix || 0));
  });
  return out;
}

// Bilan au jour `jour` : investi (achats déjà faits), valeur estimée, récupéré (ventes),
// perte de valeur (investi − valeur − récupéré), objets gardés / vendus.
export function bilanMateriel(achats, jour) {
  let investi = 0, valeur = 0, recupere = 0, gardes = 0, vendus = 0;
  achats.forEach((a) => {
    if (!a.date || a.date > jour) return;
    investi += a.prix || 0;
    valeur += valeurAu(a, jour);
    if (a.vente && a.vente.date && a.vente.date <= jour) { recupere += a.vente.prix || 0; vendus += 1; } else gardes += 1;
  });
  return { investi: cents(investi), valeur: cents(valeur), recupere: cents(recupere), perte: cents(investi - valeur - recupere), gardes, vendus };
}

// Séries mensuelles (fin de chaque mois de `ids`) : total investi cumulé et valeur estimée.
export function serieMateriel(achats, ids) {
  return {
    ids,
    investi: ids.map((id) => bilanMateriel(achats, finDeMois(id)).investi),
    valeur: ids.map((id) => bilanMateriel(achats, finDeMois(id)).valeur)
  };
}
