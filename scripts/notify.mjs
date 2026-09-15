#!/usr/bin/env node
/* ------------------------------------------------------------------
   notify.mjs
   Sends the race-day emails. Run by .github/workflows/notify.yml every
   30 minutes.

   How it decides to send
   ----------------------
   GitHub's cron is expressed in UTC and Eastern time moves twice a
   year, so this script does NOT trust the cron to fire at 10:00 ET.
   It wakes often, works out what time it currently is in
   America/New_York, and sends if a configured slot is due inside its
   window. data/sent.json records what has already gone out so a second
   run inside the same window is a no-op.

   Usage
   -----
     node scripts/notify.mjs                     normal run
     node scripts/notify.mjs --dry-run           print, send nothing
     node scripts/notify.mjs --force morning     ignore the clock and the log
     node scripts/notify.mjs --force morning \
          --dry-run --html preview.html          write the email out to look at
------------------------------------------------------------------- */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = resolve(ROOT, "data/schedule.json");
const SENT = resolve(ROOT, "data/sent.json");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = (() => { const i = args.indexOf("--force"); return i !== -1 ? args[i + 1] : null; })();
const HTML_OUT = (() => { const i = args.indexOf("--html"); return i !== -1 ? args[i + 1] : null; })();

/* ============================ time ============================ */

function tzOffset(date, tz) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(date).reduce((a, x) => (a[x.type] = x.value, a), {});
  const h = p.hour === "24" ? 0 : Number(p.hour);
  return Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second) - date.getTime();
}

function zonedToUtc(dateStr, timeStr, tz) {
  const naive = new Date(`${dateStr}T${timeStr.length === 5 ? timeStr + ":00" : timeStr}Z`);
  const off = tzOffset(naive, tz);
  let utc = new Date(naive.getTime() - off);
  const off2 = tzOffset(utc, tz);
  if (off2 !== off) utc = new Date(naive.getTime() - off2);
  return utc;
}

function zonedParts(date, tz) {
  const off = tzOffset(date, tz);
  const s = new Date(date.getTime() + off);
  const p = n => String(n).padStart(2, "0");
  return {
    date: `${s.getUTCFullYear()}-${p(s.getUTCMonth() + 1)}-${p(s.getUTCDate())}`,
    time: `${p(s.getUTCHours())}:${p(s.getUTCMinutes())}`,
    hour: s.getUTCHours(), minute: s.getUTCMinutes()
  };
}

const fmtTime = (iso, tz) => new Intl.DateTimeFormat("en-GB", {
  timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false
}).format(new Date(iso));

const fmtLongDate = (dateStr) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC", weekday: "long", day: "numeric", month: "long"
}).format(new Date(dateStr + "T12:00:00Z"));

const zoneAbbr = (iso, tz) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(iso));
  return (p.find(x => x.type === "timeZoneName") || {}).value || "";
};

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function countdown(iso, now) {
  const ms = new Date(iso).getTime() - now;
  if (ms < 0) return "under way";
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) { const d = Math.floor(h / 24); return `in ${d} day${d > 1 ? "s" : ""}`; }
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

const esc = s => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ============================ data ============================ */

if (!existsSync(DATA)) { console.error("No data/schedule.json found."); process.exit(1); }
const data = JSON.parse(readFileSync(DATA, "utf8"));
const S = data.settings || {};
const E = S.email || {};
const TZ = S.timezone || "America/New_York";

let sentLog = { sent: [] };
if (existsSync(SENT)) { try { sentLog = JSON.parse(readFileSync(SENT, "utf8")); } catch {} }
if (!Array.isArray(sentLog.sent)) sentLog.sent = [];

const leagueById = Object.fromEntries((data.leagues || []).map(l => [l.id, l]));
const raceDay = r => zonedParts(new Date(r.startUtc), TZ).date;

function offDayFor(day) {
  return (data.offDays || []).find(o => day >= o.start && day <= (o.end || o.start)) || null;
}

function isExcluded(r) {
  if (r.status === "skipped" || r.status === "cancelled") return true;
  if (E.skipOnOffDays !== false && !r.overrideAvailable && offDayFor(raceDay(r))) return true;
  return false;
}

/* ============================ slot selection ============================ */

