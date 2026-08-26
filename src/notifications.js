// notifications.js
//
// Δημιουργεί ΠΡΑΓΜΑΤΙΚΑ αποστείλιμα μηνύματα μέσω WhatsApp click-to-chat
// (wa.me), χωρίς κόστος ή τρίτο API/λογαριασμό. Το frontend ανοίγει το
// επιστρεφόμενο whatsappUrl σε νέο tab, με το μήνυμα ήδη γραμμένο — το μόνο
// που μένει είναι να πατηθεί "Αποστολή" στο WhatsApp.

const log = [];

function record(entry) {
  log.push(entry);
  return entry;
}

// Καθαρίζει τον αριθμό τηλεφώνου σε μορφή που καταλαβαίνει το wa.me
// (μόνο ψηφία, με κωδικό χώρας). Αν δεν έχει ήδη κωδικό χώρας υποθέτουμε
// Κύπρο (357) — προσαρμόστε αν το club είναι αλλού.
function sanitizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("357") && digits.length >= 11) return digits;
  if (digits.length === 8) return `357${digits}`;
  return digits;
}

function buildWhatsAppLink(phone, message) {
  const sanitized = sanitizePhone(phone);
  if (!sanitized) return null;
  return `https://wa.me/${sanitized}?text=${encodeURIComponent(message)}`;
}

function sendGapNotification(player, gapInfo) {
  const message = `Γεια σου ${player.name}! Υπάρχει ελεύθερο γήπεδο στις ${gapInfo.time} (${gapInfo.courtName}) στο επίπεδό σου. Θες να το κλείσεις;`;
  const whatsappUrl = buildWhatsAppLink(player.phone, message);
  const entry = {
    id: `n${log.length + 1}`,
    playerId: player.id,
    playerName: player.name,
    channel: whatsappUrl ? "whatsapp" : "app-notification",
    message,
    whatsappUrl,
    gapId: gapInfo.gapId,
    sentAt: new Date().toISOString(),
  };
  return record(entry);
}

function getLog() {
  return log.slice().reverse();
}

module.exports = { sendGapNotification, getLog };
