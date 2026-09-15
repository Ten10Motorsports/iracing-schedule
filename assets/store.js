/* ------------------------------------------------------------------
   store.js
   The single source of truth in the browser, plus everything that
   talks to GitHub.

   Shape of the world:
     - data/schedule.json in the repo is authoritative.
     - On load we fetch it. If a local draft exists that is newer than
       the fetched file, we offer to keep the draft (this is what saves
       you when a publish fails or you close the tab mid-edit).
     - Edits mutate S.data and write a draft to localStorage instantly.
     - "Publish" commits S.data back to the repo via the GitHub
       Contents API using a fine-grained token you paste once.
------------------------------------------------------------------- */

(function () {
  const S = {};

  const LS_DRAFT = "rs_draft_v1";
  const LS_TOKEN = "rs_gh_token";
  const LS_UNLOCK = "rs_unlocked";
  const LS_FILTERS = "rs_filters";
  const LS_VIEW = "rs_view";

  S.data = null;
  S.sha = null;          /* blob sha of the file we loaded, needed to commit */
  S.dirty = false;
  S.unlocked = false;
  S.listeners = [];

  /* ---------------- storage helpers (never throw) ---------------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  S.lsGet = lsGet; S.lsSet = lsSet; S.lsDel = lsDel;

  /* ---------------- events ---------------- */
  S.on = function (fn) { S.listeners.push(fn); };
  S.emit = function () { S.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); };

  /* ---------------- load ---------------- */
  S.load = async function () {
    const path = (S.cfgPath && S.cfgPath()) || "data/schedule.json";
    let remote = null;
    try {
      const res = await fetch(path + "?v=" + Date.now(), { cache: "no-store" });
      if (res.ok) remote = await res.json();
    } catch (e) { /* offline: fall through to draft */ }

    const rawDraft = lsGet(LS_DRAFT);
    let draft = null;
    if (rawDraft) { try { draft = JSON.parse(rawDraft); } catch (e) {} }

    if (remote && draft) {
      const rt = Date.parse(remote.updatedAt || 0) || 0;
      const dt = Date.parse(draft.updatedAt || 0) || 0;
      if (dt > rt) { S.data = draft; S.dirty = true; }
      else { S.data = remote; lsDel(LS_DRAFT); }
    } else {
      S.data = remote || draft;
    }

    if (!S.data) throw new Error("Could not load data/schedule.json and no local copy exists.");

    S.migrate();
    return S.data;
  };

  /* Fill in anything an older data file is missing, so an upgrade
     never lands on an undefined. */
  S.migrate = function () {
    const d = S.data;
    d.version = d.version || 1;
    d.settings = d.settings || {};
    const s = d.settings;
    s.timezone = s.timezone || "America/New_York";
    s.siteTitle = s.siteTitle || "Race Schedule";
    s.defaultView = s.defaultView || "month";
    s.github = Object.assign({ owner: "", repo: "", branch: "main", dataPath: "data/schedule.json" }, s.github || {});
    s.email = Object.assign({
      enabled: true, to: [], fromName: "Race Schedule", fromAddress: "onboarding@resend.dev",
      replyTo: "", siteUrl: "", subjectTemplate: "{{count}} race{{s}} today: {{summary}}",
      subjectTemplateEvening: "Starting soon: {{summary}}",
      includePracticeTimes: true, includeSiteLink: true, windowMinutes: 50, skipOnOffDays: true,
      sends: []
    }, s.email || {});
    if (!s.email.sends.length) {
      s.email.sends = [
        { id: "morning", label: "Morning digest", hour: 10, minute: 0, scope: "today", enabled: true, intro: "Here is your day." },
        { id: "evening", label: "Last-minute reminder", hour: 19, minute: 0, scope: "remaining", enabled: true, intro: "Still to come tonight." }
      ];
    }
    d.leagues = d.leagues || [];
    d.races = d.races || [];
    d.offDays = d.offDays || [];
    d.customContent = d.customContent || { tracks: [], cars: [] };
    d.leagues.forEach(l => {
      l.season = l.season || { name: "", rounds: 0, startDate: "" };
      l.defaults = Object.assign({ dayOfWeek: 2, startTime: "20:00", practiceOffsetMin: 30, qualifyOffsetMin: 15, raceLengthMin: 60, warmup: false }, l.defaults || {});
      if (l.active === undefined) l.active = true;
      if (!l.timezone) l.timezone = s.timezone;
    });
  };

  S.cfgPath = function () {
    return (S.data && S.data.settings && S.data.settings.github && S.data.settings.github.dataPath) || "data/schedule.json";
  };

  /* ---------------- mutation ---------------- */
  S.touch = function () {
    S.data.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    S.dirty = true;
    lsSet(LS_DRAFT, JSON.stringify(S.data));
    S.emit();
  };

  S.discardDraft = function () { lsDel(LS_DRAFT); };

  /* ---------------- derived lookups ---------------- */
  S.league = function (id) { return (S.data.leagues || []).find(l => l.id === id) || null; };

  S.leagueColor = function (id) { const l = S.league(id); return l ? l.color : "#7e7e88"; };

  S.race = function (id) { return (S.data.races || []).find(r => r.id === id) || null; };

  /* Day key of a race, in the display zone. Derived from startUtc so it
     is always right, even if someone hand-edited `date`. */
  S.raceDay = function (r) {
    return U.utcToZoned(new Date(r.startUtc), S.tz()).date;
  };

  S.tz = function () { return (S.data.settings && S.data.settings.timezone) || "America/New_York"; };

  S.racesByDay = function () {
    const map = {};
    (S.data.races || []).forEach(r => {
      const k = S.raceDay(r);
      (map[k] = map[k] || []).push(r);
    });
    Object.keys(map).forEach(k => map[k].sort((a, b) => a.startUtc < b.startUtc ? -1 : 1));
    return map;
  };

  S.visibleRaces = function () {
    const active = S.activeFilters();
    return (S.data.races || []).filter(r => active.indexOf(r.leagueId) !== -1);
  };

  /* ---------------- days off ---------------- */
  S.offDayFor = function (dayKey) {
    return (S.data.offDays || []).find(o => dayKey >= o.start && dayKey <= (o.end || o.start)) || null;
  };

  S.isOff = function (r) {
    if (r.status === "skipped" || r.status === "cancelled") return true;
    if (r.overrideAvailable) return false;
    return !!S.offDayFor(S.raceDay(r));
  };

  /* ---------------- clash detection ----------------
     A race "occupies" from its earliest session (practice, or qualifying,
     or the race itself) through to the end of the race. Overlap of two
     such windows on the same day is a clash.
  ------------------------------------------------------------------ */
  S.raceWindow = function (r) {
    const starts = [r.startUtc, r.practiceUtc, r.qualifyUtc].filter(Boolean).map(x => Date.parse(x));
    const from = Math.min.apply(null, starts);
    const lenMin = r.lengthMin || (r.lengthLaps ? r.lengthLaps * 2 : 60);
    const to = Date.parse(r.startUtc) + lenMin * 60000;
    return { from: from, to: to };
  };

  S.clashesFor = function (race, ignoreId) {
    if (!S.data.settings.clashDetection) return [];
    const w = S.raceWindow(race);
    return (S.data.races || []).filter(o => {
      if (o.id === race.id || o.id === ignoreId) return false;
      if (o.status === "skipped" || o.status === "cancelled") return false;
      const ow = S.raceWindow(o);
      return ow.from < w.to && w.from < ow.to;
    });
  };

  S.clashSet = function () {
    /* ids of every race involved in at least one clash */
    const out = {};
    if (!S.data.settings.clashDetection) return out;
    const rs = (S.data.races || []).filter(r => r.status !== "skipped" && r.status !== "cancelled");
    for (let i = 0; i < rs.length; i++) {
      const wi = S.raceWindow(rs[i]);
      for (let j = i + 1; j < rs.length; j++) {
        const wj = S.raceWindow(rs[j]);
        if (wj.from < wi.to && wi.from < wj.to) { out[rs[i].id] = true; out[rs[j].id] = true; }
      }
    }
    return out;
  };

  /* ---------------- filters & view ---------------- */
  S.activeFilters = function () {
    const raw = lsGet(LS_FILTERS);
    const all = (S.data.leagues || []).map(l => l.id);
    if (!raw) return all;
    try {
      const saved = JSON.parse(raw).filter(id => all.indexOf(id) !== -1);
      return saved.length ? saved : all;
    } catch (e) { return all; }
  };
  S.setFilters = function (arr) { lsSet(LS_FILTERS, JSON.stringify(arr)); };

  S.view = function () { return lsGet(LS_VIEW) || (S.data.settings.defaultView || "month"); };
  S.setView = function (v) { lsSet(LS_VIEW, v); };

  /* ---------------- passcode ----------------
     SHA-256 of the passcode is stored in the data file. This is a gate
     against casual visitors on a public page, not a security boundary:
     anyone can read the hash and the page's JavaScript. The thing that
     actually protects the repo is the GitHub token, which lives only in
     your browser's localStorage and is never written to the data file.
  ------------------------------------------------------------------ */
  S.sha256 = async function (str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  };

  S.checkPasscode = async function (pass) {
    const want = S.data.settings.adminPasscodeHash;
    if (!want) return true;                     /* no passcode set yet */
    return (await S.sha256(pass)) === want;
  };

  S.setPasscode = async function (pass) {
    S.data.settings.adminPasscodeHash = pass ? await S.sha256(pass) : "";
    S.touch();
  };

  S.unlock = function () { S.unlocked = true; lsSet(LS_UNLOCK, "1"); S.emit(); };
  S.lock = function () { S.unlocked = false; lsDel(LS_UNLOCK); S.emit(); };
  S.wasUnlocked = function () { return lsGet(LS_UNLOCK) === "1"; };

  /* ---------------- GitHub token ---------------- */
  S.token = function () { return lsGet(LS_TOKEN) || ""; };
  S.setToken = function (t) { if (t) lsSet(LS_TOKEN, t); else lsDel(LS_TOKEN); };

  /* ---------------- GitHub API ---------------- */
  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  async function gh(path, opts) {
    const res = await fetch("https://api.github.com" + path, Object.assign({}, opts, {
      headers: Object.assign({
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": "Bearer " + S.token()
      }, (opts && opts.headers) || {})
    }));
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      const msg = (json && json.message) || res.statusText;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  S.ghConfig = function () {
    const g = S.data.settings.github || {};
    if (!g.owner || !g.repo) throw new Error("Set your GitHub owner and repo in Settings > GitHub first.");
    return g;
  };

  /* Fetch the current blob sha so the commit does not clobber a change
     made elsewhere (a hand edit on github.com, or your other device). */
  S.fetchSha = async function () {
    const g = S.ghConfig();
    try {
      const j = await gh(`/repos/${g.owner}/${g.repo}/contents/${encodeURI(g.dataPath)}?ref=${encodeURIComponent(g.branch)}`);
      return { sha: j.sha, content: j.content };
    } catch (e) {
      if (e.status === 404) return { sha: null, content: null };
      throw e;
    }
  };

  S.publish = async function (message) {
    if (!S.token()) throw new Error("No GitHub token saved. Settings > GitHub.");
    const g = S.ghConfig();

    /* conflict check */
    const cur = await S.fetchSha();
    if (cur.sha && cur.content) {
      let remote = null;
      try { remote = JSON.parse(decodeURIComponent(escape(atob(cur.content.replace(/\n/g, ""))))); } catch (e) {}
      if (remote && remote.updatedAt && S.loadedAt && Date.parse(remote.updatedAt) > Date.parse(S.loadedAt)) {
        const ok = confirm(
          "The schedule in GitHub has changed since this page loaded " +
          "(edited on another device, or directly on github.com).\n\n" +
          "OK  = overwrite it with what is on this screen.\n" +
          "Cancel = stop, so you can reload and redo your edits."
        );
        if (!ok) throw new Error("Publish cancelled, nothing was written.");
      }
    }

    S.data.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const body = {
      message: message || ("Update schedule " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"),
      content: b64(JSON.stringify(S.data, null, 2) + "\n"),
      branch: g.branch
    };
    if (cur.sha) body.sha = cur.sha;

    const out = await gh(`/repos/${g.owner}/${g.repo}/contents/${encodeURI(g.dataPath)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    S.sha = out.content.sha;
    S.loadedAt = S.data.updatedAt;
    S.dirty = false;
    S.discardDraft();
    S.emit();
    return out;
  };

  S.testToken = async function () {
    const g = S.ghConfig();
    const j = await gh(`/repos/${g.owner}/${g.repo}`);
    return j;
  };

  window.S = S;
})();
