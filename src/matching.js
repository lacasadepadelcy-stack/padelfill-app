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
const notifications = require("./notifications");
const rewards = require("./rewards");

const LEVEL_TOLERANCE = 0.3; // πόσο μπορεί να διαφέρει το επίπεδο για να θεωρηθεί "ταίρι"
const RECENT_NOTIFY_HOURS = 48; // μετά από πόσες ώρες ξαναθεωρείται "φρέσκος" ένας παίκτης που ειδοποιήθηκε
// Πόσο "βαραίνει" η αξιοπιστία (ιστορικό ανταπόκρισης) στην τελική σειρά —
// αρκετά μικρό ώστε να μην ανατρέπει ποτέ ένα σαφώς καλύτερο ταίριασμα
// επιπέδου, αλλά αρκετό για να ξεχωρίζει ανάμεσα σε παρόμοιους υποψήφιους.
const RELIABILITY_NUDGE = 0.15;

// Βαθμός αξιοπιστίας 0-1 (πόσο συχνά έκλεισε γήπεδο όταν ειδοποιήθηκε).
// Παίκτες χωρίς κανένα ιστορικό ακόμα θεωρούνται ουδέτεροι (0.5) — δεν
// τιμωρούνται απλά επειδή δεν έχουν ξαναειδοποιηθεί.
function reliabilityWeight(playerId) {
  const rel = notifications.getReliability(playerId);
  return rel ? rel.booked / rel.sent : 0.5;
}

