// playtomicClient.js
//
// Συνδέεται με το πραγματικό Playtomic Third Party API όταν υπάρχουν τα
// σωστά environment variables:
//   PLAYTOMIC_CLIENT_ID
//   PLAYTOMIC_CLIENT_SECRET
//   PLAYTOMIC_VENUE_ID
// Αν έστω ένα λείπει, η εφαρμογή γυρνάει αυτόματα σε mock δεδομένα, ώστε να
// συνεχίζει να δουλεύει για δοκιμή/demo χωρίς σφάλματα.
//
// ΣΗΜΑΝΤΙΚΟ: το client_id/secret ΔΕΝ μπαίνουν ποτέ εδώ μέσα στον κώδικα.
// Μπαίνουν ως environment variables στο hosting (π.χ. Render -> Environment).
//
// Προαιρετικά μπορείτε να ορίσετε και PLAYTOMIC_COURTS με μια λίστα σε JSON
// (π.χ. [{"id":"resource-id-1","name":"Γήπεδο 1"}, ...]) ώστε τα γήπεδα να
// εμφανίζονται σωστά ακόμα και τις μέρες που δεν έχουν καμία κράτηση — το
// Playtomic API δεν έχει ξεχωριστό endpoint για λίστα γηπέδων, οπότε χωρίς
// αυτή τη μεταβλητή τα «μαθαίνουμε» από τις κρατήσεις μιας ευρύτερης περιόδου.

const PLAYTOMIC_BASE = "https://thirdparty.playtomic.io";

const CLIENT_ID = process.env.PLAYTOMIC_CLIENT_ID;
const CLIENT_SECRET = process.env.PLAYTOMIC_CLIENT_SECRET;
const VENUE_ID = process.env.PLAYTOMIC_VENUE_ID;
const MANUAL_COURTS = process.env.PLAYTOMIC_COURTS
  ? JSON.parse(process.env.PLAYTOMIC_COURTS)
  : null;

const USE_REAL_API = Boolean(CLIENT_ID && CLIENT_SECRET && VENUE_ID);

// Ωράριο κλαμπ: 07:00–23:30. Το Playtomic API δεν επιστρέφει το ωράριο
// λειτουργίας του club, οπότε μένει εδώ χειροκίνητα. Χρησιμοποιούμε ανά 30
// λεπτά (αντί για σταθερά 90λεπτα slots) ώστε να χωράνε κρατήσεις που δεν
// ξεκινούν ακριβώς σε "στρογγυλή" ώρα.
function generateHours(startHour, endHour, stepMinutes) {
  const out = [];
  for (let totalMin = startHour * 60; totalMin <= endHour * 60; totalMin += stepMinutes) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return out;
}

const HOURS = generateHours(7, 22, 30);

// Το Playtomic API επιστρέφει τις ώρες κρατήσεων σε UTC. Το club είναι στην
// Κύπρο (Asia/Nicosia), που τώρα είναι UTC+3 (θερινή ώρα) — χωρίς αυτή τη
// μετατροπή οι ώρες θα εμφανίζονταν λάθος (πιο νωρίς) στο πρόγραμμα.
const VENUE_TIMEZONE = "Asia/Nicosia";

