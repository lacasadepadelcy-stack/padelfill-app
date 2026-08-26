const navBtns = document.querySelectorAll(".navbtn");
const views = {
  schedule: document.getElementById("view-schedule"),
  swipe: document.getElementById("view-swipe"),
  dash: document.getElementById("view-dash"),
};

let DATES = [];
let dateIndex = 0;

function setView(name) {
  Object.keys(views).forEach((k) => (views[k].style.display = k === name ? "" : "none"));
  navBtns.forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (name === "schedule") loadSchedule();
  if (name === "swipe") loadSwipeCandidate();
  if (name === "dash") loadDashboard();
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
      <option value="el">Ελληνικά</option>
      <option value="en">English</option>
    </select>
  `;
  box.appendChild(filter);

  const title = el("p", "", "sub");
  const list = el("div", "");
  box.appendChild(title);
  box.appendChild(list);
  cellEl.insertAdjacentElement("afterend", box);

  async function refresh() {
    const min = document.getElementById("minLevel").value;
    const max = document.getElementById("maxLevel").value;
    let url = `/api/gaps/${encodeURIComponent(gapId)}/suggestions?date=${currentDate()}`;
    if (min) url += `&minLevel=${min}`;
    if (max) url += `&maxLevel=${max}`;
    const res = await fetch(url);
    const data = await res.json();

    title.textContent = data.levelRange
      ? `Παίκτες επιπέδου ${data.levelRange.minLevel} έως ${data.levelRange.maxLevel}`
      : data.targetLevel
      ? `Προτεινόμενοι παίκτες επιπέδου ~${data.targetLevel.toFixed(1)} (που ταιριάζουν σε αυτό το game)`
      : "Προτεινόμενοι παίκτες";

    list.innerHTML = "";
    data.suggestions.forEach((p) => {
      const row = el("div", "", "player");
      const info = el("span", `${p.name} · Επίπεδο ${p.level}`);
      const actions = el("div", "", "actions");
      const notifyBtn = el("button", "Ειδοποίησε");
      notifyBtn.addEventListener("click", async () => {
        notifyBtn.disabled = true;
        notifyBtn.textContent = "...";
        const lang = document.getElementById("notifyLang")?.value || "el";
        const res = await fetch(`/api/gaps/${encodeURIComponent(gapId)}/notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: p.id, date: currentDate(), lang }),
        });
        const result = await res.json();
        actions.innerHTML = "";
        actions.appendChild(el("span", "Στάλθηκε ✓", "notified"));
        // Ανοίγουμε αυτόματα το WhatsApp με το μήνυμα ήδη γραμμένο, ώστε
        // ο χρήστης να χρειάζεται μόνο ένα κλικ "Αποστολή" στο WhatsApp.
        if (result.notification?.whatsappUrl) {
          window.open(result.notification.whatsappUrl, "_blank");
        }
      });
      actions.appendChild(notifyBtn);
      row.appendChild(info);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  document.getElementById("applyRange").addEventListener("click", refresh);
  refresh();
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
  const res = await fetch(`/api/dashboard?date=${currentDate()}`);
  const data = await res.json();
  const container = views.dash;
  container.innerHTML = "";
  const metrics = document.createElement("div");
  metrics.className = "metrics";
  metrics.appendChild(metric("Πληρότητα", `${data.occupancyPct}%`));
  metrics.appendChild(metric("Κενά", `${data.gapSlots}/${data.totalSlots}`));
  metrics.appendChild(metric("Μαθήματα vs παιχνίδια", `${data.trainingPct}% / ${data.gamePct}%`));
  container.appendChild(metrics);
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

setView("schedule");
