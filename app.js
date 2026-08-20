import { firebaseConfig, AUTHORIZED_EMAILS, GOOGLE_CLIENT_ID } from "./firebase-config.js";
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
  ]
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

// Un poste est actif pour un mois donné s'il n'a jamais été retiré, ou s'il a été retiré
// après ce mois (permet de garder les postes retirés visibles dans l'historique passé).
function isActiveAt(item, monthIdStr) {
  return !item.retiredAt || monthIdStr < item.retiredAt;
}

function computeTotals(cat, data) {
  const values = (data && data.values) || {};
  let totalIncome = 0;
  const byGroup = { regulieres: 0, occasionnelles: 0, capital: 0 };
  let chargesAVenir = 0;
  cat.items.forEach((item) => {
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
  const resteAVivreReel = ((data && data.bankBalance) || 0) - chargesAVenir;
  return { totalIncome, byGroup, totalExpenses, balance, chargesAVenir, resteAVivreReel };
}

// ---- State ----
let currentUser = null;
let currentMonthId = monthId(new Date());
let monthData = null;
let catalog = null;
let saveTimeout = null;
let charts = { pie: null, pieAvg: null, line: null, investment: null };

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
  await loadMonth(currentMonthId);
});

// ---- Navigation entre vues ----
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

async function switchView(view) {
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
  return { values, bankBalance: 0 };
}

async function loadMonth(id) {
  currentMonthId = id;
  monthTitle.textContent = monthLabel(id);
  monthData = await fetchMonth(id);
  emptyMonthBanner.classList.toggle("hidden", !!monthData);
  if (!monthData) {
    groupsContainer.innerHTML = "";
    incomeList.innerHTML = "";
    bankBalanceEl.value = "";
    renderTotals();
    return;
  }
  if (!monthData.values) monthData.values = {};
  render();
}

createMonthBtn.addEventListener("click", async () => {
  const prevId = addMonths(currentMonthId, -1);
  const prev = await fetchMonth(prevId);
  monthData = prev ? cloneForNewMonth(prev) : { values: {}, bankBalance: 0 };
  emptyMonthBanner.classList.add("hidden");
  render();
  await saveMonth();
});

// ---- Rendu : Suivi du mois ----
function render() {
  renderIncome();
  renderExpenseGroups();
  bankBalanceEl.value = monthData.bankBalance || 0;
  renderTotals();
}

// Un poste à 0 € pour le mois affiché n'est pas montré dans Suivi (juste du bruit visuel) :
// pour lui donner un montant, ça se fait dans Prévisions, qui liste toujours tous les postes actifs.
function hasAmount(item) {
  return !!(monthData.values[item.id] && monthData.values[item.id].amount);
}

function renderIncome() {
  incomeList.innerHTML = "";
  const items = catalog.items.filter((it) => it.type === "income" && isActiveAt(it, currentMonthId) && hasAmount(it));
  $("#income-card").classList.toggle("hidden", !items.length);
  items.forEach((item) => incomeList.appendChild(buildSuiviRow(item)));
}

