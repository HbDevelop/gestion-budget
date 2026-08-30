import { firebaseConfig, AUTHORIZED_EMAILS, GOOGLE_CLIENT_ID, SPACES } from "./firebase-config.js";
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

// Solde bancaire : nouveau format { habib, marwa }. L'ancien format (un seul nombre) est
// rattaché à l'espace de repli et converti à la première écriture, puis réaffectable via
// l'outil "attribution en masse" de Prévisions.
function bankBalancesOf(data) {
  if (!data) return {};
  if (data.bankBalances && typeof data.bankBalances === "object") return data.bankBalances;
  if (typeof data.bankBalance === "number") return { [FALLBACK_OWNER]: data.bankBalance };
  return {};
}
// Somme de tous les soldes bancaires du mois, quelle que soit la clé — y compris d'anciens
// seaux orphelins (ex. "commun") pas encore réaffectés à une personne.
function sumBankBalances(data) {
  return Object.values(bankBalancesOf(data)).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0);
}
function bankFor(data, scope) {
  if (scope === "famille") return sumBankBalances(data);
  return bankBalancesOf(data)[scope] || 0;
}

// Montant d'un espace avec l'extérieur du foyer (hors virements internes), pour un mois donné.
// `kind` vaut "income" ou "expense". Sert à la ventilation et aux graphes consolidés.
function ownerExternalOf(data, scope, kind) {
  if (!catalog) return 0;
  const values = (data && data.values) || {};
  return catalog.items.reduce((s, it) => {
    if (it.owner !== scope || it.internal) return s;
    const isIncome = it.type === "income";
    if (kind === "income" && !isIncome) return s;
    if (kind === "expense" && isIncome) return s;
    return s + ((values[it.id] && values[it.id].amount) || 0);
  }, 0);
}

function computeTotals(cat, data, scope = "famille") {
  const values = (data && data.values) || {};
  let totalIncome = 0;
  const byGroup = { regulieres: 0, occasionnelles: 0, capital: 0 };
  let chargesAVenir = 0;
  cat.items.forEach((item) => {
    if (!inScope(item, scope)) return;
    // Dans le consolidé, les transferts internes au foyer (ex. un remboursement de Habib
    // à Marwa) s'annulent : on ne compte que les flux avec l'extérieur.
    if (scope === "famille" && item.internal) return;
    const v = values[item.id];
    const amount = (v && v.amount) || 0;
    if (item.type === "income") {
      totalIncome += amount;
    } else {
      byGroup[item.type] = (byGroup[item.type] || 0) + amount;
      if (!v || !v.paid) chargesAVenir += amount;
    }
  });
  const totalExpenses = byGroup.regulieres + byGroup.occasionnelles + byGroup.capital;
  const balance = totalIncome - totalExpenses;
  const bankBalance = bankFor(data, scope);
  const resteAVivreReel = bankBalance - chargesAVenir;
  return { totalIncome, byGroup, totalExpenses, balance, chargesAVenir, resteAVivreReel, bankBalance };
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
const totalExpensesEl = $("#total-expenses");
const balanceEl = $("#balance");
const daysLeftEl = $("#days-left");
const bankBalanceEl = $("#bank-balance");
const chargesAVenirEl = $("#charges-a-venir");
const resteAVivreEl = $("#reste-a-vivre");
const dailyAllocationEl = $("#daily-allocation");
const emptyMonthBanner = $("#empty-month-banner");
const createMonthBtn = $("#create-month-btn");
const historyTable = $("#history-table");
const forecastTable = $("#forecast-table");
const analyseMonthLabel = $("#analyse-month-label");
const scopeSwitch = $("#scope-switch");
const scopeHint = $("#scope-hint");
const suiviIndividual = $("#suivi-individual");
const suiviFamille = $("#suivi-famille");
const analyseFamille = $("#analyse-famille");
const bulkOwner = $("#bulk-owner");
const bulkOwnerSelect = $("#bulk-owner-select");
const bulkOwnerCount = $("#bulk-owner-count");
const bulkOwnerBanks = $("#bulk-owner-banks");
const bulkOwnerApply = $("#bulk-owner-apply");
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
  if (!AUTHORIZED_EMAILS.includes(user.email)) {
    deniedScreen.classList.remove("hidden");
    $("#denied-email").textContent = user.email;
    return;
  }
  userLabel.textContent = user.email;
  appShell.classList.remove("hidden");
  catalog = await fetchCatalog();
  if (!catalog) {
    catalog = DEFAULT_CATALOG();
    await persistCatalog(catalog);
  }
  await normalizeCatalogOwners();

  // Au tout premier chargement (aucun choix mémorisé), on ouvre sur l'espace perso de la
  // personne connectée plutôt que sur le consolidé.
  if (!lsGet("budget-scope")) {
    const mine = SPACES.find((s) => s.email === user.email);
    currentScope = mine ? mine.key : DEFAULT_SCOPE;
  }
  buildScopeSwitch();
  await loadMonth(currentMonthId);
});

