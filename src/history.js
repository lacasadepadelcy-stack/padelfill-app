// history.js
//
// Κρατάει ιστορικό ποιος έπαιξε με ποιον, ώστε το matching να μπορεί να
// προτείνει ποικιλία αντιπάλων αντί να προτείνει πάντα τους ίδιους παίκτες.
// Όλες οι συναρτήσεις είναι async επειδή το playtomicClient.js μπορεί να
// κάνει πραγματικά HTTP calls προς το Playtomic API.

const playtomic = require("./playtomicClient");

// Χτίζει, για κάθε παίκτη, πόσες φορές έπαιξε με κάθε άλλον παίκτη και πότε
// έπαιξαν τελευταία φορά μαζί.
async function buildOpponentStats() {
  const matches = await playtomic.getPastMatches();
  const stats = {}; // stats[playerId][opponentId] = { count, lastDate }

  matches.forEach((match) => {
    match.players.forEach((playerId) => {
      match.players.forEach((opponentId) => {
        if (playerId === opponentId) return;
        if (!stats[playerId]) stats[playerId] = {};
        if (!stats[playerId][opponentId]) stats[playerId][opponentId] = { count: 0, lastDate: null };
        stats[playerId][opponentId].count += 1;
        if (!stats[playerId][opponentId].lastDate || match.date > stats[playerId][opponentId].lastDate) {
          stats[playerId][opponentId].lastDate = match.date;
        }
      });
    });
  });

  return stats;
}

// Επιστρέφει το ιστορικό αντιπάλων ενός παίκτη, ταξινομημένο από τον πιο
// πρόσφατο/συχνό αντίπαλο στον λιγότερο — χρήσιμο για εμφάνιση στο dashboard.
async function getOpponentHistory(playerId) {
  const stats = await buildOpponentStats();
  const entries = stats[playerId] || {};
  const players = await playtomic.getPlayers();
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));

  return Object.entries(entries)
    .map(([opponentId, info]) => ({ opponent: byId[opponentId], ...info }))
    .filter((e) => e.opponent)
    .sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || ""));
}

// Ταξινομεί μια λίστα υποψήφιων παικτών ώστε να προηγούνται όσοι ΔΕΝ έχουν
// παίξει πρόσφατα/συχνά με τον δεδομένο παίκτη — για ποικιλία αντιπάλων.
// Δεν αποκλείει κανέναν, απλώς αλλάζει τη σειρά προτεραιότητας.
async function rankByVariety(playerId, candidates) {
  const stats = await buildOpponentStats();
  const playerStats = stats[playerId] || {};

  return [...candidates].sort((a, b) => {
    const countA = playerStats[a.id]?.count || 0;
    const countB = playerStats[b.id]?.count || 0;
    return countA - countB; // λιγότερες φορές μαζί -> πιο ψηλά
  });
}

module.exports = { getOpponentHistory, rankByVariety };