function toVenueDateTimeParts(isoStr) {
  const raw = isoStr || "";
  // Αν το API δεν στείλει ρητά UTC ένδειξη (Z ή +offset), υποθέτουμε UTC.
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
  const d = new Date(withZone);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: VENUE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// ============================================================
// MOCK δεδομένα — χρησιμοποιούνται μόνο όταν ΔΕΝ υπάρχουν τα
// παραπάνω environment variables (demo/δοκιμή χωρίς πραγματικό API).
// ============================================================

const MOCK_COURTS = [
  { id: "court-1", name: "Γήπεδο 1" },
  { id: "court-2", name: "Γήπεδο 2" },
  { id: "court-3", name: "Γήπεδο 3" },
  { id: "court-4", name: "Γήπεδο 4" },
];

const MOCK_PLAYERS = [
  { id: "p1", name: "Μαρία Π.", level: 3.5, phone: "99xxxxx1" },
  { id: "p2", name: "Γιώργος Σ.", level: 3.5, phone: "99xxxxx2" },
  { id: "p3", name: "Ελένη Τ.", level: 4.0, phone: "99xxxxx3" },
  { id: "p4", name: "Ανδρέας Κ.", level: 2.5, phone: "99xxxxx4" },
  { id: "p5", name: "Δήμητρα Λ.", level: 3.0, phone: "99xxxxx5" },
  { id: "p6", name: "Νίκος Κ.", level: 3.5, phone: "99xxxxx6" },
  { id: "p7", name: "Κατερίνα Μ.", level: 3.0, phone: "99xxxxx7" },
  { id: "p8", name: "Παύλος Ν.", level: 4.0, phone: "99xxxxx8" },
  { id: "p9", name: "Χριστίνα Ρ.", level: 2.5, phone: "99xxxxx9" },
  { id: "p10", name: "Σάββας Ι.", level: 4.5, phone: "99xxxxx10" },
];

function hashDate(dateStr) {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) % 997;
  return h;
}

const mockBookingsCache = new Map();

function buildMockBookingsForDate(dateStr) {
  if (mockBookingsCache.has(dateStr)) return mockBookingsCache.get(dateStr);

  const seed = hashDate(dateStr);
  const gapOffset = seed % 4;
  const trainingOffset = seed % 5;

  const bookings = [];
  const playerIds = MOCK_PLAYERS.map((p) => p.id);
  let cursor = seed % playerIds.length;

  MOCK_COURTS.forEach((court, ci) => {
    HOURS.forEach((time, ti) => {
      const slotIndex = ci * HOURS.length + ti;
      if (slotIndex % 4 === gapOffset) return; // κενό
      const isTraining = slotIndex % 5 === trainingOffset;
      const count = isTraining ? 1 : 2;
      const players = [];
      for (let i = 0; i < count; i++) {
        players.push(playerIds[cursor % playerIds.length]);
        cursor++;
      }
      bookings.push({ court: court.id, time, type: isTraining ? "training" : "game", players });
    });
  });

  mockBookingsCache.set(dateStr, bookings);
  return bookings;
}

function buildMockPastMatches() {
  const playerIds = MOCK_PLAYERS.map((p) => p.id);
  const matches = [];
  const today = new Date();
  let cursor = 0;
  for (let d = 1; d <= 14; d++) {
    const day = new Date(today);
    day.setDate(today.getDate() - d);
    const iso = day.toISOString().slice(0, 10);
    for (let m = 0; m < 2; m++) {
      const group = [];
      for (let i = 0; i < 4; i++) {
        group.push(playerIds[cursor % playerIds.length]);
        cursor += 3;
      }
      matches.push({ date: iso, players: group });
    }
  }
  return matches;
}

const MOCK_PAST_MATCHES = buildMockPastMatches();

// ============================================================
// Πραγματικό Playtomic Third Party API
// ============================================================

let cachedToken = null; // { token, expiresAt }