function renderExpenseGroups() {
  groupsContainer.innerHTML = "";
  GROUPS.forEach((group) => {
    const items = catalog.items.filter((it) => it.type === group.key && isActiveAt(it, currentMonthId) && hasAmount(it));
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

bankBalanceEl.addEventListener("input", () => {
  if (!monthData) return;
  monthData.bankBalance = parseFloat(bankBalanceEl.value) || 0;
  renderTotals();
  scheduleSave();
});

function renderTotals() {
  const days = remainingDays(currentMonthId);
  daysLeftEl.textContent = days;

  if (!monthData || !catalog) {
    [totalIncomeEl, totalExpensesEl, balanceEl, chargesAVenirEl, resteAVivreEl, dailyAllocationEl].forEach((el) => el.textContent = euros(0));
    return;
  }
  const t = computeTotals(catalog, monthData);
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
// tous pour Historique). opts.editable : montants modifiables. opts.structural : permet
// aussi de renommer/ajouter/supprimer des postes (réservé aux Prévisions).
function buildMonthGrid(table, ids, monthsByI, items, opts) {
  let html = "<thead><tr><th>Poste</th>";
  ids.forEach((id) => { html += `<th>${monthLabelShort(id)}</th>`; });
  html += "</tr></thead><tbody>";

  SECTIONS.forEach((sec) => {
    html += `<tr class="section-row"><td colspan="${ids.length + 1}">${sec.label}</td></tr>`;
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
      <button type="button" class="remove-item-btn" data-item-id="${item.id}" title="Supprimer ce poste">✕</button>`;
  } else {
    row += escapeHtml(item.label);
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
  let row = `<tr class="${strong ? "total-row" : "subtotal-row"}"><td>${label}</td>`;
  ids.forEach((id) => {
    const t = computeTotals(catalog, monthsByI[id]);
    row += `<td>${euros(getValue(t))}</td>`;
  });
  return row + "</tr>";
}

// ---- Historique (grille en lecture seule, tous les postes, mois passés) ----
async function renderHistory() {
  historyTable.innerHTML = `<tr><td>Chargement…</td></tr>`;
  const currentId = monthId(new Date());
  const past = (await fetchAllMonthsAsc()).filter(({ id }) => id < currentId);
  if (!past.length) {
    historyTable.innerHTML = `<tr><td>Aucun mois passé enregistré pour l'instant.</td></tr>`;
    return;
  }
  const ids = past.map((m) => m.id);
  const monthsByI = {};
  past.forEach(({ id, data }) => { monthsByI[id] = data; });
  buildMonthGrid(historyTable, ids, monthsByI, catalog.items, { editable: false, structural: false });
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

  const activeItems = catalog.items.filter((it) => !it.retiredAt);
  buildMonthGrid(forecastTable, ids, monthsByI, activeItems, { editable: true, structural: true });

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
  catalog.items.push({ id: uid(), label: label.trim(), type, retiredAt: null });
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
  analyseMonthLabel.textContent = monthLabel(currentMonthId);
  // Toujours relire Firestore (plutôt que de réutiliser monthData) : un montant modifié
  // depuis Prévisions ne met pas à jour l'état en mémoire de l'écran Suivi.
  const data = (await fetchMonth(currentMonthId)) || { values: {} };
  const t = computeTotals(catalog, data);
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
      const dt = computeTotals(catalog, d);
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

  // Épargne cumulée = solde de départ + somme glissante de (Épargne du mois - Virement de
  // l'épargne du mois). L'Investissement n'entre pas en compte : c'est un poste distinct.
  const epargneItem = catalog.items.find((it) => it.role === "epargne");
  const virementItem = catalog.items.find((it) => it.role === "epargne_out");
  let cumul = settings.epargneBase || 0;
  const labels = [];
  const values = [];
  months.forEach(({ id, data: d }) => {
    const values_ = d.values || {};
    const epargne = (epargneItem && values_[epargneItem.id] && values_[epargneItem.id].amount) || 0;
    const virement = (virementItem && values_[virementItem.id] && values_[virementItem.id].amount) || 0;
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
  const investissementItem = catalog.items.find((it) => it.role === "investissement");
  const invStart = settings.investissementStart || "2026-08";
  let invCumul = settings.investissementBase || 0;
  const invLabels = [];
  const invValues = [];
  months.filter(({ id }) => id >= invStart).forEach(({ id, data: d }) => {
    const values_ = d.values || {};
    const amount = (investissementItem && values_[investissementItem.id] && values_[investissementItem.id].amount) || 0;
    invCumul += amount;
    invLabels.push(monthLabelShort(id));
    invValues.push(invCumul);
  });
  charts.investment = new Chart($("#chart-investment"), {
    type: "line",
    data: { labels: invLabels, datasets: [{ label: "Investissement cumulé", data: invValues, borderColor: "#059669", tension: 0.3 }] },
    options: { plugins: { legend: { display: false } } }
  });
}
