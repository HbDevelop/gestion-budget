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

const GROUPS = [
  { key: "regulieres", label: "Charges fixes régulières" },
  { key: "occasionnelles", label: "Charges fixes occasionnelles" },
  { key: "capital", label: "Capital et réserves" }
];

const DEFAULT_TEMPLATE = () => ({
  income: [
    { id: uid(), label: "Salaire", amount: 0 },
    { id: uid(), label: "Impôt", amount: 0 },
    { id: uid(), label: "Extra", amount: 0 },
    { id: uid(), label: "Virement de l'épargne", amount: 0 }
  ],
  expenses: [
    { id: uid(), label: "Crédit / Loyer", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Essence", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Transport en commun", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Crèche / École", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Forfait mobile", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Box internet", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Virement enfants", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Abonnements", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Assurance électroménager", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Assurance habitation", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Assurance voiture", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Mutuelle complémentaire", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Banque", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Charges copropriété", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Assurance appareil", amount: 0, paid: false, group: "regulieres" },
    { id: uid(), label: "Électroménager", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Échéancier", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Billet de transport", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Sorties / Loisirs", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Sport / Club", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Réparations / Entretien voiture", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Santé (non remboursé)", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Billet d'avion", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Impôts (ponctuels)", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Vêtements", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Vacances", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Amendes", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Épargne", amount: 0, paid: false, group: "capital" },
    { id: uid(), label: "Investissement", amount: 0, paid: false, group: "capital" }
  ],
  bankBalance: 0
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

function computeTotals(data) {
  const totalIncome = data.income.reduce((s, r) => s + (r.amount || 0), 0);
  const byGroup = {};
  GROUPS.forEach((g) => {
    byGroup[g.key] = data.expenses.filter((e) => e.group === g.key).reduce((s, r) => s + (r.amount || 0), 0);
  });
  const totalExpenses = GROUPS.reduce((s, g) => s + byGroup[g.key], 0);
  const balance = totalIncome - totalExpenses;
  const chargesAVenir = data.expenses.filter((e) => !e.paid).reduce((s, r) => s + (r.amount || 0), 0);
  const resteAVivreReel = (data.bankBalance || 0) - chargesAVenir;
  return { totalIncome, byGroup, totalExpenses, balance, chargesAVenir, resteAVivreReel };
}

// ---- State ----
let currentUser = null;
let currentMonthId = monthId(new Date());
let monthData = null;
let saveTimeout = null;
let currentView = "suivi";
let charts = { pie: null, bar: null, line: null };

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
const prevMonthBtn = $("#prev-month");
const nextMonthBtn = $("#next-month");
const saveStatus = $("#save-status");
const groupsContainer = $("#groups-container");
const incomeList = $("#income-list");
const addIncomeBtn = $("#add-income");
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
const historyBody = $("#history-body");
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
  await loadMonth(currentMonthId);
});

// ---- Navigation entre vues ----
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

async function switchView(view) {
  currentView = view;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(`#view-${view}`).classList.remove("hidden");
  if (view === "historique") await renderHistory();
  if (view === "previsions") await renderForecast();
  if (view === "analyse") await renderAnalyse();
}

// ---- Firestore ----
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
  return {
    income: prev.income.map((r) => ({ ...r })),
    expenses: prev.expenses.map((r) => ({ ...r, paid: false })),
    bankBalance: 0
  };
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
  render();
}

createMonthBtn.addEventListener("click", async () => {
  const prevId = addMonths(currentMonthId, -1);
  const prev = await fetchMonth(prevId);
  monthData = prev ? cloneForNewMonth(prev) : DEFAULT_TEMPLATE();
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

function renderIncome() {
  incomeList.innerHTML = "";
  monthData.income.forEach((row) => incomeList.appendChild(buildRow(row, "income")));
}

function renderExpenseGroups() {
  groupsContainer.innerHTML = "";
  GROUPS.forEach((group) => {
    const section = document.createElement("section");
    section.className = "card";
    section.innerHTML = `
      <div class="card-header">
        <h2>${group.label}</h2>
        <button type="button" class="add-row-btn" data-group="${group.key}">+ Ajouter</button>
      </div>
      <div class="rows" data-group-rows="${group.key}"></div>
    `;
    groupsContainer.appendChild(section);
    const rowsEl = section.querySelector(`[data-group-rows="${group.key}"]`);
    monthData.expenses.filter((e) => e.group === group.key).forEach((row) => rowsEl.appendChild(buildRow(row, "expense")));
  });

  groupsContainer.querySelectorAll(".add-row-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      monthData.expenses.push({ id: uid(), label: "Nouvelle ligne", amount: 0, paid: false, group: btn.dataset.group });
      renderExpenseGroups();
      renderTotals();
      scheduleSave();
    });
  });
}