// Απλό, ντετερμινιστικό "ανακάτεμα" (ίδιο seed -> ίδιο αποτέλεσμα, ώστε η
// σελίδα να μη δείχνει διαφορετικά ονόματα σε κάθε refresh, αλλά ΔΙΑΦΟΡΕΤΙΚΟ
// αποτέλεσμα ανά κενό/ημέρα). Χρησιμοποιείται όταν ΔΕΝ έχουμε κάποια ένδειξη
// επιπέδου (κανένα γειτονικό παιχνίδι) — ώστε να μην προτείνουμε πάντα τους
// ίδιους (π.χ. πάντα τους χαμηλότερου επιπέδου) παίκτες, αλλά να καλύπτονται
// διαφορετικά επίπεδα και διαφορετικοί πελάτες με τον καιρό.
function seededShuffle(items, seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Μέγιστη επιτρεπτή διαφορά επιπέδου ΑΝΑΜΕΣΑ σε οποιουσδήποτε δύο παίκτες
// μέσα στην ΙΔΙΑ λίστα προτάσεων — ώστε να μη βγαίνει ποτέ λίστα με π.χ.
// επίπεδο 1.02 μαζί με 4.0 (ακόμα κι όταν δεν υπάρχει γειτονικό παιχνίδι
// για να δώσει ένδειξη επιπέδου).
const SUGGESTION_LEVEL_SPREAD = 0.3;

// Διαλέγει, με τη σειρά προτεραιότητας που ήδη έχουν οι υποψήφιοι (π.χ. πιο
// κοντά στο targetLevel, ή shuffle για ποικιλία), μέχρι `limit` παίκτες —
// προσπερνώντας όποιον θα έκανε το συνολικό εύρος επιπέδου της τελικής
// λίστας να ξεπεράσει το `maxSpread`.
function pickWithinLevelSpread(orderedCandidates, limit, maxSpread) {
  const chosen = [];
  let min = Infinity;
  let max = -Infinity;
  for (const p of orderedCandidates) {
    const newMin = Math.min(min, p.level);
    const newMax = Math.max(max, p.level);
    if (newMax - newMin <= maxSpread) {
      chosen.push(p);
      min = newMin;
      max = newMax;
      if (chosen.length >= limit) break;
    }
  }
  return chosen;
}

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
  const limit = options.limit || 5;

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

  if (hasManualRange || targetLevel !== null) {
    // Έχουμε συγκεκριμένη ένδειξη επιπέδου (χειροκίνητο εύρος ή γειτονικό
    // παιχνίδι) -> ταξινόμηση με βάση αυτήν, με μικρή "ώθηση" υπέρ όσων
    // ιστορικά ανταποκρίνονται περισσότερο όταν ισοπαλεύουν σε ταίριασμα.
    candidates.sort((a, b) => {
      const baseA = hasManualRange ? a.level : Math.abs(a.level - targetLevel);
      const baseB = hasManualRange ? b.level : Math.abs(b.level - targetLevel);
      const scoreA = baseA - reliabilityWeight(a.id) * RELIABILITY_NUDGE;
      const scoreB = baseB - reliabilityWeight(b.id) * RELIABILITY_NUDGE;
      return scoreA - scoreB;
    });
  } else {
    // Καμία ένδειξη επιπέδου -> αντί να δείχνουμε πάντα τους ίδιους (πάντα
    // τους χαμηλότερου επιπέδου, αφού πριν ταξινομούσαμε αύξουσα), κάνουμε
    // πρώτα ένα ντετερμινιστικό ανακάτεμα (ποικιλία) και μετά προτεραιότητα
    // σε όσους ιστορικά ανταποκρίνονται περισσότερο (οι χωρίς ιστορικό
    // μένουν στη σειρά του ανακατέματος μεταξύ τους).
    candidates = seededShuffle(candidates, `${date}|${gapId}`);
    candidates.sort((a, b) => reliabilityWeight(b.id) - reliabilityWeight(a.id));
  }

  // Όσοι έχουν ειδοποιηθεί πρόσφατα (τελευταίες 48 ώρες, για ΟΠΟΙΟΔΗΠΟΤΕ
  // κενό) μετακινούνται στο τέλος της λίστας — έτσι δεν στέλνουμε συνέχεια
  // μήνυμα στους ίδιους λίγους πελάτες, αλλά "γυρνάμε" σε διαφορετικούς.
  const recentlyNotified = notifications.getRecentlyNotifiedIds(RECENT_NOTIFY_HOURS);
  const fresh = candidates.filter((p) => !recentlyNotified.has(p.id));
  const stale = candidates.filter((p) => recentlyNotified.has(p.id));
  candidates = [...fresh, ...stale];

  // Ακόμα κι αν η λίστα candidates έχει μεγάλο εύρος επιπέδων (π.χ. όταν δεν
  // υπάρχει γειτονικό παιχνίδι για ένδειξη), η τελική λίστα προτάσεων
  // περιορίζεται ώστε η μέγιστη διαφορά επιπέδου ανάμεσα σε δύο παίκτες της
  // να μην ξεπερνά το SUGGESTION_LEVEL_SPREAD (0.30). Προσθέτουμε και το
  // ιστορικό αξιοπιστίας σε κάθε πρόταση (για εμφάνιση στο UI).
  const finalSuggestions = pickWithinLevelSpread(candidates, limit, SUGGESTION_LEVEL_SPREAD).map((p) => ({
    ...p,
    reliability: notifications.getReliability(p.id),
  }));

  return {
    targetLevel,
    levelRange: hasManualRange ? { minLevel, maxLevel } : null,
    suggestions: finalSuggestions,
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

  // Εκτιμώμενα έσοδα της ημέρας — μόνο αν έχει οριστεί η τιμή/ώρα ανά γήπεδο
  // (COURT_RATE_PER_HOUR στο hosting). Κάθε slot είναι 30 λεπτά, άρα
  // slots * 0.5 * τιμή/ώρα.
  const hourlyRate = parseFloat(process.env.COURT_RATE_PER_HOUR);
  const estimatedRevenue = Number.isFinite(hourlyRate) ? Math.round(bookedSlots * 0.5 * hourlyRate) : null;

  return {
    date,
    occupancyPct,
    totalSlots,
    bookedSlots,
    gapSlots,
    trainingPct,
    gamePct,
    estimatedRevenue,
  };
}

// Συγκεντρωτική λίστα ΟΛΩΝ των κενών τις επόμενες `days` ημέρες, μαζί με
// προτεινόμενους παίκτες ίδιου επιπέδου για το καθένα — ώστε να μη χρειάζεται
// να μπαίνει κανείς σε κάθε μέρα/κενό ξεχωριστά για να δει ποιον να καλέσει.
// Συνεχόμενα κενά slots στο ίδιο γήπεδο ενώνονται σε ένα ενιαίο χρονικό
// παράθυρο (π.χ. "10:00–12:00"), όπως ακριβώς και τα παιχνίδια στο πρόγραμμα.
const CLOSING_TIME = "23:30"; // ώρα κλεισίματος club — χρησιμοποιείται όταν ένα κενό φτάνει μέχρι το τέλος της ημέρας

async function buildWeeklyGaps(days = 7) {
  const dates = playtomic.getUpcomingDates(days);
  const report = [];
  // Μετράει πόσες φορές έχει ήδη προταθεί ο κάθε παίκτης μέσα σε ΑΥΤΗ την
  // αναφορά — ώστε, ανάμεσα σε ισοδύναμους υποψήφιους, να προηγούνται όσοι
  // δεν έχουν προταθεί ακόμα (διαφορετικοί πελάτες σε κάθε κενό, όχι πάντα
  // οι ίδιοι 2-3 άνθρωποι σε όλη την εβδομάδα).
  const suggestionUsage = new Map();

  for (const { date, label } of dates) {
    const schedule = await buildSchedule(date);
    const dayEntries = [];

    for (const { court, slots } of schedule) {
      let i = 0;
      while (i < slots.length) {
        if (slots[i].status !== "gap") {
          i += 1;
          continue;
        }
        const startIdx = i;
        while (i < slots.length && slots[i].status === "gap") i += 1;
        const startTime = slots[startIdx].time;
        const endTime = i < slots.length ? slots[i].time : CLOSING_TIME;
        const gapMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);
        // Αγνοούμε "κενά" μηδενικής διάρκειας (π.χ. ακριβώς η ώρα κλεισίματος,
        // που δεν αντιπροσωπεύει πραγματικό παίξιμο χρόνο).
        if (gapMinutes <= 0) continue;

        const gapId = slots[startIdx].gapId;
        // Ζητάμε μεγαλύτερη «δεξαμενή» υποψηφίων (10) από όσους θα δείξουμε
        // τελικά (4 — μια έτοιμη «παρέα» για το κενό), ώστε να έχουμε από τι
        // να διαλέξουμε για ποικιλία.
        const { targetLevel, suggestions: pool } = await suggestPlayersForGap(gapId, date, { limit: 10 });

        const ranked = [...pool].sort(
          (a, b) => (suggestionUsage.get(a.id) || 0) - (suggestionUsage.get(b.id) || 0)
        );
        // 4 άτομα = μια πλήρης, έτοιμη παρέα για να γεμίσει το γήπεδο (όχι
        // μεμονωμένα ονόματα χωρίς σχέση μεταξύ τους).
        const chosen = ranked.slice(0, 4);
        chosen.forEach((p) => suggestionUsage.set(p.id, (suggestionUsage.get(p.id) || 0) + 1));

        dayEntries.push({
          date,
          dateLabel: label,
          court,
          startTime,
          endTime,
          gapMinutes,
          gapId,
          targetLevel,
          suggestions: chosen,
        });
      }
    }

    // Προτεραιότητα: τα μεγαλύτερα (πιο "χαμένα") κενά πρώτα μέσα σε κάθε
    // ημέρα, ώστε να φαίνονται πρώτα οι πιο σημαντικές ευκαιρίες γεμίσματος.
    dayEntries.sort((a, b) => b.gapMinutes - a.gapMinutes);
    report.push(...dayEntries);
  }

  return report;
}

