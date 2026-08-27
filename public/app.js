// Αν οποιοδήποτε fetch γυρίσει 401 (μη συνδεδεμένος / έληξε το session),
// στέλνουμε αυτόματα στη σελίδα σύνδεσης — έτσι δεν χρειάζεται να το
// ελέγχει ξεχωριστά κάθε συνάρτηση που κάνει fetch.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await nativeFetch(...args);
  const url = String(args[0] || "");
  if (res.status === 401 && !url.includes("/api/login")) {
    window.location.href = "/login.html";
  }
  return res;
};

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
});

const navBtns = document.querySelectorAll(".navbtn");
const views = {
  schedule: document.getElementById("view-schedule"),
  weekly: document.getElementById("view-weekly"),
  swipe: document.getElementById("view-swipe"),
  dash: document.getElementById("view-dash"),
  customers: document.getElementById("view-customers"),
};

let DATES = [];
let dateIndex = 0;

function setView(name) {
  Object.keys(views).forEach((k) => (views[k].style.display = k === name ? "" : "none"));
  navBtns.forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (name === "schedule") loadSchedule();
  if (name === "weekly") loadWeeklyGaps();
  if (name === "swipe") loadSwipeCandidate();
  if (name === "dash") loadDashboard();
  if (name === "customers") loadCustomers();
}

navBtns.forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

async function ensureDates() {
  if (DATES.length) return;
  const res = await fetch("/api/dates");
  const data = await res.json();
  DATES = data.dates;
}

function currentDate() {
  return DATES[dateIndex] ? DATES[dateIndex].date : undefined;
}

async function loadSchedule() {
  await ensureDates();
  const container = views.schedule;
  container.innerHTML = "";

  const dayNav = document.createElement("div");
  dayNav.className = "daynav";
  const prev = el("button", "‹ Προηγούμενη");
  const label = el("span", DATES[dateIndex]?.label || "", "sub");
  label.style.margin = "0";
  const next = el("button", "Επόμενη ›");
  prev.disabled = dateIndex === 0;
  next.disabled = dateIndex >= DATES.length - 1;
  prev.addEventListener("click", () => { dateIndex = Math.max(0, dateIndex - 1); loadSchedule(); });
  next.addEventListener("click", () => { dateIndex = Math.min(DATES.length - 1, dateIndex + 1); loadSchedule(); });
  dayNav.appendChild(prev);
  dayNav.appendChild(label);
  dayNav.appendChild(next);
  container.appendChild(dayNav);

  const res = await fetch(`/api/schedule?date=${currentDate()}`);
  const data = await res.json();

  const courts = data.schedule.map((s) => s.court);
  const hours = data.schedule[0] ? data.schedule[0].slots.map((s) => s.time) : [];

  const scheduleWrap = document.createElement("div");
  scheduleWrap.className = "schedulewrap";

  const grid = document.createElement("div");
  grid.className = "grid";
  grid.style.gridTemplateColumns = `56px repeat(${courts.length}, 1fr)`;

  // Τοποθετούμε κάθε κελί σε ρητή στήλη/γραμμή (αντί να βασιζόμαστε στη
  // σειρά προσθήκης) ώστε ένα παιχνίδι να μπορεί να "απλώνεται" σε πολλές
  // γραμμές (grid-row span) χωρίς να μπερδεύεται η υπόλοιπη διάταξη.
  function placeCell(node, col, row, rowSpan = 1) {
    node.style.gridColumn = String(col);
    node.style.gridRow = rowSpan > 1 ? `${row} / span ${rowSpan}` : String(row);
    grid.appendChild(node);
  }

  // Επικεφαλίδα (γραμμή 1): κενό κελί (γωνία) + ένα όνομα γηπέδου ανά στήλη
  placeCell(el("div", ""), 1, 1);
  courts.forEach((c, ci) => placeCell(el("div", c.name, "hdr courtname"), ci + 2, 1));

  // Ετικέτες ωρών στην αριστερή στήλη, μία ανά γραμμή
  hours.forEach((time, hIdx) => placeCell(el("div", time, "rowlabel"), 1, hIdx + 2));

  // Ένα κελί ανά κράτηση (όχι ανά μισή ώρα): το κάθε παιχνίδι/μάθημα
  // εμφανίζεται ΜΙΑ φορά σαν ενιαίο κελί που απλώνεται σε όσες γραμμές
  // αντιστοιχούν στη διάρκειά του — όπως ακριβώς στο πραγματικό Playtomic.
  data.schedule.forEach(({ slots }, ci) => {
    const col = ci + 2;
    let hIdx = 0;
    while (hIdx < slots.length) {
      const s = slots[hIdx];
      const row = hIdx + 2;

      if (s.status === "booked") {
        // Μετράμε πόσα συνεχόμενα slots ανήκουν στην ΙΔΙΑ κράτηση
        // (ίδια ώρα έναρξης/λήξης) ώστε να ξέρουμε πόσες γραμμές να
        // καλύψει το ενιαίο κελί.
        let span = 1;
        while (
          hIdx + span < slots.length &&
          slots[hIdx + span].status === "booked" &&
          slots[hIdx + span].startTime === s.startTime &&
          slots[hIdx + span].endTime === s.endTime
        ) {
          span += 1;
        }

        const lbl = s.type === "training" ? "Μάθημα" : "Παιχνίδι";
        const cell = document.createElement("div");
        cell.className = `slot booked ${s.type}`;
        const namesHtml = (s.players || [])
          .map((p) => `${p.name}${typeof p.level === "number" ? ` (${p.level})` : ""}`)
          .join(", ");
        const timeRangeHtml = s.startTime && s.endTime ? `<div class="slot-time">${s.startTime}–${s.endTime}</div>` : "";
        cell.innerHTML = `<div class="slot-type">${lbl}</div>${namesHtml ? `<div class="slot-players">${namesHtml}</div>` : ""}${timeRangeHtml}`;
        placeCell(cell, col, row, span);

        hIdx += span;
      } else {
        const cell = el("div", "Κενό", "slot gap");
        cell.addEventListener("click", () => showGapDetail(cell, s.gapId));
        placeCell(cell, col, row);
        hIdx += 1;
      }
    }
  });

  scheduleWrap.appendChild(grid);
  container.appendChild(scheduleWrap);
}

