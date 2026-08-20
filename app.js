import { firebaseConfig, AUTHORIZED_EMAILS } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const GROUPS = [
  { key: "fixes", label: "Dépenses fixes" },
  { key: "courantes", label: "Dépenses courantes" },
  { key: "occasionnelles", label: "Dépenses occasionnelles" },
  { key: "epargne", label: "Épargne du mois" }
];

const DEFAULT_TEMPLATE = () => ({
  income: [
    { id: uid(), label: "Salaire", amount: 0 },
    { id: uid(), label: "Salaire conjoint", amount: 0 },
    { id: uid(), label: "Autres revenus", amount: 0 }
  ],
  expenses: [
    { id: uid(), label: "Logement", amount: 0, paid: false, group: "fixes" },
    { id: uid(), label: "Assurance habitation", amount: 0, paid: false, group: "fixes" },
    { id: uid(), label: "Assurance voiture", amount: 0, paid: false, group: "fixes" },
    { id: uid(), label: "Banque", amount: 0, paid: false, group: "fixes" },
    { id: uid(), label: "Impôts", amount: 0, paid: false, group: "fixes" },
    { id: uid(), label: "TV / Internet", amount: 0, paid: false, group: "fixes" },
    { id: uid(), label: "Téléphone mobile", amount: 0, paid: false, group: "fixes" },
    { id: uid(), label: "Scolarité", amount: 0, paid: false, group: "fixes" },
    { id: uid(), label: "EDF, GDF, eau", amount: 0, paid: false, group: "fixes" },
    { id: uid(), label: "Charges copropriété", amount: 0, paid: false, group: "fixes" },
    { id: uid(), label: "Entretien voiture", amount: 0, paid: false, group: "fixes" },
    { id: uid(), label: "Alimentation, hygiène", amount: 0, paid: false, group: "courantes" },
    { id: uid(), label: "Transports, essence", amount: 0, paid: false, group: "courantes" },
    { id: uid(), label: "Culture, sports, loisirs", amount: 0, paid: false, group: "courantes" },
    { id: uid(), label: "Santé (non remboursé)", amount: 0, paid: false, group: "courantes" },
    { id: uid(), label: "Habillement", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Vacances", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Équipement divers", amount: 0, paid: false, group: "occasionnelles" },
    { id: uid(), label: "Épargne", amount: 0, paid: false, group: "epargne" }
  ],
  savings: { disponible: 0, depots: 0, retraits: 0 }
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

function addMonths(id, delta) {
  const [y, m] = id.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthId(d);
}

function daysInMonth(id) {
  const [y, m] = id.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function euros(n) {
  return (n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

// ---- State ----
let currentUser = null;
let currentMonthId = monthId(new Date());
let monthData = null;
let saveTimeout = null;

// ---- DOM ----
const $ = (sel) => document.querySelector(sel);
const loginScreen = $("#login-screen");
const deniedScreen = $("#denied-screen");
const appScreen = $("#app-screen");
const loginBtn = $("#login-btn");
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
const dailyAllocationEl = $("#daily-allocation");
const savingsDisponibleEl = $("#savings-disponible");
const savingsDepotsEl = $("#savings-depots");
const savingsRetraitsEl = $("#savings-retraits");
const savingsTotalEl = $("#savings-total");
const emptyMonthBanner = $("#empty-month-banner");
const createMonthBtn = $("#create-month-btn");
const historyBtn = $("#history-btn");
const historyScreen = $("#history-screen");
const historyBody = $("#history-body");
const backToMonthBtn = $("#back-to-month");

// ---- Auth ----
loginBtn.addEventListener("click", () => signInWithRedirect(auth, provider).catch((e) => {
  alert("Connexion impossible : " + e.message);
}));
logoutBtn.addEventListener("click", () => signOut(auth));
deniedLogoutBtn.addEventListener("click", () => signOut(auth));

getRedirectResult(auth).catch((e) => {
  if (e.code !== "auth/no-auth-event") console.error(e);
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  loginScreen.classList.add("hidden");
  deniedScreen.classList.add("hidden");
  appScreen.classList.add("hidden");

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
  appScreen.classList.remove("hidden");
  await loadMonth(currentMonthId);
});

// ---- Firestore ----
async function fetchMonth(id) {
  const snap = await getDoc(doc(db, "months", id));
  return snap.exists() ? snap.data() : null;
}

async function saveMonth() {
  if (!monthData) return;
  saveStatus.textContent = "Enregistrement…";
  try {
    await setDoc(doc(db, "months", currentMonthId), {
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

async function loadMonth(id) {
  currentMonthId = id;
  monthTitle.textContent = monthLabel(id);
  monthData = await fetchMonth(id);
  emptyMonthBanner.classList.toggle("hidden", !!monthData);
  if (!monthData) {
    groupsContainer.innerHTML = "";
    incomeList.innerHTML = "";
    updateTotals();
    return;
  }
  render();
}

createMonthBtn.addEventListener("click", async () => {
  const prevId = addMonths(currentMonthId, -1);
  const prev = await fetchMonth(prevId);
  if (prev) {
    monthData = {
      income: prev.income.map((r) => ({ ...r })),
      expenses: prev.expenses.map((r) => ({ ...r, paid: false })),
      savings: {
        disponible: (prev.savings.disponible || 0) + (prev.savings.depots || 0) - (prev.savings.retraits || 0),
        depots: 0,
        retraits: 0
      }
    };
  } else {
    monthData = DEFAULT_TEMPLATE();
  }
  emptyMonthBanner.classList.add("hidden");
  render();
  await saveMonth();
});

// ---- Render ----
function render() {
  renderIncome();
  renderExpenses();
  renderSavings();
  updateTotals();
}

function renderIncome() {
  incomeList.innerHTML = "";
  monthData.income.forEach((row) => {
    incomeList.appendChild(buildRow(row, "income"));
  });
}

function renderExpenses() {
  groupsContainer.innerHTML = "";
  GROUPS.forEach((group) => {
    const section = document.createElement("section");
    section.className = "card";
    const rows = monthData.expenses.filter((e) => e.group === group.key);
    section.innerHTML = `
      <div class="card-header">
        <h2>${group.label}</h2>
        <button type="button" class="add-row-btn" data-group="${group.key}">+ Ajouter</button>
      </div>
      <div class="rows" data-group-rows="${group.key}"></div>
    `;
    groupsContainer.appendChild(section);
    const rowsEl = section.querySelector(`[data-group-rows="${group.key}"]`);
    rows.forEach((row) => rowsEl.appendChild(buildRow(row, "expense")));
  });

  groupsContainer.querySelectorAll(".add-row-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = { id: uid(), label: "Nouvelle ligne", amount: 0, paid: false, group: btn.dataset.group };
      monthData.expenses.push(row);
      renderExpenses();
      updateTotals();
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
    updateTotals();
    scheduleSave();
  });
  if (paidCheck) {
    paidCheck.addEventListener("change", () => { row.paid = paidCheck.checked; scheduleSave(); });
  }
  removeBtn.addEventListener("click", () => {
    if (kind === "income") {
      monthData.income = monthData.income.filter((r) => r.id !== row.id);
      renderIncome();
    } else {
      monthData.expenses = monthData.expenses.filter((r) => r.id !== row.id);
      renderExpenses();
    }
    updateTotals();
    scheduleSave();
  });

  return div;
}

function renderSavings() {
  savingsDisponibleEl.value = monthData.savings.disponible;
  savingsDepotsEl.value = monthData.savings.depots;
  savingsRetraitsEl.value = monthData.savings.retraits;

  [savingsDisponibleEl, savingsDepotsEl, savingsRetraitsEl].forEach((el) => {
    el.oninput = () => {
      monthData.savings.disponible = parseFloat(savingsDisponibleEl.value) || 0;
      monthData.savings.depots = parseFloat(savingsDepotsEl.value) || 0;
      monthData.savings.retraits = parseFloat(savingsRetraitsEl.value) || 0;
      updateTotals();
      scheduleSave();
    };
  });
}

function updateTotals() {
  if (!monthData) {
    totalIncomeEl.textContent = euros(0);
    totalExpensesEl.textContent = euros(0);
    balanceEl.textContent = euros(0);
    dailyAllocationEl.textContent = euros(0);
    savingsTotalEl.textContent = euros(0);
    return;
  }
  const totalIncome = monthData.income.reduce((s, r) => s + (r.amount || 0), 0);
  const totalExpenses = monthData.expenses.reduce((s, r) => s + (r.amount || 0), 0);
  const balance = totalIncome - totalExpenses;

  totalIncomeEl.textContent = euros(totalIncome);
  totalExpensesEl.textContent = euros(totalExpenses);
  balanceEl.textContent = euros(balance);
  balanceEl.classList.toggle("negative", balance < 0);

  const today = new Date();
  const isCurrentMonth = currentMonthId === monthId(today);
  const remainingDays = isCurrentMonth
    ? Math.max(1, daysInMonth(currentMonthId) - today.getDate() + 1)
    : daysInMonth(currentMonthId);
  dailyAllocationEl.textContent = euros(balance / remainingDays);
  dailyAllocationEl.classList.toggle("negative", balance < 0);

  const totalSavings = (monthData.savings.disponible || 0) + (monthData.savings.depots || 0) - (monthData.savings.retraits || 0);
  savingsTotalEl.textContent = euros(totalSavings);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- Navigation ----
prevMonthBtn.addEventListener("click", () => loadMonth(addMonths(currentMonthId, -1)));
nextMonthBtn.addEventListener("click", () => loadMonth(addMonths(currentMonthId, 1)));

addIncomeBtn.addEventListener("click", () => {
  monthData.income.push({ id: uid(), label: "Nouvelle source", amount: 0 });
  renderIncome();
  updateTotals();
  scheduleSave();
});

// ---- History ----
historyBtn.addEventListener("click", async () => {
  appScreen.classList.add("hidden");
  historyScreen.classList.remove("hidden");
  historyBody.innerHTML = `<tr><td colspan="4">Chargement…</td></tr>`;
  const snap = await getDocs(query(collection(db, "months"), orderBy("__name__", "desc")));
  historyBody.innerHTML = "";
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const totalIncome = data.income.reduce((s, r) => s + (r.amount || 0), 0);
    const totalExpenses = data.expenses.reduce((s, r) => s + (r.amount || 0), 0);
    const balance = totalIncome - totalExpenses;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${monthLabel(docSnap.id)}</td>
      <td>${euros(totalIncome)}</td>
      <td>${euros(totalExpenses)}</td>
      <td class="${balance < 0 ? "negative" : ""}">${euros(balance)}</td>
    `;
    historyBody.appendChild(tr);
  });
  if (!historyBody.children.length) {
    historyBody.innerHTML = `<tr><td colspan="4">Aucun mois enregistré pour l'instant.</td></tr>`;
  }
});

backToMonthBtn.addEventListener("click", () => {
  historyScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
});