// Στατιστικά κενών ανά ημέρα και ανά ώρα, μέσα στις επόμενες `days` ημέρες —
// για να φαίνεται ποια μέρα/ώρα έχει τα περισσότερα κενά (πού αξίζει να
// ρίξει κανείς προσφορές/προσπάθεια πρώτα).
async function buildWeeklyStats(days = 7) {
  const dates = playtomic.getUpcomingDates(days);
  const byDay = [];
  const byHour = {}; // time -> { gapCount, totalCount }

  for (const { date, label } of dates) {
    const schedule = await buildSchedule(date);
    let totalSlots = 0;
    let gapSlots = 0;
    schedule.forEach(({ slots }) => {
      slots.forEach((s) => {
        totalSlots += 1;
        if (!byHour[s.time]) byHour[s.time] = { gapCount: 0, totalCount: 0 };
        byHour[s.time].totalCount += 1;
        if (s.status === "gap") {
          gapSlots += 1;
          byHour[s.time].gapCount += 1;
        }
      });
    });
    byDay.push({
      date,
      label,
      totalSlots,
      gapSlots,
      gapPct: totalSlots ? Math.round((gapSlots / totalSlots) * 100) : 0,
    });
  }

  const byHourArr = Object.entries(byHour)
    .map(([time, v]) => ({
      time,
      gapPct: v.totalCount ? Math.round((v.gapCount / v.totalCount) * 100) : 0,
    }))
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  return { byDay, byHour: byHourArr };
}

