// server.js
//
// Σκόπιμα γραμμένο χωρίς εξωτερικά dependencies (μόνο builtin Node modules)
// ώστε να τρέχει παντού με ένα "node server.js", χωρίς npm install.
// Ένας developer μπορεί αργότερα να το μεταφέρει εύκολα σε Express/Fastify
// αν χρειαστεί — η λογική (matching.js / playtomicClient.js) δεν αλλάζει.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const playtomic = require("./src/playtomicClient");
const matching = require("./src/matching");
const swipeModule = require("./src/swipe");
const notifications = require("./src/notifications");
const history = require("./src/history");

// ============================================================
// Απλό login (ένας μόνο λογαριασμός — ο ιδιοκτήτης του club). Στοιχεία
// σύνδεσης ΔΕΝ μπαίνουν ποτέ στον κώδικα· ορίζονται ως environment
// variables στο hosting (Render -> Environment): ADMIN_USERNAME, ADMIN_PASSWORD.
// Sessions κρατιούνται in-memory (ένα session cookie ανά browser).
// ============================================================
const SESSION_COOKIE = "pf_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 μέρες
const sessions = new Map(); // token -> { expiresAt }

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

function createSession() {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function isValidSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

const PUBLIC_DIR = path.join(__dirname, "public");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseFloatOrUndefined(v) {
  if (v === null || v === undefined || v === "") return undefined;
  const n = parseFloat(v);
  return Number.isNaN(n) ? undefined : n;
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.join(PUBLIC_DIR, filePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = url;

  try {
    if (pathname === "/api/login" && req.method === "POST") {
      const body = await readBody(req);
      const { username, password } = body;
      const validUser = process.env.ADMIN_USERNAME;
      const validPass = process.env.ADMIN_PASSWORD;
      if (!validUser || !validPass) {
        return sendJSON(res, 500, {
          error: "Δεν έχουν οριστεί ακόμα ADMIN_USERNAME / ADMIN_PASSWORD στο hosting (Render -> Environment).",
        });
      }
      if (username !== validUser || password !== validPass) {
        return sendJSON(res, 401, { error: "Λάθος όνομα χρήστη ή κωδικός" });
      }
      const token = createSession();
      res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; SameSite=Lax`
      );
      return sendJSON(res, 200, { ok: true });
    }

    if (pathname === "/api/logout" && req.method === "POST") {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) sessions.delete(token);
      res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
      return sendJSON(res, 200, { ok: true });
    }

    if (pathname === "/api/me" && req.method === "GET") {
      return sendJSON(res, 200, { authenticated: isValidSession(req) });
    }

    // Δημόσιο, μόνο-ανάγνωσης endpoint (ΧΩΡΙΣ ονόματα/τηλέφωνα παικτών) — το
    // χρησιμοποιεί το αυτόματο πρωινό μήνυμα (scheduled task) που δεν μπορεί
    // να συνδεθεί με τα προσωπικά στοιχεία διαχειριστή.
    if (pathname === "/api/public/today-summary" && req.method === "GET") {
      const report = await matching.buildWeeklyGaps(1);
      const gaps = report.map((g) => ({
        court: g.court.name,
        startTime: g.startTime,
        endTime: g.endTime,
        gapMinutes: g.gapMinutes,
      }));
      return sendJSON(res, 200, { date: todayISO(), gaps });
    }

    // Όλα τα υπόλοιπα /api/* endpoints απαιτούν έγκυρη σύνδεση.
    if (pathname.startsWith("/api/") && !isValidSession(req)) {
      return sendJSON(res, 401, { error: "Απαιτείται σύνδεση" });
    }

    if (pathname === "/api/dates" && req.method === "GET") {
      return sendJSON(res, 200, { dates: playtomic.getUpcomingDates(7) });
    }

    if (pathname === "/api/schedule" && req.method === "GET") {
      const date = searchParams.get("date") || todayISO();
      return sendJSON(res, 200, { date, schedule: await matching.buildSchedule(date) });
    }

    const gapMatch = pathname.match(/^\/api\/gaps\/([^/]+)\/suggestions$/);
    if (gapMatch && req.method === "GET") {
      const date = searchParams.get("date") || todayISO();
      const gapId = decodeURIComponent(gapMatch[1]);
      const options = {
        minLevel: parseFloatOrUndefined(searchParams.get("minLevel")),
        maxLevel: parseFloatOrUndefined(searchParams.get("maxLevel")),
      };
      return sendJSON(res, 200, await matching.suggestPlayersForGap(gapId, date, options));
    }

    const notifyMatch = pathname.match(/^\/api\/gaps\/([^/]+)\/notify$/);
    if (notifyMatch && req.method === "POST") {
      const gapId = decodeURIComponent(notifyMatch[1]);
      const body = await readBody(req);
      const { playerId, date, lang } = body;
      if (!playerId) return sendJSON(res, 400, { error: "playerId απαιτείται" });

      const [courtId, time] = gapId.split("__");
      const courts = await playtomic.getCourts();
      const courtName = courts.find((c) => c.id === courtId)?.name || courtId;
      const players = await playtomic.getPlayers();
      const player = players.find((p) => p.id === playerId);
      if (!player) return sendJSON(res, 404, { error: "Άγνωστος παίκτης" });

      const entry = notifications.sendGapNotification(player, { gapId, time, courtName, date }, lang);
      return sendJSON(res, 200, { sent: true, notification: entry });
    }

    if (pathname === "/api/notifications" && req.method === "GET") {
      await matching.reconcileNotificationOutcomes();
      return sendJSON(res, 200, { notifications: notifications.getLog() });
    }

    if (pathname === "/api/notifications/stats" && req.method === "GET") {
      await matching.reconcileNotificationOutcomes();
      return sendJSON(res, 200, notifications.getStats());
    }

    const outcomeMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/outcome$/);
    if (outcomeMatch && req.method === "POST") {
      const id = decodeURIComponent(outcomeMatch[1]);
      const body = await readBody(req);
      const entry = notifications.setOutcome(id, body.outcome);
      if (!entry) return sendJSON(res, 404, { error: "Άγνωστη ειδοποίηση" });
      return sendJSON(res, 200, { notification: entry });
    }

    if (pathname === "/api/dashboard" && req.method === "GET") {
      const date = searchParams.get("date") || todayISO();
      return sendJSON(res, 200, await matching.buildDashboard(date));
    }

    if (pathname === "/api/gaps/weekly" && req.method === "GET") {
      const days = parseInt(searchParams.get("days"), 10) || 7;
      await matching.reconcileNotificationOutcomes();
      return sendJSON(res, 200, { report: await matching.buildWeeklyGaps(days) });
    }

    if (pathname === "/api/stats/weekly" && req.method === "GET") {
      const days = parseInt(searchParams.get("days"), 10) || 7;
      return sendJSON(res, 200, await matching.buildWeeklyStats(days));
    }

    const historyMatch = pathname.match(/^\/api\/players\/([^/]+)\/history$/);
    if (historyMatch && req.method === "GET") {
      const playerId = decodeURIComponent(historyMatch[1]);
      return sendJSON(res, 200, { history: await history.getOpponentHistory(playerId) });
    }

    if (pathname === "/api/swipe/next" && req.method === "GET") {
      const forId = searchParams.get("playerId") || "p6";
      const options = {
        minLevel: parseFloatOrUndefined(searchParams.get("minLevel")),
        maxLevel: parseFloatOrUndefined(searchParams.get("maxLevel")),
      };
      return sendJSON(res, 200, { candidate: await swipeModule.getNextCandidate(forId, options) });
    }

    if (pathname === "/api/swipe" && req.method === "POST") {
      const body = await readBody(req);
      const { fromId, toId, liked } = body;
      if (!fromId || !toId || typeof liked !== "boolean") {
        return sendJSON(res, 400, { error: "fromId, toId, liked (boolean) απαιτούνται" });
      }
      return sendJSON(res, 200, swipeModule.swipe(fromId, toId, liked));
    }

    if (pathname.startsWith("/api/")) {
      return sendJSON(res, 404, { error: "Άγνωστο endpoint" });
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    return sendJSON(res, 500, { error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`PadelFill Phase 1 prototype: http://localhost:${PORT}`);
});