function buildRow(row, kind) {
  const div = document.createElement("div");
  div.className = "row";
  div.innerHTML = `
    ${kind === "expense" ? `<input type="checkbox" class="paid-check" ${row.paid ? "checked" : ""} title="Payé" />` : ""}
    <input type="text" class="label-input" value="${escapeHtml(row.label)}" />
    <input type="number" class="amount-input" value="${row.amount}" step="0.01" />
    <button type="button" class="remove-row" title="Supprimer">✕</button>
  `;
  const labelInput = div.querySelector(".label-input");
  const amountInput = div.querySelector(".amount-input");
  const removeBtn = div.querySelector(".remove-row");
  const paidCheck = div.querySelector(".paid-check");

  labelInput.addEventListener("input", () => { row.label = labelInput.value; scheduleSave(); });
  amountInput.addEventListener("input", () => {
    row.amount = parseFloat(amountInput.value) || 0;
    renderTotals();
    scheduleSave();
  });
  if (paidCheck) {
    paidCheck.addEventListener("change", () => { row.paid = paidCheck.checked; renderTotals(); scheduleSave(); });
  }
  removeBtn.addEventListener("click", () => {
    if (kind === "income") {
      monthData.income = monthData.income.filter((r) => r.id !== row.id);
      renderIncome();
    } else {
      monthData.expenses = monthData.expenses.filter((r) => r.id !== row.id);
      renderExpenseGroups();
    }
    renderTotals();
    scheduleSave();
  });

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

  if (!monthData) {
    [totalIncomeEl, totalExpensesEl, balanceEl, chargesAVenirEl, resteAVivreEl, dailyAllocationEl].forEach((el) => el.textContent = euros(0));
    return;
  }
  const t = computeTotals(monthData);
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

// ---- Navigation mois ----
prevMonthBtn.addEventListener("click", () => loadMonth(addMonths(currentMonthId, -1)));
nextMonthBtn.addEventListener("click", () => loadMonth(addMonths(currentMonthId, 1)));

addIncomeBtn.addEventListener("click", () => {
  monthData.income.push({ id: uid(), label: "Nouvelle source", amount: 0 });
  renderIncome();
  renderTotals();
  scheduleSave();
});

// ---- Historique ----
async function renderHistory() {
  historyBody.innerHTML = `<tr><td colspan="7">Chargement…</td></tr>`;
  const months = (await fetchAllMonthsAsc()).reverse();
  historyBody.innerHTML = "";
  months.forEach(({ id, data }) => {
    const t = computeTotals(data);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${monthLabel(id)}</td>
      <td>${euros(t.totalIncome)}</td>
      <td>${euros(t.byGroup.regulieres)}</td>
      <td>${euros(t.byGroup.occasionnelles)}</td>
      <td>${euros(t.byGroup.capital)}</td>
      <td>${euros(t.totalExpenses)}</td>
      <td class="${t.balance < 0 ? "negative" : ""}">${euros(t.balance)}</td>
    `;
    historyBody.appendChild(tr);
  });
  if (!historyBody.children.length) {
    historyBody.innerHTML = `<tr><td colspan="7">Aucun mois enregistré pour l'instant.</td></tr>`;
  }
}

// ---- Prévisions annuelles (grille éditable sur 12 mois) ----
function forecastMonthIds() {
  const base = monthId(new Date());
  return Array.from({ length: 12 }, (_, i) => addMonths(base, i));
}

async function renderForecast() {
  forecastTable.innerHTML = `<tr><td>Chargement…</td></tr>`;
  const ids = forecastMonthIds();
  const docs = await Promise.all(ids.map(fetchMonth));
  const monthsByI = {};
  ids.forEach((id, i) => { monthsByI[id] = docs[i]; });

  // Base des lignes : le premier mois du champ qui a des données, sinon le template par défaut.
  const base = docs.find((d) => d) || DEFAULT_TEMPLATE();
  const incomeRows = base.income.map((r) => r.label);
  const expenseRowsByGroup = {};
  GROUPS.forEach((g) => { expenseRowsByGroup[g.key] = base.expenses.filter((e) => e.group === g.key).map((e) => e.label); });

  let html = "<thead><tr><th>Poste</th>";
  ids.forEach((id) => { html += `<th>${monthLabelShort(id)}</th>`; });
  html += "</tr></thead><tbody>";

  html += `<tr class="section-row"><td colspan="${ids.length + 1}">Revenus</td></tr>`;
  incomeRows.forEach((label) => { html += forecastRow(label, "income", null, ids, monthsByI); });
  html += forecastTotalRow("Sous-total revenus", ids, monthsByI, (t) => t.totalIncome);

  GROUPS.forEach((g) => {
    html += `<tr class="section-row"><td colspan="${ids.length + 1}">${g.label}</td></tr>`;
    expenseRowsByGroup[g.key].forEach((label) => { html += forecastRow(label, "expense", g.key, ids, monthsByI); });
    html += forecastTotalRow(`Sous-total ${g.label.toLowerCase()}`, ids, monthsByI, (t) => t.byGroup[g.key]);
  });

  html += forecastTotalRow("Total dépenses", ids, monthsByI, (t) => t.totalExpenses, true);
  html += forecastTotalRow("Reste à vivre", ids, monthsByI, (t) => t.balance, true);
  html += "</tbody>";
  forecastTable.innerHTML = html;

  forecastTable.querySelectorAll(".forecast-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const { monthIdAttr, label, kind, group } = input.dataset;
      const value = parseFloat(input.value) || 0;
      await setForecastValue(monthIdAttr, label, kind, group, value, monthsByI);
    });
  });
}