const now = new Date();
const nowMs = now.getTime();
const nowET = zonedParts(now, TZ);
const today = nowET.date;
const windowMin = Number(E.windowMinutes) || 50;

function dueSlots() {
  if (FORCE) {
    const s = (E.sends || []).find(x => x.id === FORCE);
    if (!s) { console.error(`No send slot called "${FORCE}". Known: ${(E.sends || []).map(x => x.id).join(", ")}`); process.exit(1); }
    return [s];
  }
  return (E.sends || []).filter(s => {
    if (!s.enabled) return false;
    const at = zonedToUtc(today, `${String(s.hour).padStart(2, "0")}:${String(s.minute || 0).padStart(2, "0")}`, TZ).getTime();
    return nowMs >= at && nowMs < at + windowMin * 60000;
  });
}

function racesFor(scope) {
  const all = (data.races || []).filter(r => !isExcluded(r));
  let list;
  if (scope === "tomorrow") {
    const t = addDays(today, 1);
    list = all.filter(r => raceDay(r) === t);
  } else if (scope === "remaining") {
    /* still to come today, keeping one that started in the last 10 min */
    list = all.filter(r => raceDay(r) === today && Date.parse(r.startUtc) > nowMs - 10 * 60000);
  } else {
    list = all.filter(r => raceDay(r) === today);
  }
  return list.sort((a, b) => a.startUtc < b.startUtc ? -1 : 1);
}

/* ============================ subject ============================ */

function summaryOf(races) {
  if (!races.length) return "";
  const r = races[0];
  const lg = leagueById[r.leagueId] || {};
  const head = `${lg.short || lg.name || "Race"} at ${shortTrack(r)} ${fmtTime(r.startUtc, TZ)}`;
  return races.length > 1 ? `${head} +${races.length - 1} more` : head;
}

/* Short track names live in assets/content.js so the site and the email
   never disagree. That file is plain JavaScript that assigns to
   `window`, so it can be evaluated here with a stand-in object rather
   than duplicating the list. */
const SHORT_NAMES = (() => {
  try {
    const src = readFileSync(resolve(ROOT, "assets/content.js"), "utf8");
    const win = {};
    new Function("window", src)(win);
    return (win.IR_CONTENT && win.IR_CONTENT.shortNames) || {};
  } catch { return {}; }
})();

function shortTrack(r) {
  if (!r.track) return "TBA";
  if (SHORT_NAMES[r.track]) return SHORT_NAMES[r.track];
  return r.track
    .replace(/^(Circuit de |Circuit |Autodromo Nazionale |Autódromo |Autodromo |Michelin Raceway |WeatherTech Raceway |Mobility Resort |The )/, "")
    .replace(/ (International Racing Course|International Raceway|International Speedway|Motor Speedway|Superspeedway|Raceway|Speedway|Racing Circuit|Circuit|Sports Car Course|Motorsports Park|Grand-Prix-Strecke|International)$/, "")
    .trim() || r.track;
}

function fillSubject(tpl, races, scope) {
  const leagues = [...new Set(races.map(r => (leagueById[r.leagueId] || {}).short || (leagueById[r.leagueId] || {}).name).filter(Boolean))];
  return String(tpl || "{{count}} race{{s}} today: {{summary}}")
    .replace(/\{\{count\}\}/g, races.length)
    .replace(/\{\{s\}\}/g, races.length === 1 ? "" : "s")
    .replace(/\{\{summary\}\}/g, summaryOf(races))
    .replace(/\{\{leagues\}\}/g, leagues.join(", "))
    .replace(/\{\{date\}\}/g, fmtLongDate(scope === "tomorrow" ? addDays(today, 1) : today))
    .replace(/\{\{first\}\}/g, races.length ? fmtTime(races[0].startUtc, TZ) : "")
    .trim();
}

/* ============================ the email ============================ */

const C = {
  bg: "#0c0c0e", card: "#151518", card2: "#1c1c20",
  line: "#2a2a30", ink: "#f4f4f5", ink2: "#b6b6bd", ink3: "#7e7e88",
  red: "#e8232f"
};