async function showGapDetail(cellEl, gapId) {
  document.querySelectorAll(".gapdetail").forEach((d) => d.remove());

  const box = el("div", "", "gapdetail");
  box.style.display = "block";

  const filter = document.createElement("div");
  filter.className = "levelfilter";
  filter.innerHTML = `
    <span>Επίπεδο από</span>
    <input type="number" step="0.5" id="minLevel" placeholder="π.χ. 3">
    <span>έως</span>
    <input type="number" step="0.5" id="maxLevel" placeholder="π.χ. 4">
    <button id="applyRange">Εφαρμογή</button>
    <span style="margin-left:8px;">Γλώσσα μηνύματος</span>
    <select id="notifyLang">
      <option value="el">Greeklish</option>
      <option value="en">English</option>
    </select>
  `;
  box.appendChild(filter);

  const title = el("p", "", "sub");
  const list = el("div", "");
  box.appendChild(title);
  box.appendChild(list);
  cellEl.insertAdjacentElement("afterend", box);

  const getLang = () => document.getElementById("notifyLang")?.value || "el";

  async function refresh() {
    const min = document.getElementById("minLevel").value;
    const max = document.getElementById("maxLevel").value;
    let url = `/api/gaps/${encodeURIComponent(gapId)}/suggestions?date=${currentDate()}`;
    if (min) url += `&minLevel=${min}`;
    if (max) url += `&maxLevel=${max}`;
    const [res, notifRes] = await Promise.all([fetch(url), fetch("/api/notifications")]);
    const data = await res.json();
    const notifData = await notifRes.json();
    const notifiedMap = new Map(
      (notifData.notifications || [])
        .filter((n) => n.gapId === gapId)
        .map((n) => [n.playerId, n])
    );

    title.textContent = data.levelRange
      ? `Παίκτες επιπέδου ${data.levelRange.minLevel} έως ${data.levelRange.maxLevel}`
      : data.targetLevel
      ? `Προτεινόμενοι παίκτες επιπέδου ~${data.targetLevel.toFixed(1)} (που ταιριάζουν σε αυτό το game)`
      : "Προτεινόμενοι παίκτες";

    list.innerHTML = "";
    data.suggestions.forEach((p) => {
      list.appendChild(
        buildSuggestionRow({ gapId, date: currentDate() }, p, notifiedMap.get(p.id), getLang)
      );
    });
  }

  document.getElementById("applyRange").addEventListener("click", refresh);
  refresh();
}