// Αυτόματος έλεγχος: για κάθε ειδοποίηση που περιμένει ακόμα αποτέλεσμα,
// κοιτάμε αν το γήπεδο/ώρα έχει πλέον πραγματική κράτηση στο Playtomic —
// αν ναι, το κενό γέμισε (outcome "booked"), χωρίς να χρειάζεται να το
// σημειώσει κανείς χειροκίνητα. Αν η ημέρα του κενού έχει ήδη περάσει και
// ΔΕΝ έγινε τελικά κράτηση, το σημειώνουμε "no" (δεν έπιασε).
async function reconcileNotificationOutcomes() {
  const pending = notifications.getLog().filter((n) => n.outcome === null && n.date);
  if (!pending.length) return { updated: 0 };

  const bookingsByDate = new Map();
  const todayISO = new Date().toISOString().slice(0, 10);
  let updated = 0;

  for (const entry of pending) {
    const [courtId, time] = entry.gapId.split("__");
    if (!bookingsByDate.has(entry.date)) {
      bookingsByDate.set(entry.date, await playtomic.getBookingsForDate(entry.date));
    }
    const bookings = bookingsByDate.get(entry.date);
    const slotMin = timeToMinutes(time);
    const isBooked = bookings.some((b) => {
      if (b.court !== courtId) return false;
      const startMin = timeToMinutes(b.time);
      const endMin = startMin + (b.duration || 90);
      return slotMin >= startMin && slotMin < endMin;
    });

    if (isBooked) {
      notifications.setOutcome(entry.id, "booked");
      updated += 1;
    } else if (entry.date < todayISO) {
      notifications.setOutcome(entry.id, "no");
      updated += 1;
    }
  }

  return { updated };
}

const MONTH_NAMES_EL = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];

// Μηνιαία τάση: πόσα παιχνίδια (bookings) έγιναν ανά μήνα τους τελευταίους
// ~3 μήνες (όσο κρατάει το ιστορικό), για να φαίνεται αν η πληρότητα
// ανεβαίνει ή κατεβαίνει με τον καιρό. Ο τρέχων μήνας σημειώνεται ως
// "partial" (δεν έχει τελειώσει ακόμα) ώστε να μη συγκρίνεται άδικα με
// ολοκληρωμένους μήνες.
async function buildMonthlyTrend() {
  const matches = await playtomic.getPastMatches();
  const byMonth = new Map(); // "YYYY-MM" -> πλήθος παιχνιδιών

  matches.forEach((m) => {
    const monthKey = m.date.slice(0, 7);
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + 1);
  });

  const today = new Date();

  const months = Array.from(byMonth.keys())
    .sort()
    .map((monthKey) => {
      const [y, mo] = monthKey.split("-").map(Number);
      const isCurrentMonth = today.getFullYear() === y && today.getMonth() + 1 === mo;
      const daysInMonth = new Date(y, mo, 0).getDate();
      const daysSoFar = isCurrentMonth ? today.getDate() : daysInMonth;
      const bookings = byMonth.get(monthKey);
      return {
        month: monthKey,
        label: `${MONTH_NAMES_EL[mo - 1]} ${y}`,
        bookings,
        avgPerDay: daysSoFar ? Math.round((bookings / daysSoFar) * 10) / 10 : 0,
        partial: isCurrentMonth,
      };
    });

  // Ποσοστιαία μεταβολή ανάμεσα στους δύο πιο πρόσφατους ΟΛΟΚΛΗΡΩΜΕΝΟΥΣ μήνες
  // (αγνοώντας τον τρέχοντα, μισοτελειωμένο μήνα) — για μια γρήγορη ένδειξη
  // τάσης "πάμε καλύτερα ή χειρότερα".
  const completedMonths = months.filter((m) => !m.partial);
  let trendPct = null;
  if (completedMonths.length >= 2) {
    const latest = completedMonths[completedMonths.length - 1];
    const prev = completedMonths[completedMonths.length - 2];
    if (prev.avgPerDay > 0) {
      trendPct = Math.round(((latest.avgPerDay - prev.avgPerDay) / prev.avgPerDay) * 100);
    }
  }

  return { months, trendPct };
}

