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
// ("simera"/"avrio"/όνομα ημέρας σε greeklish) αντί για ξερή ημερομηνία —
// πιο φυσικό/αυθεντικό μήνυμα προς τον παίκτη.
function dayLabel(dateStr, lang) {
  if (!dateStr) return "";
  const todayISO = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);

  if (dateStr === todayISO) return lang === "en" ? "today" : "simera";
  if (dateStr === tomorrowISO) return lang === "en" ? "tomorrow" : "avrio";

  const d = new Date(`${dateStr}T00:00:00`);
  if (lang === "en") {
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "2-digit" });
  }
  const greeklishDays = ["Kyriaki", "Deutera", "Triti", "Tetarti", "Pempti", "Paraskevi", "Savvato"];
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${greeklishDays[d.getDay()]} ${dd}/${mm}`;
}

// Ζεστό/άμεσο μήνυμα που ρωτάει αν ο παίκτης θέλει να παίξει τη
// συγκεκριμένη ώρα — σε greeklish (πιο αυθεντικό/casual) ή στα αγγλικά.
function buildMessage(player, gapInfo, lang) {
  const when = dayLabel(gapInfo.date, lang);
  // Μόνο το μικρό όνομα (όχι επίθετο) — πιο προσωπικό/φυσικό ύφος.
  const firstName = String(player.name || "").trim().split(/\s+/)[0];
  if (lang === "en") {
    return `Hi ${firstName}, would you like to play padel ${when} at ${gapInfo.time}?`;
  }
  return `Hi ${firstName}, tha itheles na pexis padel ${when} stis ${gapInfo.time};`;
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
    // Η ημερομηνία του κενού (όχι πότε στάλθηκε το μήνυμα) — χρειάζεται για
    // να ελέγχουμε αργότερα αυτόματα αν το γήπεδο τελικά κλείστηκε.
    date: gapInfo.date || null,
    sentAt: new Date().toISOString(),
    // Αποτέλεσμα: null (άγνωστο ακόμα) / "booked" (έκλεισε γήπεδο) / "no"
    // (δεν έκλεισε) — ενημερώνεται χειροκίνητα από το προσωπικό αργότερα,
    // αφού δουν αν ο παίκτης πράγματι έκλεισε το κενό.
    outcome: null,
  };
  return record(entry);
}

// Ενημερώνει το αποτέλεσμα μιας ήδη σταλμένης ειδοποίησης — πόσο "έπιασε"
// στην πράξη, ώστε σιγά σιγά να φαίνεται ποιοι παίκτες πραγματικά
// ανταποκρίνονται όταν τους ειδοποιούμε για ένα κενό.
function setOutcome(notificationId, outcome) {
  const entry = log.find((n) => n.id === notificationId);
  if (!entry) return null;
  entry.outcome = outcome === "booked" ? "booked" : outcome === "no" ? "no" : null;
  return entry;
}

// Συγκεντρωτικά στατιστικά ανταπόκρισης — πόσες ειδοποιήσεις έχουν σταλεί
// συνολικά, πόσες οδήγησαν σε πραγματικό κλείσιμο γηπέδου, κ.λπ.
function getStats() {
  const total = log.length;
  const booked = log.filter((n) => n.outcome === "booked").length;
  const no = log.filter((n) => n.outcome === "no").length;
  const pending = total - booked - no;
  return {
    total,
    booked,
    no,
    pending,
    bookedPct: total ? Math.round((booked / total) * 100) : 0,
  };
}

function getLog() {
  return log.slice().reverse();
}

// Ids παικτών που έχουν ειδοποιηθεί (για ΟΠΟΙΟΔΗΠΟΤΕ κενό) τις τελευταίες
// `hours` ώρες — χρησιμοποιείται από το matching.js ώστε να μην προτείνουμε
// συνέχεια τους ίδιους παίκτες μέρα με τη μέρα.
function getRecentlyNotifiedIds(hours = 48) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const ids = new Set();
  log.forEach((n) => {
    if (new Date(n.sentAt).getTime() >= cutoff) ids.add(n.playerId);
  });
  return ids;
}

module.exports = { sendGapNotification, getLog, getRecentlyNotifiedIds, setOutcome, getStats };
