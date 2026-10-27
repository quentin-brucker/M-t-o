// ---------------------------------------------------------------------------
// Bouton « Actualiser maintenant » de la page des villes.
// La page va chercher la météo d'Environnement Canada directement dans le
// navigateur, refait les cartes et prépare un PDF du jour à jour.
// Ce fichier n'est pas réécrit par le robot du matin.
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  const API = id => `https://api.weather.gc.ca/collections/citypageweather-realtime/items/${id}?f=json&lang=fr`;
  const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const VILLES_DEFAUT = { "Québec": [
    ["qc-144", "Alma"], ["qc-160", "Baie-Comeau"], ["qc-d4", "Chandler"], ["qc-64", "Dolbeau-Mistassini"], ["qc-2", "Drummondville"],
    ["qc-126", "Gatineau"], ["qc-47", "Mont-Laurier"], ["qc-147", "Montréal"], ["qc-133", "Québec"], ["qc-138", "Rimouski"],
    ["qc-148", "Rouyn-Noranda"], ["qc-166", "Saguenay (Jonquière)"], ["qc-b6", "Saint-Georges"], ["qc-141", "Sept-Îles"],
    ["qc-136", "Sherbrooke"], ["qc-130", "Trois-Rivières"], ["qc-157", "Victoriaville"], ["qc-149", "Val-d'Or"]] };

  const dateLongue = d => `${JOURS[d.getDay()]} ${d.getDate()}${d.getDate() === 1 ? "er" : ""} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
  const deux = n => String(n).padStart(2, "0");
  const memeJour = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

  // ----------------------------- lecture des données (comme le robot) -----
  function fr(obj, ...chemin) {
    for (const c of chemin) { if (!obj || typeof obj !== "object") return null; obj = obj[c]; }
    if (obj && typeof obj === "object" && ("fr" in obj || "en" in obj)) return obj.fr ?? obj.en;
    return obj ?? null;
  }
  function tempDe(periode, classe) {
    for (const t of (fr(periode, "temperatures") || {}).temperature || []) if (fr(t, "class") === classe) return fr(t, "value");
    return null;
  }
  function probPrecip(p) {
    let pop = fr(p, "abbreviatedForecast", "pop");
    if (pop && typeof pop === "object") pop = fr(pop, "value");
    if (pop !== null && pop !== "") return pop;
    const m = /(\d+)\s*pour\s*cent/.exec(fr(p, "cloudPrecip") || "");
    return m ? +m[1] : null;
  }
  function resume(p) {
    if (!p) return null;
    return { nom: fr(p, "period", "textForecastName"), conditions: fr(p, "abbreviatedForecast", "textSummary"),
             icone: fr(p, "abbreviatedForecast", "icon", "url"), code: fr(p, "abbreviatedForecast", "icon", "value"),
             max: tempDe(p, "high"), min: tempDe(p, "low"), pop: probPrecip(p) };
  }
  function heure(iso) { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : `${deux(d.getHours())}:${deux(d.getMinutes())}`; }
  function extraire(id, nom, brut) {
    const base = { id, nom, ok: false, lien: "https://meteo.gc.ca/fr/location/index.html" };
    if (!brut) return base;
    const p = brut.properties || {}, cc = p.currentConditions || {}, prev = (p.forecastGroup || {}).forecasts || [];
    base.lien = fr(p, "url") || base.lien;
    let jour = null, nuit = null;
    if (prev.length) { if (tempDe(prev[0], "high") != null) { jour = prev[0]; nuit = prev[1] || null; } else nuit = prev[0]; }
    const normales = {};
    for (const t of ((p.forecastGroup || {}).regionalNormals || {}).temperature || []) normales[fr(t, "class")] = fr(t, "value");
    return Object.assign(base, {
      ok: true,
      actuel: { temp: fr(cc, "temperature", "value"), conditions: fr(cc, "condition") },
      jour: resume(jour), nuit: resume(nuit),
      normales: { max: normales.high ?? null, min: normales.low ?? null },
      alertes: (p.warnings || []).map(a => ({ titre: fr(a, "description"), niveau: fr(a, "alertColourLevel"), lien: fr(a, "url") })),
      lever: heure(fr(p, "riseSet", "sunrise")), coucher: heure(fr(p, "riseSet", "sunset")),
    });
  }
  async function telecharger(id) {
    for (let essai = 0; essai < 3; essai++) {
      try { const r = await fetch(API(id), { cache: "no-store" }); if (!r.ok) throw new Error(r.status); return await r.json(); }
      catch (e) { if (essai === 2) return null; await new Promise(res => setTimeout(res, 1500 * (essai + 1))); }
    }
  }

  // ----------------------------- règles d'emballage (mêmes que le robot) --
  const emballageLocal = j => j == null ? null : (j <= 0 ? "Hybride" : "Été");
  const emballage24h = (j, n) => (j == null || n == null) ? null : (n <= -10 || j < -5) ? "Hiver" : (j <= 0 || n <= 0) ? "Hybride" : "Été";
  const COULEURS = { "Été": ["#fde7b0", "#7a4b00"], "Hybride": ["#d4efd6", "#1d6331"], "Hiver": ["#d3e5fb", "#17457e"] };
  const nombre = v => { const f = parseFloat(v); return isNaN(f) ? null : f; };
  function deg(v) {
    if (v == null || v === "") return "—";
    const f = parseFloat(v); if (isNaN(f)) return `${v}°`;
    return Math.abs(f - Math.round(f)) < 0.05 ? `${Math.round(f)}°` : `${f.toFixed(1).replace(".", ",")}°`;
  }

  // ----------------------------- cartes de la page ------------------------
  function carte(v) {
    if (!v.ok) return `<article class="carte"><h3>${esc(v.nom)}</h3><p class="muet">Données indisponibles</p></article>`;
    const j = v.jour, n = v.nuit, ic = (j || n || {}).icone;
    const img = typeof ic === "string" && ic.startsWith("https://") ? `<img src="${esc(ic)}" alt="" width="45" height="38" loading="lazy" onerror="this.remove()">` : "";
    const alertes = v.alertes.map(a => `<a class="alerte ${esc(a.niveau || "")}" href="${esc(a.lien || v.lien)}" target="_blank" rel="noopener">⚠ ${esc(a.titre || "Alerte")}</a>`).join("");
    const ligne = (label, per, cle) => !per
      ? `<div class="per"><span class="lbl">${label}</span><span class="muet">Période terminée</span></div>`
      : `<div class="per"><span class="lbl">${label}</span><strong class="t">${deg(per[cle])}</strong><span>${esc(per.conditions || "—")}${per.pop != null && per.pop !== "" ? ` · ${per.pop} % précip.` : ""}</span></div>`;
    return `<article class="carte">
  <header><h3><a href="${esc(v.lien)}" target="_blank" rel="noopener">${esc(v.nom)}</a></h3>${img}</header>
  <p class="actuel">Maintenant : <strong>${deg(v.actuel.temp)}</strong> ${esc(v.actuel.conditions || "")}</p>
  ${ligne("Jour", j, "max")}
  ${ligne("Nuit", n, "min")}
  <p class="muet">Normales ${deg(v.normales.max)} / ${deg(v.normales.min)} · Soleil ${v.lever || "—"}–${v.coucher || "—"}</p>
  ${alertes}
