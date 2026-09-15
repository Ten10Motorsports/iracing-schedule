/* ------------------------------------------------------------------
   admin.js
   The editor: race form, league management, days off, email settings,
   GitHub connection, import and export.

   Nothing in here runs unless S.unlocked is true, with the single
   exception of the unlock dialog itself.
------------------------------------------------------------------- */

(function () {
  const A = {};
  const el = (id) => document.getElementById(id);

  let editingId = null;

  /* =================== toasts =================== */
  A.toast = function (msg, kind) {
    const t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.textContent = msg;
    el("toasts").appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 2600);
    setTimeout(() => t.remove(), 3000);
  };

  /* =================== modal plumbing =================== */
  A.openModal = function (id) { el(id).classList.add("on"); document.body.style.overflow = "hidden"; };
  A.closeModal = function (id) { el(id).classList.remove("on"); document.body.style.overflow = ""; };

  /* =================== content lists =================== */
  function allTracks() {
    const custom = (S.data.customContent.tracks || []).map(t => typeof t === "string" ? { n: t, c: [], t: "custom" } : t);
    return IR_CONTENT.tracks.concat(custom);
  }
  function allCars() {
    const custom = (S.data.customContent.cars || []).map(c => typeof c === "string" ? { n: c, cl: "custom" } : c);
    return IR_CONTENT.cars.concat(custom);
  }

  /* A small type-ahead. Keyboard: up/down/enter/escape. Free text always wins. */
  function combo(inputId, listId, items, labelOf, subOf, onPick) {
    const input = el(inputId), list = el(listId);
    let idx = -1, current = [];

    function close() { list.classList.remove("on"); idx = -1; }
    function open(q) {
      const needle = (q || "").toLowerCase().trim();
      current = !needle
        ? items.slice(0, 40)
        : items.filter(i => labelOf(i).toLowerCase().indexOf(needle) !== -1).slice(0, 40);
      if (!current.length) {
        list.innerHTML = '<div class="none">No match. Whatever you type is saved as-is.</div>';
        list.classList.add("on");
        return;
      }
      list.innerHTML = current.map((i, n) =>
        '<button type="button" data-n="' + n + '" class="' + (n === idx ? "sel" : "") + '">' +
        U.esc(labelOf(i)) + (subOf && subOf(i) ? '<span class="cl">' + U.esc(subOf(i)) + '</span>' : '') +
        '</button>').join("");
      list.classList.add("on");
      list.querySelectorAll("button").forEach(b => {
        b.onmousedown = (e) => { e.preventDefault(); pick(current[Number(b.dataset.n)]); };
      });
    }
    function pick(item) {
      input.value = labelOf(item);
      close();
      if (onPick) onPick(item);
      input.dispatchEvent(new Event("change"));
    }

    input.oninput = () => open(input.value);
    input.onfocus = () => open(input.value);
    input.onblur = () => setTimeout(close, 120);
    input.onkeydown = (e) => {
      if (!list.classList.contains("on")) return;
      if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(idx + 1, current.length - 1); open(input.value); }
      else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); open(input.value); }
      else if (e.key === "Enter" && idx >= 0) { e.preventDefault(); pick(current[idx]); }
      else if (e.key === "Escape") {
        /* Escape closes the suggestion list only. Without stopping it
           here the page-level handler would close the whole modal and
           throw away what you were typing. */
        e.stopPropagation();
        close();
      }
    };
  }

  function fillConfigs(trackName, selected) {
    const sel = el("f_config");
    const t = allTracks().find(x => x.n === trackName);
    const cfgs = (t && t.c && t.c.length) ? t.c : [];
    sel.innerHTML = '<option value="">-</option>' +
      cfgs.map(c => '<option value="' + U.esc(c) + '">' + U.esc(c) + '</option>').join("");
    if (selected && cfgs.indexOf(selected) === -1) {
      sel.insertAdjacentHTML("beforeend", '<option value="' + U.esc(selected) + '">' + U.esc(selected) + '</option>');
    }
    sel.value = selected || "";
  }

  /* =================== race editor =================== */

  A.newRace = function (preset) {
    preset = preset || {};
    const lgId = preset.leagueId || (S.data.leagues[0] && S.data.leagues[0].id);
    const lg = S.league(lgId) || { defaults: {} };
    const existing = S.data.races.filter(r => r.leagueId === lgId);
    const nextRound = existing.length ? Math.max.apply(null, existing.map(r => r.round || 0)) + 1 : 1;

    let date = preset.date;
    if (!date) {
      /* next occurrence of the league's usual weekday */
      const today = U.todayKey(S.tz());
      const want = lg.defaults.dayOfWeek;
      date = today;
      for (let i = 0; i < 14; i++) { if (U.dowOf(date) === want) break; date = U.addDays(date, 1); }
    }

    A.openRaceModal({
      id: null, leagueId: lgId, round: nextRound, date: date,
      startTime: lg.defaults.startTime || "20:00",
      practiceTime: "", qualifyTime: "",
      warmup: !!lg.defaults.warmup,
      track: "", trackConfig: "", car: "",
      lengthVal: lg.defaults.raceLengthMin || 60, lengthUnit: "min",
      status: "scheduled", notes: ""
    }, true);
  };

  A.editRace = function (id) {
    const r = S.race(id);
    if (!r) return;
    const tz = S.tz();
    A.openRaceModal({
      id: r.id, leagueId: r.leagueId, round: r.round, date: S.raceDay(r),
      startTime: U.utcToZoned(new Date(r.startUtc), tz).time,
      practiceTime: r.practiceUtc ? U.utcToZoned(new Date(r.practiceUtc), tz).time : "",
      qualifyTime: r.qualifyUtc ? U.utcToZoned(new Date(r.qualifyUtc), tz).time : "",
      warmup: !!r.warmup,
      track: r.track || "", trackConfig: r.trackConfig || "", car: r.car || "",
      lengthVal: r.lengthLaps || r.lengthMin || "", lengthUnit: r.lengthLaps ? "laps" : "min",
      status: r.status || "scheduled", notes: r.notes || ""
    }, false);
  };

  A.openRaceModal = function (m, isNew) {
    editingId = m.id;
    el("raceModalTitle").textContent = isNew ? "Add race" : "Edit race";
    el("btnDeleteRace").hidden = isNew;
    el("repeatBlock").hidden = !isNew;
    el("f_repeat").checked = false;
    el("repeatOpts").hidden = true;

    el("f_league").innerHTML = S.data.leagues.map(l =>
      '<option value="' + U.esc(l.id) + '">' + U.esc(l.name) + '</option>').join("");
    el("f_league").value = m.leagueId;

    el("f_round").value = m.round || "";
    el("f_date").value = m.date;
    el("f_start").value = m.startTime;
    el("f_prac").value = m.practiceTime;
    el("f_qual").value = m.qualifyTime;
    el("f_warmup").checked = m.warmup;
    el("f_track").value = m.track;
    el("f_car").value = m.car;
    el("f_lenVal").value = m.lengthVal;
    el("f_lenUnit").value = m.lengthUnit;
    el("f_status").value = m.status;
    el("f_notes").value = m.notes;
    fillConfigs(m.track, m.trackConfig);

    combo("f_track", "trackList", allTracks(), t => t.n, t => t.t,
      t => fillConfigs(t.n, (t.c && t.c[0]) || ""));
    combo("f_car", "carList", allCars(), c => c.n, c => c.cl);
    el("f_track").onchange = () => fillConfigs(el("f_track").value, el("f_config").value);

    updateHints();
    ["f_date", "f_start", "f_league", "f_prac", "f_qual", "f_lenVal"].forEach(id => {
      el(id).addEventListener("input", updateHints);
      el(id).addEventListener("change", updateHints);
    });

    el("f_repeat").onchange = () => { el("repeatOpts").hidden = !el("f_repeat").checked; };
    el("btnUseDefaults").onclick = () => {
      const lg = S.league(el("f_league").value);
      if (!lg) return;
      const d = lg.defaults;
      if (!el("f_start").value) el("f_start").value = d.startTime;
      const start = el("f_start").value || d.startTime;
      el("f_prac").value = offsetTime(start, -(d.practiceOffsetMin || 0));
      el("f_qual").value = offsetTime(start, -(d.qualifyOffsetMin || 0));
      el("f_lenVal").value = d.raceLengthMin || 60;
      el("f_lenUnit").value = "min";
      el("f_warmup").checked = !!d.warmup;
      updateHints();
    };

    A.openModal("mRace");
    setTimeout(() => el("f_track").focus(), 80);
  };

  function offsetTime(hhmm, deltaMin) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    let t = h * 60 + m + deltaMin;
    t = ((t % 1440) + 1440) % 1440;
    return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  }

  function updateHints() {
    const tz = S.tz();
    const date = el("f_date").value, time = el("f_start").value;
    if (date && time) {
      const utc = U.zonedToUtc(date, time, tz);
      el("utcHint").textContent = "= " + utc.toISOString().slice(0, 16).replace("T", " ") + " UTC · " +
        U.fmtZoneAbbr(utc.toISOString(), tz) + " on this date";
    } else el("utcHint").textContent = "";

    const lg = S.league(el("f_league").value);
    if (lg && lg.season && lg.season.rounds) {
      el("roundHint").textContent = lg.season.name ? lg.season.name + ", " + lg.season.rounds + " rounds" : lg.season.rounds + " rounds";
    } else el("roundHint").textContent = "";

    /* live clash preview */
    const warn = el("clashWarn");
    if (date && time) {
      const probe = buildRaceObject(true);
      const cl = S.clashesFor(probe, editingId);
      if (cl.length) {
        warn.hidden = false;
        warn.innerHTML = "<b>Overlaps " + cl.length + " existing race" + (cl.length > 1 ? "s" : "") + ":</b><br>" +
          cl.map(c => {
            const l = S.league(c.leagueId) || {};
            return U.esc(l.name) + " · " + U.fmtDate(c.startUtc, tz, { weekday: "short", day: "numeric", month: "short" }) +
              " " + U.fmtTime(c.startUtc, tz);
          }).join("<br>") + "<br><span style='color:var(--ink-3)'>Saving is still allowed. The clash is flagged on the calendar.</span>";
      } else warn.hidden = true;
    }
  }

  function buildRaceObject(probe) {
    const tz = S.tz();
    const date = el("f_date").value;
    const time = el("f_start").value || "00:00";
    const startUtc = U.zonedToUtc(date, time, tz).toISOString().replace(/\.\d{3}Z$/, "Z");
    const pr = el("f_prac").value, qu = el("f_qual").value;
    const lenUnit = el("f_lenUnit").value;
    const lenVal = Number(el("f_lenVal").value) || null;

    /* A session time earlier in the clock than the race on the same
       calendar day is on that day. If it reads later (e.g. practice
       23:30 for a 00:30 race) it belongs to the previous day. */
    function sessionUtc(hhmm) {
      if (!hhmm) return null;
      let d = date;
      if (hhmm > time) d = U.addDays(date, -1);
      return U.zonedToUtc(d, hhmm, tz).toISOString().replace(/\.\d{3}Z$/, "Z");
    }

    return {
      id: editingId || U.uid("r"),
      leagueId: el("f_league").value,
      round: Number(el("f_round").value) || null,
      date: date,
      startUtc: startUtc,
      practiceUtc: sessionUtc(pr),
      qualifyUtc: sessionUtc(qu),
      warmup: el("f_warmup").checked,
      track: el("f_track").value.trim(),
      trackConfig: el("f_config").value,
      car: el("f_car").value.trim(),
      lengthMin: lenUnit === "min" ? lenVal : null,
      lengthLaps: lenUnit === "laps" ? lenVal : null,
      status: el("f_status").value,
      notes: el("f_notes").value.trim(),
      overrideAvailable: probe ? false : (S.race(editingId) || {}).overrideAvailable || false
    };
  }

  A.saveRace = function () {
    if (!el("f_date").value) { A.toast("Pick a date first", "err"); return; }
    const obj = buildRaceObject(false);

    if (editingId) {
      const i = S.data.races.findIndex(r => r.id === editingId);
      S.data.races[i] = obj;
    } else {
      S.data.races.push(obj);

      if (el("f_repeat").checked) {
        const total = Math.max(2, Number(el("f_repeatCount").value) || 2);
        const every = Number(el("f_repeatEvery").value) || 7;
        const tz = S.tz();
        for (let k = 1; k < total; k++) {
          const d = U.addDays(obj.date, k * every);
          const startUtc = U.zonedToUtc(d, el("f_start").value, tz).toISOString().replace(/\.\d{3}Z$/, "Z");
          const shift = (iso) => {
            if (!iso) return null;
            const delta = Date.parse(obj.startUtc) - Date.parse(iso);
            return new Date(Date.parse(startUtc) - delta).toISOString().replace(/\.\d{3}Z$/, "Z");
          };
          S.data.races.push(Object.assign({}, obj, {
            id: U.uid("r"),
            round: (obj.round || 1) + k,
            date: d,
            startUtc: startUtc,
            practiceUtc: shift(obj.practiceUtc),
            qualifyUtc: shift(obj.qualifyUtc),
            track: "", trackConfig: "", car: obj.car,
            notes: ""
          }));
        }
        A.toast("Added " + total + " rounds", "ok");
      }
    }

    /* remember anything typed that is not in the bundled list */
    const cc = S.data.customContent;
    if (obj.track && !allTracks().some(t => t.n === obj.track)) cc.tracks.push({ n: obj.track, c: obj.trackConfig ? [obj.trackConfig] : [], t: "custom" });
    if (obj.car && !allCars().some(c => c.n === obj.car)) cc.cars.push({ n: obj.car, cl: "custom" });

    S.touch();
    A.closeModal("mRace");
    V.render();
    if (!el("f_repeat").checked) A.toast(editingId ? "Race updated" : "Race added", "ok");
  };

  A.deleteRace = function () {
    if (!editingId) return;
    if (!confirm("Delete this race? This cannot be undone until you reload without publishing.")) return;
    S.data.races = S.data.races.filter(r => r.id !== editingId);
    S.touch();
    A.closeModal("mRace");
    V.render();
    A.toast("Race deleted");
  };

  /* =================== days off =================== */

  A.toggleOffDay = function (dayKey) {
    const existing = S.offDayFor(dayKey);
    if (existing) {
      S.data.offDays = S.data.offDays.filter(o => o.id !== existing.id);
      A.toast("Day off removed");
    } else {
      const reason = prompt("Why are you unavailable? (shown on the calendar)", "Unavailable");
      if (reason === null) return;
      S.data.offDays.push({
        id: U.uid("o"), start: dayKey, end: dayKey,
        reason: reason || "Unavailable", createdAt: new Date().toISOString()
      });
      A.toast("Day marked off");
    }
    S.touch();
    V.render();
  };

  /* =================== settings =================== */

  let curTab = "leagues";

  A.openSettings = function (tab) {
    curTab = tab || curTab;
    document.querySelectorAll("[data-tab]").forEach(b =>
      b.setAttribute("aria-selected", String(b.dataset.tab === curTab)));
    A.renderTab();
    A.openModal("mSettings");
  };

  A.renderTab = function () {
    const body = el("tabBody");
    const ro = !S.unlocked;
    body.innerHTML = ({
      leagues: tabLeagues, off: tabOff, email: tabEmail, site: tabSite, github: tabGithub, data: tabData
    }[curTab] || tabLeagues)(ro);
    ({ leagues: wireLeagues, off: wireOff, email: wireEmail, site: wireSite, github: wireGithub, data: wireData }[curTab] || wireLeagues)();
  };

  function lockedNote() {
    return S.unlocked ? "" :
      '<div class="note red">Editing is locked. Press <kbd>E</kbd> or use the button below to unlock with your passcode.' +
      '<div style="margin-top:9px"><button class="btn sm primary" id="btnAskUnlock">Unlock editing</button></div></div>';
  }

  /* ---------- leagues ---------- */
  function tabLeagues() {
    let h = lockedNote();
    h += '<div class="list-manage">';
    S.data.leagues.forEach(l => {
      const n = S.data.races.filter(r => r.leagueId === l.id).length;
      h += '<div class="manage-row">' +
        '<span class="sw" style="background:' + U.esc(l.color) + '"></span>' +
        '<div><div class="nm">' + U.esc(l.name) + ' <span style="color:var(--ink-4);font-family:var(--mono);font-size:11px">' + U.esc(l.short || "") + '</span></div>' +
        '<div class="mt">' + n + ' races · ' + U.DOW_LONG[l.defaults.dayOfWeek] + 's ' + U.esc(l.defaults.startTime) +
        (l.season && l.season.rounds ? ' · ' + l.season.rounds + ' rounds' : '') + '</div></div>' +
        '<div class="acts">' +
        (S.unlocked ? '<button class="btn sm" data-editlg="' + U.esc(l.id) + '">Edit</button>' +
          '<button class="btn sm danger" data-dellg="' + U.esc(l.id) + '">Delete</button>' : '') +
        '</div></div>';
    });
    h += '</div>';
    if (S.unlocked) h += '<div style="margin-top:14px"><button class="btn primary" id="btnAddLg">+ Add league</button></div>';
    h += '<div id="lgForm"></div>';
    return h;
  }

  function leagueForm(l) {
    const isNew = !l.id;
    return '<div style="margin-top:20px;padding-top:18px;border-top:1px solid var(--line)">' +
      '<h3 style="font-size:15px;margin-bottom:14px">' + (isNew ? "New league" : "Edit " + U.esc(l.name)) + '</h3>' +
      '<div class="grid-2">' +
        '<div class="field"><label>Name</label><input type="text" id="lg_name" value="' + U.esc(l.name || "") + '" placeholder="Coxy GT3 Series"></div>' +
        '<div class="field"><label>Short code</label><input type="text" id="lg_short" value="' + U.esc(l.short || "") + '" maxlength="6" placeholder="GT3"><div class="hint">Shown on the small calendar tiles.</div></div>' +
      '</div>' +
      '<div class="grid-3">' +
        '<div class="field"><label>Colour</label><input type="color" id="lg_color" value="' + U.esc(l.color || "#e8232f") + '"></div>' +
        '<div class="field"><label>Season name</label><input type="text" id="lg_season" value="' + U.esc((l.season && l.season.name) || "") + '" placeholder="2026 Season 4"></div>' +
        '<div class="field"><label>Rounds in season</label><input type="number" id="lg_rounds" min="0" max="60" value="' + ((l.season && l.season.rounds) || "") + '"></div>' +
      '</div>' +
      '<div class="lbl" style="margin-top:6px">Defaults used when adding a race</div>' +
      '<div class="grid-3">' +
        '<div class="field"><label>Race day</label><select id="lg_dow">' +
          U.DOW_LONG.map((d, i) => '<option value="' + i + '"' + (i === l.defaults.dayOfWeek ? " selected" : "") + '>' + d + '</option>').join("") +
        '</select></div>' +
        '<div class="field"><label>Start time (ET)</label><input type="time" id="lg_start" step="300" value="' + U.esc(l.defaults.startTime || "20:00") + '"></div>' +
        '<div class="field"><label>Race length (min)</label><input type="number" id="lg_len" min="1" value="' + (l.defaults.raceLengthMin || 60) + '"></div>' +
      '</div>' +
      '<div class="grid-3">' +
        '<div class="field"><label>Practice opens (min before)</label><input type="number" id="lg_prac" min="0" value="' + (l.defaults.practiceOffsetMin || 0) + '"></div>' +
        '<div class="field"><label>Qualifying (min before)</label><input type="number" id="lg_qual" min="0" value="' + (l.defaults.qualifyOffsetMin || 0) + '"></div>' +
        '<div class="field"><label>Season starts</label><input type="date" id="lg_startdate" value="' + U.esc((l.season && l.season.startDate) || "") + '"></div>' +
      '</div>' +
      '<label class="check"><input type="checkbox" id="lg_warmup"' + (l.defaults.warmup ? " checked" : "") + '><span>Warmup session by default</span></label>' +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<button class="btn primary" id="lg_save">' + (isNew ? "Create league" : "Save league") + '</button>' +
        '<button class="btn" id="lg_cancel">Cancel</button>' +
      '</div></div>';
  }

  function wireLeagues() {
    const u = el("btnAskUnlock"); if (u) u.onclick = () => A.askUnlock();
    document.querySelectorAll("[data-editlg]").forEach(b => b.onclick = () => showLeagueForm(S.league(b.dataset.editlg)));
    document.querySelectorAll("[data-dellg]").forEach(b => b.onclick = () => {
      const l = S.league(b.dataset.dellg);
      const n = S.data.races.filter(r => r.leagueId === l.id).length;
      if (!confirm('Delete "' + l.name + '" and its ' + n + ' races?')) return;
      S.data.leagues = S.data.leagues.filter(x => x.id !== l.id);
      S.data.races = S.data.races.filter(r => r.leagueId !== l.id);
      S.touch(); A.renderTab(); V.render();
    });
    const add = el("btnAddLg");
    if (add) add.onclick = () => showLeagueForm({ name: "", short: "", color: "#3b82f6", season: {}, defaults: { dayOfWeek: 2, startTime: "20:00", practiceOffsetMin: 30, qualifyOffsetMin: 15, raceLengthMin: 60 } });
  }

  function showLeagueForm(l) {
    el("lgForm").innerHTML = leagueForm(l);
    el("lg_cancel").onclick = () => { el("lgForm").innerHTML = ""; };
    el("lg_save").onclick = () => {
      const name = el("lg_name").value.trim();
      if (!name) { A.toast("Give the league a name", "err"); return; }
      const obj = {
        id: l.id || U.slug(name) + "-" + Math.random().toString(36).slice(2, 5),
        name: name,
        short: el("lg_short").value.trim() || name.slice(0, 3).toUpperCase(),
        color: el("lg_color").value,
        timezone: S.tz(),
        active: l.active !== false,
        priority: l.priority || (S.data.leagues.length + 1),
        season: {
          name: el("lg_season").value.trim(),
          rounds: Number(el("lg_rounds").value) || 0,
          startDate: el("lg_startdate").value || ""
        },
        defaults: {
          dayOfWeek: Number(el("lg_dow").value),
          startTime: el("lg_start").value || "20:00",
          practiceOffsetMin: Number(el("lg_prac").value) || 0,
          qualifyOffsetMin: Number(el("lg_qual").value) || 0,
          raceLengthMin: Number(el("lg_len").value) || 60,
          warmup: el("lg_warmup").checked
        },
        notes: l.notes || ""
      };
      if (l.id) S.data.leagues[S.data.leagues.findIndex(x => x.id === l.id)] = obj;
      else S.data.leagues.push(obj);
      S.touch(); A.renderTab(); V.render();
      A.toast(l.id ? "League saved" : "League created", "ok");
    };
  }

  /* ---------- days off ---------- */
  function tabOff() {
    let h = lockedNote();
    h += '<div class="note">Races inside a blocked period stay visible but are greyed out, flagged, and left out of the notification emails. ' +
      'You can still override a single race with <b>Race anyway</b> on its card.</div>';
    if (S.unlocked) {
      h += '<div class="grid-3">' +
        '<div class="field"><label>From</label><input type="date" id="off_start"></div>' +
        '<div class="field"><label>To</label><input type="date" id="off_end"><div class="hint">Leave blank for a single day.</div></div>' +
        '<div class="field"><label>Reason</label><input type="text" id="off_reason" placeholder="Holiday"></div>' +
        '</div><button class="btn primary" id="off_add" style="margin-bottom:18px">Add period</button>';
    }
    h += '<div class="list-manage">';
    if (!S.data.offDays.length) h += '<div class="note">Nothing blocked yet.</div>';
    U.sortBy(S.data.offDays, o => o.start).forEach(o => {
      const days = Math.round((Date.parse(o.end || o.start) - Date.parse(o.start)) / 86400000) + 1;
      h += '<div class="manage-row"><span class="sw" style="background:var(--warn)"></span>' +
        '<div><div class="nm">' + U.esc(o.reason || "Unavailable") + '</div>' +
        '<div class="mt">' + U.esc(o.start) + (o.end && o.end !== o.start ? " → " + U.esc(o.end) : "") + ' · ' + days + ' day' + (days > 1 ? 's' : '') + '</div></div>' +
        '<div class="acts">' + (S.unlocked ? '<button class="btn sm danger" data-deloff="' + U.esc(o.id) + '">Remove</button>' : '') + '</div></div>';
    });
    h += '</div>';
    return h;
  }

  function wireOff() {
    const u = el("btnAskUnlock"); if (u) u.onclick = () => A.askUnlock();
    const add = el("off_add");
    if (add) add.onclick = () => {
      const s = el("off_start").value;
      if (!s) { A.toast("Pick a start date", "err"); return; }
      const e = el("off_end").value || s;
      if (e < s) { A.toast("End date is before the start", "err"); return; }
      S.data.offDays.push({ id: U.uid("o"), start: s, end: e, reason: el("off_reason").value.trim() || "Unavailable", createdAt: new Date().toISOString() });
      S.touch(); A.renderTab(); V.render(); A.toast("Period added", "ok");
    };
    document.querySelectorAll("[data-deloff]").forEach(b => b.onclick = () => {
      S.data.offDays = S.data.offDays.filter(o => o.id !== b.dataset.deloff);
      S.touch(); A.renderTab(); V.render();
    });
  }

  /* ---------- email ---------- */
  function tabEmail() {
    const e = S.data.settings.email;
    let h = lockedNote();
    h += '<div class="note">Emails are sent by a GitHub Action, not by this page. It wakes every 30 minutes, ' +
      'works out the current Eastern time, and sends if a slot below is due. Nothing is sent on a day you have no races, ' +
      'and nothing is sent for a race inside a blocked period.</div>';

    h += '<label class="check"><input type="checkbox" id="em_on"' + (e.enabled ? " checked" : "") + '><span>Notification emails on</span></label>';

    h += '<div class="field"><label>Send to</label><input type="text" id="em_to" value="' + U.esc((e.to || []).join(", ")) + '" placeholder="you@example.com, someone@else.com">' +
      '<div class="hint">Comma separated. Everyone listed gets the same mail.</div></div>';

    h += '<div class="grid-2">' +
      '<div class="field"><label>From name</label><input type="text" id="em_fromname" value="' + U.esc(e.fromName || "") + '" placeholder="Race Schedule"></div>' +
      '<div class="field"><label>From address</label><input type="text" id="em_fromaddr" value="' + U.esc(e.fromAddress || "") + '">' +
      '<div class="hint">Start with <code>onboarding@resend.dev</code>. Once you verify a domain in Resend, change it to something like <code>schedule@coxgp.com</code>.</div></div></div>';

    h += '<div class="field"><label>Reply-to (optional)</label><input type="text" id="em_replyto" value="' + U.esc(e.replyTo || "") + '"></div>';

    h += '<div class="field"><label>Morning subject line</label><input type="text" id="em_subj" value="' + U.esc(e.subjectTemplate || "") + '">' +
      '<div class="hint">Placeholders: <code>{{count}}</code> number of races, <code>{{s}}</code> plural s, <code>{{summary}}</code> ' +
      'short "GT3 at Spa 20:00" style line, <code>{{leagues}}</code> league names, <code>{{date}}</code>, <code>{{first}}</code> first race time.</div></div>';

    h += '<div class="field"><label>Evening subject line</label><input type="text" id="em_subj2" value="' + U.esc(e.subjectTemplateEvening || "") + '"></div>';

    h += '<div class="lbl" style="margin-top:18px">Send times (Eastern)</div>';
    (e.sends || []).forEach((s, i) => {
      h += '<div class="manage-row" style="align-items:flex-start;flex-wrap:wrap">' +
        '<label class="check" style="margin:0"><input type="checkbox" data-sendon="' + i + '"' + (s.enabled ? " checked" : "") + '><span></span></label>' +
        '<div style="flex:1;min-width:190px"><div class="nm">' + U.esc(s.label) + '</div>' +
        '<div class="mt">' + (s.scope === "today" ? "Every race today" : s.scope === "remaining" ? "Races still to come today" : "Tomorrow's races") + '</div></div>' +
        '<input type="time" data-sendtime="' + i + '" value="' + String(s.hour).padStart(2, "0") + ':' + String(s.minute || 0).padStart(2, "0") + '" step="300" style="width:118px">' +
        '<select data-sendscope="' + i + '" style="width:180px">' +
          '<option value="today"' + (s.scope === "today" ? " selected" : "") + '>Every race today</option>' +
          '<option value="remaining"' + (s.scope === "remaining" ? " selected" : "") + '>Still to come today</option>' +
          '<option value="tomorrow"' + (s.scope === "tomorrow" ? " selected" : "") + '>Tomorrow\'s races</option>' +
        '</select>' +
        '</div>';
    });

    h += '<label class="check" style="margin-top:14px"><input type="checkbox" id="em_prac"' + (e.includePracticeTimes ? " checked" : "") + '>' +
      '<span>Include practice and qualifying times<span class="sub">Tells you when to be at the desk, not just the green flag.</span></span></label>';
    h += '<label class="check"><input type="checkbox" id="em_link"' + (e.includeSiteLink ? " checked" : "") + '>' +
      '<span>Include a link back to the schedule</span></label>';

    h += '<div class="field" style="margin-top:12px"><label>Site URL (for the button in the email)</label>' +
      '<input type="url" id="em_site" value="' + U.esc(e.siteUrl || "") + '" placeholder="https://yourname.github.io/iracing-schedule/"></div>';

    h += '<div class="note warn"><b>One thing to do outside this page:</b> add your Resend API key as a repository secret called ' +
      '<code>RESEND_API_KEY</code> under Settings → Secrets and variables → Actions. The key must never go in this file, ' +
      'because this file is public.</div>';

    if (S.unlocked) h += '<button class="btn primary" id="em_save">Save email settings</button>';
    return h;
  }

  function wireEmail() {
    const u = el("btnAskUnlock"); if (u) u.onclick = () => A.askUnlock();
    const b = el("em_save");
    if (!b) return;
    b.onclick = () => {
      const e = S.data.settings.email;
      e.enabled = el("em_on").checked;
      e.to = el("em_to").value.split(",").map(x => x.trim()).filter(Boolean);
      e.fromName = el("em_fromname").value.trim();
      e.fromAddress = el("em_fromaddr").value.trim();
      e.replyTo = el("em_replyto").value.trim();
      e.subjectTemplate = el("em_subj").value;
      e.subjectTemplateEvening = el("em_subj2").value;
      e.includePracticeTimes = el("em_prac").checked;
      e.includeSiteLink = el("em_link").checked;
      e.siteUrl = el("em_site").value.trim();
      (e.sends || []).forEach((s, i) => {
        s.enabled = document.querySelector('[data-sendon="' + i + '"]').checked;
        const t = document.querySelector('[data-sendtime="' + i + '"]').value.split(":");
        s.hour = Number(t[0]); s.minute = Number(t[1]);
        s.scope = document.querySelector('[data-sendscope="' + i + '"]').value;
      });
      S.touch(); A.toast("Email settings saved. Publish to make them live.", "ok"); A.renderTab();
    };
  }

  /* ---------- site ---------- */
  function tabSite() {
    const s = S.data.settings;
    let h = lockedNote();
    h += '<div class="grid-2">' +
      '<div class="field"><label>Site title</label><input type="text" id="st_title" value="' + U.esc(s.siteTitle || "") + '"></div>' +
      '<div class="field"><label>Subtitle</label><input type="text" id="st_sub" value="' + U.esc(s.siteSubtitle || "") + '"></div></div>';
    h += '<div class="grid-2">' +
      '<div class="field"><label>Display timezone</label><select id="st_tz">' +
      ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "UTC", "Australia/Sydney"]
        .map(t => '<option value="' + t + '"' + (t === s.timezone ? " selected" : "") + '>' + t + '</option>').join("") +
      '</select><div class="hint">Every time is stored in UTC, so changing this only changes what you read, never the data.</div></div>' +
      '<div class="field"><label>Opens on</label><select id="st_view">' +
      [["month", "Month calendar"], ["week", "Week"], ["list", "List"], ["season", "Seasons"]]
        .map(v => '<option value="' + v[0] + '"' + (v[0] === s.defaultView ? " selected" : "") + '>' + v[1] + '</option>').join("") +
      '</select></div></div>';
    h += '<label class="check"><input type="checkbox" id="st_utc"' + (s.showUtc ? " checked" : "") + '><span>Show the UTC time on race cards</span></label>';
    h += '<label class="check"><input type="checkbox" id="st_clash"' + (s.clashDetection !== false ? " checked" : "") + '>' +
      '<span>Detect overlapping races<span class="sub">Compares the whole window from practice to chequered flag.</span></span></label>';

    h += '<div style="margin-top:20px;padding-top:18px;border-top:1px solid var(--line)">' +
      '<div class="lbl">Admin passcode</div>' +
      '<div class="field"><input type="password" id="st_pass" placeholder="' + (s.adminPasscodeHash ? "Set. Type a new one to change it." : "Not set. Anyone can unlock editing.") + '">' +
      '<div class="hint warn">This is a gate against casual visitors on a public page, not real security: the hash sits in the public data file. ' +
      'What actually protects your repo is the GitHub token, which is only in this browser.</div></div>' +
      (S.unlocked ? '<button class="btn" id="st_setpass">Set passcode</button> ' +
        (s.adminPasscodeHash ? '<button class="btn danger" id="st_clearpass">Remove passcode</button>' : '') : '') +
      '</div>';

    if (S.unlocked) h += '<div style="margin-top:18px"><button class="btn primary" id="st_save">Save site settings</button></div>';
    return h;
  }

  function wireSite() {
    const u = el("btnAskUnlock"); if (u) u.onclick = () => A.askUnlock();
    const sv = el("st_save");
    if (sv) sv.onclick = () => {
      const s = S.data.settings;
      s.siteTitle = el("st_title").value.trim() || "Race Schedule";
      s.siteSubtitle = el("st_sub").value.trim();
      s.timezone = el("st_tz").value;
      s.defaultView = el("st_view").value;
      s.showUtc = el("st_utc").checked;
      s.clashDetection = el("st_clash").checked;
      S.touch(); App.applyBranding(); V.render(); A.toast("Saved", "ok");
    };
    const sp = el("st_setpass");
    if (sp) sp.onclick = async () => {
      const v = el("st_pass").value;
      if (!v || v.length < 4) { A.toast("Use at least 4 characters", "err"); return; }
      await S.setPasscode(v);
      A.toast("Passcode set. Publish to make it live on other devices.", "ok");
      A.renderTab();
    };
    const cp = el("st_clearpass");
    if (cp) cp.onclick = async () => {
      if (!confirm("Remove the passcode? Anyone visiting will be able to open the editor.")) return;
      await S.setPasscode("");
      A.renderTab();
    };
  }

  /* ---------- github ---------- */
  function tabGithub() {
    const g = S.data.settings.github;
    const hasToken = !!S.token();
    let h = lockedNote();
    h += '<div class="note"><b>How saving works.</b> This page writes <code>' + U.esc(g.dataPath) + '</code> straight back to your repo ' +
      'using a fine-grained personal access token. The token is kept in this browser only (localStorage), never in the data file, ' +
      'and never sent anywhere except github.com.</div>';

    h += '<div class="grid-2">' +
      '<div class="field"><label>GitHub username</label><input type="text" id="gh_owner" value="' + U.esc(g.owner || "") + '" placeholder="your-username"></div>' +
      '<div class="field"><label>Repository</label><input type="text" id="gh_repo" value="' + U.esc(g.repo || "") + '" placeholder="iracing-schedule"></div></div>';
    h += '<div class="grid-2">' +
      '<div class="field"><label>Branch</label><input type="text" id="gh_branch" value="' + U.esc(g.branch || "main") + '"></div>' +
      '<div class="field"><label>Data file path</label><input type="text" id="gh_path" value="' + U.esc(g.dataPath || "data/schedule.json") + '"></div></div>';

    h += '<div class="field"><label>Personal access token</label>' +
      '<input type="password" id="gh_token" placeholder="' + (hasToken ? "Saved in this browser. Type a new one to replace it." : "github_pat_...") + '">' +
      '<div class="hint">Create at <b>github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens</b>. ' +
      'Give it access to this one repository, and a single permission: <b>Contents: Read and write</b>. Nothing else.</div></div>';

    if (S.unlocked) {
      h += '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="gh_save">Save connection</button>' +
        '<button class="btn" id="gh_test">Test connection</button>' +
        (hasToken ? '<button class="btn danger" id="gh_forget">Forget token on this device</button>' : '') + '</div>';
    }
    h += '<div id="gh_result" style="margin-top:14px"></div>';
    return h;
  }

  function wireGithub() {
    const u = el("btnAskUnlock"); if (u) u.onclick = () => A.askUnlock();
    const sv = el("gh_save");
    if (sv) sv.onclick = () => {
      const g = S.data.settings.github;
      g.owner = el("gh_owner").value.trim();
      g.repo = el("gh_repo").value.trim();
      g.branch = el("gh_branch").value.trim() || "main";
      g.dataPath = el("gh_path").value.trim() || "data/schedule.json";
      const t = el("gh_token").value.trim();
      if (t) { S.setToken(t); el("gh_token").value = ""; }
      S.touch(); App.applyBranding(); A.renderTab(); A.toast("Connection saved", "ok");
    };
    const tb = el("gh_test");
    if (tb) tb.onclick = async () => {
      const g = S.data.settings.github;
      g.owner = el("gh_owner").value.trim(); g.repo = el("gh_repo").value.trim();
      const t = el("gh_token").value.trim(); if (t) S.setToken(t);
      el("gh_result").innerHTML = '<div class="note">Checking…</div>';
      try {
        const j = await S.testToken();
        el("gh_result").innerHTML = '<div class="note" style="border-left-color:var(--go)"><b>Connected.</b> ' +
          U.esc(j.full_name) + ' · ' + (j.private ? "private" : "public") + ' · default branch <code>' + U.esc(j.default_branch) + '</code>' +
          (j.permissions && j.permissions.push ? '<br>Write access confirmed.' : '<br><span style="color:var(--warn)">This token may be read-only. Publishing will fail.</span>') +
          '</div>';
      } catch (err) {
        el("gh_result").innerHTML = '<div class="note red"><b>Failed.</b> ' + U.esc(err.message) +
          '<br><span style="color:var(--ink-3)">Check the username and repo spelling, that the token has not expired, and that it grants Contents: Read and write on this repository.</span></div>';
      }
    };
    const fg = el("gh_forget");
    if (fg) fg.onclick = () => { S.setToken(""); A.renderTab(); A.toast("Token removed from this device"); };
  }

  /* ---------- import / export ---------- */
  function tabData() {
    let h = lockedNote();
    h += '<div class="lbl">Export</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px">' +
      '<button class="btn" id="dl_json">Download schedule.json</button>' +
      '<button class="btn" id="dl_ics">Download .ics calendar</button>' +
      '<button class="btn" id="dl_csv">Download CSV</button></div>';

    if (S.unlocked) {
      h += '<div class="lbl">Paste a season</div>' +
        '<div class="note">One race per line. Columns separated by tabs or commas, in this order:<br>' +
        '<code>round, date (YYYY-MM-DD), time (HH:MM Eastern), track, config, car</code><br>' +
        'Anything after that is treated as notes. A header row is ignored.</div>' +
        '<div class="field"><label>League to import into</label><select id="imp_league">' +
        S.data.leagues.map(l => '<option value="' + U.esc(l.id) + '">' + U.esc(l.name) + '</option>').join("") + '</select></div>' +
        '<div class="field"><textarea id="imp_text" style="min-height:150px;font-family:var(--mono);font-size:12.5px" placeholder="1&#9;2026-09-15&#9;20:00&#9;Circuit de Spa-Francorchamps&#9;Grand Prix&#9;Ferrari 296 GT3"></textarea></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="imp_go">Import rows</button>' +
        '<button class="btn" id="imp_replace">Replace this league\'s races</button></div>' +
        '<div id="imp_result" style="margin-top:14px"></div>' +

        '<div style="margin-top:26px;padding-top:20px;border-top:1px solid var(--line)">' +
        '<div class="lbl">Restore from a file</div>' +
        '<div class="field"><input type="file" id="imp_file" accept="application/json"></div>' +
        '<div class="hint">Replaces everything on this screen with the file\'s contents. Nothing reaches GitHub until you publish.</div></div>';
    }
    return h;
  }

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function wireData() {
    const u = el("btnAskUnlock"); if (u) u.onclick = () => A.askUnlock();
    el("dl_json").onclick = () => download("schedule.json", JSON.stringify(S.data, null, 2), "application/json");
    el("dl_ics").onclick = () => V.downloadIcs(null);
    el("dl_csv").onclick = () => {
      const rows = [["league", "round", "date", "time_et", "track", "config", "car", "length", "status", "notes"]];
      U.sortBy(S.data.races, r => r.startUtc).forEach(r => {
        const lg = S.league(r.leagueId) || {};
        rows.push([lg.name || "", r.round || "", S.raceDay(r), U.fmtTime(r.startUtc, S.tz()),
          r.track || "", r.trackConfig || "", r.car || "",
          r.lengthLaps ? r.lengthLaps + " laps" : (r.lengthMin || "") + " min", r.status || "", (r.notes || "").replace(/\n/g, " ")]);
      });
      download("schedule.csv", rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n"), "text/csv");
    };

    const go = el("imp_go");
    if (!go) return;

    function parseRows() {
      const lines = el("imp_text").value.split("\n").map(l => l.trim()).filter(Boolean);
      const lgId = el("imp_league").value;
      const lg = S.league(lgId);
      const tz = S.tz();
      const out = [], bad = [];
      lines.forEach((line, n) => {
        const cols = line.indexOf("\t") !== -1 ? line.split("\t") : line.split(",");
        const c = cols.map(x => x.trim().replace(/^"|"$/g, ""));
        if (n === 0 && /round|date/i.test(c[0] + c[1])) return;          /* header */
        const round = Number(c[0]);
        const date = c[1];
        const time = c[2] || lg.defaults.startTime;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { bad.push("Line " + (n + 1) + ": date must be YYYY-MM-DD"); return; }
        if (!/^\d{1,2}:\d{2}$/.test(time)) { bad.push("Line " + (n + 1) + ": time must be HH:MM"); return; }
        const startUtc = U.zonedToUtc(date, time.length === 4 ? "0" + time : time, tz).toISOString().replace(/\.\d{3}Z$/, "Z");
        const off = (m) => m ? new Date(Date.parse(startUtc) - m * 60000).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
        out.push({
          id: U.uid("r"), leagueId: lgId, round: round || null, date: date, startUtc: startUtc,
          practiceUtc: off(lg.defaults.practiceOffsetMin), qualifyUtc: off(lg.defaults.qualifyOffsetMin),
          warmup: !!lg.defaults.warmup,
          track: c[3] || "", trackConfig: c[4] || "", car: c[5] || "",
          lengthMin: lg.defaults.raceLengthMin || 60, lengthLaps: null,
          status: "scheduled", notes: c.slice(6).join(" ").trim()
        });
      });
      return { out: out, bad: bad };
    }

    function report(res, replaced) {
      el("imp_result").innerHTML =
        (res.out.length ? '<div class="note" style="border-left-color:var(--go)"><b>Imported ' + res.out.length + ' race' +
          (res.out.length > 1 ? "s" : "") + '.</b>' + (replaced ? " Previous races for this league were removed." : "") + '</div>' : '') +
        (res.bad.length ? '<div class="note red"><b>Skipped ' + res.bad.length + ' line' + (res.bad.length > 1 ? "s" : "") + ':</b><br>' +
          res.bad.map(U.esc).join("<br>") + '</div>' : '');
    }

    go.onclick = () => {
      const res = parseRows();
      S.data.races = S.data.races.concat(res.out);
      S.touch(); V.render(); report(res, false);
    };
    el("imp_replace").onclick = () => {
      const lgId = el("imp_league").value;
      const res = parseRows();
      if (!res.out.length) { report(res, false); return; }
      if (!confirm("Remove every existing race in this league and replace with " + res.out.length + " imported rows?")) return;
      S.data.races = S.data.races.filter(r => r.leagueId !== lgId).concat(res.out);
      S.touch(); V.render(); report(res, true);
    };

    el("imp_file").onchange = (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const j = JSON.parse(fr.result);
          if (!j.races || !j.leagues) throw new Error("That does not look like a schedule file.");
          if (!confirm("Replace everything on screen with this file?")) return;
          S.data = j; S.migrate(); S.touch(); App.applyBranding(); V.render(); A.renderTab();
          A.toast("Loaded. Publish when you are happy with it.", "ok");
        } catch (e) { A.toast(e.message, "err"); }
      };
      fr.readAsText(f);
    };
  }

  /* =================== unlock =================== */

  A.askUnlock = function () {
    el("f_pass").value = "";
    el("unlockErr").hidden = true;
    el("passHint").textContent = S.data.settings.adminPasscodeHash
      ? "Set in Settings > Site."
      : "No passcode is set yet, so any value unlocks. Set one in Settings > Site once you are in.";
    A.openModal("mUnlock");
    setTimeout(() => el("f_pass").focus(), 80);
  };

  A.tryUnlock = async function () {
    const ok = await S.checkPasscode(el("f_pass").value);
    if (!ok) {
      el("unlockErr").hidden = false;
      el("unlockErr").textContent = "That passcode does not match.";
      return;
    }
    S.unlock();
    A.closeModal("mUnlock");
    A.toast("Editing unlocked", "ok");
    V.render();
    if (el("mSettings").classList.contains("on")) A.renderTab();
  };

  window.Admin = A;
})();
