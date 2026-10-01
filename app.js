import { firebaseConfig, GOOGLE_CLIENT_ID, SPACES } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithCredential, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Un poste (revenu ou dépense) vit dans un catalogue partagé (doc meta/catalog) : ajouter,
// supprimer ou renommer un poste se fait une seule fois et se répercute sur tous les mois
// (Suivi, Prévisions, Historique), au lieu d'être dupliqué dans chaque mois séparément.
const GROUPS = [
  { key: "regulieres", label: "Charges fixes régulières" },
  { key: "occasionnelles", label: "Charges fixes occasionnelles" },
  { key: "capital", label: "Capital et réserves" }
];
const SECTIONS = [{ key: "income", label: "Revenus" }, ...GROUPS];

// Postes de "réserve" : mouvements entre le compte courant et l'épargne / l'investissement,
// pas des flux avec l'extérieur. On les distingue visuellement, et "Virement de l'épargne"
// (role epargne_out) ne compte pas dans le total "Revenus" (ça pioche dans la réserve).
const RESERVE_TAG = { epargne: "épargne", epargne_out: "reprise épargne", investissement: "invest." };
function isReserve(item) { return !!(item && RESERVE_TAG[item.role]); }
function reserveTagHtml(item) {
  return isReserve(item) ? ` <span class="poste-tag">${RESERVE_TAG[item.role]}</span>` : "";
}

// Dépense "partagée" : le compte de l'espace est débité du montant TOTAL, mais une autre
// personne rembourse sa part en dehors de l'appli (espèces, virement...). Le poste garde son
// montant net habituel (utilisé partout : Prévisions, Historique, cartes résumé) — seul le
// Suivi du mois (mois en cours) a besoin du montant total réel + du statut du remboursement,
// pour que "Charges à venir" / "Reste à vivre réel" / l'allocation journalière restent justes
// entre la date du remboursement et la date du prélèvement.
function isShared(item) { return !!(item && item.role === "partagee"); }
function sharedTagHtml(item) {
  return isShared(item) ? ` <span class="poste-tag poste-tag-shared">partagée</span>` : "";
}

// ---- Espaces budgétaires (voir firebase-config.js) ----
// Un espace par personne. Chaque poste porte un `owner` ∈ OWNER_KEYS.
// La vue "Famille" (scope "famille") consolide les espaces.
const OWNER_KEYS = SPACES.map((s) => s.key);
const OWNER_LABEL = Object.fromEntries(SPACES.map((s) => [s.key, s.label]));
const FALLBACK_COLORS = ["#2563eb", "#059669", "#7c3aed", "#d97706", "#db2777"];
const NAMED_COLORS = { habib: "#059669", marwa: "#7c3aed" };
const NAMED_BG = { habib: "#ecfdf5", marwa: "#f5f0ff" };
const OWNER_COLOR = Object.fromEntries(SPACES.map((s, i) => [s.key, s.color || NAMED_COLORS[s.key] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]]));
const OWNER_BG = Object.fromEntries(SPACES.map((s) => [s.key, NAMED_BG[s.key] || "#eef4ff"]));
const DEFAULT_SCOPE = "famille";
// Espace de repli quand un poste n'a pas encore d'owner valide (ancienne donnée, catalogue
// par défaut). L'utilisateur réaffecte ensuite depuis Prévisions (à l'unité ou en masse).
const FALLBACK_OWNER = OWNER_KEYS[0];
function ownerColor(key) { return OWNER_COLOR[key] || "#6b7280"; }
function ownerBg(key) { return OWNER_BG[key] || "#f4f6f8"; }

// localStorage peut lever (navigation privée, cookies bloqués) : on ne casse pas l'app pour ça.
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignoré */ } }

