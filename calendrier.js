// Calendrier scolaire de la région parisienne (zone C : académies de Paris, Créteil et
// Versailles) et jours fériés : logique pure, sans DOM, importée par app.js, etudes.js et les
// tests (tests/calendrier.test.js).
//
// Vacances : jeu de données officiel « fr-en-calendrier-scolaire » (data.education.gouv.fr),
// zone C, élèves. Dates en heure de Paris : `du` = premier jour sans cours, `au` = dernier jour
// de vacances inclus (la reprise est le lendemain). À compléter chaque année quand le
// ministère publie l'année suivante.
export const VACANCES = [
  { nom: "Vacances d'été", court: "Été", du: "2025-07-05", au: "2025-08-31" },
  { nom: "Vacances de la Toussaint", court: "Toussaint", du: "2025-10-18", au: "2025-11-02" },
  { nom: "Vacances de Noël", court: "Noël", du: "2025-12-20", au: "2026-01-04" },
  { nom: "Vacances d'hiver", court: "Hiver", du: "2026-02-21", au: "2026-03-08" },
  { nom: "Vacances de printemps", court: "Printemps", du: "2026-04-18", au: "2026-05-03" },
  { nom: "Pont de l'Ascension", court: "Ascension", du: "2026-05-14", au: "2026-05-17" },
  { nom: "Vacances d'été", court: "Été", du: "2026-07-04", au: "2026-08-31" },
  { nom: "Vacances de la Toussaint", court: "Toussaint", du: "2026-10-17", au: "2026-11-01" },
  { nom: "Vacances de Noël", court: "Noël", du: "2026-12-19", au: "2027-01-03" },
  { nom: "Vacances d'hiver", court: "Hiver", du: "2027-02-06", au: "2027-02-21" },
  { nom: "Vacances de printemps", court: "Printemps", du: "2027-04-03", au: "2027-04-18" },
  // Le jeu de données ne donne que le vendredi 7 (pont) : jeudi férié et week-end compris.
  { nom: "Pont de l'Ascension", court: "Ascension", du: "2027-05-06", au: "2027-05-09" },
  { nom: "Vacances d'été", court: "Été", du: "2027-07-03", au: "2027-09-01" },
  { nom: "Vacances de la Toussaint", court: "Toussaint", du: "2027-10-23", au: "2027-11-07" },
  { nom: "Vacances de Noël", court: "Noël", du: "2027-12-18", au: "2028-01-02" },
  { nom: "Vacances d'hiver", court: "Hiver", du: "2028-02-12", au: "2028-02-27" },
  { nom: "Vacances de printemps", court: "Printemps", du: "2028-04-15", au: "2028-05-01" },
  { nom: "Pont de l'Ascension", court: "Ascension", du: "2028-05-25", au: "2028-05-28" },
  // Fin pas encore publiée : rentrée supposée début septembre.
  { nom: "Vacances d'été", court: "Été", du: "2028-07-04", au: "2028-08-31" }
];

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

// Dimanche de Pâques (algorithme de Meeus / Butcher), en [mois, jour].
function paques(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return [Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1];
}

const feriesCache = {};
// Jours fériés en France métropolitaine pour l'année `y` : { "AAAA-MM-JJ": nom }.
export function joursFeries(y) {
  if (feriesCache[y]) return feriesCache[y];
  const [pm, pj] = paques(y);
  return (feriesCache[y] = {
    [iso(y, 1, 1)]: "Jour de l'an",
    [iso(y, pm, pj + 1)]: "Lundi de Pâques",
    [iso(y, 5, 1)]: "Fête du Travail",
    [iso(y, 5, 8)]: "Victoire 1945",
    [iso(y, pm, pj + 39)]: "Ascension",
    [iso(y, pm, pj + 50)]: "Lundi de Pentecôte",
    [iso(y, 7, 14)]: "Fête nationale",
    [iso(y, 8, 15)]: "Assomption",
    [iso(y, 11, 1)]: "Toussaint",
    [iso(y, 11, 11)]: "Armistice 1918",
    [iso(y, 12, 25)]: "Noël"
  });
}

// Vacances scolaires qui contiennent ce jour ("AAAA-MM-JJ", ou une date de séance), ou null.
export function vacancesDu(jour) {
  const d = String(jour).slice(0, 10);
  return VACANCES.find((v) => v.du <= d && d <= v.au) || null;
}

// Ce qui rend un jour particulier : { ferie: nom | null, vacances: période | null }, ou null
// pour un jour d'école ordinaire.
export function infoJour(jour) {
  const d = String(jour).slice(0, 10);
  const ferie = joursFeries(+d.slice(0, 4))[d] || null;
  const vacances = vacancesDu(d);
  return ferie || vacances ? { ferie, vacances } : null;
}

// Vacances qui touchent le mois "AAAA-MM", dans l'ordre.
export function vacancesDuMois(mid) {
  return VACANCES.filter((v) => v.du.slice(0, 7) <= mid && mid <= v.au.slice(0, 7));
}

// Jours fériés du mois "AAAA-MM" : [{ jour, nom }].
export function feriesDuMois(mid) {
  return Object.entries(joursFeries(+mid.slice(0, 4)))
    .filter(([d]) => d.startsWith(mid))
    .sort()
    .map(([jour, nom]) => ({ jour, nom }));
}

// Vacances en cours ou prochaines à partir de `jour` ("AAAA-MM-JJ"), ou null.
export function prochainesVacances(jour) {
  return VACANCES.find((v) => v.au >= jour) || null;
}

// Lendemain d'une date "AAAA-MM-JJ" (jour de la reprise après des vacances).
export function lendemain(jour) {
  const [y, m, d] = jour.split("-").map(Number);
  return iso(y, m, d + 1);
}
