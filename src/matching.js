// matching.js -- Εντοπισμός κενών και matching παικτών ίδιου επιπέδου.

const playtomic = require("./playtomicClient");

const LEVEL_TOLERANCE = 0.5;

function buildSchedule(date) {
const courts = playtomic.getCourts();
const hours = playtomic.getHours();
const bookings = playtomic.getBookingsForDate(date);
const players = playtomic.getPlayers();
const playerById = Object.fromEntries(players.map((p) => [p.id, p]));

const schedule = courts.map((court) => {
const slots = hours.map((time) => {
const booking = bookings.find((b) => b.court === court.id && b.time === time);
if (booking) {
return {
time,
status: "booked",
type: booking.type,
players: booking.players.map((id) => playerById[id]),
};
}
return { time, status: "gap", gapId: `${court.id}__${time}` };
});
return { court, slots };
});

return schedule;
}

function suggestPlayersForGap(gapId, date, options = {}) {
const [courtId, time] = gapId.split("__");
const bookings = playtomic.getBookingsForDate(date);
const players = playtomic.getPlayers();
const hours = playtomic.getHours();

const idx = hours.indexOf(time);
const neighborBookings = bookings.filter(
(b) => b.court === courtId && Math.abs(hours.indexOf(b.time) - idx) === 1
);

let targetLevel = null;
if (neighborBookings.length > 0) {
const playerById = Object.fromEntries(players.map((p) => [p.id, p]));
const levels = neighborBookings.flatMap((b) => b.players.map((id) => playerById[id]?.level).filter(Boolean));
if (levels.length > 0) {
targetLevel = levels.reduce((a, b) => a + b, 0) / levels.length;
}
}

const alreadyBookedNow = new Set(
bookings.filter((b) => b.time === time).flatMap((b) => b.players)
);

const hasManualRange = typeof options.minLevel === "number" || typeof options.maxLevel === "number";
const minLevel = hasManualRange ? (options.minLevel ?? -Infinity) : null;
const maxLevel = hasManualRange ? (options.maxLevel ?? Infinity) : null;

let candidates = players.filter((p) => !alreadyBookedNow.has(p.id));

if (hasManualRange) {
candidates = candidates.filter((p) => p.level >= minLevel && p.level <= maxLevel);
} else if (targetLevel !== null) {
candidates = candidates.filter((p) => Math.abs(p.level - targetLevel) <= LEVEL_TOLERANCE);
}

candidates.sort((a, b) => {
if (targetLevel === null) return a.level - b.level;
return Math.abs(a.level - targetLevel) - Math.abs(b.level - targetLevel);
});

return {
targetLevel,
levelRange: hasManualRange ? { minLevel, maxLevel } : null,
suggestions: candidates.slice(0, 5),
};
}

function buildDashboard(date) {
const schedule = buildSchedule(date);
let totalSlots = 0;
let bookedSlots = 0;
let gapSlots = 0;
let trainingCount = 0;
let gameCount = 0;

schedule.forEach(({ slots }) => {
slots.forEach((s) => {
totalSlots += 1;
if (s.status === "booked") {
bookedSlots += 1;
if (s.type === "training") trainingCount += 1;
if (s.type === "game") gameCount += 1;
} else {
gapSlots += 1;
}
});
});

const occupancyPct = totalSlots ? Math.round((bookedSlots / totalSlots) * 100) : 0;
const totalTypeCount = trainingCount + gameCount;
const trainingPct = totalTypeCount ? Math.round((trainingCount / totalTypeCount) * 100) : 0;
const gamePct = 100 - trainingPct;

return {
date,
occupancyPct,
totalSlots,
bookedSlots,
gapSlots,
trainingPct,
gamePct,
};
}

module.exports = { buildSchedule, suggestPlayersForGap, buildDashboard };
