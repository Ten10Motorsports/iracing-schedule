/* ------------------------------------------------------------------
   views.js
   Everything that draws. Month, week, list, seasons, the next-up
   banner, the league filter row, and the race detail drawer.
------------------------------------------------------------------- */

(function () {
  const V = {};
  const el = (id) => document.getElementById(id);

  V.cursorMonth = null;   /* "2026-09" */
  V.cursorWeek = null;    /* Monday date key */

  /* =================== shared bits =================== */

  function raceClasses(r, clashes) {
    const c = [];
    if (S.isOff(r)) c.push("is-off");
    if (r.status === "skipped" || r.status === "cancelled") c.push("skipped");
    if (r.status === "done") c.push("done");
    if (clashes && clashes[r.id]) c.push("clash");
    return c.join(" ");
  }

  function trackLabel(r) {
    if (!r.track) return "Track TBA";
    return r.track + (r.trackConfig && r.trackConfig !== "-" ? " · " + r.trackConfig : "");
  }

  function lengthLabel(r) {
    if (r.lengthLaps) return r.lengthLaps + " laps";
    if (r.lengthMin) return r.lengthMin + " min";
    return "";
  }

  function shortTrack(r) {
    if (!r.track) return "TBA";
    const named = IR_CONTENT.shortNames[r.track];
    if (named) return named;
    /* fallback for anything typed in by hand */
    return r.track
      .replace(/^(Circuit de |Circuit |Autodromo Nazionale |Autódromo |Autodromo |Michelin Raceway |WeatherTech Raceway |Mobility Resort |The )/, "")
      .replace(/ (International Racing Course|International Raceway|International Speedway|Motor Speedway|Superspeedway|Raceway|Speedway|Racing Circuit|Circuit|Sports Car Course|Motorsports Park|Motorsport Park|Grand-Prix-Strecke|International)$/, "")
      .trim() || r.track;
  }
  V.shortTrack = shortTrack;

  /* =================== next up =================== */

  V.renderNextUp = function () {
    const host = el("nextUp");
    const now = Date.now();
    const upcoming = U.sortBy(
      S.visibleRaces().filter(r => !S.isOff(r) && Date.parse(r.startUtc) + (r.lengthMin || 60) * 60000 > now),
      r => r.startUtc
    );
    const r = upcoming[0];

    if (!r) {
      host.innerHTML =
        '<div class="nextup none">' +
        '<div><div class="k">Next up</div><div class="title">Nothing scheduled</div>' +
        '<div class="meta">No upcoming races in the leagues you have shown.</div></div></div>';
      return;
    }

    const lg = S.league(r.leagueId) || { name: "Unknown", color: "#7e7e88", season: {} };
    const cd = U.countdown(r.startUtc, now);
    const day = S.raceDay(r);
    const today = U.todayKey(S.tz());
    const dayWord = day === today ? "Today" : day === U.addDays(today, 1) ? "Tomorrow" : U.fmtDate(r.startUtc, S.tz(), { weekday: "long", day: "numeric", month: "long" });
    const rounds = lg.season && lg.season.rounds ? " of " + lg.season.rounds : "";

    host.innerHTML =
      '<div class="nextup" style="--lg:' + U.esc(lg.color) + ';border-left-color:' + U.esc(lg.color) + '">' +
        '<div>' +
          '<div class="k" style="color:' + U.esc(lg.color) + '">Next up · ' + U.esc(lg.name) +
            (r.round ? ' · Week ' + r.round + rounds : '') + '</div>' +
          '<div class="title">' + U.esc(trackLabel(r)) + '</div>' +
          '<div class="meta"><b>' + U.esc(dayWord) + ' ' + U.fmtTime(r.startUtc, S.tz()) + '</b> ' +
            U.esc(U.fmtZoneAbbr(r.startUtc, S.tz())) +
            (r.car ? ' · ' + U.esc(r.car) : '') +
            (lengthLabel(r) ? ' · ' + lengthLabel(r) : '') +
          '</div>' +
        '</div>' +
        '<div class="cd"><div class="t">' + (cd.past ? "LIVE" : cd.text) + '</div>' +
          '<div class="l">' + (cd.past ? "underway" : "to green flag") + '</div></div>' +
      '</div>';

    host.firstElementChild.style.cursor = "pointer";
    host.firstElementChild.onclick = () => V.openDrawer(r.id);
  };

  /* =================== filters =================== */

  V.renderFilters = function () {
    const host = el("filters");
    const active = S.activeFilters();
    const counts = {};
    (S.data.races || []).forEach(r => counts[r.leagueId] = (counts[r.leagueId] || 0) + 1);

    let html = "";
    (S.data.leagues || []).forEach(l => {
      const on = active.indexOf(l.id) !== -1;
      html += '<button class="chip" data-league="' + U.esc(l.id) + '" aria-pressed="' + on + '">' +
        '<span class="dot" style="background:' + U.esc(on ? l.color : "#55555e") + '"></span>' +
        U.esc(l.name) + ' <span class="n">' + (counts[l.id] || 0) + '</span></button>';
    });
    html += '<span class="spacer"></span>';
    html += '<button class="chip" id="chipAll">All</button>';
    if (S.data.offDays && S.data.offDays.length) {
      html += '<span class="badge grey" title="Days you have marked unavailable">' +
        S.data.offDays.length + ' off period' + (S.data.offDays.length > 1 ? 's' : '') + '</span>';
    }
    host.innerHTML = html;

    host.querySelectorAll("[data-league]").forEach(b => {
      b.onclick = () => {
        const id = b.dataset.league;
        let cur = S.activeFilters().slice();
        const all = S.data.leagues.map(l => l.id);
        if (cur.length === all.length) cur = [id];            /* first click isolates */
        else if (cur.indexOf(id) !== -1) cur = cur.filter(x => x !== id);
        else cur.push(id);
        if (!cur.length) cur = all;
        S.setFilters(cur);
        V.render();
      };
    });
    el("chipAll").onclick = () => { S.setFilters(S.data.leagues.map(l => l.id)); V.render(); };
  };

  /* =================== month =================== */

  V.renderMonth = function () {
    const host = el("view");
    const tz = S.tz();
    const today = U.todayKey(tz);
    if (!V.cursorMonth) V.cursorMonth = U.monthKey(today);

    const byDay = S.racesByDay();
    const active = S.activeFilters();
    const clashes = S.clashSet();
    const start = U.monthGridStart(V.cursorMonth);
    const cells = 42;
    const narrow = window.matchMedia("(max-width: 720px)").matches;
    const maxPerDay = narrow ? 3 : 4;

    let html =
      '<div class="cal-head">' +
        '<button class="btn icon" id="mPrev" aria-label="Previous month">‹</button>' +
        '<h2>' + U.esc(U.monthLabel(V.cursorMonth)) + '</h2>' +
        '<button class="btn icon" id="mNext" aria-label="Next month">›</button>' +
        '<button class="btn sm ghost today-btn" id="mToday">Today</button>' +
        '<span style="flex:1"></span>' +
        '<span class="badge grey" id="monthCount"></span>' +
      '</div>' +
      '<div class="dow-row">' +
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d =>
          '<div>' + (narrow ? d[0] : d) + '</div>').join("") +
      '</div><div class="month-grid">';

    let monthRaces = 0;

    for (let i = 0; i < cells; i++) {
      const key = U.addDays(start, i);
      const inMonth = U.monthKey(key) === V.cursorMonth;
      const off = S.offDayFor(key);
      const dow = U.dowOf(key);
      const list = (byDay[key] || []).filter(r => active.indexOf(r.leagueId) !== -1);
      if (inMonth) monthRaces += list.length;

      const cls = ["day"];
      if (!inMonth) cls.push("out");
      if (key === today) cls.push("today");
      if (off) cls.push("off");
      if (dow === 0 || dow === 6) cls.push("weekend");

      html += '<div class="' + cls.join(" ") + '" data-day="' + key + '">' +
        '<div class="day-top"><span class="dnum">' + Number(key.slice(8)) + '</span>' +
        (off && inMonth ? '<span class="off-tag" title="' + U.esc(off.reason || "Unavailable") + '">' + U.esc(off.reason || "Off") + '</span>' : '') +
        '</div>';

      list.slice(0, maxPerDay).forEach(r => {
        const lg = S.league(r.leagueId) || {};
        html += '<button class="ev ' + raceClasses(r, clashes) + '" data-race="' + U.esc(r.id) + '" style="--lg:' + U.esc(lg.color || "#7e7e88") + '" ' +
          'title="' + U.esc(lg.name + (r.round ? " Week " + r.round : "") + " · " + trackLabel(r) + (r.car ? " · " + r.car : "")) + '">' +
          '<span class="r1"><span class="tm">' + U.fmtTime(r.startUtc, tz) + '</span>' +
          '<span class="lg">' + U.esc(lg.short || lg.name || "") + '</span>' +
          (clashes[r.id] ? '<span class="flag" title="Overlaps another race">▲</span>' : '') +
          (r.round ? '<span class="rd">W' + r.round + '</span>' : '') + '</span>' +
          '<span class="r2">' + U.esc(shortTrack(r)) + '</span>' +
          '</button>';
      });
      if (list.length > maxPerDay) {
        html += '<button class="more" data-openday="' + key + '">+' + (list.length - maxPerDay) + ' more</button>';
      }
      html += '</div>';
    }
    html += '</div>';
    host.innerHTML = html;

    el("monthCount").textContent = monthRaces + " race" + (monthRaces === 1 ? "" : "s");
    el("mPrev").onclick = () => { V.cursorMonth = U.shiftMonth(V.cursorMonth, -1); V.render(); };
    el("mNext").onclick = () => { V.cursorMonth = U.shiftMonth(V.cursorMonth, 1); V.render(); };
    el("mToday").onclick = () => { V.cursorMonth = U.monthKey(U.todayKey(tz)); V.render(); };

    host.querySelectorAll("[data-openday]").forEach(b => b.onclick = (e) => { e.stopPropagation(); V.openDay(b.dataset.openday); });

    /* On a phone the tiles are too small to carry detail, so a tap
       anywhere on the day opens that day in the drawer. On a wide
       screen the tiles are readable, so a tap goes straight to the
       race and a double-click on empty space adds one. */
    if (narrow) {
      host.querySelectorAll(".day:not(.out)").forEach(d => {
        d.style.cursor = "pointer";
        d.onclick = () => V.openDay(d.dataset.day);
      });
      host.querySelectorAll("[data-race]").forEach(b => b.onclick = (e) => {
        e.stopPropagation(); V.openDay(b.closest(".day").dataset.day);
      });
    } else {
      host.querySelectorAll("[data-race]").forEach(b => b.onclick = (e) => { e.stopPropagation(); V.openDrawer(b.dataset.race); });
      host.querySelectorAll(".day:not(.out)").forEach(d => {
        d.ondblclick = () => { if (S.unlocked) Admin.newRace({ date: d.dataset.day }); };
      });
    }
  };

  /* =================== week =================== */

  V.renderWeek = function () {
    const host = el("view");
    const tz = S.tz();
    const today = U.todayKey(tz);
    if (!V.cursorWeek) V.cursorWeek = U.addDays(today, -((U.dowOf(today) + 6) % 7));

    const byDay = S.racesByDay();
    const active = S.activeFilters();
    const clashes = S.clashSet();
    const endKey = U.addDays(V.cursorWeek, 6);

    let html =
      '<div class="cal-head">' +
        '<button class="btn icon" id="wPrev" aria-label="Previous week">‹</button>' +
        '<h2>' + U.fmtDate(V.cursorWeek + "T12:00:00Z", "UTC", { weekday: undefined, day: "numeric", month: "short" }) +
          ' – ' + U.fmtDate(endKey + "T12:00:00Z", "UTC", { weekday: undefined, day: "numeric", month: "short", year: "numeric" }) + '</h2>' +
        '<button class="btn icon" id="wNext" aria-label="Next week">›</button>' +
        '<button class="btn sm ghost" id="wToday">This week</button>' +
      '</div><div class="week-grid">';

    for (let i = 0; i < 7; i++) {
      const key = U.addDays(V.cursorWeek, i);
      const off = S.offDayFor(key);
      const list = (byDay[key] || []).filter(r => active.indexOf(r.leagueId) !== -1);
      const cls = ["wday"];
      if (key === today) cls.push("today");
      if (off) cls.push("off");

      html += '<div class="' + cls.join(" ") + '" data-day="' + key + '">' +
        '<h3>' + U.DOW_LABEL[U.dowOf(key)] + ' <span>' + Number(key.slice(8)) + '</span>' +
        (off ? ' <span class="badge warn" style="font-size:9px">' + U.esc(off.reason || "Off") + '</span>' : '') + '</h3>';

      if (!list.length) html += '<div style="font-size:12px;color:var(--ink-4)">-</div>';
      list.forEach(r => {
        const lg = S.league(r.leagueId) || {};
        html += '<button class="ev ' + raceClasses(r, clashes) + '" data-race="' + U.esc(r.id) + '" style="--lg:' + U.esc(lg.color || "#7e7e88") + '">' +
          '<span class="r1"><span class="tm">' + U.fmtTime(r.startUtc, tz) + '</span>' +
          '<span class="lg">' + U.esc(lg.short || lg.name || "") + '</span></span>' +
          '<span class="r2">' + U.esc(shortTrack(r)) + '</span>' +
          '<span class="r2" style="color:var(--ink-4)">' + U.esc(r.car || "") + '</span>' +
          '</button>';
      });
      html += '</div>';
    }
    html += '</div>';
    host.innerHTML = html;

    el("wPrev").onclick = () => { V.cursorWeek = U.addDays(V.cursorWeek, -7); V.render(); };
    el("wNext").onclick = () => { V.cursorWeek = U.addDays(V.cursorWeek, 7); V.render(); };
    el("wToday").onclick = () => { V.cursorWeek = U.addDays(today, -((U.dowOf(today) + 6) % 7)); V.render(); };
    host.querySelectorAll("[data-race]").forEach(b => b.onclick = () => V.openDrawer(b.dataset.race));
  };

  /* =================== list =================== */

  V.renderList = function () {
    const host = el("view");
    const tz = S.tz();
    const today = U.todayKey(tz);
    const active = S.activeFilters();
    const clashes = S.clashSet();
    const showPast = host.dataset.past === "1";

    let races = S.visibleRaces();
    if (!showPast) races = races.filter(r => S.raceDay(r) >= today);
    races = U.sortBy(races, r => r.startUtc);
    if (showPast) races = races.reverse();

    let html =
      '<div class="cal-head">' +
        '<h2>' + (showPast ? "Everything, newest first" : "Coming up") + '</h2>' +
        '<span style="flex:1"></span>' +
        '<button class="btn sm" id="togglePast">' + (showPast ? "Upcoming only" : "Show past races") + '</button>' +
      '</div>';

    if (!races.length) {
      html += '<div class="empty"><h3>Nothing here</h3><p>No races match the leagues you have shown.</p></div>';
    }

    let lastDay = "";
    races.forEach(r => {
      const day = S.raceDay(r);
      if (day !== lastDay) {
        lastDay = day;
        const off = S.offDayFor(day);
        const rel = day === today ? "Today" : day === U.addDays(today, 1) ? "Tomorrow" : "";
        html += '<div class="list-day-h">' +
          U.fmtDate(day + "T12:00:00Z", "UTC", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) +
          (off ? ' <span class="off-tag">' + U.esc(off.reason || "Unavailable") + '</span>' : '') +
          '<span class="rel">' + U.esc(rel) + '</span></div>';
      }
      const lg = S.league(r.leagueId) || {};
      html += '<button class="row ' + raceClasses(r, clashes) + '" data-race="' + U.esc(r.id) + '" style="--lg:' + U.esc(lg.color || "#7e7e88") + '">' +
        '<div class="time">' + U.fmtTime(r.startUtc, tz) + '<small>' + U.esc(U.fmtZoneAbbr(r.startUtc, tz)) + '</small></div>' +
        '<div class="main">' +
          '<div class="l1"><span class="lgname">' + U.esc(lg.name || "") + '</span>' +
            (r.round ? '<span class="round">Week ' + r.round + (lg.season && lg.season.rounds ? " / " + lg.season.rounds : "") + '</span>' : '') +
            (clashes[r.id] ? '<span class="badge warn">Clash</span>' : '') +
            (r.status && r.status !== "scheduled" ? '<span class="badge grey">' + U.esc(r.status) + '</span>' : '') +
          '</div>' +
          '<div class="l2">' + U.esc(trackLabel(r)) + '</div>' +
          '<div class="l3">' + U.esc(r.car || "Car TBA") + (lengthLabel(r) ? ' · ' + lengthLabel(r) : '') + '</div>' +
        '</div>' +
        '<div class="right">' + U.esc(U.countdownPhrase(r.startUtc)) +
          (r.practiceUtc ? '<br>practice ' + U.fmtTime(r.practiceUtc, tz) : '') + '</div>' +
        '</button>';
    });

    host.innerHTML = html;
    el("togglePast").onclick = () => { host.dataset.past = showPast ? "0" : "1"; V.renderList(); };
    host.querySelectorAll("[data-race]").forEach(b => b.onclick = () => V.openDrawer(b.dataset.race));
  };

  /* =================== seasons =================== */

  V.renderSeason = function () {
    const host = el("view");
    const tz = S.tz();
    const today = U.todayKey(tz);
    const active = S.activeFilters();
    let html = '<div class="cal-head"><h2>Seasons by league</h2></div>';

    (S.data.leagues || []).filter(l => active.indexOf(l.id) !== -1).forEach(lg => {
      const races = U.sortBy(S.data.races.filter(r => r.leagueId === lg.id), r => (r.round || 0) * 1e13 + Date.parse(r.startUtc));
      const done = races.filter(r => S.raceDay(r) < today).length;

      html += '<div class="season-block" style="--lg:' + U.esc(lg.color) + '">' +
        '<div class="season-head" style="border-bottom-color:' + U.esc(lg.color) + '">' +
          '<h3>' + U.esc(lg.name) + '</h3>' +
          (lg.season && lg.season.name ? '<span class="pill">' + U.esc(lg.season.name) + '</span>' : '') +
          '<span class="pill">' + done + ' / ' + (races.length || (lg.season && lg.season.rounds) || 0) + ' run</span>' +
          '<span style="flex:1"></span>' +
          (S.unlocked ? '<button class="btn sm" data-addfor="' + U.esc(lg.id) + '">+ Add round</button>' : '') +
        '</div>';

      if (!races.length) {
        html += '<div class="note">No rounds yet for this league.</div></div>';
        return;
      }

      html += '<div class="tbl-wrap"><table class="season-table"><thead><tr>' +
        '<th style="width:64px">Week</th><th style="width:132px">Date</th><th style="width:78px">Time</th>' +
        '<th>Track</th><th>Car</th><th style="width:90px">Length</th><th style="width:100px">Status</th>' +
        (S.unlocked ? '<th style="width:64px"></th>' : '') +
        '</tr></thead><tbody>';

      races.forEach(r => {
        const past = S.raceDay(r) < today;
        const off = S.isOff(r);
        html += '<tr class="' + (past ? "done " : "") + (off ? "is-off" : "") + '" data-race="' + U.esc(r.id) + '" style="cursor:pointer">' +
          '<td class="rd">' + (r.round ? "W" + r.round : "-") + '</td>' +
          '<td class="dt">' + U.fmtDate(r.startUtc, tz, { weekday: "short", day: "2-digit", month: "short" }) + '</td>' +
          '<td class="dt">' + U.fmtTime(r.startUtc, tz) + '</td>' +
          '<td>' + U.esc(trackLabel(r)) + '</td>' +
          '<td style="color:var(--ink-2)">' + U.esc(r.car || "-") + '</td>' +
          '<td style="color:var(--ink-3)">' + U.esc(lengthLabel(r) || "-") + '</td>' +
          '<td>' + (off ? '<span class="badge warn">unavailable</span>'
                        : '<span class="badge grey">' + U.esc(r.status || "scheduled") + '</span>') + '</td>' +
          (S.unlocked ? '<td class="act"><button class="btn sm ghost" data-edit="' + U.esc(r.id) + '">Edit</button></td>' : '') +
          '</tr>';
      });
      html += '</tbody></table></div></div>';
    });

    host.innerHTML = html;
    host.querySelectorAll("tr[data-race]").forEach(tr => tr.onclick = () => V.openDrawer(tr.dataset.race));
    host.querySelectorAll("[data-edit]").forEach(b => b.onclick = (e) => { e.stopPropagation(); Admin.editRace(b.dataset.edit); });
    host.querySelectorAll("[data-addfor]").forEach(b => b.onclick = () => Admin.newRace({ leagueId: b.dataset.addfor }));
  };

  /* =================== day popup (month "+n more") =================== */

  V.openDay = function (dayKey) {
    const tz = S.tz();
    const byDay = S.racesByDay();
    const active = S.activeFilters();
    const list = (byDay[dayKey] || []).filter(r => active.indexOf(r.leagueId) !== -1);
    const off = S.offDayFor(dayKey);

    el("drawerKicker").textContent = off ? "Marked unavailable" : "Day";
    el("drawerTitle").textContent = U.fmtDate(dayKey + "T12:00:00Z", "UTC", { weekday: "long", day: "numeric", month: "long" });

    let html = off ? '<div class="note warn"><b>' + U.esc(off.reason || "Unavailable") + '</b>, ' +
      U.esc(off.start) + (off.end && off.end !== off.start ? " to " + U.esc(off.end) : "") + '</div>' : "";

    list.forEach(r => {
      const lg = S.league(r.leagueId) || {};
      html += '<button class="row ' + raceClasses(r, S.clashSet()) + '" data-race="' + U.esc(r.id) + '" style="--lg:' + U.esc(lg.color) + '">' +
        '<div class="time">' + U.fmtTime(r.startUtc, tz) + '</div>' +
        '<div class="main"><div class="l1"><span class="lgname">' + U.esc(lg.name) + '</span>' +
        (r.round ? '<span class="round">W' + r.round + '</span>' : '') + '</div>' +
        '<div class="l2">' + U.esc(trackLabel(r)) + '</div>' +
        '<div class="l3">' + U.esc(r.car || "") + '</div></div><div class="right"></div></button>';
    });
    if (!list.length) html += '<div class="empty"><h3>No races</h3></div>';

    el("drawerBody").innerHTML = html;
    el("drawerFoot").innerHTML = S.unlocked
      ? '<button class="btn primary" id="dAddHere">+ Add race on this day</button>' +
        '<button class="btn" id="dToggleOff">' + (off ? "Remove day off" : "Mark day off") + '</button>'
      : '';
    if (S.unlocked) {
      el("dAddHere").onclick = () => { V.closeDrawer(); Admin.newRace({ date: dayKey }); };
      el("dToggleOff").onclick = () => { Admin.toggleOffDay(dayKey); V.closeDrawer(); };
    }
    el("drawerBody").querySelectorAll("[data-race]").forEach(b => b.onclick = () => V.openDrawer(b.dataset.race));
    V.showDrawer();
  };

  /* =================== race drawer =================== */

  V.openDrawer = function (raceId) {
    const r = S.race(raceId);
    if (!r) return;
    const lg = S.league(r.leagueId) || { name: "Unknown", color: "#7e7e88", season: {} };
    const tz = S.tz();
    const off = S.offDayFor(S.raceDay(r));
    const clashes = S.clashesFor(r);

    el("drawerKicker").textContent = lg.name + (r.round ? " · Week " + r.round + (lg.season.rounds ? " of " + lg.season.rounds : "") : "");
    el("drawerKicker").style.color = lg.color;
    el("drawerTitle").textContent = trackLabel(r);

    let html = "";

    if (off && !r.overrideAvailable) {
      html += '<div class="note warn"><b>You are marked unavailable</b> on this day (' +
        U.esc(off.reason || "day off") + '). This race is excluded from notification emails.</div>';
    }
    if (clashes.length) {
      html += '<div class="note warn"><b>Overlaps ' + clashes.length + ' other race' + (clashes.length > 1 ? 's' : '') + ':</b><br>' +
        clashes.map(c => {
          const cl = S.league(c.leagueId) || {};
          return U.esc(cl.name) + " at " + U.fmtTime(c.startUtc, tz) + " (" + U.esc(shortTrack(c)) + ")";
        }).join("<br>") + '</div>';
    }

    html += '<div class="timeline">';
    if (r.practiceUtc) html += '<div class="t"><div class="lbl">Practice opens</div><div class="val">' +
      U.fmtTime(r.practiceUtc, tz) + '<small>' + U.countdownPhrase(r.practiceUtc) + '</small></div></div>';
    if (r.qualifyUtc) html += '<div class="t"><div class="lbl">Qualifying</div><div class="val">' +
      U.fmtTime(r.qualifyUtc, tz) + '</div></div>';
    if (r.warmup) html += '<div class="t"><div class="lbl">Warmup</div><div class="val">yes</div></div>';
    html += '<div class="t race"><div class="lbl">Green flag</div><div class="val">' +
      U.fmtTime(r.startUtc, tz) + '<small>' + U.countdownPhrase(r.startUtc) + '</small></div></div>';
    html += '</div>';

    html += '<dl class="kv">' +
      '<dt>Date</dt><dd>' + U.fmtDate(r.startUtc, tz, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + '</dd>' +
      '<dt>Car</dt><dd>' + U.esc(r.car || "-") + '</dd>' +
      '<dt>Track</dt><dd>' + U.esc(r.track || "-") + (r.trackConfig ? '<br><span style="color:var(--ink-3)">' + U.esc(r.trackConfig) + '</span>' : '') + '</dd>' +
      '<dt>Length</dt><dd>' + U.esc(lengthLabel(r) || "-") + '</dd>' +
      '<dt>Status</dt><dd>' + U.esc(r.status || "scheduled") + '</dd>' +
      (S.data.settings.showUtc ? '<dt>In UTC</dt><dd class="mono" style="font-family:var(--mono);font-size:13px">' +
        U.esc(r.startUtc.replace("T", " ").replace("Z", " UTC")) + '</dd>' : '') +
      (r.notes ? '<dt>Notes</dt><dd>' + U.esc(r.notes).replace(/\n/g, "<br>") + '</dd>' : '') +
      '</dl>';

    el("drawerBody").innerHTML = html;

    let foot = '<button class="btn" id="dIcs">Add to calendar</button>';
    if (S.unlocked) {
      foot += '<button class="btn primary" id="dEdit">Edit</button>';
      foot += off
        ? '<button class="btn sm ghost" id="dOverride">' + (r.overrideAvailable ? "Respect day off" : "Race anyway") + '</button>'
        : '';
    }
    el("drawerFoot").innerHTML = foot;
    el("dIcs").onclick = () => V.downloadIcs(r);
    if (S.unlocked) {
      el("dEdit").onclick = () => { V.closeDrawer(); Admin.editRace(r.id); };
      const ov = el("dOverride");
      if (ov) ov.onclick = () => { r.overrideAvailable = !r.overrideAvailable; S.touch(); V.render(); V.openDrawer(r.id); };
    }
    V.showDrawer();
  };

  V.showDrawer = function () {
    el("drawer").classList.add("on");
    el("drawer").setAttribute("aria-hidden", "false");
    el("scrim").classList.add("on");
  };
  V.closeDrawer = function () {
    el("drawer").classList.remove("on");
    el("drawer").setAttribute("aria-hidden", "true");
    el("scrim").classList.remove("on");
  };

  /* =================== .ics export =================== */

  function icsStamp(iso) { return iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"); }

  V.icsFor = function (races, name) {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Race Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "X-WR-CALNAME:" + (name || "Race Schedule")];
    races.forEach(r => {
      const lg = S.league(r.leagueId) || {};
      const end = new Date(Date.parse(r.startUtc) + (r.lengthMin || 60) * 60000).toISOString();
      const desc = [
        lg.name ? "League: " + lg.name : "",
        r.round ? "Week " + r.round : "",
        r.car ? "Car: " + r.car : "",
        r.practiceUtc ? "Practice opens " + U.fmtTime(r.practiceUtc, S.tz()) : "",
        r.qualifyUtc ? "Qualifying " + U.fmtTime(r.qualifyUtc, S.tz()) : "",
        r.notes || ""
      ].filter(Boolean).join("\\n");
      lines.push("BEGIN:VEVENT",
        "UID:" + r.id + "@race-schedule",
        "DTSTAMP:" + icsStamp(new Date().toISOString()),
        "DTSTART:" + icsStamp(r.startUtc),
        "DTEND:" + icsStamp(end),
        "SUMMARY:" + ((lg.short || lg.name || "Race") + " W" + (r.round || "")  + " - " + (r.track || "TBA")).replace(/,/g, "\\,"),
        "LOCATION:" + String(trackLabel(r)).replace(/,/g, "\\,"),
        "DESCRIPTION:" + desc.replace(/,/g, "\\,"),
        "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Race in 30 minutes", "END:VALARM",
        "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  };

  V.downloadIcs = function (race) {
    const races = race ? [race] : S.visibleRaces();
    const blob = new Blob([V.icsFor(races, S.data.settings.siteTitle)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = race ? "race-" + (race.round || "") + ".ics" : "race-schedule.ics";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  /* =================== router =================== */

  V.render = function () {
    const v = S.view();
    document.querySelectorAll("[data-view]").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.view === v)));
    V.renderNextUp();
    V.renderFilters();
    if (v === "week") V.renderWeek();
    else if (v === "list") V.renderList();
    else if (v === "season") V.renderSeason();
    else V.renderMonth();
  };

  window.V = V;
})();