// Όριο για να θεωρείται ένας πελάτης "τακτικός"/VIP — 8+ παιχνίδια τον μήνα
// (περίπου 2 τη βδομάδα). Χρησιμοποιείται για το badge στον πίνακα πελατών.
const VIP_THRESHOLD_PER_MONTH = 8;

// Το "Δευτέρα αυτής της εβδομάδας" ως κλειδί εβδομάδας (YYYY-MM-DD), ώστε να
// ομαδοποιούνται οι κρατήσεις ανά εβδομάδα όταν ζητηθεί εβδομαδιαία προβολή.
function getWeekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
}

function formatWeekLabel(mondayKey) {
  const monday = new Date(`${mondayKey}T00:00:00Z`);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${fmt(monday)}–${fmt(sunday)}`;
}

// Πόσα παιχνίδια έκανε ΚΑΘΕ παίκτης ανά μήνα Ή ανά εβδομάδα (τελευταίοι ~3
// μήνες, όσο κρατάει το ιστορικό) — χρήσιμο για να φτιάξει κανείς πρόγραμμα
// ανταμοιβής στους πιο τακτικούς πελάτες. Το όριο VIP παραμένει πάντα "ανά
// ημερολογιακό μήνα" (επιχειρηματικός κανόνας), ανεξάρτητα από το αν η
// προβολή είναι ανά εβδομάδα ή ανά μήνα.
async function buildPlayerActivity(granularity = "month") {
  const [matches, players] = await Promise.all([playtomic.getPastMatches(), playtomic.getPlayers()]);
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]));

  const isWeekly = granularity === "week";
  const bucketKeyFor = (dateStr) => (isWeekly ? getWeekKey(dateStr) : dateStr.slice(0, 7));
  const bucketLabelFor = (key) => {
    if (isWeekly) return formatWeekLabel(key);
    const [y, mo] = key.split("-").map(Number);
    return `${MONTH_NAMES_EL[mo - 1]} ${y}`;
  };

  const perPlayerBucket = new Map(); // playerId -> Map(bucketKey -> count) — για την προβολή
  const perPlayerMonth = new Map(); // playerId -> Map(monthKey -> count) — πάντα ανά μήνα, για το VIP
  const bucketSet = new Set();

  matches.forEach((m) => {
    const bucketKey = bucketKeyFor(m.date);
    const monthKey = m.date.slice(0, 7);
    bucketSet.add(bucketKey);
    m.players.forEach((pid) => {
      if (!perPlayerBucket.has(pid)) perPlayerBucket.set(pid, new Map());
      const bm = perPlayerBucket.get(pid);
      bm.set(bucketKey, (bm.get(bucketKey) || 0) + 1);

      if (!perPlayerMonth.has(pid)) perPlayerMonth.set(pid, new Map());
      const mm = perPlayerMonth.get(pid);
      mm.set(monthKey, (mm.get(monthKey) || 0) + 1);
    });
  });

  const buckets = Array.from(bucketSet).sort();
  const bucketLabels = Object.fromEntries(buckets.map((k) => [k, bucketLabelFor(k)]));

  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysSoFar = today.getDate();
  const allMonths = Array.from(new Set(matches.map((m) => m.date.slice(0, 7)))).sort();
  const completedMonths = allMonths.filter((mk) => mk !== currentMonthKey);
  const lastCompleteKey = completedMonths[completedMonths.length - 1];

  const activity = Array.from(perPlayerBucket.entries())
    .map(([pid, bucketMap]) => {
      const player = playerById[pid];
      const byBucket = {};
      let total = 0;
      buckets.forEach((k) => {
        const count = bucketMap.get(k) || 0;
        byBucket[k] = count;
        total += count;
      });

      const monthMap = perPlayerMonth.get(pid) || new Map();

      // Ρυθμός για το VIP badge: προτιμάμε τον τελευταίο ΟΛΟΚΛΗΡΩΜΕΝΟ μήνα·
      // αν δεν υπάρχει ακόμα (νέος πελάτης), κάνουμε προβολή του τρέχοντος
      // μισοτελειωμένου μήνα στις υπόλοιπες μέρες, ώστε να μη φαίνεται
      // άδικα "μη τακτικός" απλά επειδή ο μήνας μόλις ξεκίνησε.
      const vipMonth = lastCompleteKey || currentMonthKey;
      const rateForVip = lastCompleteKey
        ? monthMap.get(lastCompleteKey) || 0
        : daysSoFar
        ? Math.round(((monthMap.get(currentMonthKey) || 0) / daysSoFar) * daysInCurrentMonth)
        : 0;
      const isVip = rateForVip >= VIP_THRESHOLD_PER_MONTH;

      // Πόσα παιχνίδια λείπουν ΑΥΤΟΝ τον μήνα (τον τρέχοντα, όχι προβολή) για
      // να φτάσει το όριο VIP — μόνο χρήσιμο ενόσω δεν είναι ήδη VIP.
      const gamesToVip = isVip
        ? 0
        : Math.max(VIP_THRESHOLD_PER_MONTH - (monthMap.get(currentMonthKey) || 0), 0);

      return {
        id: pid,
        name: player ? player.name : "Άγνωστος παίκτης",
        level: player ? player.level : null,
        total,
        byMonth: byBucket,
        vip: isVip,
        vipMonth,
        gamesToVip,
        rewardGiven: rewards.hasRewardForMonth(pid, vipMonth),
      };
    })
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total);

  return {
    months: buckets,
    monthLabels: bucketLabels,
    granularity: isWeekly ? "week" : "month",
    players: activity,
    vipThreshold: VIP_THRESHOLD_PER_MONTH,
  };
}

// Πόσα παιχνίδια χρειάζεται να έχει παίξει κάποιος ιστορικά για να θεωρηθεί
// "τακτικός" πελάτης (όχι απλά κάποιος που δοκίμασε μία φορά και δεν ξανάρθε).
const LAPSED_MIN_HISTORICAL_GAMES = 4;
// Πόσες μέρες χωρίς κανένα παιχνίδι θεωρούνται "σταμάτησε να έρχεται".
const LAPSED_DAYS_THRESHOLD = 14;

// Εντοπίζει παίκτες που έπαιζαν τακτικά αλλά έχουν καιρό να εμφανιστούν —
// καλοί υποψήφιοι για ένα φιλικό μήνυμα "μας λείψατε" ώστε να μην τους
// χάσουμε οριστικά ως πελάτες.
async function buildLapsedCustomers() {
  const [matches, players] = await Promise.all([playtomic.getPastMatches(), playtomic.getPlayers()]);
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]));

  const statsByPlayer = new Map(); // playerId -> { count, lastDate }
  matches.forEach((m) => {
    m.players.forEach((pid) => {
      if (!statsByPlayer.has(pid)) statsByPlayer.set(pid, { count: 0, lastDate: null });
      const s = statsByPlayer.get(pid);
      s.count += 1;
      if (!s.lastDate || m.date > s.lastDate) s.lastDate = m.date;
    });
  });

  const todayMs = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();

  const lapsed = Array.from(statsByPlayer.entries())
    .map(([pid, s]) => {
      const player = playerById[pid];
      const daysSince = Math.round((todayMs - new Date(`${s.lastDate}T00:00:00Z`).getTime()) / 86400000);
      return {
        id: pid,
        name: player ? player.name : "Άγνωστος παίκτης",
        level: player ? player.level : null,
        totalGames: s.count,
        lastPlayedDate: s.lastDate,
        daysSinceLastPlay: daysSince,
      };
    })
    .filter((p) => p.totalGames >= LAPSED_MIN_HISTORICAL_GAMES && p.daysSinceLastPlay >= LAPSED_DAYS_THRESHOLD)
    .sort((a, b) => b.daysSinceLastPlay - a.daysSinceLastPlay);

  return { lapsed, minGames: LAPSED_MIN_HISTORICAL_GAMES, daysThreshold: LAPSED_DAYS_THRESHOLD };
}

// Πόσοι παίκτες χρειάζονται για ένα πλήρες παιχνίδι padel (2 εναντίον 2).
const GAME_FULL_SIZE = 4;

// Εντοπίζει "ανοιχτά παιχνίδια" (ό,τι στο Playtomic λέγεται "Open Match"):
// κρατήσεις τύπου "παιχνίδι" που ΥΠΑΡΧΟΥΝ αλλά δεν έχουν συμπληρώσει τους 4
// παίκτες — π.χ. έκλεισαν το γήπεδο 2 άτομα και ψάχνουν άλλους 2. Διαφορετικό
// από τα "κενά": εδώ η κράτηση υπάρχει, απλά λείπουν παίκτες. Χρησιμοποιούμε
// το ΑΚΡΙΒΕΣ μέσο επίπεδο των ήδη υπαρχόντων παικτών ως στόχο — πιο ακριβές
// από την εικασία που κάνουμε για τα κενά (γειτονικό παιχνίδι).
async function buildOpenMatches(days = 7) {
  const dates = playtomic.getUpcomingDates(days);
  const report = [];
  const suggestionUsage = new Map();

  for (const { date, label } of dates) {
    const schedule = await buildSchedule(date);

    for (const { court, slots } of schedule) {
      const seen = new Set(); // ένα παιχνίδι μπορεί να καλύπτει πολλά slots (span) — μετράμε μία φορά
      for (const s of slots) {
        if (s.status !== "booked" || s.type !== "game") continue;
        const key = `${s.startTime}__${s.endTime}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const currentPlayers = s.players || [];
        const missing = GAME_FULL_SIZE - currentPlayers.length;
        if (missing <= 0) continue;

        const levels = currentPlayers.map((p) => p.level).filter((l) => typeof l === "number");
        const targetLevel = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : null;

        const gapId = `${court.id}__${s.startTime}`;
        const { suggestions: pool } = await suggestPlayersForGap(gapId, date, {
          minLevel: targetLevel !== null ? targetLevel - LEVEL_TOLERANCE : undefined,
          maxLevel: targetLevel !== null ? targetLevel + LEVEL_TOLERANCE : undefined,
        });

        const ranked = [...pool].sort(
          (a, b) => (suggestionUsage.get(a.id) || 0) - (suggestionUsage.get(b.id) || 0)
        );
        const chosen = ranked.slice(0, missing + 2); // λίγοι παραπάνω υποψήφιοι από όσοι λείπουν, για επιλογή
        chosen.forEach((p) => suggestionUsage.set(p.id, (suggestionUsage.get(p.id) || 0) + 1));

        report.push({
          date,
          dateLabel: label,
          court,
          startTime: s.startTime,
          endTime: s.endTime,
          existingPlayers: currentPlayers,
          spotsNeeded: missing,
          targetLevel,
          gapId,
          suggestions: chosen,
        });
      }
    }
  }

  return report;
}

module.exports = {
  buildSchedule,
  suggestPlayersForGap,
  buildDashboard,
  buildWeeklyGaps,
  buildWeeklyStats,
  reconcileNotificationOutcomes,
  buildMonthlyTrend,
  buildPlayerActivity,
  buildLapsedCustomers,
  buildOpenMatches,
};
