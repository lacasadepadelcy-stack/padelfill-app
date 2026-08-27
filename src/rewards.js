// rewards.js
//
// Απλό, in-memory ημερολόγιο ανταμοιβών: πότε δόθηκε ανταμοιβή/έκπτωση σε
// έναν VIP πελάτη, ώστε να μην ξαναδοθεί κατά λάθος για τον ίδιο μήνα.

const log = [];

function markRewardGiven(playerId, month, note) {
  const entry = {
    id: `r${log.length + 1}`,
    playerId,
    month, // "YYYY-MM" — ο μήνας για τον οποίο δόθηκε η ανταμοιβή
    note: note || "",
    givenAt: new Date().toISOString(),
  };
  log.push(entry);
  return entry;
}

function hasRewardForMonth(playerId, month) {
  return log.some((r) => r.playerId === playerId && r.month === month);
}

function getRewardLog() {
  return log.slice().reverse();
}

module.exports = { markRewardGiven, hasRewardForMonth, getRewardLog };
