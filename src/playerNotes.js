// playerNotes.js
//
// Ελεύθερο κείμενο σημειώσεων ανά πελάτη (π.χ. "θέλει πάντα Δευτέρα βράδυ",
// "μην τον καλείτε πριν τις 10πμ") — μία τρέχουσα σημείωση ανά παίκτη, όχι
// ιστορικό. Σε memory (όπως και τα υπόλοιπα logs της εφαρμογής).

const notes = new Map(); // playerId -> { note, updatedAt }

function getNote(playerId) {
  return notes.get(playerId) || null;
}

function setNote(playerId, note) {
  const trimmed = String(note || "").trim();
  if (!trimmed) {
    notes.delete(playerId);
    return null;
  }
  const entry = { note: trimmed, updatedAt: new Date().toISOString() };
  notes.set(playerId, entry);
  return entry;
}

module.exports = { getNote, setNote };
