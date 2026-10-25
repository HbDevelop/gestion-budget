// Onglet « Études » : bilan de l'activité de cours (postes à séances) d'une personne depuis
// son démarrage. Affichage seulement (DOM + Chart.js global) : les chiffres viennent de
// statsActivite (seances.js). Pas de Firebase ici : app.js lit les mois et appelle renderEtudes.

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const COULEURS = { virement: "#2563eb", especes: "#d97706", accent: "#7c3aed" };

let charts = [];

// Couleur d'avatar stable par élève (teinte dérivée de son identifiant).
export function eleveHue(id) {
  let h = 0;
  for (const c of String(id || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  // Angle d'or : deux identifiants proches donnent quand même des teintes bien distinctes.
  return Math.round((h * 137.508) % 360);
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const euros = (n, dec = true) => (n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: dec ? 2 : 0 });
const pct = (x) => `${Math.round(x * 100)} %`;
const plur = (n, mot, pl = mot + "s") => `${n.toLocaleString("fr-FR")} ${n > 1 ? pl : mot}`;
const moisDate = (id) => { const [y, m] = id.split("-").map(Number); return new Date(y, m - 1, 1); };
const moisLong = (id) => moisDate(id).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const moisCourt = (id) => moisDate(id).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
const jourDate = (d) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const dateCourte = (d) => jourDate(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" });
const dateLongue = (d) => {
  const j = jourDate(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return `${j.charAt(0).toUpperCase()}${j.slice(1)} à ${+d.slice(11, 13)}h${d.slice(14, 16) === "00" ? "" : d.slice(14, 16)}`;
};
const heure = (h) => `${h} h`;

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function avatar(e) {
  const lettre = (e.nom || "?").trim().charAt(0).toUpperCase() || "?";
  return `<span class="sx-av" style="--h:${eleveHue(e.eleveId)}">${esc(lettre)}</span>`;
}

// `root` : conteneur vide ; `stats` : statsActivite(...) ou null ; `label` : nom du poste.
export function renderEtudes(root, stats, { label = "Études", maintenant } = {}) {
  charts.forEach((c) => c.destroy());
  charts = [];
  root.innerHTML = "";
  if (!stats) {
    root.appendChild(el("section", "card et-empty",
      `<span class="et-empty-icon" aria-hidden="true">🎓</span><b>Pas encore d'activité enregistrée</b>` +
      `<p>Le bilan apparaîtra ici dès la première séance (Suivi du mois → ${esc(label)}).</p>`));
    return;
  }
  root.append(
    hero(stats, label),
    titre("Mois par mois"),
    moisParMois(stats, maintenant),
    titre("Paiements et fiabilité"),
    grille(modesPaiement(stats), fiabilite(stats)),
    titre("Élèves"),
    elevesCard(stats),
    titre("Rythme et séances à venir"),
    grille(rythme(stats), aVenir(stats))
  );
}

function titre(t) { return el("h3", "analyse-section-title", t); }
function grille(...cards) {
  const g = el("div", "charts-grid");
  g.append(...cards);
  return g;
}

// En-tête : depuis quand, puis les quatre chiffres clés.
function hero(st, label) {
  const t = st.totaux;
  const actifs = st.eleves.filter((e) => e.statut === "actif").length;
  const total = st.eleves.filter((e) => e.passees > 0 || e.statut !== "supprime").length;
  const card = el("section", "card et-hero");
  card.innerHTML =
    `<div class="et-hero-head">` +
      `<span class="et-hero-icon" aria-hidden="true">🎓</span>` +
      `<div><h3>${esc(label)}</h3>` +
      `<p>Depuis <b>${moisLong(st.debut)}</b> · ${plur(st.nbMois, "mois", "mois")} d'activité` +
      (st.debutSeances ? ` · séances suivies depuis le ${dateCourte(st.debutSeances)}` : "") + `</p></div>` +
    `</div>` +
    `<div class="et-kpis">` +
      kpi("Total encaissé", euros(t.encaisse, false),
        t.especes ? `dont ${euros(t.especes, false)} en espèces` : "tout en virement", "et-kpi-main") +
      kpi("Séances faites", t.faites.toLocaleString("fr-FR"),
        st.aVenir.nombre ? `+ ${plur(st.aVenir.nombre, "prévue")}` : "aucune prévue") +
      kpi("Prix moyen", t.prixMoyen == null ? "—" : euros(t.prixMoyen), "par séance faite") +
      kpi("Par mois", t.moyenneMois == null ? "—" : euros(t.moyenneMois, false), "en moyenne, mois terminés") +
    `</div>` +
    `<p class="et-hero-foot">👥 ${plur(actifs, "élève actif", "élèves actifs")}` +
      (total > actifs ? ` · ${plur(total, "élève suivi", "élèves suivis")} au total` : "") + `</p>`;
  return card;
}

function kpi(label, value, sub, cls = "") {
  return `<div class="et-kpi ${cls}"><span class="et-kpi-label">${label}</span><b class="et-kpi-value">${value}</b><small>${sub}</small></div>`;
}

// Barres empilées : virement + espèces reçus chaque mois, puis ce qui reste à encaisser
// (séances non payées, passées ou prévues) en clair ; ligne = séances faites.
function moisParMois(st, maintenant) {
  const card = el("section", "card chart-card et-chart",
    `<h3>Argent reçu et séances faites</h3><p class="et-note">En clair : séances pas encore payées (impayés des mois passés, séances prévues).</p>`);
  const wrap = el("div", "et-canvas");
  const canvas = el("canvas");
  wrap.appendChild(canvas);
  card.appendChild(wrap);
  const cur = maintenant ? maintenant.slice(0, 7) : null;
  const m = st.mois;
  const debutSeances = st.debutSeances ? st.debutSeances.slice(0, 7) : "9999-99";
  queueMicrotask(() => charts.push(new Chart(canvas, {
    data: {
      labels: m.map((x) => moisCourt(x.id)),
      datasets: [
        { type: "bar", label: "Virement", data: m.map((x) => x.virement), backgroundColor: COULEURS.virement, stack: "e", borderRadius: 3, order: 2 },
        { type: "bar", label: "Espèces", data: m.map((x) => x.especes), backgroundColor: COULEURS.especes, stack: "e", borderRadius: 3, order: 2 },
        {
          type: "bar", label: "À encaisser", data: m.map((x) => x.aEncaisser), stack: "e", order: 2, borderRadius: 3,
          backgroundColor: "rgba(124, 58, 237, 0.14)", borderColor: "rgba(124, 58, 237, 0.55)", borderWidth: 1, borderDash: [3, 3]
        },
        {
          // Pas de point avant le suivi des séances (mois saisis à la main) ni après ce mois-ci.
          type: "line", label: "Séances faites", yAxisID: "y2", order: 1,
          data: m.map((x) => (x.id < debutSeances || (cur && x.id > cur) ? null : x.faites)),
          borderColor: COULEURS.accent, backgroundColor: COULEURS.accent, tension: 0.3, borderWidth: 2,
          pointRadius: m.map((x) => (x.id === cur ? 5 : 3)), pointBackgroundColor: "#fff", pointBorderWidth: 2
        }
      ]
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            filter: (c) => c.raw != null && (c.dataset.yAxisID === "y2" || c.raw > 0),
            label: (c) => c.dataset.yAxisID === "y2" ?` ${plur(c.raw, "séance faite", "séances faites")}` : ` ${c.dataset.label} : ${euros(c.raw)}`,
            footer: (items) => {
              const x = m[items[0].dataIndex];
              const recu = x.virement + x.especes;
              return [recu ? `Reçu : ${euros(recu)}` : "", x.annulees ? plur(x.annulees, "annulée") : ""].filter(Boolean).join(" · ");
            }
          }
        }
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => euros(v, false) }, grid: { color: "#f1f2f4" } },
        y2: { position: "right", beginAtZero: true, grid: { display: false }, ticks: { precision: 0, color: COULEURS.accent } }
      }
    }
  })));
  return card;
}