// ---- Navigation entre vues ----
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ---- Attribution en masse (migration / rééquilibrage depuis Prévisions) ----
bulkOwnerSelect.innerHTML = OWNER_KEYS.map((k) => `<option value="${k}">${OWNER_LABEL[k]}</option>`).join("");
bulkOwnerApply.addEventListener("click", () => bulkAssignOwner(bulkOwnerSelect.value, bulkOwnerBanks.checked));

forecastEditToggle.addEventListener("click", () => {
  forecastEdit = !forecastEdit;
  forecastEditToggle.textContent = forecastEdit ? "✓ Terminé" : "✏️ Modifier les postes";
  forecastEditToggle.classList.toggle("active", forecastEdit);
  bulkOwner.hidden = !forecastEdit;
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

async function setItemOwner(itemId, owner) {
  const item = catalog.items.find((it) => it.id === itemId);
  if (!item || !OWNER_KEYS.includes(owner) || item.owner === owner) return;
  item.owner = owner;
  await persistCatalog(catalog);
  await renderForecast();
}

async function setItemInternal(itemId, internal) {
  const item = catalog.items.find((it) => it.id === itemId);
  if (!item) return;
  if (internal) item.internal = true;
  else delete item.internal;
  await persistCatalog(catalog);
  await renderForecast();
}

// Postes actuellement listés dans Prévisions (actifs, filtrés par l'espace affiché).
function forecastListedItems() {
  return catalog.items.filter((it) => !it.retiredAt && inScope(it, currentScope));
}

// Attribue en masse tous les postes listés à un espace. Sert surtout à la reprise
// initiale : "tout ce budget est celui de Marwa" → un clic, au lieu de 30 menus.
// Option `moveBanks` : regroupe aussi le solde bancaire de CHAQUE mois sur cet espace.
async function bulkAssignOwner(targetOwner, moveBanks) {
  if (!OWNER_KEYS.includes(targetOwner)) return;
  const listed = forecastListedItems();
  const toChange = listed.filter((it) => it.owner !== targetOwner);

  let msg = `Attribuer ${toChange.length} poste(s) à « ${OWNER_LABEL[targetOwner]} » ?`;
  if (!toChange.length) msg = `Tous les postes affichés sont déjà attribués à « ${OWNER_LABEL[targetOwner]} ».`;
  if (moveBanks) msg += `\n\nEt regrouper le solde bancaire de tous les mois enregistrés sur « ${OWNER_LABEL[targetOwner]} ».`;
  if (!toChange.length && !moveBanks) { alert(msg); return; }
  if (!confirm(msg)) return;

  bulkOwnerApply.disabled = true;
  bulkOwnerApply.textContent = "Migration…";
  try {
    if (toChange.length) {
      toChange.forEach((it) => { it.owner = targetOwner; });
      await persistCatalog(catalog);
    }
    if (moveBanks) {
      const all = await fetchAllMonthsAsc();
      for (const { id, data } of all) {
        if (data.bankBalances == null && data.bankBalance == null) continue;
        const total = sumBankBalances(data);
        const next = { ...data, bankBalances: { [targetOwner]: total } };
        delete next.bankBalance;
        await persistMonth(id, { ...next, updatedAt: new Date().toISOString(), updatedBy: currentUser.email });
      }
    }
    await renderForecast();
    alert("Terminé.");
  } catch (e) {
    console.error(e);
    alert("Échec de la migration : " + e.message);
  } finally {
    bulkOwnerApply.disabled = false;
    bulkOwnerApply.textContent = "Appliquer";
  }
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
    renderTotals();
    return;
  }
  renderIncome();
  renderExpenseGroups();
  bankBalanceEl.value = bankFor(monthData, currentScope) || 0;
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
  items.forEach((item) => incomeList.appendChild(buildSuiviRow(item)));
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

function buildSuiviRow(item) {
  const isExpense = item.type !== "income";
  const current = () => monthData.values[item.id] || { amount: 0, paid: false };
  const v0 = current();
  const div = document.createElement("div");
  div.className = "row";
  div.innerHTML = `
    ${isExpense ? `<input type="checkbox" class="paid-check" ${v0.paid ? "checked" : ""} title="Payé" />` : `<span class="paid-check-spacer"></span>`}
    <span class="label-text">${escapeHtml(item.label)}</span>
    <input type="number" class="amount-input" value="${v0.amount}" step="0.01" />
  `;
  const amountInput = div.querySelector(".amount-input");
  const paidCheck = div.querySelector(".paid-check");

  amountInput.addEventListener("input", () => {
    const c = current();
    monthData.values[item.id] = { amount: parseFloat(amountInput.value) || 0, paid: c.paid };
    renderTotals();
    scheduleSave();
  });
  if (paidCheck) {
    paidCheck.addEventListener("change", () => {
      const c = current();
      monthData.values[item.id] = { amount: c.amount, paid: paidCheck.checked };
      renderTotals();
      scheduleSave();
    });
  }
  return div;
}

// Ligne en lecture seule pour la vue consolidée (l'édition des montants se fait dans
// l'espace de chaque personne, ou dans Prévisions — comme l'écran Historique).
function buildFamilleRow(item) {
  const v = (monthData.values && monthData.values[item.id]) || { amount: 0, paid: false };
  const isExpense = item.type !== "income";
  const div = el("div", "row fam-row");
  div.innerHTML =
    (isExpense
      ? `<span class="paid-dot${v.paid ? " on" : ""}" title="${v.paid ? "Payé" : "Non payé"}"></span>`
      : `<span class="paid-check-spacer"></span>`) +
    `<span class="label-text">${escapeHtml(item.label)}</span>` +
    `<span class="fam-amount">${euros(v.amount)}</span>`;
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

function renderTotals() {
  const days = remainingDays(currentMonthId);
  daysLeftEl.textContent = days;

  if (!monthData || !catalog) {
    [totalIncomeEl, totalExpensesEl, balanceEl, chargesAVenirEl, resteAVivreEl, dailyAllocationEl].forEach((elm) => elm.textContent = euros(0));
    return;
  }
  const t = computeTotals(catalog, monthData, currentScope);
  totalIncomeEl.textContent = euros(t.totalIncome);
  totalExpensesEl.textContent = euros(t.totalExpenses);
  balanceEl.textContent = euros(t.balance);
  balanceEl.classList.toggle("negative", t.balance < 0);
  chargesAVenirEl.textContent = euros(t.chargesAVenir);
  resteAVivreEl.textContent = euros(t.resteAVivreReel);
  resteAVivreEl.classList.toggle("negative", t.resteAVivreReel < 0);

  const allocation = days > 0 ? t.resteAVivreReel / days : t.resteAVivreReel;
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
  summary.appendChild(famSummaryCard("Revenus du foyer", fam.totalIncome, "income"));
  summary.appendChild(famSummaryCard("Dépenses du foyer", fam.totalExpenses, "expense"));
  const soldeCard = famSummaryCard("Solde consolidé", fam.balance, null);
  soldeCard.querySelector(".summary-value").classList.toggle("negative", fam.balance < 0);
  summary.appendChild(soldeCard);
  suiviFamille.appendChild(summary);

  // 2. Rappel : les transferts internes au foyer sont neutralisés dans le consolidé
  suiviFamille.appendChild(el("div", "fam-note",
    "<span>&#8505;</span><span>Les <b>transferts entre Habib et Marwa</b> (postes marqués " +
    "« interne » dans Prévisions, ex. un remboursement) sont neutralisés ici : le consolidé " +
    "ne compte que les flux avec l'extérieur du foyer. Chaque espace, lui, les voit comme un " +
    "vrai mouvement.</span>"));

  // 3. Suivi temps réel par espace
  suiviFamille.appendChild(famRealtimePanel(days));

  // 4. Un bloc par espace
  OWNER_KEYS.forEach((owner) => suiviFamille.appendChild(famPersonBlock(owner)));
}

function famSummaryCard(label, value, kind) {
  const card = el("div", "summary-card");
  card.appendChild(el("span", "summary-label", label));
  card.appendChild(el("span", "summary-value", euros(value)));
  if (kind) {
    const split = el("div", "summary-split");
    OWNER_KEYS.forEach((k) => {
      const v = ownerExternalOf(monthData, k, kind);
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
  const famUpcoming = OWNER_KEYS.reduce((s, k) => s + totals[k].chargesAVenir, 0);
  const famReste = OWNER_KEYS.reduce((s, k) => s + totals[k].resteAVivreReel, 0);

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

  // Ligne "Solde bancaire" : éditable, un compte par espace
  const balRow = el("tr");
  balRow.appendChild(el("td", null, "Solde bancaire"));
  OWNER_KEYS.forEach((k) => {
    const td = el("td");
    const input = el("input", "fam-rt-input");
    input.type = "number";
    input.step = "0.01";
    input.value = totals[k].bankBalance || 0;
    input.setAttribute("aria-label", "Solde bancaire " + OWNER_LABEL[k]);
    // "change" (et pas "input") : on ne reconstruit le tableau qu'à la validation du champ,
    // pour ne pas perdre le focus à chaque frappe.
    input.addEventListener("change", () => {
      monthData.bankBalances = bankBalancesOf(monthData);
      monthData.bankBalances[k] = parseFloat(input.value) || 0;
      delete monthData.bankBalance;
      scheduleSave();
      renderFamilleSuivi();
    });
    td.appendChild(input);
    balRow.appendChild(td);
  });
  balRow.appendChild(el("td", "fam-col", euros(famBank)));
  body.appendChild(balRow);

  body.appendChild(famRtRow("Charges à venir", OWNER_KEYS.map((k) => totals[k].chargesAVenir), famUpcoming));
  body.appendChild(famRtRow("Reste à vivre", OWNER_KEYS.map((k) => totals[k].resteAVivreReel), famReste, true));
  body.appendChild(famRtRow("Allocation / jour", OWNER_KEYS.map((k) => totals[k].resteAVivreReel / days), famReste / days, true));

  table.appendChild(body);
  card.appendChild(table);
  return card;
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
      `<span>Revenus <b>${euros(t.totalIncome)}</b></span>` +
      `<span>Dépenses <b>${euros(t.totalExpenses)}</b></span>` +
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

  SECTIONS.forEach((sec) => {
    html += `<tr class="section-row"><td colspan="${ids.length + 1}"><span class="cell-label section-label">${sec.label}</span></td></tr>`;
    items.filter((it) => it.type === sec.key).forEach((item) => {
      html += gridRow(item, ids, monthsByI, opts);
    });
    if (opts.structural) {
      html += `<tr class="add-row"><td colspan="${ids.length + 1}"><button type="button" class="add-item-btn" data-type="${sec.key}">+ Ajouter un poste</button></td></tr>`;
    }
    const getValue = sec.key === "income" ? (t) => t.totalIncome : (t) => t.byGroup[sec.key];
    html += gridTotalRow(sec.key === "income" ? "Sous-total revenus" : `Sous-total ${sec.label.toLowerCase()}`, ids, monthsByI, getValue);
  });

  html += gridTotalRow("Total dépenses", ids, monthsByI, (t) => t.totalExpenses, true);
  html += gridTotalRow("Reste à vivre", ids, monthsByI, (t) => t.balance, true);
  html += "</tbody>";
  table.innerHTML = html;
}

function gridRow(item, ids, monthsByI, opts) {
  let row = `<tr><td class="poste-cell">`;
  if (opts.structural) {
    row += `<input type="text" class="rename-input" value="${escapeAttr(item.label)}" data-item-id="${item.id}" />
      <select class="owner-select" data-item-id="${item.id}" title="Espace du poste">
        ${OWNER_KEYS.map((k) => `<option value="${k}"${k === item.owner ? " selected" : ""}>${OWNER_LABEL[k]}</option>`).join("")}
      </select>
      <label class="internal-check" title="Flux interne au foyer (virement entre espaces) : neutralisé dans le consolidé">
        <input type="checkbox" class="internal-toggle" data-item-id="${item.id}"${item.internal ? " checked" : ""} /> interne
      </label>
      <button type="button" class="remove-item-btn" data-item-id="${item.id}" title="Supprimer ce poste">✕</button>`;
  } else {
    row += `<span class="cell-label poste-label" title="${escapeAttr(item.label)}">${escapeHtml(item.label)}</span>`;
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

function gridTotalRow(label, ids, monthsByI, getValue, strong) {
  let row = `<tr class="${strong ? "total-row" : "subtotal-row"}"><td><span class="cell-label">${label}</span></td>`;
  ids.forEach((id) => {
    const t = computeTotals(catalog, monthsByI[id], currentScope);
    row += `<td>${euros(getValue(t))}</td>`;
  });
  return row + "</tr>";
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
  bulkOwner.hidden = !forecastEdit;
  forecastTable.classList.toggle("compact", !forecastEdit);
  bulkOwnerCount.textContent = currentScope === "famille"
    ? `les ${activeItems.length} postes`
    : `les ${activeItems.length} postes de « ${OWNER_LABEL[currentScope]} »`;
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
  forecastTable.querySelectorAll(".owner-select").forEach((sel) => {
    sel.addEventListener("change", () => setItemOwner(sel.dataset.itemId, sel.value));
  });
  forecastTable.querySelectorAll(".internal-toggle").forEach((cb) => {
    cb.addEventListener("change", () => setItemInternal(cb.dataset.itemId, cb.checked));
  });
  forecastTable.querySelectorAll(".remove-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => removeItem(btn.dataset.itemId, ids, monthsByI));
  });
  forecastTable.querySelectorAll(".add-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => addItem(btn.dataset.type));
  });
}

async function setForecastValue(targetMonthId, itemId, value, monthsByI) {
  let data = monthsByI[targetMonthId];
  if (!data || !data.values || !Object.keys(data).length) {
    const ids = forecastMonthIds();
    const idx = ids.indexOf(targetMonthId);
    let sourceData = null;
    for (let i = idx - 1; i >= 0 && !sourceData; i--) sourceData = monthsByI[ids[i]] && monthsByI[ids[i]].values ? monthsByI[ids[i]] : null;
    if (!sourceData) sourceData = (await fetchMonth(currentMonthId)) || { values: {} };
    data = cloneForNewMonth(sourceData);
    monthsByI[targetMonthId] = data;
  }
  const prev = data.values[itemId] || { amount: 0, paid: false };
  data.values[itemId] = { amount: value, paid: prev.paid };
  await persistMonth(targetMonthId, { ...data, updatedAt: new Date().toISOString(), updatedBy: currentUser.email });
  await renderForecast();
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

async function renderAnalyse() {
  analyseMonthLabel.textContent = monthLabel(currentMonthId) + " (" + (currentScope === "famille" ? "Famille" : OWNER_LABEL[currentScope]) + ")";
  analyseFamille.classList.toggle("hidden", currentScope !== "famille");
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
  charts.pieAvg = new Chart($("#chart-pie-avg"), {
    type: "pie",
    data: { labels: PIE_LABELS, datasets: [{ data: avgData, backgroundColor: PIE_COLORS }] },
    options: pieOptions(avgData)
  });

  // Réglages épargne/investissement : globaux par défaut (rétro-compat), surchargeables par
  // espace via settings.byScope[<owner>] = { epargneBase, epargneStart, investissementBase,
  // investissementStart }. La vue "Famille" garde les valeurs globales.
  const sc = (currentScope !== "famille" && settings.byScope && settings.byScope[currentScope]) || {};
  const epargneBase = sc.epargneBase != null ? sc.epargneBase : (settings.epargneBase || 0);
  const epargneStart = sc.epargneStart || null;

  // Épargne cumulée = solde de départ + somme glissante de (Épargne du mois - Virement de
  // l'épargne du mois). L'Investissement n'entre pas en compte : c'est un poste distinct.
  // Les postes sont restreints à l'espace courant (plusieurs postes "épargne" possibles).
  const epargneItems = catalog.items.filter((it) => it.role === "epargne" && inScope(it, currentScope));
  const virementItems = catalog.items.filter((it) => it.role === "epargne_out" && inScope(it, currentScope));
  let cumul = epargneBase;
  const labels = [];
  const values = [];
  (epargneStart ? months.filter(({ id }) => id >= epargneStart) : months).forEach(({ id, data: d }) => {
    const values_ = d.values || {};
    const epargne = epargneItems.reduce((s, it) => s + ((values_[it.id] && values_[it.id].amount) || 0), 0);
    const virement = virementItems.reduce((s, it) => s + ((values_[it.id] && values_[it.id].amount) || 0), 0);
    cumul += epargne - virement;
    labels.push(monthLabelShort(id));
    values.push(cumul);
  });
  charts.line = new Chart($("#chart-line"), {
    type: "line",
    data: { labels, datasets: [{ label: "Épargne cumulée", data: values, borderColor: "#2563eb", tension: 0.3 }] },
    options: { plugins: { legend: { display: false } } }
  });

  // Investissement cumulé = solde de départ (à partir du mois configuré) + somme glissante
  // du poste Investissement, sans soustraction (pas de "retrait d'investissement" suivi).
  const investissementItems = catalog.items.filter((it) => it.role === "investissement" && inScope(it, currentScope));
  const invStart = sc.investissementStart || settings.investissementStart || "2026-08";
  let invCumul = sc.investissementBase != null ? sc.investissementBase : (settings.investissementBase || 0);
  const invLabels = [];
  const invValues = [];
  months.filter(({ id }) => id >= invStart).forEach(({ id, data: d }) => {
    const values_ = d.values || {};
    const amount = investissementItems.reduce((s, it) => s + ((values_[it.id] && values_[it.id].amount) || 0), 0);
    invCumul += amount;
    invLabels.push(monthLabelShort(id));
    invValues.push(invCumul);
  });
  charts.investment = new Chart($("#chart-investment"), {
    type: "line",
    data: { labels: invLabels, datasets: [{ label: "Investissement cumulé", data: invValues, borderColor: "#059669", tension: 0.3 }] },
    options: { plugins: { legend: { display: false } } }
  });

  // Reste à vivre de chaque mois (pas cumulé) : la tendance mois après mois, avec les mois
  // en négatif mis en évidence pour repérer vite les périodes tendues.
  const balanceLabels = [];
  const balanceValues = [];
  months.forEach(({ id, data: d }) => {
    balanceLabels.push(monthLabelShort(id));
    balanceValues.push(computeTotals(catalog, d, currentScope).balance);
  });
  charts.balance = new Chart($("#chart-balance"), {
    type: "line",
    data: {
      labels: balanceLabels,
      datasets: [{
        label: "Reste à vivre",
        data: balanceValues,
        borderColor: "#7c3aed",
        tension: 0.3,
        pointBackgroundColor: balanceValues.map((v) => (v < 0 ? "#dc2626" : "#7c3aed")),
        pointRadius: 4
      }]
    },
    options: { plugins: { legend: { display: false } } }
  });

  // Classement des postes occasionnels par coût total cumulé sur les mois passés + en cours
  // (les mois futurs ne sont que des prévisions, pas des dépenses réelles).
  const occItems = catalog.items.filter((it) => it.type === "occasionnelles" && inScope(it, currentScope));
  const occTotals = {};
  occItems.forEach((it) => { occTotals[it.id] = 0; });
  months.filter(({ id }) => id <= currentMonthId).forEach(({ data: d }) => {
    const values_ = d.values || {};
    occItems.forEach((it) => { occTotals[it.id] += (values_[it.id] && values_[it.id].amount) || 0; });
  });
  const occRanked = occItems
    .map((it) => ({ label: it.label, total: occTotals[it.id] }))
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

    const incNow = people.map((k) => ownerExternalOf(data, k, "income"));
    charts.famIncome = new Chart($("#chart-fam-income"), {
      type: "doughnut",
      data: { labels: peopleLabels, datasets: [{ data: incNow, backgroundColor: colors }] },
      options: pieOptions(incNow)
    });

    const expNow = people.map((k) => ownerExternalOf(data, k, "expense"));
    charts.famSplit = new Chart($("#chart-fam-split"), {
      type: "doughnut",
      data: { labels: peopleLabels, datasets: [{ data: expNow, backgroundColor: colors }] },
      options: pieOptions(expNow)
    });

    charts.famStack = new Chart($("#chart-fam-stack"), {
      type: "bar",
      data: {
        labels: months.map((m) => monthLabelShort(m.id)),
        datasets: people.map((k, i) => ({
          label: peopleLabels[i],
          data: months.map((m) => ownerExternalOf(m.data, k, "expense")),
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