</article>`;
  }

  // ----------------------------- icônes (mêmes dessins que le PDF du matin)
  const PLUIE = new Set([6, 11, 12, 13, 28, 36]), NEIGE = new Set([8, 16, 17, 18, 25, 26, 38, 40]);
  const MIXTE = new Set([7, 14, 15, 27, 37]), ORAGE = new Set([9, 19, 39, 41, 42, 46, 47, 48]), BRUME = new Set([23, 24, 44, 45]);
  const cacheIcones = {};
  function icone(code, nuitDemandee) {
    code = parseInt(code, 10);
    if (isNaN(code)) return null;
    const cle = code + (nuitDemandee ? "n" : "j");
    if (cacheIcones[cle]) return cacheIcones[cle];
    const t = 96, cv = document.createElement("canvas"); cv.width = cv.height = t;
    const c = cv.getContext("2d"); c.translate(0, t); c.scale(1, -1);
    const cercle = (x, y, r, remplir, contour) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); if (remplir) { c.fillStyle = remplir; c.fill(); } if (contour) { c.strokeStyle = contour; c.stroke(); } };
    const ligne = (x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
    const soleil = (x, y, r) => {
      c.strokeStyle = "#f39200"; c.lineWidth = r * 0.16; c.lineCap = "round";
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ligne(x + Math.cos(a) * r * 1.3, y + Math.sin(a) * r * 1.3, x + Math.cos(a) * r * 1.75, y + Math.sin(a) * r * 1.75); }
      c.lineWidth = r * 0.08; cercle(x, y, r, "#f9b233", "#f39200");
    };
    const lune = (x, y, r) => {
      cercle(x, y, r * 1.55, "#1b2a4a"); cercle(x + r * 0.15, y, r * 0.95, "#fff4c2"); cercle(x - r * 0.35, y + r * 0.2, r * 0.85, "#1b2a4a");
      for (const [dx, dy, s] of [[-0.9, -0.55, 0.09], [-0.55, 0.95, 0.07], [0.25, -1.05, 0.06], [-1.15, 0.3, 0.06]]) cercle(x + dx * r, y + dy * r, r * s, "#ffffff");
    };
    const nuage = (x, y, w, gris) => {
      const fond = gris ? "#b9c3ce" : "#dfe5ec", h = w * 0.36, r = h / 2;
      c.lineWidth = w * 0.03; c.strokeStyle = "#9aa7b6"; c.fillStyle = fond;
      c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
      c.lineTo(x + r, y + h); c.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); c.closePath(); c.fill(); c.stroke();
      cercle(x + w * 0.35, y + h * 0.95, w * 0.22, fond, "#9aa7b6"); cercle(x + w * 0.62, y + h * 0.85, w * 0.17, fond, "#9aa7b6");
      c.strokeStyle = fond; c.lineWidth = w * 0.05; ligne(x + w * 0.12, y + h * 0.5, x + w * 0.88, y + h * 0.5);
    };
    const nuit = nuitDemandee || (code >= 30 && code <= 39);
    let nuages;
    if (code === 0 || code === 30) nuages = 0;
    else if (code === 1 || code === 31) nuages = 1;
    else if ([2, 32, 6, 7, 8, 9, 36, 37, 38, 39].includes(code)) nuages = 2;
    else if (code === 3 || code === 33) nuages = 2.5;
    else nuages = 3;
    const [pluie, neige, mixte, orage, brume] = [PLUIE, NEIGE, MIXTE, ORAGE, BRUME].map(s => s.has(code));
    const precip = pluie || neige || mixte || orage || brume;
    if (nuages < 3) { const gros = nuages === 0; const [cx, cy, r] = gros ? [t / 2, t / 2, t * 0.24] : [t * 0.38, t * 0.62, t * 0.17]; (nuit ? lune : soleil)(cx, cy, r); }
    if (nuages) { const w = t * (nuages === 1 ? 0.62 : 0.8), y = t * (precip ? 0.3 : 0.2); nuage(t - w - t * 0.04, y, w, nuages === 3 && precip); }
    const base = t * 0.12;
    if (pluie || mixte) { c.strokeStyle = "#2d7fd3"; c.lineWidth = t * 0.06; c.lineCap = "round"; [0.35, 0.55, 0.75].forEach((dx, i) => { if (!(mixte && i === 1)) ligne(t * dx, base + t * 0.1, t * (dx - 0.06), base - t * 0.06); }); }
    if (neige || mixte) for (const dx of (mixte ? [0.55] : [0.35, 0.55, 0.75])) cercle(t * dx, base + t * 0.02, t * 0.05, "#6aa9e9");
    if (orage) {
      const pts = [[0.58, 0.2], [0.44, 0.02], [0.54, 0.02], [0.46, -0.14], [0.66, 0.08], [0.56, 0.08], [0.64, 0.2]];
      c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo : c.moveTo).call(c, t * px, t * py + base)); c.closePath();
      c.fillStyle = "#f9b233"; c.fill(); c.strokeStyle = "#f39200"; c.lineWidth = t * 0.02; c.stroke();
    }
    if (brume) { c.strokeStyle = "#9aa7b6"; c.lineWidth = t * 0.05; c.lineCap = "round"; for (let i = 0; i < 3; i++) ligne(t * 0.15, t * (0.3 + i * 0.18), t * 0.85, t * (0.3 + i * 0.18)); }
    return (cacheIcones[cle] = cv.toDataURL("image/png"));
  }

  // ----------------------------- PDF (même mise en page que le robot) -----
  function chargerJsPdf() {
    if (window.jspdf) return Promise.resolve();
    return new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = ok; s.onerror = () => ko(new Error("jsPDF n'a pas pu se charger"));
      document.head.appendChild(s);
    });
  }
  function creerPdf(donnees, quand) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const CM = 72 / 2.54, W = 612;
    const cols = [4.8, 1.1, 1.7, 1.1, 1.7, 2.3, 2.3].map(c => c * CM);
    const larg = cols.reduce((a, b) => a + b, 0), x0 = (W - larg) / 2;
    const xs = cols.reduce((acc, w, i) => (acc.push(i ? acc[i - 1] + cols[i - 1] : x0), acc), []);
    const BLEU = [31, 78, 121], ICONE = 26;
    doc.setProperties({ title: `Météo du ${dateLongue(quand)}`, author: "Environnement Canada (meteo.gc.ca)" });
    let y = 1.0 * CM + 6;
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...BLEU);
    doc.text(`Météo du ${dateLongue(quand)}`, W / 2, y + 16, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(102);
    doc.text(`Maximum le jour, minimum la nuit · Généré à ${deux(quand.getHours())}:${deux(quand.getMinutes())} (actualisé à la demande) · Source : meteo.gc.ca`,
             W / 2, y + 31, { align: "center" });
    y += 22 + 10 + 10;
    for (const [prov, villes] of Object.entries(donnees)) {
      const hBande = 0.75 * CM, hEnt = 0.7 * CM, hL = 1.05 * CM, debut = y;
      doc.setFillColor(...BLEU); doc.rect(x0, y, larg, hBande, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.setTextColor(255);
      doc.text(prov, W / 2, y + hBande / 2 + 4, { align: "center" });
      y += hBande;
      doc.setFillColor(233, 238, 244); doc.rect(x0, y, larg, hEnt, "F");
      doc.setFontSize(9.5); doc.setTextColor(51);
      const b = y + hEnt / 2 + 3.3;
      doc.text("Ville", xs[0] + 6, b);
      doc.text("Jour", xs[1] + (cols[1] + cols[2]) / 2, b, { align: "center" });
      doc.text("Nuit", xs[3] + (cols[3] + cols[4]) / 2, b, { align: "center" });
      doc.text("Transmed", xs[5] + cols[5] / 2, b, { align: "center" });
      doc.text("24 h", xs[6] + cols[6] / 2, b, { align: "center" });
      const lignesY = [y + hEnt];
      y += hEnt;
      villes.forEach((v, i) => {
        if (i % 2) { doc.setFillColor(246, 248, 250); doc.rect(x0, y, larg, hL, "F"); }
        const j = v.jour || {}, n = v.nuit || {}, tj = nombre(j.max), tn = nombre(n.min), mil = y + hL / 2;
        for (const [col, mode] of [[5, emballageLocal(tj)], [6, emballage24h(tj, tn)]]) {
          doc.setFont("helvetica", "bold"); doc.setFontSize(10);
          if (mode) { doc.setFillColor(COULEURS[mode][0]); doc.rect(xs[col], y, cols[col], hL, "F"); doc.setTextColor(COULEURS[mode][1]); }
          else doc.setTextColor(0);
          doc.text(mode || "—", xs[col] + cols[col] / 2, mil + 3.5, { align: "center" });
        }
        doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(0);
        doc.text(doc.splitTextToSize(v.nom, cols[0] - 10)[0], xs[0] + 6, mil + 3.5);
        for (const [col, per, nuit, val] of [[1, v.jour, false, j.max], [3, v.nuit, true, n.min]]) {
          const u = v.ok && per ? icone(per.code, nuit) : null;
          if (u) doc.addImage(u, "PNG", xs[col] + (cols[col] - ICONE) / 2, mil - ICONE / 2, ICONE, ICONE);
          doc.setFont("helvetica", "bold"); doc.setFontSize(12.5); doc.setTextColor(0);
          doc.text(v.ok ? (val == null || val === "" ? "—" : deg(val) + "C") : "n.d.", xs[col + 1] + cols[col + 1] / 2, mil + 4.4, { align: "center" });
        }
        y += hL; lignesY.push(y);
      });
      doc.setDrawColor(211, 218, 226); doc.setLineWidth(0.4);
      for (const ly of lignesY) doc.line(x0, ly, x0 + larg, ly);
      const haut = debut + hBande;
      for (const c of [1, 3, 6]) doc.line(xs[c], haut, xs[c], y);
      doc.setDrawColor(143, 161, 181); doc.setLineWidth(0.8); doc.line(xs[5], haut, xs[5], y);
      doc.setDrawColor(184, 195, 207); doc.setLineWidth(0.6); doc.rect(x0, debut, larg, y - debut);
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(68);
    doc.text("Transmed : Hybride si le jour est à 0 °C ou moins, sinon Été.", W / 2, y + 17, { align: "center" });
    doc.text("24 h : Hiver si la nuit est à -10 °C ou moins ou si le jour est sous -5 °C ; sinon Hybride si le jour ou la nuit est à 0 °C ou moins ; sinon Été.",
             W / 2, y + 26.5, { align: "center" });
    return doc;
  }

  // ----------------------------- interface --------------------------------
  const style = document.createElement("style");
  style.textContent = `
    button.bouton { border:0; cursor:pointer; font:inherit; font-weight:700; margin-left:8px; }
    button.bouton:disabled { opacity:.6; cursor:wait; }
    .etat-meteo { margin-top:14px; padding:10px 14px; border-radius:10px; background:#fff7df; color:#6b4f00; font-weight:600; max-width:720px; }
    .etat-meteo.ok { background:#e6f4e8; color:#1d6331; }
    .etat-meteo.erreur { background:#fdecec; color:#7d1c1c; }`;
  document.head.appendChild(style);

  const haut = document.querySelector(".haut > div");
  const lienPdf = haut && haut.querySelector('a[href="meteo-du-jour.pdf"]');
  if (!haut || !lienPdf) return;
  const bouton = document.createElement("button");
  bouton.type = "button"; bouton.className = "bouton"; bouton.id = "actualiser";
  bouton.textContent = "🔄 Actualiser maintenant";
  lienPdf.insertAdjacentElement("afterend", bouton);
  const etat = document.createElement("div"); etat.className = "etat-meteo"; etat.hidden = true;
  haut.appendChild(etat);
  const afficherEtat = (txt, type = "") => { etat.textContent = txt; etat.className = "etat-meteo " + type; etat.hidden = !txt; };

  let VILLES = VILLES_DEFAUT, genereRobot = null, pdfAJour = null;
  fetch("donnees.json?" + Date.now(), { cache: "no-store" }).then(r => r.json()).then(d => {
    genereRobot = new Date(d.genere);
    VILLES = Object.fromEntries(Object.entries(d.villes).map(([p, l]) => [p, l.map(v => [v.id, v.nom])]));
    const now = new Date();
    if (!memeJour(genereRobot, now) && now.getHours() >= 5)
      afficherEtat(`Ce rapport date du ${dateLongue(genereRobot)}. Clique sur « Actualiser maintenant » pour avoir la météo d'aujourd'hui.`);
  }).catch(() => {});

  bouton.addEventListener("click", async () => {
    bouton.disabled = true; bouton.textContent = "⏳ Recherche de la météo…";
    afficherEtat("");
    try {
      const taches = Object.entries(VILLES).flatMap(([p, l]) => l.map(([id, nom]) => ({ p, id, nom })));
      const bruts = await Promise.all(taches.map(t => telecharger(t.id)));
      const donnees = {};
      taches.forEach((t, i) => (donnees[t.p] ||= []).push(extraire(t.id, t.nom, bruts[i])));
      const toutes = Object.values(donnees).flat(), ok = toutes.filter(v => v.ok);
      if (!ok.length) throw new Error("Environnement Canada ne répond pas pour l'instant. Réessaie dans quelques minutes.");
      const quand = new Date();
      if (!ok.some(v => v.jour) && genereRobot && memeJour(genereRobot, quand)) {
        afficherEtat("À cette heure-ci, Environnement Canada ne donne plus la température de jour : le rapport du matin est gardé tel quel.");
        return;
      }
      // Cartes
      const main = document.querySelector("main");
      main.querySelectorAll("section:not(.archives)").forEach(s => s.remove());
      const avant = main.querySelector("section.archives") || main.querySelector("footer");
      for (const [prov, villes] of Object.entries(donnees)) {
        const s = document.createElement("section");
        s.innerHTML = `<h2>${esc(prov)}</h2><div class="grille">${villes.map(carte).join("")}</div>`;
        main.insertBefore(s, avant);
      }
      haut.querySelector("h1").textContent = `Météo du ${dateLongue(quand)}`;
      const p = haut.querySelector("p");
      if (p) p.textContent = `Principales villes du Québec et de l'Ontario · actualisé à ${deux(quand.getHours())} h ${deux(quand.getMinutes())}`;
      pdfAJour = { donnees, quand };
      lienPdf.textContent = "⬇ Télécharger le PDF à jour";
      const manque = toutes.length - ok.length;
      afficherEtat(`Météo actualisée à ${deux(quand.getHours())} h ${deux(quand.getMinutes())}` +
        (manque ? ` (${manque} ville${manque > 1 ? "s" : ""} sans réponse d'Environnement Canada).` : ".") +
        (ok.some(v => v.jour) ? "" : " Attention : la température de jour n'est plus fournie à cette heure-ci."), manque ? "" : "ok");
    } catch (e) {
      afficherEtat(e.message || "La météo n'a pas pu être actualisée.", "erreur");
    } finally {
      bouton.disabled = false; bouton.textContent = "🔄 Actualiser maintenant";
    }
  });

  lienPdf.addEventListener("click", async e => {
    if (!pdfAJour) return;            // pas encore actualisé : PDF du robot
    e.preventDefault();
    try {
      await chargerJsPdf();
      const q = pdfAJour.quand;
      creerPdf(pdfAJour.donnees, q).save(`meteo-${q.getFullYear()}-${deux(q.getMonth() + 1)}-${deux(q.getDate())}.pdf`);
    } catch (err) { afficherEtat("Le PDF n'a pas pu être créé : " + err.message, "erreur"); }
  });

  window.__meteoLive = { extraire, creerPdf, chargerJsPdf, emballageLocal, emballage24h };
})();
