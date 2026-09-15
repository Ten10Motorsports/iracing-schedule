/* ------------------------------------------------------------------
   util.js
   Time handling, ids, small helpers.

   The one rule that matters here: every instant is stored in the data
   file as UTC (an ISO string ending in Z). Wall-clock strings like
   "20:00" only ever exist at the edges, when a human types one in or
   reads one off the screen. That is what stops daylight saving from
   quietly breaking the schedule twice a year.
------------------------------------------------------------------- */

(function () {
  const U = {};

  U.TZ = "America/New_York";

  /* ---------- ids ---------- */
  U.uid = function (prefix) {
    return (prefix || "id") + "_" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 7);
  };

  U.slug = function (s) {
    return String(s || "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "league";
  };

  /* ---------- timezone maths ----------

     tzOffset() returns how far ahead of UTC the named zone is, in ms,
     at the given instant. Intl is the only thing in the browser that
     knows the DST rules, so we format the instant in the target zone,
     read the pieces back as if they were UTC, and take the difference.
  ------------------------------------------------------------------ */
  const OFFSET_FMT = {};
  function offsetFormatter(tz) {
    if (!OFFSET_FMT[tz]) {
      OFFSET_FMT[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    }
    return OFFSET_FMT[tz];
  }

  U.tzOffset = function (date, tz) {
    const parts = offsetFormatter(tz || U.TZ).formatToParts(date)
      .reduce((a, p) => (a[p.type] = p.value, a), {});
    const h = parts.hour === "24" ? 0 : Number(parts.hour);
    const asUTC = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      h, Number(parts.minute), Number(parts.second)
    );
    return asUTC - date.getTime();
  };

  /* "2026-09-15" + "20:00" in America/New_York  ->  Date (UTC instant) */
  U.zonedToUtc = function (dateStr, timeStr, tz) {
    tz = tz || U.TZ;
    const t = (timeStr || "00:00").length === 5 ? timeStr + ":00" : (timeStr || "00:00:00");
    const naive = new Date(dateStr + "T" + t + "Z");
    if (isNaN(naive)) return null;
    let off = U.tzOffset(naive, tz);
    let utc = new Date(naive.getTime() - off);
    const off2 = U.tzOffset(utc, tz);
    if (off2 !== off) utc = new Date(naive.getTime() - off2);
    return utc;
  };

  /* Date -> { date:"2026-09-15", time:"20:00" } in the given zone */
  U.utcToZoned = function (date, tz) {
    tz = tz || U.TZ;
    const off = U.tzOffset(date, tz);
    const shifted = new Date(date.getTime() + off);
    const p = (n) => String(n).padStart(2, "0");
    return {
      date: shifted.getUTCFullYear() + "-" + p(shifted.getUTCMonth() + 1) + "-" + p(shifted.getUTCDate()),
      time: p(shifted.getUTCHours()) + ":" + p(shifted.getUTCMinutes())
    };
  };

  /* ---------- formatting ---------- */
  U.fmtTime = function (iso, tz) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || U.TZ, hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date(iso));
  };

  U.fmtTime12 = function (iso, tz) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz || U.TZ, hour: "numeric", minute: "2-digit", hour12: true
    }).format(new Date(iso)).replace(" ", "").toLowerCase();
  };

  U.fmtDate = function (iso, tz, opts) {
    return new Intl.DateTimeFormat("en-GB", Object.assign({
      timeZone: tz || U.TZ, weekday: "short", day: "numeric", month: "short"
    }, opts || {})).format(new Date(iso));
  };

  U.fmtZoneAbbr = function (iso, tz) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || U.TZ, timeZoneName: "short"
    }).formatToParts(new Date(iso));
    const p = parts.find(x => x.type === "timeZoneName");
    return p ? p.value : "";
  };

  /* ---------- local date keys (in the display zone) ---------- */
  U.dayKey = function (iso, tz) {
    return U.utcToZoned(new Date(iso), tz || U.TZ).date;
  };

  U.todayKey = function (tz) {
    return U.utcToZoned(new Date(), tz || U.TZ).date;
  };

  U.addDays = function (dateStr, n) {
    const d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  U.dowOf = function (dateStr) {
    /* 0 = Sunday .. 6 = Saturday */
    return new Date(dateStr + "T12:00:00Z").getUTCDay();
  };

  U.monthKey = function (dateStr) { return dateStr.slice(0, 7); };

  U.monthLabel = function (monthKey) {
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(monthKey + "-01T12:00:00Z"));
  };

  /* first day of the grid for a month view, starting on Monday */
  U.monthGridStart = function (monthKey) {
    const first = monthKey + "-01";
    const dow = U.dowOf(first);          /* 0 Sun .. 6 Sat */
    const back = (dow + 6) % 7;          /* how far back to Monday */
    return U.addDays(first, -back);
  };

  U.daysInMonth = function (monthKey) {
    const y = Number(monthKey.slice(0, 4)), m = Number(monthKey.slice(5, 7));
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  };

  U.shiftMonth = function (monthKey, n) {
    let y = Number(monthKey.slice(0, 4)), m = Number(monthKey.slice(5, 7)) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + "-" + String(m + 1).padStart(2, "0");
  };

  /* ---------- countdowns ---------- */
  U.countdown = function (iso, now) {
    const ms = new Date(iso).getTime() - (now || Date.now());
    const past = ms < 0;
    const a = Math.abs(ms);
    const d = Math.floor(a / 86400000);
    const h = Math.floor((a % 86400000) / 3600000);
    const m = Math.floor((a % 3600000) / 60000);
    let txt;
    if (d > 0) txt = d + "d " + h + "h";
    else if (h > 0) txt = h + "h " + m + "m";
    else txt = m + "m";
    return { past: past, text: txt, ms: ms };
  };

  U.countdownPhrase = function (iso, now) {
    const c = U.countdown(iso, now);
    if (c.past) return c.ms > -2 * 3600000 ? "underway" : "finished";
    return "in " + c.text;
  };

  /* ---------- misc ---------- */
  U.esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };

  U.clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  U.sortBy = function (arr, fn) {
    return arr.slice().sort((a, b) => {
      const x = fn(a), y = fn(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  };

  U.DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  U.DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  window.U = U;
})();
