// swipe.js
//
// Απλή, in-memory υλοποίηση του "Swipe to Play" (Φάση 3 στο έγγραφο
// απαιτήσεων). Δεν είναι συνδεδεμένο με πραγματική βάση δεδομένων — είναι
// μόνο για να δείξει τη λογική (like/pass -> match όταν είναι αμοιβαίο).
//
// Χρησιμοποιεί το history.js ώστε να προτείνει, όσο γίνεται, διαφορετικούς
// αντίπαλους από αυτούς που ο παίκτης έχει ήδη παίξει πρόσφατα/συχνά μαζί.

const playtomic = require("./playtomicClient");
const history = require("./history");

// likes[fromId] = Set από ids που έχει κάνει like
const likes = {};

// options.minLevel / options.maxLevel: ρητό εύρος επιπέδου από τον χρήστη.
// Αν δεν δοθούν, χρησιμοποιείται προεπιλεγμένη ζώνη ±0.5 γύρω από το δικό του.
function getNextCandidate(forPlayerId, options = {}) {
  const players = playtomic.getPlayers();
  const me = players.find((p) => p.id === forPlayerId);
  const seen = likes[forPlayerId] || new Set();

  const hasManualRange = typeof options.minLevel === "number" || typeof options.maxLevel === "number";
  const minLevel = hasManualRange ? (options.minLevel ?? -Infinity) : (me ? me.level - 0.5 : -Infinity);
  const maxLevel = hasManualRange ? (options.maxLevel ?? Infinity) : (me ? me.level + 0.5 : Infinity);

  let pool = players.filter(
    (p) => p.id !== forPlayerId && !seen.has(p.id) && p.level >= minLevel && p.level <= maxLevel
  );

  // Ποικιλία αντιπάλων: προηγούνται όσοι έχει παίξει μαζί τους λιγότερες
  // φορές πρόσφατα, αντί να προτείνεται συνέχεια το ίδιο άτομο.
  pool = history.rankByVariety(forPlayerId, pool);

  return pool[0] || null;
}

function swipe(fromId, toId, liked) {
  if (!likes[fromId]) likes[fromId] = new Set();
  if (liked) {
    likes[fromId].add(toId);
  }

  // Mock αμοιβαιότητα: για το demo, θεωρούμε ότι ο άλλος παίκτης έχει ήδη
  // κάνει like σε 'p1' ώστε να μπορεί κανείς να δει ένα πραγματικό match.
  const reciprocal = likes[toId] && likes[toId].has(fromId);
  const demoMatch = liked && toId === "p1";

  return { matched: Boolean(liked && (reciprocal || demoMatch)) };
}

module.exports = { getNextCandidate, swipe };