function buildHtml(races, slot, scope) {
  const dayLabel = fmtLongDate(scope === "tomorrow" ? addDays(today, 1) : today);
  const abbr = races.length ? zoneAbbr(races[0].startUtc, TZ) : "ET";
  const siteUrl = E.siteUrl || "";

  const rows = races.map(r => {
    const lg = leagueById[r.leagueId] || { name: "", color: C.red };
    const prep = [];
    if (E.includePracticeTimes !== false) {
      if (r.practiceUtc) prep.push(`practice ${fmtTime(r.practiceUtc, TZ)}`);
      if (r.qualifyUtc) prep.push(`qualy ${fmtTime(r.qualifyUtc, TZ)}`);
    }
    const len = r.lengthLaps ? `${r.lengthLaps} laps` : r.lengthMin ? `${r.lengthMin} min` : "";

    return `
    <tr><td style="padding:0 0 10px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             bgcolor="${C.card2}" style="background:${C.card2};border:1px solid ${C.line};border-left:3px solid ${lg.color || C.red};border-radius:8px">
        <tr>
          <td width="74" valign="top" style="padding:13px 0 13px 14px">
            <div style="font-family:'JetBrains Mono',Consolas,monospace;font-size:19px;font-weight:700;color:${C.ink};line-height:1.1">${fmtTime(r.startUtc, TZ)}</div>
            <div style="font-family:Arial,sans-serif;font-size:10px;color:${C.ink3};letter-spacing:.06em;text-transform:uppercase;padding-top:2px">${esc(countdown(r.startUtc, nowMs))}</div>
          </td>
          <td valign="top" style="padding:13px 14px 13px 10px">
            <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${lg.color || C.red}">
              ${esc(lg.short || lg.name)}${r.round ? ` &middot; Week ${r.round}${lg.season && lg.season.rounds ? ` of ${lg.season.rounds}` : ""}` : ""}
            </div>
            <div style="font-family:Arial,sans-serif;font-size:16px;font-weight:600;color:${C.ink};padding:3px 0 1px">
              ${esc(r.track || "Track TBA")}${r.trackConfig ? ` <span style="color:${C.ink3};font-weight:400">${esc(r.trackConfig)}</span>` : ""}
            </div>
            <div style="font-family:Arial,sans-serif;font-size:13px;color:${C.ink2}">
              ${esc(r.car || "Car TBA")}${len ? ` &middot; ${esc(len)}` : ""}
            </div>
            ${prep.length ? `<div style="font-family:Arial,sans-serif;font-size:12px;color:${C.ink3};padding-top:4px">${prep.map(esc).join(" &middot; ")}</div>` : ""}
          </td>
        </tr>
      </table>
    </td></tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>${esc(dayLabel)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(summaryOf(races))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};padding:22px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%">

    <tr><td style="padding:0 0 16px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="26" valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.red}" style="background:${C.red};border-radius:6px">
            <tr><td align="center" width="26" height="26" style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#fff;line-height:26px">${esc((S.siteTitle || "R").trim()[0].toUpperCase())}</td></tr>
          </table>
        </td>
        <td style="padding-left:10px;font-family:Arial,sans-serif;font-size:13px;font-weight:600;color:${C.ink2};letter-spacing:.02em">${esc(S.siteTitle || "Race Schedule")}</td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:0 0 4px 0;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${C.red}">
      ${esc(slot.label || "Race day")}
    </td></tr>
    <tr><td style="padding:0 0 2px 0;font-family:Arial,sans-serif;font-size:23px;font-weight:700;color:${C.ink};line-height:1.2">
      ${races.length} race${races.length === 1 ? "" : "s"} ${scope === "tomorrow" ? "tomorrow" : scope === "remaining" ? "still to come" : "today"}
    </td></tr>
    <tr><td style="padding:0 0 18px 0;font-family:Arial,sans-serif;font-size:13px;color:${C.ink3}">
      ${esc(dayLabel)} &middot; all times ${esc(abbr)}
    </td></tr>

    ${rows}

    ${E.includeSiteLink !== false && siteUrl ? `
    <tr><td style="padding:8px 0 0 0">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="${C.red}" style="background:${C.red};border-radius:6px">
          <a href="${esc(siteUrl)}" style="display:inline-block;padding:10px 18px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#ffffff;text-decoration:none">Open the full schedule</a>
        </td>
      </tr></table>
    </td></tr>` : ""}

    <tr><td style="padding:20px 0 0 0;border-top:1px solid ${C.line};margin-top:16px">
      <div style="font-family:Arial,sans-serif;font-size:11px;color:${C.ink3};line-height:1.5;padding-top:14px">
        Sent automatically from your schedule. Change the times, recipients or wording in Settings &rsaquo; Email.
      </div>
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;
}

function buildText(races, slot, scope) {
  const lines = [
    `${slot.label || "Race day"}, ${fmtLongDate(scope === "tomorrow" ? addDays(today, 1) : today)}`,
    ""
  ];
  races.forEach(r => {
    const lg = leagueById[r.leagueId] || {};
    lines.push(`${fmtTime(r.startUtc, TZ)}  ${lg.short || lg.name || ""}${r.round ? ` W${r.round}` : ""}`);
    lines.push(`        ${r.track || "TBA"}${r.trackConfig ? ` (${r.trackConfig})` : ""}`);
    lines.push(`        ${r.car || "Car TBA"}${r.lengthMin ? ` · ${r.lengthMin} min` : r.lengthLaps ? ` · ${r.lengthLaps} laps` : ""}`);
    if (E.includePracticeTimes !== false && (r.practiceUtc || r.qualifyUtc)) {
      const p = [];
      if (r.practiceUtc) p.push(`practice ${fmtTime(r.practiceUtc, TZ)}`);
      if (r.qualifyUtc) p.push(`qualy ${fmtTime(r.qualifyUtc, TZ)}`);
      lines.push(`        ${p.join(" · ")}`);
    }
    lines.push("");
  });
  if (E.siteUrl) lines.push(E.siteUrl);
  return lines.join("\n");
}

/* ============================ send ============================ */

async function sendViaResend(subject, html, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set. Add it as a repository secret.");
  const to = (E.to || []).filter(Boolean);
  if (!to.length) throw new Error("No recipients configured (Settings > Email).");

  const body = {
    from: `${E.fromName || "Race Schedule"} <${E.fromAddress || "onboarding@resend.dev"}>`,
    to, subject, html, text
  };
  if (E.replyTo) body.reply_to = E.replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const out = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${out}`);
  return out;
}

/* ============================ main ============================ */

async function main() {
  if (E.enabled === false && !FORCE) { console.log("Email is switched off in settings. Nothing to do."); return; }

  const slots = dueSlots();
  if (!slots.length) {
    console.log(`Nothing due. It is ${nowET.time} ${TZ}. Slots: ` +
      (E.sends || []).map(s => `${s.id}@${String(s.hour).padStart(2, "0")}:${String(s.minute || 0).padStart(2, "0")}${s.enabled ? "" : " (off)"}`).join(", "));
    return;
  }

  let wrote = false;

  for (const slot of slots) {
    const key = `${today}:${slot.id}`;
    if (!FORCE && sentLog.sent.includes(key)) { console.log(`${key} already sent.`); continue; }

    const races = racesFor(slot.scope);
    if (!races.length) {
      console.log(`${key}: no races in scope "${slot.scope}". Not sending.`);
      if (!FORCE) { sentLog.sent.push(key); wrote = true; }
      continue;
    }

    const tpl = slot.scope === "today" ? E.subjectTemplate : (E.subjectTemplateEvening || E.subjectTemplate);
    const subject = fillSubject(tpl, races, slot.scope);
    const html = buildHtml(races, slot, slot.scope);
    const text = buildText(races, slot, slot.scope);

    console.log(`${key}: ${races.length} race(s). Subject: ${subject}`);

    if (HTML_OUT) {
      writeFileSync(resolve(ROOT, HTML_OUT), html);
      console.log(`Wrote ${HTML_OUT}`);
    }

    if (DRY) {
      console.log("--- dry run, not sending ---");
      console.log(text);
      continue;
    }

    try {
      await sendViaResend(subject, html, text);
      console.log(`${key}: sent to ${(E.to || []).join(", ")}`);
      if (!FORCE) { sentLog.sent.push(key); wrote = true; }
    } catch (err) {
      console.error(`${key}: FAILED: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (wrote) {
    sentLog.sent = sentLog.sent.slice(-120);
    sentLog.updatedAt = new Date().toISOString();
    mkdirSync(dirname(SENT), { recursive: true });
    writeFileSync(SENT, JSON.stringify(sentLog, null, 2) + "\n");
    console.log("Updated data/sent.json");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