// Un poste appartient à un seul espace. Les postes du catalogue par défaut démarrent sur
// le premier espace ; on réaffecte ensuite chaque poste depuis l'écran Prévisions.
const DEFAULT_CATALOG = () => ({
  items: [
    { id: uid(), label: "Salaire", type: "income", retiredAt: null },
    { id: uid(), label: "Impôt", type: "income", retiredAt: null },
    { id: uid(), label: "Extra", type: "income", retiredAt: null },
    { id: uid(), label: "Virement de l'épargne", type: "income", retiredAt: null, role: "epargne_out" },
    { id: uid(), label: "Crédit / Loyer", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Essence", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Transport en commun", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Crèche / École", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Forfait mobile", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Box internet", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Virement enfants", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Abonnements", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Assurance électroménager", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Assurance habitation", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Assurance voiture", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Mutuelle complémentaire", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Banque", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Charges copropriété", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Assurance appareil", type: "regulieres", retiredAt: null },
    { id: uid(), label: "Électroménager", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Échéancier", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Billet de transport", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Théatre", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Sport / Club", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Réparations / Entretien voiture", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Santé (non remboursé)", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Billet d'avion", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Impôts (ponctuels)", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Vêtements", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Vacances", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Amendes", type: "occasionnelles", retiredAt: null },
    { id: uid(), label: "Épargne", type: "capital", retiredAt: null, role: "epargne" },
    { id: uid(), label: "Investissement", type: "capital", retiredAt: null, role: "investissement" }
  ].map((it) => ({ owner: FALLBACK_OWNER, ...it }))
});

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function monthId(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(id) {
  const [y, m] = id.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function monthLabelShort(id) {
  const [y, m] = id.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

function addMonths(id, delta) {
  const [y, m] = id.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthId(d);
}

function daysInMonth(id) {
  const [y, m] = id.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function remainingDays(id) {
  const today = new Date();
  const isCurrentMonth = id === monthId(today);
  if (!isCurrentMonth) return daysInMonth(id);
  return Math.max(1, daysInMonth(id) - today.getDate() + 1);
}

function euros(n) {
  return (n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

// Un poste est actif pour un mois donné s'il n'a jamais été retiré, ou s'il a été retiré
// après ce mois (permet de garder les postes retirés visibles dans l'historique passé).
function isActiveAt(item, monthIdStr) {
  return !item.retiredAt || monthIdStr < item.retiredAt;
}

// Un poste est dans le périmètre du scope courant : soit on regarde la famille entière,
// soit uniquement les postes d'un espace précis.
function inScope(item, scope) {
  return scope === "famille" || item.owner === scope;
}

// Solde bancaire : format { habib, marwa }. L'ancien format (un seul nombre) est rattaché à
// l'espace de repli et converti à la première écriture ; en vue "Famille" on somme tout.
function bankBalancesOf(data) {
  if (!data) return {};
  if (data.bankBalances && typeof data.bankBalances === "object") return data.bankBalances;
  if (typeof data.bankBalance === "number") return { [FALLBACK_OWNER]: data.bankBalance };
  return {};
}

// Montant d'un revenu déjà encaissé. Nouveau champ `received` (partiel) ; à défaut,
// on retombe sur l'ancien booléen `paid` (tout ou rien).
function receivedOf(v) {
  if (!v) return 0;
  if (typeof v.received === "number") return v.received;
  return v.paid ? (v.amount || 0) : 0;
}
// Part de l'encaissé reçue en espèces (`receivedCash`) : elle n'arrive pas sur le compte,
// mais c'est de l'argent disponible. Le reste de `received` est du virement.
function cashOf(v) {
  if (!v || typeof v.receivedCash !== "number") return 0;
  return Math.min(v.receivedCash, receivedOf(v));
}
function virementOf(v) { return Math.max(0, receivedOf(v) - cashOf(v)); }
// Somme de tous les soldes bancaires du mois, quelle que soit la clé — y compris d'anciens
// seaux orphelins (ex. "commun") pas encore réaffectés à une personne.
function sumBankBalances(data) {
  return Object.values(bankBalancesOf(data)).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
}
function bankFor(data, scope) {
  if (scope === "famille") return sumBankBalances(data);
  return bankBalancesOf(data)[scope] || 0;
}
// Solde espèces (argent liquide en main), saisi à la main comme le solde bancaire :
// format { habib, marwa }. Il s'ajoute au solde bancaire dans l'argent disponible.
function cashBalancesOf(data) {
  return (data && data.cashBalances && typeof data.cashBalances === "object") ? data.cashBalances : {};
}
function cashFor(data, scope) {
  const all = cashBalancesOf(data);
  if (scope === "famille") return Object.values(all).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
  return all[scope] || 0;
}

// Somme des postes d'un espace (revenus ou dépenses) pour un mois donné.
// `kind` vaut "income" ou "expense". Sert à la ventilation et aux graphes consolidés.
function ownerKindSum(data, scope, kind) {
  if (!catalog) return 0;
  const values = (data && data.values) || {};
  return catalog.items.reduce((s, it) => {
    if (it.owner !== scope) return s;
    const isIncome = it.type === "income";
    const isCapital = it.type === "capital";
    if (kind === "income" && (!isIncome || it.role === "epargne_out")) return s;
    // "expense" = dépenses réelles uniquement : l'épargne/investissement (capital) a son
    // propre kind, ce n'est pas une charge de vie.
    if (kind === "expense" && (isIncome || isCapital)) return s;
    if (kind === "capital" && !isCapital) return s;
    return s + ((values[it.id] && values[it.id].amount) || 0);
  }, 0);
}

function computeTotals(cat, data, scope = "famille") {
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
      especesRecues += cashOf(v);
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

// ---- State ----
let currentUser = null;
let currentMonthId = monthId(new Date());
let monthData = null;
let catalog = null;
let saveTimeout = null;
let currentScope = lsGet("budget-scope") || DEFAULT_SCOPE;
let currentView = "suivi";
// Prévisions : vue compacte par défaut (juste le libellé du poste). Le mode édition
// révèle renommage / espace / interne / suppression / ajout + la barre d'attribution.
let forecastEdit = false;
let charts = {
  pie: null, pieAvg: null, line: null, investment: null, balance: null, occTop: null,
  famIncome: null, famSplit: null, famStack: null
};

// ---- DOM ----
const $ = (sel) => document.querySelector(sel);
const loginScreen = $("#login-screen");
const deniedScreen = $("#denied-screen");
const appShell = $("#app-shell");
const googleButtonContainer = $("#google-signin-button");
const logoutBtn = $("#logout-btn");
const deniedLogoutBtn = $("#denied-logout-btn");
const userLabel = $("#user-label");
const monthTitle = $("#month-title");
const saveStatus = $("#save-status");
const groupsContainer = $("#groups-container");
const incomeList = $("#income-list");
const totalIncomeEl = $("#total-income");
const incomeNoteEl = $("#income-note");
const totalExpensesEl = $("#total-expenses");
const totalCapitalEl = $("#total-capital");
const balanceEl = $("#balance");
const daysLeftEl = $("#days-left");
const bankBalanceEl = $("#bank-balance");
const cashBalanceEl = $("#cash-balance");
const especesRecuesEl = $("#especes-recues");
const revenusAVenirEl = $("#revenus-a-venir");
const chargesAVenirEl = $("#charges-a-venir");
const capitalAVenirEl = $("#capital-a-venir");
const resteAVivreEl = $("#reste-a-vivre");
const soldeProjeteEl = $("#solde-projete");
const dailyAllocationEl = $("#daily-allocation");
const dailyAllocationReelleEl = $("#daily-allocation-reelle");
const emptyMonthBanner = $("#empty-month-banner");
const createMonthBtn = $("#create-month-btn");
const historyTable = $("#history-table");
const forecastTable = $("#forecast-table");
const analyseMonthLabel = $("#analyse-month-label");
const scopeSwitch = $("#scope-switch");
const scopeHint = $("#scope-hint");
const suiviIndividual = $("#suivi-individual");
const suiviFamille = $("#suivi-famille");
const analyseFamilleCards = document.querySelectorAll(".famille-only");
const forecastEditToggle = $("#forecast-edit-toggle");

// ---- Sélecteur d'espace ----
const SCOPE_TABS = [{ key: "famille", label: "Famille" }, ...SPACES.map((s) => ({ key: s.key, label: s.label }))];

function scopeHintText(scope) {
  if (scope === "famille") return "Vue consolidée du foyer";
  return "Budget personnel de " + (OWNER_LABEL[scope] || scope);
}

function buildScopeSwitch() {
  scopeSwitch.innerHTML = "";
  SCOPE_TABS.forEach((t) => {
    const btn = el("button", "seg" + (t.key === currentScope ? " active" : ""));
    btn.dataset.scope = t.key;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", t.key === currentScope ? "true" : "false");
    const dot = el("span", "seg-dot" + (t.key === "famille" ? " seg-dot-fam" : ""));
    if (t.key !== "famille") dot.style.background = ownerColor(t.key);
    btn.append(dot, document.createTextNode(t.label));
    btn.addEventListener("click", () => setScope(t.key));
    scopeSwitch.appendChild(btn);
  });
  scopeHint.textContent = scopeHintText(currentScope);
}

function setScope(scope) {
  if (scope === currentScope) return;
  currentScope = scope;
  lsSet("budget-scope", scope);
  scopeSwitch.querySelectorAll(".seg").forEach((b) => {
    const on = b.dataset.scope === scope;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  scopeHint.textContent = scopeHintText(scope);
  rerenderCurrentView();
}

function rerenderCurrentView() {
  if (currentView === "suivi") render();
  else if (currentView === "historique") renderHistory();
  else if (currentView === "previsions") renderForecast();
  else if (currentView === "analyse") renderAnalyse();
}

// ---- Auth ----
// On utilise Google Identity Services (le bouton "Sign in with Google" de Google) plutôt que
// signInWithPopup/signInWithRedirect de Firebase : ces derniers dépendent d'une iframe tierce
// sur le domaine firebaseapp.com que les navigateurs modernes bloquent de plus en plus
// (restrictions sur le stockage/les cookies tiers), ce qui empêchait la connexion d'aboutir.
function handleGoogleCredential(response) {
  const credential = GoogleAuthProvider.credential(response.credential);
  signInWithCredential(auth, credential).catch((e) => {
    alert("Connexion impossible : " + e.message);
  });
}

function initGoogleSignIn() {
  if (!window.google?.accounts?.id) {
    setTimeout(initGoogleSignIn, 100);
    return;
  }
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
  google.accounts.id.renderButton(googleButtonContainer, {
    theme: "outline", size: "large", text: "signin_with", locale: "fr", width: 280
  });
}
initGoogleSignIn();

logoutBtn.addEventListener("click", () => signOut(auth));
deniedLogoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  loginScreen.classList.add("hidden");
  deniedScreen.classList.add("hidden");
  appShell.classList.add("hidden");

  if (!user) {
    loginScreen.classList.remove("hidden");
    return;
  }
  userLabel.textContent = user.email;

  // Pas de liste d'emails dans le code : l'autorisation est faite par les règles Firestore.
  // Si le compte n'est pas autorisé, la 1re lecture lève "permission-denied" → écran refusé.
  try {
    catalog = await fetchCatalog();
    if (!catalog) {
      catalog = DEFAULT_CATALOG();
      await persistCatalog(catalog);
    }
    await normalizeCatalogOwners();
  } catch (e) {
    console.warn("Accès refusé par Firestore :", (e && e.code) || e);
    deniedScreen.classList.remove("hidden");
    return;
  }

  appShell.classList.remove("hidden");
  buildScopeSwitch();
  await loadMonth(currentMonthId);
});

// ---- Navigation entre vues ----
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

forecastEditToggle.addEventListener("click", () => {
  forecastEdit = !forecastEdit;
  forecastEditToggle.textContent = forecastEdit ? "✓ Terminé" : "✏️ Modifier les postes";
  forecastEditToggle.classList.toggle("active", forecastEdit);
  renderForecast();
});

async function switchView(view) {
  currentView = view;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(`#view-${view}`).classList.remove("hidden");
  if (view === "suivi") await loadMonth(currentMonthId);
  if (view === "historique") await renderHistory();
  if (view === "previsions") await renderForecast();
  if (view === "analyse") await renderAnalyse();
}

// ---- Firestore : catalogue de postes ----
async function fetchCatalog() {
  const snap = await getDoc(doc(db, "meta", "catalog"));
  return snap.exists() ? snap.data() : null;
}

async function fetchSettings() {
  const snap = await getDoc(doc(db, "meta", "settings"));
  return snap.exists() ? snap.data() : {};
}

async function persistCatalog(cat) {
  await setDoc(doc(db, "meta", "catalog"), cat);
}

// Migration douce : tout poste sans `owner` (ou avec un owner inconnu, ex. ancien "commun")
// est rattaché à l'espace de repli. On ne réécrit le catalogue que si quelque chose a changé.
// L'utilisateur répartit ensuite les postes entre les personnes depuis Prévisions.
async function normalizeCatalogOwners() {
  let changed = false;
  catalog.items.forEach((it) => {
    if (!OWNER_KEYS.includes(it.owner)) {
      it.owner = FALLBACK_OWNER;
      changed = true;
    }
  });
  if (changed) await persistCatalog(catalog);
}

// Postes actuellement listés dans Prévisions (actifs, filtrés par l'espace affiché).
function forecastListedItems() {
  return catalog.items.filter((it) => !it.retiredAt && inScope(it, currentScope));
}

// ---- Firestore : mois ----
async function fetchMonth(id) {
  const snap = await getDoc(doc(db, "months", id));
  return snap.exists() ? snap.data() : null;
}

async function persistMonth(id, data) {
  await setDoc(doc(db, "months", id), data);
}

async function fetchAllMonthsAsc() {
  const snap = await getDocs(query(collection(db, "months"), orderBy("__name__", "asc")));
  const out = [];
  snap.forEach((d) => out.push({ id: d.id, data: d.data() }));
  return out;
}

async function saveMonth() {
  if (!monthData) return;
  saveStatus.textContent = "Enregistrement…";
  try {
    await persistMonth(currentMonthId, {
      ...monthData,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.email
    });
    saveStatus.textContent = "Enregistré";
    setTimeout(() => { if (saveStatus.textContent === "Enregistré") saveStatus.textContent = ""; }, 1500);
  } catch (e) {
    saveStatus.textContent = "Erreur d'enregistrement";
    console.error(e);
  }
}

function scheduleSave() {
  saveStatus.textContent = "Modification…";
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveMonth, 600);
}

function cloneForNewMonth(prev) {
  const values = {};
  Object.entries((prev && prev.values) || {}).forEach(([id, v]) => {
    values[id] = { amount: v.amount || 0, paid: false };
  });
  return { values, bankBalances: {} };
}

async function loadMonth(id) {
  currentMonthId = id;
  monthTitle.textContent = monthLabel(id);
  monthData = await fetchMonth(id);
  emptyMonthBanner.classList.toggle("hidden", !!monthData);
  if (monthData && !monthData.values) monthData.values = {};
  render();
}

createMonthBtn.addEventListener("click", async () => {
  const prevId = addMonths(currentMonthId, -1);
  const prev = await fetchMonth(prevId);
  monthData = prev ? cloneForNewMonth(prev) : { values: {}, bankBalances: {} };
  emptyMonthBanner.classList.add("hidden");
  render();
  await saveMonth();
});

// ---- Rendu : Suivi du mois ----
function render() {
  const fam = currentScope === "famille";
  suiviIndividual.classList.toggle("hidden", fam);
  suiviFamille.classList.toggle("hidden", !fam);

  if (fam) {
    renderFamilleSuivi();
    return;
  }

  if (!monthData) {
    incomeList.innerHTML = "";
    groupsContainer.innerHTML = "";
    $("#income-card").classList.add("hidden");
    bankBalanceEl.value = "";
    cashBalanceEl.value = "";
    renderTotals();
    return;
  }
  renderIncome();
  renderExpenseGroups();
  bankBalanceEl.value = bankFor(monthData, currentScope) || 0;
  cashBalanceEl.value = cashFor(monthData, currentScope) || 0;
  renderTotals();
}

// Un poste à 0 € pour le mois affiché n'est pas montré dans Suivi (juste du bruit visuel) :
// pour lui donner un montant, ça se fait dans Prévisions, qui liste toujours tous les postes actifs.
function hasAmount(item) {
  return !!(monthData && monthData.values[item.id] && monthData.values[item.id].amount);
}

function renderIncome() {
  incomeList.innerHTML = "";
  const items = catalog.items.filter((it) => it.type === "income" && inScope(it, currentScope) && isActiveAt(it, currentMonthId) && hasAmount(it));
  $("#income-card").classList.toggle("hidden", !items.length);
  items.forEach((item) => incomeList.appendChild(buildIncomeRow(item)));
}

// Ligne de revenu : montant attendu + sous-ligne "encaissé X sur Y" avec barre de
// progression. La case coche/décoche = tout reçu / rien reçu ; le champ "encaissé"
// permet le partiel (ex. l'Etude payée en plusieurs fois dans le mois).
function buildIncomeRow(item) {
  const current = () => monthData.values[item.id] || { amount: 0, paid: false };
  const pct = (amt, rec) => (amt > 0 ? Math.max(0, Math.min(100, (rec / amt) * 100)) : 0);
  const v0 = current();
  const rec0 = receivedOf(v0);
  const full0 = v0.amount > 0 && rec0 >= v0.amount;

  const block = el("div", "income-block");
  const row = el("div", "row income-row" + (isReserve(item) ? " poste-reserve" : ""));
  row.innerHTML =
    `<input type="checkbox" class="paid-check" ${full0 ? "checked" : ""} title="Tout reçu" />` +
    `<span class="label-text">${escapeHtml(item.label)}${reserveTagHtml(item)}</span>` +
    `<input type="number" class="amount-input" value="${v0.amount}" step="0.01" />`;

  // L'encaissé est réparti entre virement (arrive sur le compte) et espèces (en main).
  const recu = el("div", "income-recu" + (full0 ? " done" : ""));
  recu.innerHTML =
    `<span class="recu-lbl">virement</span>` +
    `<input type="number" class="recu-input recu-vir" value="${virementOf(v0)}" step="0.01" aria-label="Montant encaissé par virement" />` +
    `<span class="recu-lbl">espèces</span>` +
    `<input type="number" class="recu-input recu-cash" value="${cashOf(v0)}" step="0.01" aria-label="Montant encaissé en espèces" />` +
    `<span class="recu-of">= <b class="recu-total">${euros(rec0)}</b> sur <b class="recu-amt">${euros(v0.amount)}</b></span>` +
    `<span class="recu-bar"><i style="width:${pct(v0.amount, rec0)}%"></i></span>`;
  block.append(row, recu);

  const amountInput = row.querySelector(".amount-input");
  const paidCheck = row.querySelector(".paid-check");
  const virInput = recu.querySelector(".recu-vir");
  const cashInput = recu.querySelector(".recu-cash");
  const recuTotalEl = recu.querySelector(".recu-total");
  const recuOfEl = recu.querySelector(".recu-amt");
  const bar = recu.querySelector(".recu-bar i");

  // Applique la valeur, resynchronise l'affichage (barre, "sur X", case, total), sauvegarde.
  const commit = (next) => {
    monthData.values[item.id] = next;
    const amt = next.amount || 0;
    const rec = receivedOf(next);
    const full = amt > 0 && rec >= amt;
    recuOfEl.textContent = euros(amt);
    recuTotalEl.textContent = euros(rec);
    bar.style.width = pct(amt, rec) + "%";
    recu.classList.toggle("done", full);
    paidCheck.checked = full;
    if (document.activeElement !== virInput) virInput.value = virementOf(next);
    if (document.activeElement !== cashInput) cashInput.value = cashOf(next);
    renderTotals();
    scheduleSave();
  };
  // Nouvelle répartition virement + espèces → total encaissé (`received`) + part cash.
  const commitSplit = (vir, cash) => {
    const c = current();
    const rec = vir + cash;
    commit({ ...c, received: rec, receivedCash: cash, paid: (c.amount || 0) > 0 && rec >= (c.amount || 0) });
  };

  amountInput.addEventListener("input", () => {
    const c = current();
    const amt = parseFloat(amountInput.value) || 0;
    commit({ ...c, amount: amt, paid: amt > 0 && receivedOf(c) >= amt });
  });
  virInput.addEventListener("input", () => {
    commitSplit(parseFloat(virInput.value) || 0, cashOf(current()));
  });
  cashInput.addEventListener("input", () => {
    commitSplit(virementOf(current()), parseFloat(cashInput.value) || 0);
  });
  // Case "tout reçu" : complète par virement en gardant la part déjà reçue en espèces.
  paidCheck.addEventListener("change", () => {
    const c = current();
    const amt = c.amount || 0;
    const cash = paidCheck.checked ? Math.min(cashOf(c), amt) : 0;
    commit({ ...c, received: paidCheck.checked ? amt : 0, receivedCash: cash, paid: paidCheck.checked });
  });

  return block;
}

function renderExpenseGroups() {
  groupsContainer.innerHTML = "";
  GROUPS.forEach((group) => {
    const items = catalog.items.filter((it) => it.type === group.key && inScope(it, currentScope) && isActiveAt(it, currentMonthId) && hasAmount(it));
    if (!items.length) return;
    const section = document.createElement("section");
    section.className = "card";
    section.innerHTML = `
      <div class="card-header"><h2>${group.label}</h2></div>
      <div class="rows"></div>
    `;
    groupsContainer.appendChild(section);
    const rowsEl = section.querySelector(".rows");
    items.forEach((item) => rowsEl.appendChild(buildSuiviRow(item)));
  });
}

// Ligne de dépense (les revenus passent par buildIncomeRow).
function buildSuiviRow(item) {
  const current = () => monthData.values[item.id] || { amount: 0, paid: false };
  const v0 = current();
  const shared = isShared(item);
  const div = document.createElement("div");
  div.className = "row" + (isReserve(item) ? " poste-reserve" : "");
  div.innerHTML = `
    <input type="checkbox" class="paid-check" ${v0.paid ? "checked" : ""} title="Payé" />
    <span class="label-text">${escapeHtml(item.label)}${reserveTagHtml(item)}${sharedTagHtml(item)}</span>
    <input type="number" class="amount-input" value="${v0.amount}" step="0.01" />
  `;
  const amountInput = div.querySelector(".amount-input");
  const paidCheck = div.querySelector(".paid-check");

  // Les handlers préservent les champs additionnels (montantTotal, remboursementRecu pour
  // une dépense partagée) via {...c, ...} au lieu de reconstruire l'objet from scratch.
  amountInput.addEventListener("input", () => {
    const c = current();
    monthData.values[item.id] = { ...c, amount: parseFloat(amountInput.value) || 0 };
    renderTotals();
    scheduleSave();
  });
  paidCheck.addEventListener("change", () => {
    const c = current();
    monthData.values[item.id] = { ...c, paid: paidCheck.checked };
    renderTotals();
    scheduleSave();
  });
  if (!shared) return div;

  // Dépense partagée : sous-ligne pour le montant total réellement débité du compte, et le
  // suivi du remboursement de l'autre part — indépendant de la case "Payé" ci-dessus, qui ne
  // concerne que le prélèvement total lui-même.
  const block = el("div", "expense-block");
  block.appendChild(div);
  const sub = document.createElement("div");
  sub.className = "shared-sub";
  const total0 = v0.montantTotal != null ? v0.montantTotal : v0.amount * 2;
  sub.innerHTML = `
    <span class="shared-lbl">total débité</span>
    <input type="number" class="shared-total-input" value="${total0}" step="0.01" />
    <label class="shared-remb">
      <input type="checkbox" class="shared-remb-check" ${v0.remboursementRecu ? "checked" : ""} />
      remboursement reçu
    </label>
  `;
  const totalInput = sub.querySelector(".shared-total-input");
  const rembCheck = sub.querySelector(".shared-remb-check");
  totalInput.addEventListener("input", () => {
    const c = current();
    monthData.values[item.id] = { ...c, montantTotal: parseFloat(totalInput.value) || 0 };
    renderTotals();
    scheduleSave();
  });
  rembCheck.addEventListener("change", () => {
    const c = current();
    monthData.values[item.id] = { ...c, remboursementRecu: rembCheck.checked };
    renderTotals();
    scheduleSave();
  });
  block.appendChild(sub);
  return block;
}

// Ligne en lecture seule pour la vue consolidée (l'édition des montants se fait dans
// l'espace de chaque personne, ou dans Prévisions — comme l'écran Historique).
function buildFamilleRow(item) {
  const v = (monthData.values && monthData.values[item.id]) || { amount: 0, paid: false };
  const isExpense = item.type !== "income";
  const div = el("div", "row fam-row" + (isReserve(item) ? " poste-reserve" : ""));
  let done, dotTitle, amountHtml;
  if (isExpense) {
    done = !!v.paid;
    dotTitle = done ? "Payé" : "Non payé";
    amountHtml = euros(v.amount);
  } else {
    const rec = receivedOf(v);
    done = v.amount > 0 && rec >= v.amount;
    dotTitle = done ? "Reçu" : rec > 0 ? "Partiellement reçu" : "Pas encore reçu";
    amountHtml = !done && rec > 0
      ? `<span class="fam-recu">${euros(rec)} /</span> ${euros(v.amount)}`
      : euros(v.amount);
    if (cashOf(v) > 0) amountHtml = `<span class="fam-recu">dont ${euros(cashOf(v))} espèces ·</span> ` + amountHtml;
  }
  div.innerHTML =
    `<span class="paid-dot${done ? " on" : ""}" title="${dotTitle}"></span>` +
    `<span class="label-text">${escapeHtml(item.label)}${reserveTagHtml(item)}</span>` +
    `<span class="fam-amount">${amountHtml}</span>`;
  return div;
}

bankBalanceEl.addEventListener("input", () => {
  if (!monthData) return;
  monthData.bankBalances = bankBalancesOf(monthData);
  monthData.bankBalances[currentScope] = parseFloat(bankBalanceEl.value) || 0;
  delete monthData.bankBalance; // conversion de l'ancien format au premier enregistrement
  renderTotals();
  scheduleSave();
});

cashBalanceEl.addEventListener("input", () => {
  if (!monthData) return;
  monthData.cashBalances = { ...cashBalancesOf(monthData), [currentScope]: parseFloat(cashBalanceEl.value) || 0 };
  renderTotals();
  scheduleSave();
});

function renderTotals() {
  const days = remainingDays(currentMonthId);
  daysLeftEl.textContent = days;

  if (!monthData || !catalog) {
    [totalIncomeEl, totalExpensesEl, totalCapitalEl, balanceEl, especesRecuesEl, revenusAVenirEl, chargesAVenirEl, capitalAVenirEl, resteAVivreEl, soldeProjeteEl, dailyAllocationEl, dailyAllocationReelleEl]
      .forEach((elm) => { if (elm) elm.textContent = euros(0); });
    return;
  }
  const t = computeTotals(catalog, monthData, currentScope);
  totalIncomeEl.textContent = euros(t.revenusReels);
  if (incomeNoteEl) {
    incomeNoteEl.textContent = t.epargneIn > 0 ? "+ " + euros(t.epargneIn) + " repris de l'épargne" : "";
    incomeNoteEl.classList.toggle("hidden", !(t.epargneIn > 0));
  }
  totalExpensesEl.textContent = euros(t.depensesReelles);
  if (totalCapitalEl) totalCapitalEl.textContent = euros(t.byGroup.capital);
  balanceEl.textContent = euros(t.balance);
  balanceEl.classList.toggle("negative", t.balance < 0);
  if (especesRecuesEl) especesRecuesEl.textContent = euros(t.especesRecues);
  revenusAVenirEl.textContent = euros(t.revenusAVenir);
  chargesAVenirEl.textContent = euros(t.chargesAVenir);
  if (capitalAVenirEl) capitalAVenirEl.textContent = euros(t.capitalAVenir);
  resteAVivreEl.textContent = euros(t.resteAVivreReel);
  resteAVivreEl.classList.toggle("negative", t.resteAVivreReel < 0);
  soldeProjeteEl.textContent = euros(t.soldeProjete);
  soldeProjeteEl.classList.toggle("negative", t.soldeProjete < 0);

  // Allocation réelle = seulement l'argent déjà sur le compte aujourd'hui (reste à vivre réel).
  if (dailyAllocationReelleEl) {
    const allocationReelle = days > 0 ? t.resteAVivreReel / days : t.resteAVivreReel;
    dailyAllocationReelleEl.textContent = euros(allocationReelle);
    dailyAllocationReelleEl.classList.toggle("negative", allocationReelle < 0);
  }
  // Allocation projetée = solde projeté (revenus à venir inclus) / jours restants.
  const allocation = days > 0 ? t.soldeProjete / days : t.soldeProjete;
  dailyAllocationEl.textContent = euros(allocation);
  dailyAllocationEl.classList.toggle("negative", allocation < 0);
}

// ---- Rendu : Suivi consolidé (espace "Famille") ----
function renderFamilleSuivi() {
  suiviFamille.innerHTML = "";
  if (!catalog) return;
  if (!monthData) {
    suiviFamille.appendChild(el("p", "pb-empty", "Ce mois n'a pas encore de données."));
    return;
  }

  const days = remainingDays(currentMonthId);
  const fam = computeTotals(catalog, monthData, "famille");

  // 1. Cartes résumé, avec ventilation par personne (flux avec l'extérieur du foyer)
  const summary = el("section", "summary summary-fam");
  summary.appendChild(famSummaryCard("Revenus du foyer", fam.revenusReels, "income", fam.epargneIn));
  summary.appendChild(famSummaryCard("Dépenses du foyer", fam.depensesReelles, "expense"));
  summary.appendChild(famSummaryCard("Épargne & Investissement", fam.byGroup.capital, "capital"));
  const soldeCard = famSummaryCard("Solde consolidé", fam.balance, null);
  soldeCard.querySelector(".summary-value").classList.toggle("negative", fam.balance < 0);
  summary.appendChild(soldeCard);
  suiviFamille.appendChild(summary);

  // 2. Suivi temps réel par espace
  suiviFamille.appendChild(famRealtimePanel(days));

  // 3. Un bloc par espace
  OWNER_KEYS.forEach((owner) => suiviFamille.appendChild(famPersonBlock(owner)));
}

function famSummaryCard(label, value, kind, note) {
  const card = el("div", "summary-card");
  card.appendChild(el("span", "summary-label", label));
  card.appendChild(el("span", "summary-value", euros(value)));
  if (note > 0) card.appendChild(el("span", "summary-note", "+ " + euros(note) + " repris de l'épargne"));
  if (kind) {
    const split = el("div", "summary-split");
    OWNER_KEYS.forEach((k) => {
      const v = ownerKindSum(monthData, k, kind);
      if (!v) return;
      const chip = el("span", "k", `${OWNER_LABEL[k]}&nbsp;<b>${euros(v)}</b>`);
      chip.style.setProperty("--oc", ownerColor(k));
      split.appendChild(chip);
    });
    if (split.children.length) card.appendChild(split);
  }
  return card;
}

function famRealtimePanel(days) {
  const card = el("section", "card live-panel");
  card.appendChild(el("div", "card-header", "<h2>Suivi en temps réel par espace</h2>"));

  const totals = {};
  OWNER_KEYS.forEach((k) => { totals[k] = computeTotals(catalog, monthData, k); });
  const famBank = sumBankBalances(monthData);
  const famRevenus = OWNER_KEYS.reduce((s, k) => s + totals[k].revenusAVenir, 0);
  const famUpcoming = OWNER_KEYS.reduce((s, k) => s + totals[k].chargesAVenir, 0);
  const famCapitalAVenir = OWNER_KEYS.reduce((s, k) => s + totals[k].capitalAVenir, 0);
  const famReste = OWNER_KEYS.reduce((s, k) => s + totals[k].resteAVivreReel, 0);
  const famProjete = OWNER_KEYS.reduce((s, k) => s + totals[k].soldeProjete, 0);

  const table = el("table", "fam-rt-table");
  const head = el("thead");
  let headRow = "<tr><th></th>";
  OWNER_KEYS.forEach((k) => {
    headRow += `<th><span class="own-chip" style="--oc:${ownerColor(k)}">${OWNER_LABEL[k]}</span></th>`;
  });
  headRow += '<th class="fam-col">Famille</th></tr>';
  head.innerHTML = headRow;
  table.appendChild(head);

  const body = el("tbody");

  // Lignes "Solde bancaire" et "Solde espèces" : éditables, une valeur par espace
  body.appendChild(famRtInputRow("Solde bancaire", (k) => totals[k].bankBalance, famBank, (k, v) => {
    monthData.bankBalances = bankBalancesOf(monthData);
    monthData.bankBalances[k] = v;
    delete monthData.bankBalance;
  }));
  body.appendChild(famRtInputRow("Solde espèces", (k) => totals[k].cashBalance, cashFor(monthData, "famille"), (k, v) => {
    monthData.cashBalances = { ...cashBalancesOf(monthData), [k]: v };
  }));

  const famEspeces = OWNER_KEYS.reduce((s, k) => s + totals[k].especesRecues, 0);
  body.appendChild(famRtRow("Espèces reçues", OWNER_KEYS.map((k) => totals[k].especesRecues), famEspeces));
  body.appendChild(famRtRow("Revenus à venir", OWNER_KEYS.map((k) => totals[k].revenusAVenir), famRevenus));
  body.appendChild(famRtRow("Charges à venir", OWNER_KEYS.map((k) => totals[k].chargesAVenir), famUpcoming));
  body.appendChild(famRtRow("Épargne/Invest. prévu(e)", OWNER_KEYS.map((k) => totals[k].capitalAVenir), famCapitalAVenir));
  body.appendChild(famRtRow("Reste à vivre réel", OWNER_KEYS.map((k) => totals[k].resteAVivreReel), famReste, true));
  body.appendChild(famRtRow("Solde projeté", OWNER_KEYS.map((k) => totals[k].soldeProjete), famProjete, true));
  body.appendChild(famRtRow("Allocation réelle / jour", OWNER_KEYS.map((k) => totals[k].resteAVivreReel / days), famReste / days, true));
  body.appendChild(famRtRow("Allocation projetée / jour", OWNER_KEYS.map((k) => totals[k].soldeProjete / days), famProjete / days, true));

  table.appendChild(body);
  card.appendChild(table);
  return card;
}

function famRtInputRow(label, valueOf, famValue, apply) {
  const tr = el("tr");
  tr.appendChild(el("td", null, label));
  OWNER_KEYS.forEach((k) => {
    const td = el("td");
    const input = el("input", "fam-rt-input");
    input.type = "number";
    input.step = "0.01";
    input.value = valueOf(k) || 0;
    input.setAttribute("aria-label", label + " " + OWNER_LABEL[k]);
    // "change" (et pas "input") : on ne reconstruit le tableau qu'à la validation du champ,
    // pour ne pas perdre le focus à chaque frappe.
    input.addEventListener("change", () => {
      apply(k, parseFloat(input.value) || 0);
      scheduleSave();
      renderFamilleSuivi();
    });
    td.appendChild(input);
    tr.appendChild(td);
  });
  tr.appendChild(el("td", "fam-col", euros(famValue)));
  return tr;
}

function famRtRow(label, values, famValue, markNegative) {
  const tr = el("tr");
  tr.appendChild(el("td", null, label));
  values.forEach((v) => {
    const td = el("td", markNegative && v < 0 ? "negative" : null, euros(v));
    tr.appendChild(td);
  });
  const famTd = el("td", "fam-col" + (markNegative && famValue < 0 ? " negative" : ""), euros(famValue));
  tr.appendChild(famTd);
  return tr;
}

function famPersonBlock(owner) {
  const t = computeTotals(catalog, monthData, owner);
  const block = el("section", "person-block");
  block.style.setProperty("--pc", ownerColor(owner));
  block.style.setProperty("--pc-bg", ownerBg(owner));

  const head = el("div", "pb-head");
  const who = el("span", "pb-who",
    `<span class="pb-dot"></span>${OWNER_LABEL[owner]} <small>budget perso</small>`);
  const bal = el("span", "pb-bal", `Solde <b class="${t.balance < 0 ? "negative" : ""}">${euros(t.balance)}</b>`);
  head.append(who, bal);
  block.appendChild(head);

  const bodyEl = el("div", "pb-body");
  let anyRow = false;
  SECTIONS.forEach((sec) => {
    const items = catalog.items.filter((it) =>
      it.owner === owner && it.type === sec.key && isActiveAt(it, currentMonthId) && hasAmount(it));
    if (!items.length) return;
    anyRow = true;
    bodyEl.appendChild(el("span", "pb-cat", sec.label));
    const rows = el("div", "rows");
    items.forEach((item) => rows.appendChild(buildFamilleRow(item)));
    bodyEl.appendChild(rows);
  });
  if (!anyRow) {
    bodyEl.appendChild(el("p", "pb-empty", "Aucun montant ce mois."));
  } else {
    const sub = el("div", "pb-sub",
      `<span>Revenus <b>${euros(t.revenusReels)}</b></span>` +
      `<span>Dépenses <b>${euros(t.depensesReelles)}</b></span>` +
      (t.byGroup.capital > 0 ? `<span>Épargne <b>${euros(t.byGroup.capital)}</b></span>` : "") +
      `<span>Solde <b class="${t.balance < 0 ? "negative" : ""}">${euros(t.balance)}</b></span>`);
    bodyEl.appendChild(sub);
  }
  block.appendChild(bodyEl);
  return block;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ---- Grille partagée (postes en lignes, mois en colonnes) ----
// items : liste de postes catalogue déjà filtrée par l'appelant (actifs pour Prévisions,
// tous pour Historique, et restreinte à l'espace courant). opts.editable : montants
// modifiables. opts.structural : permet aussi de renommer/ré-affecter/ajouter/supprimer
// des postes (réservé aux Prévisions).
function buildMonthGrid(table, ids, monthsByI, items, opts) {
  let html = "<thead><tr><th>Poste</th>";
  ids.forEach((id) => { html += `<th>${monthLabelShort(id)}</th>`; });
  html += "</tr></thead><tbody>";

  // Vue "Famille" : les postes de Habib et Marwa sont mélangés dans chaque section — on les
  // regroupe par espace (+ couleur/pastille sur la ligne, voir gridRow) pour qu'on sache tout
  // de suite qui contribue à quelle ligne, sans avoir à lire chaque libellé.
  const byOwnerThenSection = (a, b) => {
    if (currentScope !== "famille") return 0;
    return OWNER_KEYS.indexOf(a.owner) - OWNER_KEYS.indexOf(b.owner);
  };
  SECTIONS.forEach((sec) => {
    html += `<tr class="section-row"><td colspan="${ids.length + 1}"><span class="cell-label section-label">${sec.label}</span></td></tr>`;
    items.filter((it) => it.type === sec.key).sort(byOwnerThenSection).forEach((item) => {
      html += gridRow(item, ids, monthsByI, opts);
    });
    if (opts.structural) {
      html += `<tr class="add-row"><td colspan="${ids.length + 1}"><button type="button" class="add-item-btn" data-type="${sec.key}">+ Ajouter un poste</button></td></tr>`;
    }
    const getValue = sec.key === "income" ? (t) => t.revenusReels : (t) => t.byGroup[sec.key];
    html += gridTotalRow(sec.key === "income" ? "Sous-total revenus" : `Sous-total ${sec.label.toLowerCase()}`, ids, monthsByI, getValue, false, "st-" + sec.key);
  });

  html += gridTotalRow("Total dépenses", ids, monthsByI, (t) => t.depensesReelles, true, "total-expenses");
  html += gridTotalRow("Reste à vivre", ids, monthsByI, (t) => t.balance, true, "balance");
  html += "</tbody>";
  table.innerHTML = html;
}

function gridRow(item, ids, monthsByI, opts) {
  // En vue "Famille", une bande de couleur (+ pastille) sur la ligne indique tout de suite à
  // qui appartient le poste, sans devoir déduire ça du libellé au milieu de tous les autres.
  const ownerStyle = currentScope === "famille" && item.owner
    ? ` style="border-left-color:${ownerColor(item.owner)}"` : "";
  const ownerDot = currentScope === "famille" && item.owner
    ? `<span class="poste-owner-dot" style="--oc:${ownerColor(item.owner)}" title="${escapeAttr(OWNER_LABEL[item.owner] || item.owner)}"></span>`
    : "";
  let row = `<tr><td class="poste-cell"${ownerStyle}>${ownerDot}`;
  if (opts.structural) {
    const canShare = item.type === "regulieres" || item.type === "occasionnelles";
    const sharedBtn = canShare
      ? `<button type="button" class="toggle-shared-btn${isShared(item) ? " active" : ""}" data-item-id="${item.id}"
          title="${isShared(item) ? "Dépense partagée — cliquer pour retirer" : "Marquer comme dépense partagée (remboursée en partie par l'autre)"}">🤝</button>`
      : "";
    row += `<input type="text" class="rename-input${sharedBtn ? " has-shared-btn" : ""}" value="${escapeAttr(item.label)}" data-item-id="${item.id}" />
      ${sharedBtn}
      <button type="button" class="remove-item-btn" data-item-id="${item.id}" title="Supprimer ce poste">✕</button>`;
  } else {
    row += `<span class="cell-label poste-label${isReserve(item) ? " poste-reserve" : ""}" title="${escapeAttr(item.label)}">${escapeHtml(item.label)}${reserveTagHtml(item)}${sharedTagHtml(item)}</span>`;
  }
  row += `</td>`;
  ids.forEach((id) => {
    const data = monthsByI[id];
    const v = data && data.values && data.values[item.id];
    const amount = v ? v.amount : 0;
    if (opts.editable) {
      row += `<td><input class="forecast-input" type="number" step="0.01" value="${amount}"
        data-month-id-attr="${id}" data-item-id="${item.id}" /></td>`;
    } else {
      row += `<td>${euros(amount)}</td>`;
    }
  });
  return row + "</tr>";
}

function gridTotalRow(label, ids, monthsByI, getValue, strong, key) {
  let row = `<tr class="${strong ? "total-row" : "subtotal-row"}" data-total="${key}"><td><span class="cell-label">${label}</span></td>`;
  ids.forEach((id) => {
    const t = computeTotals(catalog, monthsByI[id], currentScope);
    row += `<td data-total-month="${id}">${euros(getValue(t))}</td>`;
  });
  return row + "</tr>";
}

// Met à jour les cellules de sous-totaux/totaux d'UNE colonne (un mois) sans reconstruire
// toute la grille — pour ne pas "recharger" la page à chaque montant saisi.
function refreshForecastTotals(mid, monthsByI) {
  const t = computeTotals(catalog, monthsByI[mid], currentScope);
  const vals = {
    "st-income": t.revenusReels,
    "st-regulieres": t.byGroup.regulieres,
    "st-occasionnelles": t.byGroup.occasionnelles,
    "st-capital": t.byGroup.capital,
    "total-expenses": t.depensesReelles,
    "balance": t.balance
  };
  Object.entries(vals).forEach(([key, v]) => {
    const cell = forecastTable.querySelector(`tr[data-total="${key}"] td[data-total-month="${mid}"]`);
    if (cell) cell.textContent = euros(v);
  });
}

// ---- Historique (grille en lecture seule, tous les postes, mois passés) ----
async function renderHistory() {
  historyTable.innerHTML = `<tr><td>Chargement…</td></tr>`;
  historyTable.classList.add("compact");
  const currentId = monthId(new Date());
  const past = (await fetchAllMonthsAsc()).filter(({ id }) => id < currentId);
  if (!past.length) {
    historyTable.innerHTML = `<tr><td>Aucun mois passé enregistré pour l'instant.</td></tr>`;
    return;
  }
  const ids = past.map((m) => m.id);
  const monthsByI = {};
  past.forEach(({ id, data }) => { monthsByI[id] = data; });
  const items = catalog.items.filter((it) => inScope(it, currentScope));
  buildMonthGrid(historyTable, ids, monthsByI, items, { editable: false, structural: false });
}

// ---- Prévisions annuelles (grille éditable sur 12 mois, postes actifs uniquement) ----
function forecastMonthIds() {
  const base = monthId(new Date());
  return Array.from({ length: 12 }, (_, i) => addMonths(base, i));
}

async function renderForecast() {
  forecastTable.innerHTML = `<tr><td>Chargement…</td></tr>`;
  const ids = forecastMonthIds();
  const docs = await Promise.all(ids.map(fetchMonth));
  const monthsByI = {};
  ids.forEach((id, i) => { monthsByI[id] = docs[i] || { values: {} }; });

  const activeItems = forecastListedItems();
  forecastTable.classList.toggle("compact", !forecastEdit);
  buildMonthGrid(forecastTable, ids, monthsByI, activeItems, { editable: true, structural: forecastEdit });

  forecastTable.querySelectorAll(".forecast-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const { monthIdAttr, itemId } = input.dataset;
      const value = parseFloat(input.value) || 0;
      await setForecastValue(monthIdAttr, itemId, value, monthsByI);
    });
  });
  forecastTable.querySelectorAll(".rename-input").forEach((input) => {
    input.addEventListener("change", () => renameItem(input.dataset.itemId, input.value));
  });
  forecastTable.querySelectorAll(".remove-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeItem(btn.dataset.itemId, ids, monthsByI));
  });
  forecastTable.querySelectorAll(".toggle-shared-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleShared(btn.dataset.itemId));
  });
  forecastTable.querySelectorAll(".add-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => addItem(btn.dataset.type));
  });
}

async function setForecastValue(targetMonthId, itemId, value, monthsByI) {
  let data = monthsByI[targetMonthId];
  const wasNew = !data || !data.values || !Object.keys(data).length;
  if (wasNew) {
    const ids = forecastMonthIds();
    const idx = ids.indexOf(targetMonthId);
    let sourceData = null;
    for (let i = idx - 1; i >= 0 && !sourceData; i--) sourceData = monthsByI[ids[i]] && monthsByI[ids[i]].values ? monthsByI[ids[i]] : null;
    if (!sourceData) sourceData = (await fetchMonth(currentMonthId)) || { values: {} };
    data = cloneForNewMonth(sourceData);
    monthsByI[targetMonthId] = data;
  }
  const prev = data.values[itemId] || { amount: 0, paid: false };
  // {...prev} : garde l'encaissé (virement/espèces) et les champs de dépense partagée.
  data.values[itemId] = { ...prev, amount: value };
  await persistMonth(targetMonthId, { ...data, updatedAt: new Date().toISOString(), updatedBy: currentUser.email });
  // Mois vierge qu'on vient de matérialiser (valeurs héritées du mois précédent) : on
  // ré-affiche une fois pour montrer ces valeurs. Sinon, on met juste à jour les totaux
  // de la colonne éditée — pas de reconstruction, le focus reste dans la grille.
  if (wasNew) await renderForecast();
  else refreshForecastTotals(targetMonthId, monthsByI);
}

async function addItem(type) {
  const label = prompt("Nom du nouveau poste :");
  if (!label || !label.trim()) return;
  let owner = currentScope === "famille" ? FALLBACK_OWNER : currentScope;
  if (currentScope === "famille") {
    const ans = (prompt("À quel espace ? " + OWNER_KEYS.join(" / "), FALLBACK_OWNER) || "").trim().toLowerCase();
    if (OWNER_KEYS.includes(ans)) owner = ans;
  }
  catalog.items.push({ id: uid(), label: label.trim(), type, owner, retiredAt: null });
  await persistCatalog(catalog);
  await renderForecast();
}

async function renameItem(itemId, newLabel) {
  const item = catalog.items.find((it) => it.id === itemId);
  const trimmed = newLabel.trim();
  if (!item || !trimmed || trimmed === item.label) return;
  item.label = trimmed;
  await persistCatalog(catalog);
  await renderForecast();
}

async function toggleShared(itemId) {
  const item = catalog.items.find((it) => it.id === itemId);
  if (!item) return;
  if (isShared(item)) delete item.role;
  else item.role = "partagee";
  await persistCatalog(catalog);
  await renderForecast();
}

async function removeItem(itemId, ids, monthsByI) {
  const item = catalog.items.find((it) => it.id === itemId);
  if (!item) return;

  const affectedFuture = ids.filter((id) => {
    const v = monthsByI[id] && monthsByI[id].values && monthsByI[id].values[itemId];
    return v && v.amount;
  });

  // S'il n'a jamais eu de montant sur un mois passé, autant le supprimer complètement
  // plutôt que de laisser une ligne à 0 € traîner dans l'Historique.
  const currentId = monthId(new Date());
  const pastMonths = (await fetchAllMonthsAsc()).filter((m) => m.id < currentId);
  const hasHistory = pastMonths.some((m) => m.data.values && m.data.values[itemId] && m.data.values[itemId].amount);

  if (affectedFuture.length) {
    const detail = affectedFuture.map((id) => `${monthLabel(id)} (${euros(monthsByI[id].values[itemId].amount)})`).join(", ");
    const tail = hasHistory ? "(l'historique passé n'est pas affecté)" : "Il n'a jamais eu de montant dans le passé, il sera donc supprimé entièrement, y compris de l'Historique";
    const ok = confirm(`"${item.label}" a un montant prévu sur : ${detail}.\n\nLe supprimer remettra ces montants à 0. ${tail}. Continuer ?`);
    if (!ok) return;
  } else if (hasHistory) {
    const ok = confirm(`Supprimer "${item.label}" ? Il restera visible dans l'Historique pour les mois passés.`);
    if (!ok) return;
  } else {
    const ok = confirm(`Supprimer "${item.label}" ? Il n'a jamais eu de montant, il sera donc supprimé entièrement (y compris de l'Historique).`);
    if (!ok) return;
  }

  for (const id of affectedFuture) {
    const data = monthsByI[id];
    data.values[itemId] = { ...data.values[itemId], amount: 0 };
    await persistMonth(id, { ...data, updatedAt: new Date().toISOString(), updatedBy: currentUser.email });
  }

  if (hasHistory) {
    item.retiredAt = currentId;
  } else {
    catalog.items = catalog.items.filter((it) => it.id !== itemId);
  }
  await persistCatalog(catalog);
  await renderForecast();
}

// ---- Analyse budget (graphiques) ----
const PIE_LABELS = ["Charges régulières", "Charges occasionnelles", "Capital et réserves", "Reste à vivre"];
const PIE_COLORS = ["#dc2626", "#f59e0b", "#059669", "#2563eb"];

// Légende + info-bulles avec le pourcentage de chaque part, en plus du montant.
function pieOptions(dataset) {
  const total = dataset.reduce((s, v) => s + v, 0) || 1;
  return {
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          generateLabels(chart) {
            const ds = chart.data.datasets[0];
            return chart.data.labels.map((label, i) => ({
              text: `${label} (${Math.round((ds.data[i] / total) * 100)}%)`,
              fillStyle: ds.backgroundColor[i],
              strokeStyle: ds.backgroundColor[i],
              index: i
            }));
          }
        }
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.label}: ${euros(ctx.parsed)} (${Math.round((ctx.parsed / total) * 100)}%)`
        }
      }
    }
  };
}

// Anneau avec deux lignes au centre (ex. "Revenus" / "5 300 €") : on reconnaît le graphe à sa
// forme et à son centre sans avoir à lire le titre de la carte.
function ringOptions(dataset, title, value, color) {
  const opts = pieOptions(dataset);
  opts.cutout = "62%";
  opts.plugins.centerText = { title, value, color };
  return opts;
}

const centerTextPlugin = {
  id: "centerText",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.title) return;
    const arc = chart.getDatasetMeta(0).data[0];
    if (!arc) return;
    const { ctx } = chart;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = opts.color;
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillText(opts.title, arc.x, arc.y - (opts.value ? 10 : 0));
    if (opts.value) {
      ctx.fillStyle = "#1c2331";
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.fillText(opts.value, arc.x, arc.y + 10);
    }
    ctx.restore();
  }
};

// Série cumulée d'un poste de "réserve" (épargne ou investissement). Pour l'espace "Famille",
// on calcule la série de CHAQUE personne séparément (base de départ + 1er mois suivi propres à
// chacune), puis on additionne mois par mois — impossible de sommer les réglages dans une
// boucle unique : Habib et Marwa n'ont pas le même mois de départ, une base combinée avec un
// seul point de départ ferait perdre l'historique de celui qui est suivi depuis plus longtemps
// (c'est ce qui rendait le total Famille différent de Habib + Marwa).
function reserveCumulSeries(scope, months, settings, { baseKey, startKey, role, outRole, defaultStart }) {
  const owners = scope === "famille" ? OWNER_KEYS : [scope];
  const seriesByOwner = owners.map((owner) => {
    const sc = (settings.byScope && settings.byScope[owner]) || {};
    const base = sc[baseKey] != null ? sc[baseKey] : (settings[baseKey] || 0);
    const start = sc[startKey] || settings[startKey] || defaultStart || null;
    const items = catalog.items.filter((it) => it.role === role && inScope(it, owner));
    const outItems = outRole ? catalog.items.filter((it) => it.role === outRole && inScope(it, owner)) : [];
    let cumul = base;
    const byId = {};
    (start ? months.filter(({ id }) => id >= start) : months).forEach(({ id, data: d }) => {
      const values_ = d.values || {};
      const amount = items.reduce((s, it) => s + ((values_[it.id] && values_[it.id].amount) || 0), 0);
      const out = outItems.reduce((s, it) => s + ((values_[it.id] && values_[it.id].amount) || 0), 0);
      cumul += amount - out;
      byId[id] = cumul;
    });
    return byId;
  });
  const ids = [];
  const labels = [];
  const values = [];
  months.forEach(({ id }) => {
    if (seriesByOwner.every((s) => s[id] != null)) {
      ids.push(id);
      labels.push(monthLabelShort(id));
      values.push(seriesByOwner.reduce((sum, s) => sum + s[id], 0));
    }
  });
  return { ids, labels, values };
}

// ---- Autonomie de l'épargne ----
// Combien de mois l'épargne actuelle couvrirait si elle devait payer seule les mois suivants :
// pour chaque mois à partir du mois prochain, besoin = dépenses réelles prévues (Prévisions,
// hors épargne/investissement) de l'espace + argent de poche (par personne). Au-delà des mois
// déjà prévus, on prend la moyenne des mois prévus.
const POCKET_MONEY = 500;
const COUVERTURE_MAX_MOIS = 120;

// Besoin d'un mois donné vu depuis `fromId` : dépenses réelles prévues de l'espace + argent de
// poche ; pour un mois sans prévision, moyenne des mois prévus après `fromId`. Partagé par
// l'autonomie et l'objectif d'épargne pour qu'ils suivent exactement les mêmes règles.
function besoinMensuel(scope, monthsById, fromId) {
  const pocket = POCKET_MONEY * (scope === "famille" ? OWNER_KEYS.length : 1);
  const costOf = (id) => monthsById[id] ? computeTotals(catalog, monthsById[id], scope).depensesReelles + pocket : null;
  const known = Object.keys(monthsById).filter((id) => id > fromId).map(costOf);
  const fallback = known.length
    ? known.reduce((s, c) => s + c, 0) / known.length
    : (costOf(fromId) || pocket);
  return { pocket, fallback, cost: (id) => costOf(id) ?? fallback };
}

function epargneCouverture(scope, savings, monthsById, curId) {
  const { pocket, fallback, cost: costFor } = besoinMensuel(scope, monthsById, curId);
  let remaining = Math.max(0, savings);
  const cells = [];
  let usedCost = 0;
  for (let i = 1; i <= COUVERTURE_MAX_MOIS && remaining > 0; i++) {
    const id = addMonths(curId, i);
    const cost = costFor(id);
    const fill = Math.min(1, remaining / cost);
    cells.push({ id, fill, cost, prevu: !!monthsById[id] });
    usedCost += cost;
    remaining -= cost;
  }
  const months = cells.reduce((s, c) => s + c.fill, 0);
  const avgCost = cells.length ? usedCost / cells.length : fallback;
  return { months, cells, savings, pocket, avgCost, capped: remaining > 0 };
}

// ---- Objectif d'épargne ----
// "Atteindre <palier> d'ici <mois>" : épargne nécessaire à l'échéance = besoin des N mois qui
// la suivent (N = 3 ou 6). On la compare à l'épargne prévue à cette date (courbe d'épargne) ;
// l'écart, s'il y en a un, est réparti sur les mois d'ici l'échéance (mois prochain inclus).
function monthsBetween(fromId, toId) {
  const [y1, m1] = fromId.split("-").map(Number);
  const [y2, m2] = toId.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

function objectifEpargne(scope, series, monthsById, curId, cibleMois, targetId) {
  const { cost } = besoinMensuel(scope, monthsById, targetId);
  let required = 0;
  for (let i = 1; i <= cibleMois; i++) required += cost(addMonths(targetId, i));
  let projected = 0;
  series.ids.forEach((id, i) => { if (id <= targetId) projected = series.values[i]; });
  const nbMois = Math.max(1, monthsBetween(curId, targetId));
  const gap = required - projected;
  return { required, projected, gap, nbMois, perMonth: gap / nbMois };
}

function objectifKey(scope) { return "budget-objectif-" + scope; }

// Bloc "Objectif" dans la carte autonomie : palier visé + échéance (mémorisés par espace dans
// ce navigateur), et l'effort mensuel nécessaire. Ne relit rien dans Firestore au changement.
function renderObjectif(box, scope, series, monthsById, curId, niveauActuel) {
  const moisOptions = series.ids.filter((id) => id > curId).slice(0, 12);
  if (!moisOptions.length) {
    box.innerHTML = `<span class="cv-path-lbl">Objectif</span> <span class="cv-goal-empty">Ajoute des mois dans Prévisions pour fixer un objectif.</span>`;
    return;
  }
  const cibles = COUVERTURE_NIVEAUX.filter((n) => n.min > 0);
  let saved = {};
  try { saved = JSON.parse(lsGet(objectifKey(scope)) || "{}") || {}; } catch (e) { saved = {}; }
  const defaultCible = cibles.find((n) => n.min > niveauActuel.min) || cibles[cibles.length - 1];
  let cible = cibles.find((n) => n.min === saved.min) || defaultCible;
  let target = moisOptions.includes(saved.mois) ? saved.mois : moisOptions[moisOptions.length - 1];

  box.innerHTML = `
    <div class="cv-goal-head">
      <span class="cv-path-lbl">Objectif</span>
      <label>atteindre <select class="cv-goal-niveau" aria-label="Palier visé">${cibles.map((n) =>
        `<option value="${n.min}">${n.label} (${n.min} mois)</option>`).join("")}</select></label>
      <label>d'ici <select class="cv-goal-mois" aria-label="Échéance">${moisOptions.map((id) =>
        `<option value="${id}">${monthLabel(id)}</option>`).join("")}</select></label>
    </div>
    <div class="cv-goal-res"></div>`;
  const selNiveau = box.querySelector(".cv-goal-niveau");
  const selMois = box.querySelector(".cv-goal-mois");
  const res = box.querySelector(".cv-goal-res");
  selNiveau.value = String(cible.min);
  selMois.value = target;

  const update = () => {
    cible = cibles.find((n) => n.min === Number(selNiveau.value)) || defaultCible;
    target = selMois.value;
    lsSet(objectifKey(scope), JSON.stringify({ min: cible.min, mois: target }));
    const o = objectifEpargne(scope, series, monthsById, curId, cible.min, target);
    const quand = monthLabel(target);
    box.className = "cv-goal " + (o.gap <= 0 ? "ok" : "effort");
    res.innerHTML = o.gap <= 0
      ? `<span class="cv-goal-big">✓ Atteint</span>
         <span class="cv-goal-txt">avec l'épargne déjà prévue : <b>${euros(o.projected)}</b> en ${quand}
         pour <b>${euros(o.required)}</b> nécessaires (marge ${euros(-o.gap)}).</span>`
      : `<span class="cv-goal-big">+${euros(o.perMonth)}<small>/mois</small></span>
         <span class="cv-goal-txt">à épargner <b>en plus</b> de ce qui est prévu, pendant ${o.nbMois} mois.
         Il manque <b>${euros(o.gap)}</b> : ${euros(o.required)} nécessaires en ${quand}, ${euros(o.projected)} prévus.</span>`;
  };
  selNiveau.addEventListener("change", update);
  selMois.addEventListener("change", update);
  update();
}

// Mois abrégé sans point, lisible dans une case étroite : "nov", "déc", "janv", "févr"...
function monthAbbr(id) {
  const [y, m] = id.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
}

// Niveaux d'autonomie (repères usuels d'une épargne de précaution), du plus bas au plus haut.
const COUVERTURE_NIVEAUX = [
  { min: 0, label: "Fragile", range: "moins de 3 mois", cls: "niveau-bas", color: "#dc2626" },
  { min: 3, label: "Correct", range: "3 à 6 mois", cls: "niveau-moyen", color: "#d97706" },
  { min: 6, label: "Confortable", range: "6 mois et plus", cls: "niveau-haut", color: "#059669" }
];
function niveauOf(months) { return COUVERTURE_NIVEAUX.filter((n) => months >= n.min).pop(); }

// Changements de palier prévus : pour chaque mois futur de la courbe d'épargne, on recalcule
// l'autonomie avec l'épargne prévue ce mois-là (et les dépenses prévues des mois qui suivent),
// et on garde les mois où le niveau change (montée ou descente).
function paliersPrevus(scope, series, monthsById, curId, niveauActuel) {
  const out = [];
  let prev = niveauActuel;
  series.ids.forEach((id, i) => {
    if (id <= curId) return;
    const months = epargneCouverture(scope, series.values[i], monthsById, id).months;
    const n = niveauOf(months);
    if (n !== prev) out.push({ id, index: i, niveau: n, months, up: n.min > prev.min });
    prev = n;
  });
  return out;
}

function renderCouverture(container, scope, c, curId, paliers = [], lastPrevuId = null) {
  const niveau = niveauOf(c.months);
  const badge = niveau.label;
  container.className = "card couverture-card " + niveau.cls;
  const legendHtml = COUVERTURE_NIVEAUX.map((n) =>
    `<li class="${n.cls}${n === niveau ? " current" : ""}"><i></i><b>${n.label}</b> ${n.range}</li>`).join("");
  const big = c.capped ? "10 ans +" : c.months.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  // Date de fin = jour atteint dans le dernier mois (en partie) couvert, au prorata de la part
  // couverte — cohérent avec la frise (ex. 1,9 mois → ~27 décembre, pas "fin novembre").
  const last = c.cells[c.cells.length - 1];
  let until;
  if (c.savings <= 0 || !last) until = "Aucune épargne disponible ce mois-ci.";
  else if (c.capped) until = "Plus de 10 ans de dépenses couvertes.";
  else {
    const dim = daysInMonth(last.id);
    const day = Math.max(1, Math.floor(last.fill * dim));
    const [y, m] = last.id.split("-").map(Number);
    until = day >= dim
      ? `Couvert jusqu'à fin <b>${monthLabel(last.id)}</b>`
      : `Couvert jusqu'au <b>${new Date(y, m - 1, day).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</b>`;
  }

  // Frise des 12 prochains mois : chaque case se remplit selon la part du mois couverte.
  let cellsHtml = "";
  for (let i = 1; i <= 12; i++) {
    const id = addMonths(curId, i);
    const cell = c.cells[i - 1];
    const pct = cell ? Math.round(cell.fill * 100) : 0;
    const title = `${monthLabel(id)} — ${cell ? `${pct} % couvert (besoin ${euros(cell.cost)}${cell.prevu ? "" : ", estimé"})` : "non couvert"}`;
    // Mois couvert en partie : remplissage plus clair, pour ne pas le confondre avec un mois plein.
    const partial = cell && cell.fill < 1 ? " partial" : "";
    // Année affichée au-dessus du 1er mois de la frise et de chaque janvier.
    const year = i === 1 || id.endsWith("-01") ? id.slice(0, 4) : "";
    cellsHtml += `<div class="cv-month${partial}${year && i > 1 ? " new-year" : ""}" title="${escapeAttr(title)}">` +
      `<em>${year}</em><div class="cv-cell"><i style="width:${pct}%"></i></div><span>${monthAbbr(id)}</span></div>`;
  }
  const beyond = c.months > 12 ? `<p class="cv-more">+ ${c.capped ? "plus de " : ""}${Math.floor(c.months - 12)} mois au-delà</p>` : "";
  const people = scope === "famille" ? `<small>${OWNER_KEYS.length} × ${POCKET_MONEY} €</small>` : "";

  // Parcours prévu : niveau actuel → chaque changement de palier, avec le mois où il arrive.
  const step = (n, when) => `<span class="cv-step ${n.cls}"><i></i><b>${n.label}</b> <small>${when}</small></span>`;
  let pathHtml = "";
  if (paliers.length) {
    pathHtml = `<div class="cv-path"><span class="cv-path-lbl">Prévision</span>` +
      step(niveau, "aujourd'hui") +
      paliers.map((p) => `<span class="cv-arrow">${p.up ? "↗" : "↘"}</span>` +
        step(p.niveau, `dès ${monthLabel(p.id)} · ${p.months.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} mois`)).join("") +
      `</div>`;
  } else if (lastPrevuId) {
    pathHtml = `<div class="cv-path"><span class="cv-path-lbl">Prévision</span>` +
      `<span class="cv-path-flat">Reste <b class="${niveau.cls}">${niveau.label}</b> jusqu'à ${monthLabel(lastPrevuId)} (dernier mois prévu)</span></div>`;
  }

  // Carte en bandeau sous la courbe : chiffre clé à gauche, frise + détail à droite.
  container.innerHTML = `
    <div class="cv-main">
      <h3>Autonomie de l'épargne</h3>
      <div class="cv-hero"><span class="cv-big">${big}</span>${c.capped ? "" : '<span class="cv-unit">mois</span>'}<span class="cv-badge">${badge}</span></div>
      <p class="cv-until">${until}</p>
      <ul class="cv-legend" aria-label="Niveaux d'autonomie">${legendHtml}</ul>
    </div>
    <div class="cv-side">
      <div class="cv-months" aria-label="Mois couverts sur les 12 prochains mois">${cellsHtml}</div>
      ${beyond}
      ${pathHtml}
      <div class="cv-goal"></div>
      <dl class="cv-facts">
        <div><dt>Épargne actuelle</dt><dd>${euros(c.savings)}</dd></div>
        <div><dt>Besoin moyen / mois</dt><dd>${euros(c.avgCost)}</dd></div>
        <div><dt>dont poche / mois</dt><dd>${euros(c.pocket)}${people}</dd></div>
      </dl>
      <p class="cv-note">Chaque mois à partir du mois prochain : dépenses prévues (Prévisions, hors épargne et investissement) + argent de poche. Au-delà des mois prévus : moyenne des mois prévus.</p>
    </div>`;
}