// Anneau virement / espèces sur toute la période.
function modesPaiement(st) {
  const { virement, especes, encaisse } = st.totaux;
  const card = el("section", "card chart-card et-modes", `<h3>Virement ou espèces</h3>`);
  if (!encaisse) {
    card.appendChild(el("p", "et-muted", "Rien d'encaissé pour l'instant."));
    return card;
  }
  const wrap = el("div", "et-ring");
  const canvas = el("canvas");
  wrap.append(canvas, el("div", "et-ring-center", `<small>Encaissé</small><b>${euros(encaisse, false)}</b>`));
  card.appendChild(wrap);
  const ligne = (cls, nom, v) =>
    `<li><i class="${cls}"></i><span>${nom}</span><b>${euros(v, false)}</b><small>${pct(v / encaisse)}</small></li>`;
  card.appendChild(el("ul", "et-legend", ligne("lg-vir", "Virement", virement) + ligne("lg-esp", "Espèces", especes)));
  queueMicrotask(() => charts.push(new Chart(canvas, {
    type: "doughnut",
    data: { labels: ["Virement", "Espèces"], datasets: [{ data: [virement, especes], backgroundColor: [COULEURS.virement, COULEURS.especes], borderWidth: 2, borderColor: "#fff" }] },
    options: {
      cutout: "70%", maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.label} : ${euros(c.raw)} (${pct(c.raw / encaisse)})` } } }
    }
  })));
  return card;
}

// Annulations, impayés, délai de paiement, séances passées pas encore traitées.
function fiabilite(st) {
  const f = st.fiabilite;
  const card = el("section", "card et-fiab", `<h3>Fiabilité</h3>`);
  const taux = f.tauxAnnulation;
  const niveau = taux == null ? "" : taux <= 0.1 ? "ok" : taux <= 0.2 ? "warn" : "bad";
  const delai = f.delaiMoyen;
  const delaiTxt = delai == null ? "—"
    : delai <= 0.5 ? "le jour même"
      : `${delai.toLocaleString("fr-FR")} jour${delai >= 2 ? "s" : ""}`;
  card.innerHTML += metric("Annulations", taux == null ? "—" : pct(taux), niveau,
    taux == null ? "Aucune séance passée" : `${plur(f.annulees, "séance annulée", "séances annulées")} sur ${plur(f.passees, "passée", "passées")}`,
    taux == null ? "" : `<span class="et-meter"><i style="width:${Math.min(100, taux * 100)}%"></i></span>`);
  card.innerHTML += f.impayes.nombre
    ? metric("Reste à encaisser", euros(f.impayes.total), "warn", `${plur(f.impayes.nombre, "séance passée", "séances passées")} pas encore payée${f.impayes.nombre > 1 ? "s" : ""}`)
    : metric("Reste à encaisser", "0 €", "ok", "Tout est payé ✓");
  card.innerHTML += metric("Délai de paiement", delaiTxt, "", delai == null ? "Aucun paiement encore" : "en moyenne, entre la séance et le paiement");
  if (f.aTraiter) {
    card.innerHTML += `<p class="et-hint">⚠️ ${plur(f.aTraiter, "séance passée", "séances passées")} encore « prévue${f.aTraiter > 1 ? "s" : ""} » : à marquer faite${f.aTraiter > 1 ? "s" : ""} ou annulée${f.aTraiter > 1 ? "s" : ""} dans le Suivi.</p>`;
  }
  return card;
}

function metric(label, value, niveau, sub, extra = "") {
  return `<div class="et-metric ${niveau ? "is-" + niveau : ""}"><span class="et-metric-label">${label}</span>` +
    `<b class="et-metric-value">${value}</b>${extra}<small>${sub}</small></div>`;
}

// Un élève par ligne (cartes sur téléphone), du plus gros total payé au plus petit.
function elevesCard(st) {
  const card = el("section", "card et-eleves");
  const liste = st.eleves.filter((e) => e.passees > 0 || e.prochaine || e.statut !== "supprime");
  if (!liste.length) {
    card.appendChild(el("p", "et-muted", "Aucun élève pour l'instant."));
    return card;
  }
  const max = Math.max(...liste.map((e) => e.paye), 1);
  card.innerHTML =
    `<div class="et-row et-head"><span>Élève</span><span>Séances</span><span>Payé</span><span>Reste dû</span><span>Annulées</span><span>Période</span></div>` +
    liste.map((e) => {
      const chip = e.statut === "actif" ? "" : `<span class="et-chip et-chip-${e.statut}">${e.statut === "supprime" ? "supprimé" : "inactif"}</span>`;
      const periode = e.premiere
        ? `${dateCourte(e.premiere)} → ${e.prochaine ? "en cours" : dateCourte(e.derniere)}`
        : e.prochaine ? "pas encore commencé" : "aucune séance";
      const prochaine = e.prochaine ? `<small>Prochaine : ${dateCourte(e.prochaine)}</small>` : "";
      return `<div class="et-row${e.statut === "actif" ? "" : " is-off"}">` +
        `<span class="et-who">${avatar(e)}<b>${esc(e.nom)}</b>${chip}</span>` +
        `<span data-label="Séances">${e.faites}</span>` +
        `<span data-label="Payé" class="et-paye"><b>${euros(e.paye, false)}</b><span class="et-bar"><i style="width:${(e.paye / max) * 100}%"></i></span></span>` +
        `<span data-label="Reste dû" class="${e.impaye ? "et-du" : "et-ok"}">${e.impaye ? euros(e.impaye) : "—"}</span>` +
        `<span data-label="Annulées">${e.tauxAnnulation == null ? "—" : `${e.annulees} <small>(${pct(e.tauxAnnulation)})</small>`}</span>` +
        `<span data-label="Période" class="et-periode">${periode}${prochaine}</span>` +
      `</div>`;
    }).join("");
  return card;
}

// Carte de chaleur jours × heures des séances (non annulées, passées et prévues).
function rythme(st) {
  const card = el("section", "card et-rythme", `<h3>Rythme de la semaine</h3>`);
  const { grille, top } = st.rythme;
  if (!top.length) {
    card.appendChild(el("p", "et-muted", "Pas encore de séance."));
    return card;
  }
  const heures = [];
  grille.forEach((h) => h.forEach((n, i) => { if (n) heures.push(i); }));
  let h0 = Math.min(...heures), h1 = Math.max(...heures);
  while (h1 - h0 < 3) { if (h0 > 0) h0 -= 1; if (h1 - h0 < 3 && h1 < 23) h1 += 1; }
  const max = Math.max(...grille.flat());
  const cols = h1 - h0 + 1;
  const t = top[0];
  card.appendChild(el("p", "et-rythme-lead",
    `Surtout le <b>${JOURS[t.jour].toLowerCase()} vers ${heure(t.heure)}</b>` +
    (top[1] ? `, puis le ${JOURS[top[1].jour].toLowerCase()} vers ${heure(top[1].heure)}` : "") + "."));
  const g = el("div", "et-heat");
  g.style.setProperty("--cols", cols);
  let html = `<span></span>`;
  for (let h = h0; h <= h1; h++) html += `<span class="et-heat-h">${h}h</span>`;
  JOURS.forEach((j, ji) => {
    html += `<span class="et-heat-j">${j.slice(0, 3)}</span>`;
    for (let h = h0; h <= h1; h++) {
      const n = grille[ji][h];
      html += `<span class="et-cell${n ? "" : " is-zero"}" style="--a:${n ? 0.15 + 0.85 * (n / max) : 0}" title="${j} ${heure(h)} : ${plur(n, "séance")}">${n || ""}</span>`;
    }
  });
  g.innerHTML = html;
  card.appendChild(g);
  return card;
}

// Prochaine séance, total attendu, et séances prévues par mois.
function aVenir(st) {
  const a = st.aVenir;
  const card = el("section", "card et-avenir", `<h3>Déjà programmé</h3>`);
  if (!a.nombre) {
    card.appendChild(el("p", "et-muted", "Aucune séance programmée pour la suite."));
    return card;
  }
  const max = Math.max(...a.parMois.map((m) => m.total), 1);
  card.innerHTML +=
    `<div class="et-next"><small>Prochaine séance</small><b>${esc(dateLongue(a.prochaine.date))}</b>` +
      `<span>${esc(a.prochaine.nom)} · ${euros(a.prochaine.prix)}</span></div>` +
    `<p class="et-avenir-total"><b>${plur(a.nombre, "séance prévue", "séances prévues")}</b> · ${euros(a.total, false)} attendus</p>` +
    `<ul class="et-avenir-mois">` + a.parMois.map((m) =>
      `<li><span>${moisLong(m.id)}</span><span class="et-bar"><i style="width:${(m.total / max) * 100}%"></i></span>` +
      `<b>${euros(m.total, false)}</b><small>${plur(m.nombre, "séance")}</small></li>`).join("") +
    `</ul>`;
  return card;
}