// Χτίζει τα στοιχεία ελέγχου "αποτελέσματος" για μια ήδη σταλμένη
// ειδοποίηση: "✓ Έκλεισε" / "✕ Όχι" όσο δεν έχει σημειωθεί ακόμα αποτέλεσμα,
// ή ένα ένδειξη-badge (κλικ για επαναφορά) όταν έχει ήδη σημειωθεί. Έτσι το
// προσωπικό μπορεί να καταγράφει αν μια ειδοποίηση πραγματικά "έπιασε".
function buildOutcomeControls(entry) {
  const wrap = el("span", "", "outcome");

  async function setOutcome(outcome) {
    const res = await fetch(`/api/notifications/${encodeURIComponent(entry.id)}/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    });
    const result = await res.json();
    if (result.notification) {
      entry.outcome = result.notification.outcome;
      render();
    }
  }

  function render() {
    wrap.innerHTML = "";
    if (entry.outcome === "booked") {
      const badge = el("span", "✅ Έκλεισε γήπεδο", "outcome-booked");
      badge.title = "Πάτησε για επαναφορά";
      badge.addEventListener("click", () => setOutcome(null));
      wrap.appendChild(badge);
    } else if (entry.outcome === "no") {
      const badge = el("span", "✕ Δεν έκλεισε", "outcome-no");
      badge.title = "Πάτησε για επαναφορά";
      badge.addEventListener("click", () => setOutcome(null));
      wrap.appendChild(badge);
    } else {
      wrap.appendChild(el("span", "Στάλθηκε ✓", "notified"));
      const yesBtn = el("button", "✓ Έκλεισε", "outcome-btn");
      const noBtn = el("button", "✕ Όχι", "outcome-btn");
      yesBtn.addEventListener("click", () => setOutcome("booked"));
      noBtn.addEventListener("click", () => setOutcome("no"));
      wrap.appendChild(yesBtn);
      wrap.appendChild(noBtn);
    }
  }

  render();
  return wrap;
}

// Μετατρέπει λεπτά σε σύντομη ένδειξη διάρκειας (π.χ. 90 -> "1ω30", 30 -> "30λ")
// για να φαίνεται εύκολα πόσο "χαμένος" χρόνος είναι κάθε κενό.
function formatDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}ω${String(m).padStart(2, "0")}`;
  if (h) return `${h}ω`;
  return `${m}λ`;
}

// Συγκεντρωτική προβολή: όλα τα κενά των επόμενων 7 ημερών (τα μεγαλύτερα
// πρώτα, μέσα σε κάθε μέρα), μαζί με προτεινόμενους παίκτες ίδιου επιπέδου —
// χωρίς να χρειάζεται να μπαίνει κανείς σε κάθε μέρα ξεχωριστά. Δείχνει ποιοι
// έχουν ήδη ειδοποιηθεί (ιστορικό) και επιτρέπει ειδοποίηση όλων με 1 κλικ.
async function loadWeeklyGaps() {
  const container = views.weekly;
  container.innerHTML = "";

  const langWrap = document.createElement("div");
  langWrap.className = "levelfilter";
  langWrap.innerHTML = `
    <span>Γλώσσα μηνύματος</span>
    <select id="weeklyLang">
      <option value="el">Greeklish</option>
      <option value="en">English</option>
    </select>
  `;
  container.appendChild(langWrap);

  const loadingMsg = el("p", "Φόρτωση...", "sub");
  container.appendChild(loadingMsg);

  const [gapsRes, notifRes] = await Promise.all([
    fetch("/api/gaps/weekly?days=7"),
    fetch("/api/notifications"),
  ]);
  const data = await gapsRes.json();
  const notifData = await notifRes.json();
  container.removeChild(loadingMsg);

  // Χάρτης "gapId|playerId" -> notification ώστε να ξέρουμε ποιος έχει ήδη
  // ειδοποιηθεί για συγκεκριμένο κενό (να μη στέλνουμε διπλό μήνυμα) ΚΑΙ να
  // δείχνουμε/ενημερώνουμε το αποτέλεσμα (έκλεισε γήπεδο ή όχι).
  const notifiedMap = new Map(
    (notifData.notifications || []).map((n) => [`${n.gapId}|${n.playerId}`, n])
  );
  const getLang = () => document.getElementById("weeklyLang")?.value || "el";

  if (!data.report.length) {
    container.appendChild(el("p", "Δεν υπάρχουν κενά τις επόμενες 7 μέρες 🎉", "sub"));
    return;
  }

  let lastDate = null;
  data.report.forEach((gap) => {
    if (gap.date !== lastDate) {
      container.appendChild(el("div", gap.dateLabel, "dateheader"));
      lastDate = gap.date;
    }

    const card = document.createElement("div");
    card.className = "gapcard";

    const titleRow = document.createElement("div");
    titleRow.style.display = "flex";
    titleRow.style.justifyContent = "space-between";
    titleRow.style.alignItems = "center";
    titleRow.style.gap = "8px";

    const timeRange = `${gap.startTime}–${gap.endTime}`;
    const levelText = gap.targetLevel ? ` · επίπεδο ~${gap.targetLevel.toFixed(1)}` : "";
    const durationText = ` · ${formatDuration(gap.gapMinutes)} κενό`;
    titleRow.appendChild(el("div", `${gap.court.name} · ${timeRange}${levelText}${durationText}`, "gapcard-title"));

    const pendingPlayers = gap.suggestions.filter((p) => !notifiedMap.has(`${gap.gapId}|${p.id}`));
    if (pendingPlayers.length > 1) {
      const notifyAllBtn = el("button", `Ειδοποίησε όλους (${pendingPlayers.length})`);
      titleRow.appendChild(notifyAllBtn);
      notifyAllBtn.addEventListener("click", () => notifyAll(gap, pendingPlayers, notifyAllBtn, card, notifiedMap, getLang));
    }
    card.appendChild(titleRow);
    if (gap.suggestions.length > 1) {
      card.appendChild(el("p", `Προτεινόμενη παρέα (${gap.suggestions.length}/4)`, "sub"));
    }

    if (!gap.suggestions.length) {
      card.appendChild(el("p", "Δεν βρέθηκαν κατάλληλοι παίκτες.", "sub"));
    } else {
      gap.suggestions.forEach((p) => {
        card.appendChild(buildSuggestionRow(gap, p, notifiedMap.get(`${gap.gapId}|${p.id}`), getLang));
      });
    }

    container.appendChild(card);
  });
}

// Χτίζει τη γραμμή ενός προτεινόμενου παίκτη: κουμπί "Ειδοποίησε" αν δεν
// έχει ειδοποιηθεί ακόμα για αυτό το κενό, αλλιώς στοιχεία ελέγχου
// αποτελέσματος (buildOutcomeControls) ώστε να σημειώνεται αν τελικά
// έκλεισε το γήπεδο. `getLang` είναι συνάρτηση που επιστρέφει την επιλεγμένη
// γλώσσα μηνύματος (διαφορετικό select id ανάλογα με την προβολή).
function buildSuggestionRow(gap, p, existingEntry, getLang) {
  const row = el("div", "", "player");
  const reliabilityText = p.reliability ? ` · ${p.reliability.pct}% ανταπόκριση (${p.reliability.sent})` : "";
  const info = el("span", `${p.name} · Επίπεδο ${p.level}${reliabilityText}`);
  const actions = el("div", "", "actions");

  if (existingEntry) {
    actions.appendChild(buildOutcomeControls(existingEntry));
  } else {
    const notifyBtn = el("button", "Ειδοποίησε");
    notifyBtn.addEventListener("click", async () => {
      notifyBtn.disabled = true;
      notifyBtn.textContent = "...";
      const lang = getLang ? getLang() : "el";
      const notifyRes = await fetch(`/api/gaps/${encodeURIComponent(gap.gapId)}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: p.id, date: gap.date, lang }),
      });
      const result = await notifyRes.json();
      actions.innerHTML = "";
      if (result.notification) {
        actions.appendChild(buildOutcomeControls(result.notification));
      }
      if (result.notification?.whatsappUrl) {
        window.open(result.notification.whatsappUrl, "_blank");
      }
    });
    actions.appendChild(notifyBtn);
  }

  row.appendChild(info);
  row.appendChild(actions);
  return row;
}

// Ειδοποιεί ΟΛΟΥΣ τους μη-ειδοποιημένους προτεινόμενους παίκτες ενός κενού με
// ένα κλικ. Ανοίγουμε τα WhatsApp tabs ΑΜΕΣΩΣ (synchronous, πριν από κανένα
// await) ώστε ο browser να μην τα μπλοκάρει ως pop-ups, και μετά γεμίζουμε
// το σωστό URL σε καθένα μόλις έρθει η απάντηση από τον server.
async function notifyAll(gap, players, buttonEl, cardEl, notifiedMap, getLang) {
  buttonEl.disabled = true;
  buttonEl.textContent = "...";
  const lang = getLang ? getLang() : "el";
  const windows = players.map(() => window.open("", "_blank"));
  const freshEntries = new Map(); // playerId -> notification που μόλις στάλθηκε

  for (let idx = 0; idx < players.length; idx++) {
    const p = players[idx];
    try {
      const notifyRes = await fetch(`/api/gaps/${encodeURIComponent(gap.gapId)}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: p.id, date: gap.date, lang }),
      });
      const result = await notifyRes.json();
      if (result.notification) freshEntries.set(p.id, result.notification);
      if (result.notification?.whatsappUrl && windows[idx]) {
        windows[idx].location = result.notification.whatsappUrl;
      } else if (windows[idx]) {
        windows[idx].close();
      }
    } catch (e) {
      if (windows[idx]) windows[idx].close();
    }
  }

  buttonEl.textContent = `Ειδοποιήθηκαν όλοι ✓ (${players.length})`;
  // Ανανεώνουμε τις γραμμές παικτών ώστε να δείχνουν στοιχεία αποτελέσματος
  // (είτε για τους μόλις ειδοποιημένους, είτε για όσους ήταν ήδη στο ιστορικό).
  cardEl.querySelectorAll(".player").forEach((row) => row.remove());
  gap.suggestions.forEach((p) => {
    const entry = freshEntries.get(p.id) || notifiedMap.get(`${gap.gapId}|${p.id}`);
    cardEl.appendChild(buildSuggestionRow(gap, p, entry, getLang));
  });
}

