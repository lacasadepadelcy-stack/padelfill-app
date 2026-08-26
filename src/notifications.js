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

// Μετατρέπει την ημερομηνία του κενού σε φυσική ένδειξη ημέρας
// ("σήμερα"/"αύριο"/όνομα ημέρας) αντί για ξερή ημερομηνία — πιο φυσικό
// μήνυμα προς τον παίκτη.
function dayLabel(dateStr, lang) {
  if (!dateStr) return "";
  const todayISO = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);

  if (dateStr === todayISO) return lang === "en" ? "today" : "σήμερα";
  if (dateStr === tomorrowISO) return lang === "en" ? "tomorrow" : "αύριο";

  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(lang === "en" ? "en-GB" : "el-GR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
}

// Ευγενικό/διακριτικό μήνυμα που ρωτάει (όχι επιβεβαιώνει) αν ο παίκτης
// μπορεί να παίξει τη συγκεκριμένη ώρα — σε Ελληνικά ή Αγγλικά.
function buildMessage(player, gapInfo, lang) {
  const when = dayLabel(gapInfo.date, lang);
  if (lang === "en") {
    return `Hi ${player.name}! Can you play padel ${when} at ${gapInfo.time} at ${gapInfo.courtName}?`;
  }
  return `Γεια σου ${player.name}! Μπορείς να παίξεις padel ${when} στις ${gapInfo.time} στο ${gapInfo.courtName};`;
}

function sendGapNotification(player, gapInfo, lang = "el") {
  const safeLang = lang === "en" ? "en" : "el";
  const message = buildMessage(player, gapInfo, safeLang);
  const whatsappUrl = buildWhatsAppLink(player.phone, message);
  const entry = {
    id: `n${log.length + 1}`,
    playerId: player.id,
    playerName: player.name,
    channel: whatsappUrl ? "whatsapp" : "app-notification",
    lang: safeLang,
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