// Παίρνει (και ανανεώνει όταν χρειάζεται) το Bearer token. Τα tokens λήγουν
// μετά από 1 ώρα (βλ. Playtomic docs) — το ανανεώνουμε λίγο πριν λήξει.
async function getAuthToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
    return cachedToken.token;
  }
  const res = await fetch(`${PLAYTOMIC_BASE}/api/v1/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, secret: CLIENT_SECRET }),
  });
  if (!res.ok) {
    throw new Error(`Playtomic auth απέτυχε: HTTP ${res.status}`);
  }
  const data = await res.json();
  cachedToken = {
    token: data.token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

async function playtomicFetch(path, params = {}) {
  const token = await getAuthToken();
  const url = new URL(`${PLAYTOMIC_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  const res = await fetch(url, {
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Playtomic API error ${res.status} στο ${path}`);
  }
  return res.json();
}

function isoNoMs(date) {
  return date.toISOString().slice(0, 19);
}

// Το endpoint κρατήσεων είναι page-based· τραβάμε σελίδες μέχρι να έρθει
// σελίδα με λιγότερα αποτελέσματα από το ζητούμενο μέγεθος.
async function fetchAllBookings(startISO, endISO) {
  const all = [];
  let page = 0;
  const size = 200;
  for (;;) {
    const data = await playtomicFetch("/api/v1/bookings", {
      tenant_id: VENUE_ID,
      start_booking_date: startISO,
      end_booking_date: endISO,
      page,
      size,
    });
    all.push(...data);
    if (data.length < size) break;
    page += 1;
  }
  return all;
}

// Το endpoint παικτών χρησιμοποιεί cursor-based pagination.
async function fetchAllPlayers() {
  const all = [];
  let cursor;
  for (;;) {
    const data = await playtomicFetch(`/api/v1/venues/${VENUE_ID}/players`, {
      limit: 100,
      cursor_id: cursor,
      include: "SPORTS",
    });
    all.push(...data.data);
    if (!data.has_more) break;
    cursor = data.next_cursor_id;
  }
  return all;
}

const TRAINING_TYPES = new Set(["PRIVATE_CLASS", "COURSE_CLASS", "PUBLIC_CLASS"]);

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// Υπολογίζει τη διάρκεια μιας κράτησης σε λεπτά, ώστε το πρόγραμμα να μπορεί
// να τη δείχνει "κρατημένη" σε ΟΛΑ τα slots που καλύπτει (όχι μόνο στην ώρα
// έναρξης) — π.χ. ένα παιχνίδι 90 λεπτών πρέπει να γεμίζει 3 slots των 30'.
function bookingDurationMinutes(raw) {
  if (typeof raw.duration === "number" && raw.duration > 0) return raw.duration;
  if (raw.booking_start_date && raw.booking_end_date) {
    const start = new Date(
      /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw.booking_start_date) ? raw.booking_start_date : `${raw.booking_start_date}Z`
    );
    const end = new Date(
      /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw.booking_end_date) ? raw.booking_end_date : `${raw.booking_end_date}Z`
    );
    const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
    if (diffMin > 0) return diffMin;
  }
  return 90; // εύλογη προεπιλογή αν το API δεν δώσει διάρκεια/ώρα λήξης
}

function mapPlayer(raw) {
  const padel = (raw.sports || []).find((s) => s.sport_id === "PADEL");
  return {
    id: raw.player_id,
    name: raw.name || "Άγνωστος παίκτης",
    level: padel && typeof padel.level_value === "number" ? padel.level_value : 2.5,
    phone: raw.phone || "",
  };
}

// Μικρές, ξεχωριστές μνήμες cache ώστε να μη χτυπάμε το πραγματικό API σε
// κάθε request (και να μένουμε μέσα στο rate limit των 400 req/10 λεπτά).
let playersCache = { data: null, expiresAt: 0 };
let courtsCache = { data: null, expiresAt: 0 };
const realBookingsCache = new Map(); // dateStr -> { data, expiresAt }
let pastMatchesCache = { data: null, expiresAt: 0 };

async function getRealPlayers() {
  if (playersCache.data && playersCache.expiresAt > Date.now()) return playersCache.data;
  const raw = await fetchAllPlayers();
  const players = raw.map(mapPlayer);
  playersCache = { data: players, expiresAt: Date.now() + 5 * 60 * 1000 };
  return players;
}

async function getRealCourts() {
  if (MANUAL_COURTS) return MANUAL_COURTS;
  if (courtsCache.data && courtsCache.expiresAt > Date.now()) return courtsCache.data;

  // Χωρίς endpoint λίστας γηπέδων, τα «μαθαίνουμε» από τις κρατήσεις μιας
  // ευρύτερης περιόδου (προηγούμενες 7 + επόμενες 14 μέρες). Αν κάποιο
  // γήπεδο δεν έχει καμία κράτηση σε αυτό το διάστημα, δεν θα εμφανιστεί —
  // σε αυτή την περίπτωση καλύτερα να οριστεί το PLAYTOMIC_COURTS χειροκίνητα.
  const start = new Date();
  start.setDate(start.getDate() - 7);
  const end = new Date();
  end.setDate(end.getDate() + 14);
  const bookings = await fetchAllBookings(isoNoMs(start), isoNoMs(end));

  const seen = new Map();
  bookings.forEach((b) => {
    if (!seen.has(b.resource_id)) seen.set(b.resource_id, b.resource_name || b.resource_id);
  });
  const courts = Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  courtsCache = { data: courts, expiresAt: Date.now() + 60 * 60 * 1000 };
  return courts;
}

async function getRealBookingsForDate(dateStr) {
  const cached = realBookingsCache.get(dateStr);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // Τραβάμε λίγο ευρύτερο διάστημα σε UTC (μία μέρα πριν/μετά) γιατί, μετά τη
  // μετατροπή σε τοπική ώρα Κύπρου, κάποιες κρατήσεις κοντά στα μεσάνυχτα UTC
  // μπορεί να "μετακινηθούν" σε γειτονική ημερομηνία.
  const start = new Date(`${dateStr}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${dateStr}T23:59:59Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  const raw = await fetchAllBookings(isoNoMs(start), isoNoMs(end));

  const bookings = raw
    .filter((b) => !b.is_canceled)
    .map((b) => {
      const { date, time } = toVenueDateTimeParts(b.booking_start_date);
      return {
        date,
        court: b.resource_id,
        time,
        duration: bookingDurationMinutes(b),
        type: TRAINING_TYPES.has(b.booking_type) ? "training" : "game",
        players: (b.participant_info?.participants || []).map((p) => p.participant_id),
      };
    })
    // Κρατάμε μόνο τις κρατήσεις που πέφτουν πραγματικά στη ζητούμενη
    // ημερομηνία ΜΕΤΑ τη μετατροπή σε τοπική ώρα (όχι σε ώρα UTC).
    .filter((b) => b.date === dateStr)
    .map(({ date, ...rest }) => rest);

  realBookingsCache.set(dateStr, { data: bookings, expiresAt: Date.now() + 2 * 60 * 1000 });
  return bookings;
}

async function getRealPastMatches() {
  if (pastMatchesCache.data && pastMatchesCache.expiresAt > Date.now()) return pastMatchesCache.data;

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90); // το Playtomic API κρατάει ιστορικό ~3 μηνών

  const raw = await fetchAllBookings(isoNoMs(start), isoNoMs(end));

  const matches = raw
    .filter((b) => !b.is_canceled && !TRAINING_TYPES.has(b.booking_type))
    .map((b) => ({
      date: toVenueDateTimeParts(b.booking_start_date).date,
      players: (b.participant_info?.participants || []).map((p) => p.participant_id),
    }))
    .filter((m) => m.players.length > 0);

  pastMatchesCache = { data: matches, expiresAt: Date.now() + 30 * 60 * 1000 };
  return matches;
}

// ============================================================
// Δημόσιο API — το χρησιμοποιούν matching.js, history.js, swipe.js,
// server.js. Όλες οι συναρτήσεις είναι async ώστε να δουλεύουν είτε με
// mock είτε με πραγματικά δεδομένα χωρίς αλλαγή στον κώδικα που τις καλεί.
// ============================================================

async function getCourts() {
  return USE_REAL_API ? getRealCourts() : MOCK_COURTS;
}

function getHours() {
  return HOURS;
}

async function getPlayers() {
  return USE_REAL_API ? getRealPlayers() : MOCK_PLAYERS;
}

async function getBookingsForDate(date) {
  return USE_REAL_API ? getRealBookingsForDate(date) : buildMockBookingsForDate(date);
}

// Επιστρέφει τις επόμενες `count` ημερομηνίες (ISO yyyy-mm-dd) ξεκινώντας
// από σήμερα, μαζί με ελληνική ετικέτα ημέρας — για τον επιλογέα ημέρας.
function getUpcomingDates(count = 7) {
  const days = ["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"];
  const out = [];
  const base = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const label = `${days[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ date: iso, label });
  }
  return out;
}

async function getPastMatches() {
  return USE_REAL_API ? getRealPastMatches() : MOCK_PAST_MATCHES;
}

module.exports = {
  getCourts,
  getHours,
  getPlayers,
  getBookingsForDate,
  getUpcomingDates,
  getPastMatches,
  USE_REAL_API,
};