async function loadSwipeCandidate() {
  const res = await fetch("/api/swipe/next?playerId=p6");
  const data = await res.json();
  const container = views.swipe;
  container.innerHTML = "";
  if (!data.candidate) {
    container.appendChild(el("p", "Δεν υπάρχουν άλλοι υποψήφιοι αυτή τη στιγμή.", "sub"));
    return;
  }
  const card = document.createElement("div");
  card.className = "card";
  const initials = data.candidate.name
    .split(" ")
    .map((w) => w[0])
    .join("");
  card.innerHTML = `
    <div class="avatar">${initials}</div>
    <p style="font-weight:500; font-size:16px; margin:0;">${data.candidate.name}</p>
    <p class="sub" style="margin:4px 0 0;">Επίπεδο ${data.candidate.level}</p>
  `;
  container.appendChild(card);

  const actions = document.createElement("div");
  actions.className = "swipe-actions";
  const pass = el("button", "✕", "round");
  const like = el("button", "♥", "round");
  actions.appendChild(pass);
  actions.appendChild(like);
  container.appendChild(actions);

  const msg = el("p", "Match! Ανοίγει chat για να κλείσετε γήπεδο μαζί.", "msg");
  container.appendChild(msg);

  async function doSwipe(liked) {
    const res = await fetch("/api/swipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromId: "p6", toId: data.candidate.id, liked }),
    });
    const result = await res.json();
    if (result.matched) {
      msg.style.display = "block";
      setTimeout(loadSwipeCandidate, 1200);
    } else {
      loadSwipeCandidate();
    }
  }

  pass.addEventListener("click", () => doSwipe(false));
  like.addEventListener("click", () => doSwipe(true));
}