function forecastRow(label, kind, group, ids, monthsByI) {
  let row = `<tr><td>${escapeHtml(label)}</td>`;
  ids.forEach((id) => {
    const data = monthsByI[id];
    const list = kind === "income" ? data?.income : data?.expenses?.filter((e) => e.group === group);
    const item = list?.find((r) => r.label === label);
    const value = item ? item.amount : 0;
    row += `<td><input class="forecast-input" type="number" step="0.01" value="${value}"
      data-month-id-attr="${id}" data-label="${escapeAttr(label)}" data-kind="${kind}" data-group="${group || ""}" /></td>`;
  });
  return row + "</tr>";
}

function forecastTotalRow(label, ids, monthsByI, getValue, strong) {
  let row = `<tr class="${strong ? "total-row" : "subtotal-row"}"><td>${label}</td>`;
  ids.forEach((id) => {
    const data = monthsByI[id];
    const t = data ? computeTotals(data) : { totalIncome: 0, totalExpenses: 0, balance: 0, byGroup: { regulieres: 0, occasionnelles: 0, capital: 0 } };
    row += `<td>${euros(getValue(t))}</td>`;
  });
  return row + "</tr>";
}

async function setForecastValue(targetMonthId, label, kind, group, value, monthsByI) {
  let data = monthsByI[targetMonthId];
  if (!data) {
    // Crée le mois en clonant le mois disponible le plus proche dans la fenêtre, sinon le mois courant, sinon le template.
    const ids = forecastMonthIds();
    const idx = ids.indexOf(targetMonthId);
    let sourceData = null;
    for (let i = idx - 1; i >= 0 && !sourceData; i--) sourceData = monthsByI[ids[i]];
    if (!sourceData) sourceData = (await fetchMonth(currentMonthId)) || DEFAULT_TEMPLATE();
    data = cloneForNewMonth(sourceData);
    monthsByI[targetMonthId] = data;
  }
  const list = kind === "income" ? data.income : data.expenses;
  let item = list.find((r) => r.label === label && (kind === "income" || r.group === group));
  if (!item) {
    item = kind === "income" ? { id: uid(), label, amount: 0 } : { id: uid(), label, amount: 0, paid: false, group };
    list.push(item);
  }
  item.amount = value;
  await persistMonth(targetMonthId, { ...data, updatedAt: new Date().toISOString(), updatedBy: currentUser.email });
  await renderForecast();
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ---- Analyse budget (graphiques) ----
async function renderAnalyse() {
  analyseMonthLabel.textContent = monthLabel(currentMonthId);
  const data = monthData || await fetchMonth(currentMonthId);
  const t = data ? computeTotals(data) : { byGroup: { regulieres: 0, occasionnelles: 0, capital: 0 }, balance: 0, totalIncome: 0 };

  Object.values(charts).forEach((c) => c?.destroy());

  charts.pie = new Chart($("#chart-pie"), {
    type: "pie",
    data: {
      labels: ["Charges régulières", "Charges occasionnelles", "Capital et réserves", "Reste à vivre"],
      datasets: [{
        data: [t.byGroup.regulieres, t.byGroup.occasionnelles, t.byGroup.capital, Math.max(t.balance, 0)],
        backgroundColor: ["#dc2626", "#f59e0b", "#059669", "#2563eb"]
      }]
    },
    options: { plugins: { legend: { position: "bottom" } } }
  });

  const regulieres = (data?.expenses || []).filter((e) => e.group === "regulieres" && e.amount > 0);
  charts.bar = new Chart($("#chart-bar"), {
    type: "bar",
    data: {
      labels: regulieres.map((r) => r.label),
      datasets: [{ label: "Montant", data: regulieres.map((r) => r.amount), backgroundColor: "#2563eb" }]
    },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 30 } } } }
  });

  const months = await fetchAllMonthsAsc();
  let cumul = 0;
  const labels = [];
  const values = [];
  months.forEach(({ id, data: d }) => {
    const dt = computeTotals(d);
    cumul += dt.byGroup.capital;
    labels.push(monthLabelShort(id));
    values.push(cumul);
  });
  charts.line = new Chart($("#chart-line"), {
    type: "line",
    data: { labels, datasets: [{ label: "Épargne cumulée", data: values, borderColor: "#2563eb", tension: 0.3 }] },
    options: { plugins: { legend: { display: false } } }
  });
}
