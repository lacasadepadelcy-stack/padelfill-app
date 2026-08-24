// playtomicClient.js -- Δοκιμή ελληνικών: Γήπεδο 1, Μαρία Π.
// Αυτό το αρχείο "μιμείται" το Playtomic API με στατικά (mock) δεδομένα.
// 4 γήπεδα, ωράριο 07:00-23:30, κρατήσεις 90 λεπτών.
// Για σύνδεση με πραγματικό Playtomic: αντικαταστήστε τις συναρτήσεις με πραγματικά API calls,
// το API key μπαίνει πάντα ως environment variable, όχι μέσα στον κώδικα.

const COURTS = [
{ id: "court-1", name: "Γήπεδο 1" },
{ id: "court-2", name: "Γήπεδο 2" },
{ id: "court-3", name: "Γήπεδο 3" },
{ id: "court-4", name: "Γήπεδο 4" },
];

const HOURS = [
"07:00", "08:30", "10:00", "11:30", "13:00",
"14:30", "16:00", "17:30", "19:00", "20:30", "22:00",
];

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

function hashDate(dateStr) {
let h = 0;
for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) % 997;
return h;
}

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
if (slotIndex % 4 === gapOffset) return;
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
return buildMockBookingsForDate(date);
}

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

function buildMockPastMatches() {
const playerIds = PLAYERS.map((p) => p.id);
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

const PAST_MATCHES = buildMockPastMatches();

function getPastMatches() {
return PAST_MATCHES;
}

module.exports = { getCourts, getHours, getPlayers, getBookingsForDate, getUpcomingDates, getPastMatches };