async function loadDashboard() {
  await ensureDates();
  const [res, statsRes, weeklyStatsRes, monthlyRes] = await Promise.all([
    fetch(`/api/dashboard?date=${currentDate()}`),
    fetch("/api/notifications/stats"),
    fetch("/api/stats/weekly?days=7"),
    fetch("/api/stats/monthly"),
  ]);
  const data = await res.json();
  const stats = await statsRes.json();
  const weeklyStats = await weeklyStatsRes.json();
  const monthly = await monthlyRes.json();
  const container = views.dash;
  container.innerHTML = "";
  const metrics = document.createElement("div");
  metrics.className = "metrics";
  metrics.appendChild(metric("Πληρότητα", `${data.occupancyPct}%`));
  metrics.appendChild(metric("Κενά", `${data.gapSlots}/${data.totalSlots}`));
  metrics.appendChild(metric("Μαθήματα vs παιχνίδια", `${data.trainingPct}% / ${data.gamePct}%`));
  container.appendChild(metrics);

  if (stats.total > 0) {
    const notifMetrics = document.createElement("div");
    notifMetrics.className = "metrics";
    notifMetrics.style.marginTop = "12px";
    notifMetrics.appendChild(metric("Ειδοποιήσεις (σύνολο)", `${stats.total}`));
    notifMetrics.appendChild(metric("Έκλεισαν γήπεδο", `${stats.booked} (${stats.bookedPct}%)`));
    notifMetrics.appendChild(metric("Χωρίς αποτέλεσμα ακόμα", `${stats.pending}`));
    container.appendChild(notifMetrics);
  }

  if (weeklyStats.byDay?.length) {
    const worstDay = [...weeklyStats.byDay].sort((a, b) => b.gapPct - a.gapPct)[0];
    const worstHour = [...weeklyStats.byHour].sort((a, b) => b.gapPct - a.gapPct)[0];
    const weekMetrics = document.createElement("div");
    weekMetrics.className = "metrics";
    weekMetrics.style.marginTop = "12px";
    weekMetrics.appendChild(metric("Πιο «αδύναμη» μέρα (7 μέρες)", `${worstDay.label} · ${worstDay.gapPct}% κενά`));
    if (worstHour) {
      weekMetrics.appendChild(metric("Πιο «αδύναμη» ώρα (7 μέρες)", `${worstHour.time} · ${worstHour.gapPct}% κενά`));
    }
    container.appendChild(weekMetrics);
  }

  if (monthly.months?.length) {
    const section = document.createElement("div");
    section.style.marginTop = "16px";

    const trendText =
      monthly.trendPct === null
        ? ""
        : monthly.trendPct > 0
        ? ` (↑ ${monthly.trendPct}% σε σχέση με τον προηγούμενο μήνα)`
        : monthly.trendPct < 0
        ? ` (↓ ${Math.abs(monthly.trendPct)}% σε σχέση με τον προηγούμενο μήνα)`
        : " (ίδια με τον προηγούμενο μήνα)";
    section.appendChild(el("p", `Τάση πληρότητας ανά μήνα${trendText}`, "sub"));

    const maxAvg = Math.max(...monthly.months.map((m) => m.avgPerDay), 1);
    monthly.months.forEach((m) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.marginBottom = "6px";
      row.style.fontSize = "12.5px";

      const label = el("span", `${m.label}${m.partial ? " (μέχρι σήμερα)" : ""}`);
      label.style.width = "150px";
      label.style.flexShrink = "0";
      label.style.color = "var(--text-secondary)";

      const barWrap = document.createElement("div");
      barWrap.style.flex = "1";
      barWrap.style.background = "var(--surface-1)";
      barWrap.style.borderRadius = "999px";
      barWrap.style.height = "16px";
      barWrap.style.overflow = "hidden";

      const bar = document.createElement("div");
      bar.style.height = "100%";
      bar.style.width = `${Math.max((m.avgPerDay / maxAvg) * 100, 4)}%`;
      bar.style.background = m.partial ? "var(--border-warning)" : "var(--accent)";
      bar.style.borderRadius = "999px";
      barWrap.appendChild(bar);

      const value = el("span", `${m.avgPerDay}/μέρα`);
      value.style.width = "70px";
      value.style.flexShrink = "0";
      value.style.color = "var(--text-secondary)";

      row.appendChild(label);
      row.appendChild(barWrap);
      row.appendChild(value);
      section.appendChild(row);
    });

    container.appendChild(section);
  }
}