// Courbe cumulée (épargne / investissement) avec le point du mois en cours mis en valeur :
// point agrandi + étiquette permanente "<mois> : <valeur>" au-dessus, pour repérer d'un coup
// d'œil où on en est au milieu des mois passés et des mois prévus.
// `marks` (optionnel) : repères verticaux [{ index, label, color }] (changements de palier).
function cumulLineChart(canvas, { ids, labels, values }, label, color, marks = []) {
  const idx = ids.indexOf(monthId(new Date()));
  const at = (special, normal) => values.map((_, i) => (i === idx ? special : normal));
  return new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label, data: values, borderColor: color, tension: 0.3,
        pointRadius: at(7, 3),
        pointHoverRadius: at(9, 5),
        pointBackgroundColor: at(color, "#fff"),
        pointBorderColor: color,
        pointBorderWidth: at(3, 1.5)
      }]
    },
    options: {
      layout: { padding: { top: 34, right: 12 } },
      plugins: { legend: { display: false }, currentPoint: { index: idx, color }, levelMarks: { marks } }
    },
    plugins: [levelMarksPlugin, currentPointPlugin]
  });
}

// Plugin Chart.js local : ligne verticale pointillée + étiquette en haut du graphe pour chaque
// repère (ex. passage de l'épargne au palier "Correct"). Dessiné avant l'étiquette du mois en cours.
const levelMarksPlugin = {
  id: "levelMarks",
  afterDatasetsDraw(chart, _args, opts) {
    const marks = (opts && opts.marks) || [];
    if (!marks.length) return;
    const { ctx, chartArea } = chart;
    const meta = chart.getDatasetMeta(0);
    ctx.save();
    ctx.font = "600 11px system-ui, sans-serif";
    marks.forEach((m) => {
      const point = meta.data[m.index];
      if (!point) return;
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(point.x, chartArea.top + 18);
      ctx.lineTo(point.x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      const text = m.label;
      const w = ctx.measureText(text).width + 12;
      const x = Math.min(Math.max(point.x - w / 2, chartArea.left), chartArea.right - w);
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = m.color;
      ctx.beginPath();
      ctx.roundRect(x, chartArea.top, w, 18, 9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = m.color;
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + 6, chartArea.top + 9);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    ctx.restore();
  }
};

// Plugin Chart.js local : dessine l'étiquette du point d'index `options.index` (si présent).
const currentPointPlugin = {
  id: "currentPoint",
  afterDatasetsDraw(chart, _args, opts) {
    if (opts.index == null || opts.index < 0) return;
    const point = chart.getDatasetMeta(0).data[opts.index];
    const value = chart.data.datasets[0].data[opts.index];
    if (!point || value == null) return;
    const { ctx, chartArea } = chart;
    const text = `${chart.data.labels[opts.index]} : ${euros(value)}`;
    ctx.save();
    ctx.font = "600 12px system-ui, sans-serif";
    const w = ctx.measureText(text).width + 14;
    const h = 22;
    // Bulle centrée au-dessus du point, gardée dans la zone du graphe.
    const x = Math.min(Math.max(point.x - w / 2, chartArea.left), chartArea.right - w);
    const y = point.y - h - 12;
    ctx.fillStyle = opts.color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(point.x - 5, y + h);
    ctx.lineTo(point.x + 5, y + h);
    ctx.lineTo(point.x, y + h + 5);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 7, y + h / 2);
    ctx.restore();
  }
};

async function renderAnalyse() {
  // Juste le mois (titre "Ce mois-ci · octobre 2026") : l'espace est déjà indiqué par la barre d'espace.
  analyseMonthLabel.textContent = monthLabel(currentMonthId);
  analyseFamilleCards.forEach((card) => card.classList.toggle("hidden", currentScope !== "famille"));
  // Toujours relire Firestore (plutôt que de réutiliser monthData) : un montant modifié
  // depuis Prévisions ne met pas à jour l'état en mémoire de l'écran Suivi.
  const data = (await fetchMonth(currentMonthId)) || { values: {} };
  const t = computeTotals(catalog, data, currentScope);
  const settings = await fetchSettings();
  const months = await fetchAllMonthsAsc();

  Object.values(charts).forEach((c) => c?.destroy());

  const pieData = [t.byGroup.regulieres, t.byGroup.occasionnelles, t.byGroup.capital, Math.max(t.balance, 0)];
  charts.pie = new Chart($("#chart-pie"), {
    type: "pie",
    data: { labels: PIE_LABELS, datasets: [{ data: pieData, backgroundColor: PIE_COLORS }] },
    options: pieOptions(pieData)
  });

  const pastId = monthId(new Date());
  const pastMonths = months.filter(({ id }) => id < pastId);
  const avgData = [0, 0, 0, 0];
  if (pastMonths.length) {
    pastMonths.forEach(({ data: d }) => {
      const dt = computeTotals(catalog, d, currentScope);
      avgData[0] += dt.byGroup.regulieres;
      avgData[1] += dt.byGroup.occasionnelles;
      avgData[2] += dt.byGroup.capital;
      avgData[3] += Math.max(dt.balance, 0);
    });
    for (let i = 0; i < avgData.length; i++) avgData[i] /= pastMonths.length;
  }
  // Moyenne en anneau (et pas en camembert plein comme "Ce mois-ci") : les deux se distinguent
  // au premier coup d'œil.
  charts.pieAvg = new Chart($("#chart-pie-avg"), {
    type: "doughnut",
    data: { labels: PIE_LABELS, datasets: [{ data: avgData, backgroundColor: PIE_COLORS }] },
    options: ringOptions(avgData, "Moyenne", `${pastMonths.length} mois`, "#6b7280"),
    plugins: [centerTextPlugin]
  });

  // Épargne cumulée = solde de départ + somme glissante de (Épargne du mois - Virement de
  // l'épargne du mois). L'Investissement n'entre pas en compte : c'est un poste distinct.
  // Réglages par espace via settings.byScope[<owner>] = { epargneBase, epargneStart,
  // investissementBase, investissementStart }, avec repli sur les réglages globaux
  // (rétro-compat). Pour "Famille", reserveCumulSeries somme Habib + Marwa proprement
  // (voir sa doc) au lieu de réutiliser un seul réglage global pour les deux.
  const epargneSeries = reserveCumulSeries(currentScope, months, settings, {
    baseKey: "epargneBase", startKey: "epargneStart", role: "epargne", outRole: "epargne_out"
  });
  // Autonomie : épargne cumulée au mois en cours (ou dernier mois connu avant), confrontée
  // aux dépenses prévues des mois suivants pour l'espace affiché. Puis les changements de
  // palier prévus d'après l'épargne prévue des mois suivants (carte + repères sur la courbe).
  const curId = monthId(new Date());
  let savingsNow = 0;
  epargneSeries.ids.forEach((id, i) => { if (id <= curId) savingsNow = epargneSeries.values[i]; });
  const monthsById = Object.fromEntries(months.map((m) => [m.id, m.data]));
  const couverture = epargneCouverture(currentScope, savingsNow, monthsById, curId);
  const paliers = paliersPrevus(currentScope, epargneSeries, monthsById, curId, niveauOf(couverture.months));
  const lastPrevuId = epargneSeries.ids.filter((id) => id > curId).pop() || null;
  renderCouverture($("#epargne-couverture"), currentScope, couverture, curId, paliers, lastPrevuId);
  renderObjectif($("#epargne-couverture .cv-goal"), currentScope, epargneSeries, monthsById, curId, niveauOf(couverture.months));
  charts.line = cumulLineChart($("#chart-line"), epargneSeries, "Épargne cumulée", "#2563eb",
    paliers.map((p) => ({ index: p.index, label: `${p.up ? "↗" : "↘"} ${p.niveau.label}`, color: p.niveau.color })));

  // Investissement cumulé = solde de départ (à partir du mois configuré) + somme glissante
  // du poste Investissement, sans soustraction (pas de "retrait d'investissement" suivi).
  const invSeries = reserveCumulSeries(currentScope, months, settings, {
    baseKey: "investissementBase", startKey: "investissementStart", role: "investissement", defaultStart: "2026-08"
  });
  charts.investment = cumulLineChart($("#chart-investment"), invSeries, "Investissement cumulé", "#059669");

  // Reste à vivre de chaque mois (pas cumulé) : la tendance mois après mois, avec les mois
  // en négatif mis en évidence pour repérer vite les périodes tendues. Juin 2026 est exclu :
  // ce mois a été mal archivé, ses données ne sont pas représentatives.
  const balanceIds = [];
  const balanceLabels = [];
  const balanceValues = [];
  months.filter(({ id }) => id !== "2026-06").forEach(({ id, data: d }) => {
    balanceIds.push(id);
    balanceLabels.push(monthLabelShort(id));
    balanceValues.push(computeTotals(catalog, d, currentScope).balance);
  });
  // Mois en cours mis en valeur comme sur les courbes cumulées : point agrandi cerclé de blanc
  // + étiquette avec sa valeur (en rouge si le reste à vivre du mois est négatif).
  const balanceIdx = balanceIds.indexOf(monthId(new Date()));
  const balanceColor = (v) => (v < 0 ? "#dc2626" : "#7c3aed");
  const isCur = (i) => i === balanceIdx;
  charts.balance = new Chart($("#chart-balance"), {
    type: "line",
    data: {
      labels: balanceLabels,
      datasets: [{
        label: "Reste à vivre",
        data: balanceValues,
        borderColor: "#7c3aed",
        tension: 0.3,
        pointBackgroundColor: balanceValues.map(balanceColor),
        pointBorderColor: balanceValues.map((v, i) => (isCur(i) ? "#fff" : balanceColor(v))),
        pointBorderWidth: balanceValues.map((_, i) => (isCur(i) ? 3 : 1)),
        pointRadius: balanceValues.map((_, i) => (isCur(i) ? 8 : 4)),
        pointHoverRadius: balanceValues.map((_, i) => (isCur(i) ? 10 : 6))
      }]
    },
    options: {
      layout: { padding: { top: 34, right: 12 } },
      plugins: {
        legend: { display: false },
        currentPoint: { index: balanceIdx, color: balanceIdx >= 0 ? balanceColor(balanceValues[balanceIdx]) : "#7c3aed" }
      }
    },
    plugins: [currentPointPlugin]
  });

  // Classement des postes occasionnels par coût total cumulé sur les mois passés + en cours
  // (les mois futurs ne sont que des prévisions, pas des dépenses réelles). En vue Famille,
  // Habib et Marwa ont chacun leur propre poste (id différent) même quand ils portent le même
  // nom (ex. "Sport / Club") — on les fusionne par libellé pour avoir une seule ligne avec le
  // total des deux, au lieu de deux lignes identiques qui n'affichent chacune que la moitié.
  const occItems = catalog.items.filter((it) => it.type === "occasionnelles" && inScope(it, currentScope));
  const occTotals = {};
  months.filter(({ id }) => id <= currentMonthId).forEach(({ data: d }) => {
    const values_ = d.values || {};
    occItems.forEach((it) => {
      occTotals[it.label] = (occTotals[it.label] || 0) + ((values_[it.id] && values_[it.id].amount) || 0);
    });
  });
  const occRanked = Object.entries(occTotals)
    .map(([label, total]) => ({ label, total }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  charts.occTop = new Chart($("#chart-occ-top"), {
    type: "bar",
    data: {
      labels: occRanked.map((r) => r.label),
      datasets: [{ label: "Total", data: occRanked.map((r) => r.total), backgroundColor: "#f59e0b" }]
    },
    options: { indexAxis: "y", plugins: { legend: { display: false } } }
  });

  // ---- Graphes propres à la vue consolidée ----
  if (currentScope === "famille") {
    const people = OWNER_KEYS;
    const colors = people.map(ownerColor);
    const peopleLabels = people.map((k) => OWNER_LABEL[k]);

    const incNow = people.map((k) => ownerKindSum(data, k, "income"));
    // Centre de l'anneau = type + total (vert pour les entrées, rouge pour les sorties) : sinon
    // les deux anneaux Habib/Marwa se ressemblent trait pour trait.
    const sum = (arr) => arr.reduce((s, v) => s + v, 0);
    charts.famIncome = new Chart($("#chart-fam-income"), {
      type: "doughnut",
      data: { labels: peopleLabels, datasets: [{ data: incNow, backgroundColor: colors }] },
      options: ringOptions(incNow, "Revenus", euros(sum(incNow)), "#059669"),
      plugins: [centerTextPlugin]
    });

    const expNow = people.map((k) => ownerKindSum(data, k, "expense"));
    charts.famSplit = new Chart($("#chart-fam-split"), {
      type: "doughnut",
      data: { labels: peopleLabels, datasets: [{ data: expNow, backgroundColor: colors }] },
      options: ringOptions(expNow, "Dépenses", euros(sum(expNow)), "#dc2626"),
      plugins: [centerTextPlugin]
    });

    charts.famStack = new Chart($("#chart-fam-stack"), {
      type: "bar",
      data: {
        labels: months.map((m) => monthLabelShort(m.id)),
        datasets: people.map((k, i) => ({
          label: peopleLabels[i],
          data: months.map((m) => ownerKindSum(m.data, k, "expense")),
          backgroundColor: colors[i]
        }))
      },
      options: {
        plugins: { legend: { position: "bottom" } },
        scales: { x: { stacked: true }, y: { stacked: true } }
      }
    });
  }
}
