// notifications.js -- Mock ειδοποιήσεις. Για πραγματική αποστολή (SMS/email) αντικαταστήστε το record().

const log = [];

function record(entry) {
  log.push(entry);
  return entry;
}

function sendGapNotification(player, gapInfo) {
  const message = `Γεια σου ${player.name}! Υπάρχει ελεύθερο γήπεδο στις ${gapInfo.time} (${gapInfo.courtName}) στο επίπεδό σου. Θες να το κλείσεις;`;
  const entry = {
    id: `n${log.length + 1}`,
    playerId: player.id,
    playerName: player.name,
    channel: "app-notification",
    message,
    gapId: gapInfo.gapId,
    sentAt: new Date().toISOString(),
  };
  return record(entry);
}

function getLog() {
  return log.slice().reverse();
}

module.exports = { sendGapNotification, getLog };