// Πίνακας πελατών: πόσα παιχνίδια έκανε ο καθένας ανά μήνα (τελευταίοι ~3
// μήνες ιστορικού) — για σχεδιασμό προγράμματος ανταμοιβής στους πιο
// τακτικούς πελάτες. Ταξινομημένοι από τον πιο τακτικό στον λιγότερο.
async function loadCustomers() {
  const container = views.customers;
  container.innerHTML = "";
  container.appendChild(el("p", "Φόρτωση...", "sub"));

  const res = await fetch("/api/stats/players");
  const data = await res.json();
  container.innerHTML = "";

  if (!data.players?.length) {
    container.appendChild(el("p", "Δεν υπάρχει ακόμα αρκετό ιστορικό παιχνιδιών.", "sub"));
    return;
  }

  container.appendChild(
    el(
      "p",
      `Παιχνίδια ανά πελάτη, ανά μήνα (${data.months.length} μήνες ιστορικού) · VIP = ${data.vipThreshold}+ παιχνίδια/μήνα`,
      "sub"
    )
  );

  const wrap = document.createElement("div");
  wrap.className = "schedulewrap";
  const table = document.createElement("table");
  table.className = "datatable";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.appendChild(el("th", "Πελάτης"));
  headRow.appendChild(el("th", "Επίπεδο"));
  data.months.forEach((mk) => headRow.appendChild(el("th", mk)));
  headRow.appendChild(el("th", "Σύνολο"));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  data.players.forEach((p, idx) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    if (idx < 3) {
      const rankBadge = el("span", String(idx + 1), "rank");
      nameCell.appendChild(rankBadge);
    }
    nameCell.appendChild(document.createTextNode(p.name));
    if (p.vip) nameCell.appendChild(el("span", "VIP", "vip-badge"));
    row.appendChild(nameCell);
    row.appendChild(el("td", typeof p.level === "number" ? String(p.level) : "—"));
    data.months.forEach((mk) => {
      const cell = el("td", String(p.byMonth[mk] || 0));
      cell.className = "num";
      row.appendChild(cell);
    });
    const totalCell = el("td", String(p.total));
    totalCell.className = "num";
    totalCell.style.fontWeight = "700";
    row.appendChild(totalCell);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  wrap.appendChild(table);
  container.appendChild(wrap);
}

function metric(label, value) {
  const box = el("div", "", "metric");
  box.innerHTML = `<p>${label}</p><p>${value}</p>`;
  return box;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

(async () => {
  const res = await nativeFetch("/api/me");
  const data = await res.json();
  if (!data.authenticated) {
    window.location.href = "/login.html";
    return;
  }
  setView("schedule");
})();
