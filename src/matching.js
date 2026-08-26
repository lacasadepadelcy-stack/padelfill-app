// matching.js
//
// Η "καρδιά" του PadelFill: εντοπισμός κενών (gap detection) και matching
// παικτών ίδιου επιπέδου για να τα γεμίσουν. Δουλεύει πάνω από τα δεδομένα
// του playtomicClient.js (mock ή πραγματικό Playtomic API) — όποτε αλλάξει
// η πηγή δεδομένων, αυτό το αρχείο δεν χρειάζεται αλλαγές.
//
// Όλες οι συναρτήσεις είναι async επειδή το playtomicClient.js μπορεί να
// κάνει πραγματικά HTTP calls προς το Playtomic API.

const playtomic = require("./playtomicClient");

const LEVEL_TOLERANCE = 0.5; // πόσο μπορεί να διαφέρει το επίπεδο για να θεωρηθεί "ταίρι"

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

async function buildSchedule(date) {
  const courts = await playtomic.getCourts();
  const bookings = await playtomic.getBookingsForDate(date);
  const players = await playtomic.getPlayers();
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]));

  // Ενοποιούμε το βασικό ωράριο με όποιες πραγματικές ώρες κράτησης δεν
  // πέφτουν ακριβώς πάνω σε αυτό, ώστε να μη "χάνεται" κανένα παιχνίδι από
  // το πρόγραμμα ακόμα κι αν ξεκινάει σε μη τυπική ώρα.
  const hoursSet = new Set(playtomic.getHours());
  bookings.forEach((b) => hoursSet.add(b.time));
  const hours = Array.from(hoursSet).sort();

  const schedule = courts.map((court) => {
    const slots = hours.map((time) => {
      const slotMin = timeToMinutes(time);
      // Μια κράτηση "καλύπτει" ΟΛΑ τα slots από την ώρα έναρξης μέχρι
      // ώρα έναρξης + διάρκεια (π.χ. ένα παιχνίδι 90' καλύπτει 3 slots των
      // 30'), όχι μόνο το slot της ακριβούς ώρας έναρξης — αλλιώς οι
      // επόμενες μισές ώρες θα φαίνονταν λανθασμένα "Κενό".
      const booking = bookings.find((b) => {
        if (b.court !== court.id) return false;
        const startMin = timeToMinutes(b.time);
        const endMin = startMin + (b.duration || 90);
        return slotMin >= startMin && slotMin < endMin;
      });
      if (booking) {
        const startMin = timeToMinutes(booking.time);
        const endMin = startMin + (booking.duration || 90);
        return {
          time,
          status: "booked",
          type: booking.type,
          isContinuation: booking.time !== time,
          startTime: booking.time,
          endTime: minutesToTime(endMin),
          players: booking.players.map((id) => playerById[id]).filter(Boolean),
        };
      }
      return { time, status: "gap", gapId: `${court.id}__${time}` };
    });
    return { court, slots };
  });

  return schedule;
}

// Βρίσκει παίκτες ίδιου/παρόμοιου επιπέδου για ένα συγκεκριμένο κενό.
// Λογική: παίρνουμε το μέσο επίπεδο των παικτών που έπαιξαν στο ίδιο γήπεδο
// γύρω από αυτή την ώρα (προηγούμενες/επόμενες κρατήσεις) ως ένδειξη για το
// "επίπεδο της ζώνης ώρας" — αλλιώς προτείνουμε παίκτες μεσαίου επιπέδου.
//
// options.minLevel / options.maxLevel: αν δοθούν (π.χ. από τον χρήστη μέσω
// UI), αντικαθιστούν την αυτόματη ζώνη ανοχής με ένα ρητό εύρος επιπέδου.
async function suggestPlayersForGap(gapId, date, options = {}) {
  const [courtId, time] = gapId.split("__");
  const bookings = await playtomic.getBookingsForDate(date);
  const players = await playtomic.getPlayers();
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

  // "Απασχολημένος τώρα" σημαίνει ότι η κράτησή του καλύπτει αυτή την ώρα
  // (όχι μόνο ότι ξεκινάει ακριβώς σε αυτήν) — π.χ. αν παίζει από τις 17:30
  // ένα παιχνίδι 90', είναι ακόμα απασχολημένος στις 18:00 και 18:30.
  const slotMin = timeToMinutes(time);
  const alreadyBookedNow = new Set(
    bookings
      .filter((b) => {
        const startMin = timeToMinutes(b.time);
        const endMin = startMin + (b.duration || 90);
        return slotMin >= startMin && slotMin < endMin;
      })
      .flatMap((b) => b.players)
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

async function buildDashboard(date) {
  const schedule = await buildSchedule(date);
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
