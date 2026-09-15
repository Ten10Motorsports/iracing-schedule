/* ------------------------------------------------------------------
   app.js
   Boot, wiring, and the bits that belong to the page as a whole.
------------------------------------------------------------------- */

(function () {
  const App = {};
  const el = (id) => document.getElementById(id);

  App.applyBranding = function () {
    const s = S.data.settings;
    el("siteTitle").textContent = s.siteTitle || "Race Schedule";
    el("siteSubtitle").textContent = s.siteSubtitle || "";
    document.title = s.siteTitle || "Race Schedule";
    el("brandMark").textContent = (s.siteTitle || "R").trim()[0].toUpperCase();
    const g = s.github || {};
    el("adminRepo").textContent = g.owner && g.repo ? g.owner + "/" + g.repo : "no repo configured";
  };

  App.refreshAdminChrome = function () {
    el("adminBar").hidden = !S.unlocked;
    el("fabAdd").hidden = !S.unlocked;
    el("dirtyFlag").hidden = !S.dirty;
  };

  App.publish = async function () {
    if (!S.unlocked) { Admin.askUnlock(); return; }
    const btns = [el("btnPublish"), el("btnPublish2")].filter(Boolean);
    btns.forEach(b => { b.disabled = true; b.dataset.old = b.textContent; b.textContent = "Publishing…"; });
    try {
      await S.publish();
      Admin.toast("Published. GitHub Pages usually refreshes within a minute.", "ok");
    } catch (e) {
      Admin.toast(e.message, "err");
      if (/token|credential|Bad credentials|401|403/i.test(e.message)) {
        Admin.openSettings("github");
      }
    } finally {
      btns.forEach(b => { b.disabled = false; b.textContent = b.dataset.old || "Publish to GitHub"; });
      App.refreshAdminChrome();
    }
  };

  /* ---------------- boot ---------------- */

  async function boot() {
    try {
      await S.load();
    } catch (e) {
      document.getElementById("view").innerHTML =
        '<div class="empty"><h3>Could not load the schedule</h3><p>' + U.esc(e.message) + '</p></div>';
      return;
    }
    S.loadedAt = S.data.updatedAt;
    if (S.wasUnlocked()) S.unlocked = true;

    App.applyBranding();
    App.refreshAdminChrome();
    V.render();

    S.on(() => { App.refreshAdminChrome(); });

    /* view switcher */
    document.querySelectorAll("[data-view]").forEach(b => {
      b.onclick = () => { S.setView(b.dataset.view); V.render(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    });

    /* drawer */
    el("drawerClose").onclick = V.closeDrawer;
    el("scrim").onclick = V.closeDrawer;

    /* modal close buttons */
    document.querySelectorAll("[data-close]").forEach(b => {
      b.onclick = () => Admin.closeModal(b.dataset.close);
    });
    document.querySelectorAll(".modal").forEach(m => {
      m.addEventListener("mousedown", (e) => { if (e.target === m) Admin.closeModal(m.id); });
    });

    /* settings tabs */
    document.querySelectorAll("[data-tab]").forEach(b => {
      b.onclick = () => Admin.openSettings(b.dataset.tab);
    });
    el("btnSettings").onclick = () => Admin.openSettings();

    /* race editor */
    el("btnSaveRace").onclick = () => Admin.saveRace();
    el("btnDeleteRace").onclick = () => Admin.deleteRace();
    el("fabAdd").onclick = () => Admin.newRace({});

    /* admin bar */
    el("btnPublish").onclick = App.publish;
    el("btnPublish2").onclick = App.publish;
    el("btnLockAdmin").onclick = () => {
      if (S.dirty && !confirm("You have unpublished changes. Lock anyway? They stay saved in this browser.")) return;
      S.lock(); V.render(); App.refreshAdminChrome(); Admin.toast("Locked");
    };

    /* unlock */
    el("btnUnlock").onclick = () => Admin.tryUnlock();
    el("f_pass").addEventListener("keydown", (e) => { if (e.key === "Enter") Admin.tryUnlock(); });

    /* keyboard */
    document.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === "Escape") {
        V.closeDrawer();
        document.querySelectorAll(".modal.on").forEach(m => Admin.closeModal(m.id));
        return;
      }
      if (typing) return;
      if (e.key === "e" || e.key === "E") { if (!S.unlocked) Admin.askUnlock(); }
      if (e.key === "n" || e.key === "N") { if (S.unlocked) Admin.newRace({}); }
      if (e.key === "m") { S.setView("month"); V.render(); }
      if (e.key === "w") { S.setView("week"); V.render(); }
      if (e.key === "l") { S.setView("list"); V.render(); }
      if (e.key === "s") { S.setView("season"); V.render(); }
      if (e.key === "ArrowLeft") { const b = el("mPrev") || el("wPrev"); if (b) b.click(); }
      if (e.key === "ArrowRight") { const b = el("mNext") || el("wNext"); if (b) b.click(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); App.publish(); }
    });

    /* warn before losing unpublished work */
    window.addEventListener("beforeunload", (e) => {
      if (S.dirty) { e.preventDefault(); e.returnValue = ""; }
    });

    /* the month view lays out differently on a phone, so redraw when
       the viewport crosses that line (rotation, or a resized window) */
    const mq = window.matchMedia("(max-width: 720px)");
    const onMq = () => V.render();
    if (mq.addEventListener) mq.addEventListener("change", onMq);
    else if (mq.addListener) mq.addListener(onMq);

    /* keep countdowns honest without redrawing the whole calendar */
    setInterval(() => { V.renderNextUp(); }, 30000);

    /* if the day rolls over while the tab is open, redraw */
    let lastDay = U.todayKey(S.tz());
    setInterval(() => {
      const now = U.todayKey(S.tz());
      if (now !== lastDay) { lastDay = now; V.render(); }
    }, 60000);

    /* deep link: ?race=<id> or #2026-09-15 */
    const params = new URLSearchParams(location.search);
    if (params.get("race")) V.openDrawer(params.get("race"));
    if (/^#\d{4}-\d{2}-\d{2}$/.test(location.hash)) {
      const d = location.hash.slice(1);
      V.cursorMonth = U.monthKey(d);
      V.render();
      V.openDay(d);
    }
  }

  window.App = App;
  document.addEventListener("DOMContentLoaded", boot);
})();
