// history.js -- Κρατάει ιστορικό αντιπάλων για ποικιλία.

const playtomic = require("./playtomicClient");

function buildOpponentStats() {
  const matches = playtomic.getPastMatches();
const stats = {};

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

function getOpponentHistory(playerId) {
  const stats = buildOpponentStats();
const entries = stats[playerId] || {};
const players = playtomic.getPlayers();
const byId = Object.fromEntries(players.map((p) => [p.id, p]));

return Object.entries(entries)
  .map(([opponentId, info]) => ({ opponent: byId[opponentId], ...info }))
.filter((e) => e.opponent)
  .sort((a, b) => (b.lastDate || "").localeCompare(a.lastDate || ""));
}

function rankByVariety(playerId, candidates) {
  const stats = buildOpponentStats();
const playerStats = stats[playerId] || {};

return [...candidates].sort((a, b) => {
  const countA = playerStats[a.id]?.count || 0;
  const countB = playerStats[b.id]?.count || 0;
  return countA - countB;
});
}

module.exports = { getOpponentHistory, rankByVariety };
