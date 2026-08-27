// waitlist.js
//
// "Λίστα αναμονής": πελάτες που έχουν ζητήσει να ειδοποιηθούν αν ανοίξει
// κενό γήπεδο συγκεκριμένη μέρα/ώρα (π.χ. "πες μου αν αδειάσει κάτι Τρίτη
// βράδυ") — αντίστροφο από τις κανονικές προτάσεις: εδώ ο ΠΕΛΑΤΗΣ δηλώνει
// προτίμηση, όχι το σύστημα που μαντεύει βάσει επιπέδου.

const entries = [];

// dayOfWeek: 0 (Κυριακή) έως 6 (Σάββατο), ή null = οποιαδήποτε μέρα.
// timeFrom/timeTo: "HH:MM" — το επιθυμητό παράθυρο ώρας.
function addEntry({ playerId, dayOfWeek, timeFrom, timeTo, note }) {
  const entry = {
    id: `w${entries.length + 1}`,
    playerId,
    dayOfWeek: dayOfWeek === null || dayOfWeek === undefined || dayOfWeek === "" ? null : parseInt(dayOfWeek, 10),
    timeFrom: timeFrom || "07:00",
    timeTo: timeTo || "23:30",
    note: note || "",
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);
  return entry;
}

function removeEntry(id) {
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  return true;
}

function listEntries() {
  return entries.slice().reverse();
}

// Επιστρέφει τις εγγραφές αναμονής που "ταιριάζουν" με ένα συγκεκριμένο κενό
// (ίδια μέρα εβδομάδας — ή "οποιαδήποτε" — ΚΑΙ επικάλυψη ώρας).
function findMatches(dayOfWeek, startTime, endTime) {
  return entries.filter((e) => {
    if (e.dayOfWeek !== null && e.dayOfWeek !== dayOfWeek) return false;
    return startTime < e.timeTo && endTime > e.timeFrom;
  });
}

module.exports = { addEntry, removeEntry, listEntries, findMatches };
