// server.js
//
// Σκόπιμα γραμμένο χωρίς εξωτερικά dependencies (μόνο builtin Node modules)
// ώστε να τρέχει παντού με ένα "node server.js", χωρίς npm install.
// Ένας developer μπορεί αργότερα να το μεταφέρει εύκολα σε Express/Fastify
// αν χρειαστεί — η λογική (matching.js / playtomicClient.js) δεν αλλάζει.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const playtomic = require("./src/playtomicClient");
const matching = require("./src/matching");
const swipeModule = require("./src/swipe");
const notifications = require("./src/notifications");
const history = require("./src/history");

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
      return sendJSON(res, 200, { notifications: notifications.getLog() });
    }

    if (pathname === "/api/notifications/stats" && req.method === "GET") {
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
      return sendJSON(res, 200, { report: await matching.buildWeeklyGaps(days) });
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
