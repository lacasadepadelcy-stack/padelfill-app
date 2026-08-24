// playtomicClient.js
//
// Αυτό το αρχείο "μιμείται" το Playtomic API με στατικά (mock) δεδομένα, ώστε
// όλη η υπόλοιπη εφαρμογή (gap detection, matching, dashboard) να μπορεί να
// αναπτυχθεί και να δοκιμαστεί χωρίς πραγματικό API key.
//
// Ρυθμισμένο με τα πραγματικά στοιχεία του γηπέδου: 4 γήπεδα, σε κλειστή
// αποθήκη, ωράριο 07:00–23:30, κρατήσεις των 90 λεπτών.
//
// ΓΙΑ ΣΥΝΔΕΣΗ ΜΕ ΤΟ ΠΡΑΓΜΑΤΙΚΟ PLAYTOMIC API:
//   1. Πάρτε API key / OAuth credentials από το Playtomic Business.
//   2. Αντικαταστήστε τις συναρτήσεις παρακάτω με πραγματικά HTTP calls
//      (π.χ. με fetch/axios) προς τα endpoints του Playtomic.
//   3. Το "σχήμα" (shape) των δεδομένων που επιστρέφουν οι συναρτήσεις
//      πρέπει να παραμείνει ίδιο, ώστε να μη χρειαστεί αλλαγή στον
//      υπόλοιπο κώδικα (matching.js, server.js).
//
// ΣΗΜΑΝΤΙΚΟ: το πραγματικό API key ΔΕΝ μπαίνει ποτέ εδώ μέσα στον κώδικα.
// Μπαίνει σε μεταβλητή περιβάλλοντος (environment variable), π.χ.
// PLAYTOMIC_API_KEY, που ορίζεται στο server όπου θα "ζήσει" η εφαρμογή
// (hosting) — όχι σε αρχείο που μπαίνει σε git/κοινόχρηστο χώρο.

const COURTS = [
  { id: "court-1", name: "Γήπεδο 1" },
  { id: "court-2", name: "Γήπεδο 2" },
  { id: "court-3", name: "Γήπεδο 3" },
  { id: "court-4", name: "Γήπεδο 4" },
];

// Ωράριο κλαμπ: 07:00–23:30, κρατήσεις 90 λεπτών.
const HOURS = [
  "07:00", "08:30", "10:00", "11:30", "13:00",
  "14:30", "16:00", "17:30", "19:00", "20:30", "22:00",
];

// Mock παίκτες με επίπεδο (στο πραγματικό Playtomic αυτό θα έρχεται από το
// προφίλ / ιστορικό αγώνων του κάθε παίκτη).
const PLAYERS = [
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

// Απλό hash πάνω στο ημερομηνιακό string, ώστε κάθε μέρα να έχει
// διαφορετικό (αλλά σταθερό/επαναλήψιμο) μοτίβο κρατήσεων στο mock.
function hashDate(dateStr) {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) % 997;
  return h;
}

// Mock κρατήσεις για μια συγκεκριμένη μέρα, γεννημένες με ένα απλό
// επαναλαμβανόμενο μοτίβο ώστε να υπάρχουν ρεαλιστικά κενά και στα 4 γήπεδα
// για δοκιμή, και να διαφέρουν ελαφρώς από μέρα σε μέρα. Στο πραγματικό API
// αυτό θα αντικατασταθεί από πραγματικές κρατήσεις (GET /bookings?date=...).
const bookingsCache = new Map();

function buildMockBookingsForDate(dateStr) {
  if (bookingsCache.has(dateStr)) return bookingsCache.get(dateStr);

  const seed = hashDate(dateStr);
  const gapOffset = seed % 4;
  const trainingOffset = seed % 5;

  const bookings = [];
  const playerIds = PLAYERS.map((p) => p.id);
  let cursor = seed % playerIds.length;

  COURTS.forEach((court, ci) => {
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

  bookingsCache.set(dateStr, bookings);
  return bookings;
}

function getCourts() {
  return COURTS;
}

function getHours() {
  return HOURS;
}

function getPlayers() {
  return PLAYERS;
}

function getBookingsForDate(date) {
  // Στο πραγματικό API: GET /bookings?date=... ανά club.
  return buildMockBookingsForDate(date);
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

// Mock ιστορικό προηγούμενων παιχνιδιών (τελευταίες ~14 μέρες), ανεξάρτητο
// από το μελλοντικό πρόγραμμα — χρησιμοποιείται για να θυμάται η εφαρμογή
// ποιος έπαιξε με ποιον, ώστε να προτείνει ποικιλία αντιπάλων (βλ. history.js).
// Στο πραγματικό API αυτό θα έρχεται από το ιστορικό κρατήσεων του Playtomic.
function buildMockPastMatches() {
  const playerIds = PLAYERS.map((p) => p.id);
  const matches = [];
  const today = new Date();
  let cursor = 0;
  for (let d = 1; d <= 14; d++) {
    const day = new Date(today);
    day.setDate(today.getDate() - d);
    const iso = day.toISOString().slice(0, 10);
    // 2 "παιχνίδια" (4 παίκτες το καθένα) ανά μέρα ιστορικού
    for (let m = 0; m < 2; m++) {
      const group = [];
      for (let i = 0; i < 4; i++) {
        group.push(playerIds[cursor % playerIds.length]);
        cursor += 3; // "τυχαία" διασπορά ώστε να μην επαναλαμβάνονται πάντα οι ίδιοι
      }
      matches.push({ date: iso, players: group });
    }
  }
  return matches;
}

const PAST_MATCHES = buildMockPastMatches();

function getPastMatches() {
  // Στο πραγματικό API: GET /matches/history?club=...
  return PAST_MATCHES;
}

module.exports = { getCourts, getHours, getPlayers, getBookingsForDate, getUpcomingDates, getPastMatches };
