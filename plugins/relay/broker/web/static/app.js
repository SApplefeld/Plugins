// The web surface's pages: one script for all four. Each page names itself in `<body data-page>`,
// fetches its view from the broker every five seconds and draws it again. The page holds no state the
// broker does not, apart from which session list is expanded.
//
// Render rule: every string in a view was written by a session or a person and is hostile to the
// page. View text goes in through `textContent` or `append` of a string, never as markup, and a link
// is fixed route text plus `encodeURIComponent` of a view value. Nothing here builds HTML.
"use strict";

(function () {
  const POLL_MS = 5000;
  const TIMEOUT_MS = 8000;
  /** How many polls a text selection on the page may hold it still, so it can be copied. */
  const HOLD_POLLS = 6;

  const PAGES = {
    standup: { render: renderStandup, url: () => "/web/standup" },
    repo: { render: renderRepo, url: repoUrl },
    plan: { render: renderPlan, url: planUrl },
    health: { render: renderHealth, url: () => "/web/health" },
  };

  // ---------------------------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------------------------

  /** An element with fixed classes and, when given, text set as text. */
  function h(tag, cls, text) {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  /** A link to a fixed route; the caller builds `href` from route text and encoded values only. */
  function link(cls, href, text) {
    const anchor = h("a", cls, text);
    anchor.href = href;
    return anchor;
  }

  function repoHref(name) {
    return "/repo/" + encodeURIComponent(name);
  }

  function planHref(root, path) {
    return "/plan?root=" + encodeURIComponent(root) + "&path=" + encodeURIComponent(path);
  }

  function txt(value) {
    return typeof value === "string" ? value : "";
  }

  function num(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function parse(iso) {
    if (typeof iso !== "string") return null;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
  }

  const pad = (n) => String(n).padStart(2, "0");

  function clock(ms) {
    const d = new Date(ms);
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  /** The time of day, with the weekday when it is not the day of `nowMs`. */
  function dayClock(ms, nowMs) {
    const d = new Date(ms);
    if (d.toDateString() === new Date(nowMs).toDateString()) return clock(ms);
    return d.toLocaleDateString(undefined, { weekday: "short" }) + " " + clock(ms);
  }

  /** A duration in the short form the mockups use: 40s, 40m, 3h, 2d. */
  function span(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return seconds + "s";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h";
    return Math.floor(hours / 24) + "d";
  }

  /** A time left to a reset: 22m, 1h 40m, 3d 7h. */
  function until(ms) {
    if (ms <= 0) return "due";
    const minutes = Math.floor(ms / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    if (days > 0) return days + "d " + hours + "h";
    if (hours > 0) return hours + "h " + (minutes % 60) + "m";
    return Math.max(1, minutes) + "m";
  }

  /** The broker's clock for this reading: the registry is read at the request, so it is "now". */
  function nowOf(view) {
    const asOf = view && view.asOf ? view.asOf : {};
    const at = parse(asOf.registry);
    return at === null ? Date.now() : at;
  }

  /** "as of <time>" from the oldest source, and "held <age>" for each source that could not refresh. */
  function stamp(view) {
    const box = h("div", "stamp");
    const asOf = view && view.asOf ? view.asOf : {};
    const times = Object.keys(asOf)
      .map((name) => parse(asOf[name]))
      .filter((at) => at !== null);
    const now = nowOf(view);
    box.append(h("span", null, times.length > 0 ? "as of " + dayClock(Math.min.apply(null, times), now) : "no reading yet"));
    for (const name of list(view.held)) {
      const at = parse(asOf[name]);
      box.append(" ", h("span", "held", at === null ? txt(name) + ": no reading yet" : txt(name) + " held " + span(now - at)));
    }
    return box;
  }

  /** The line of per-source read times that ends a page. */
  function sources(view, names) {
    const asOf = view && view.asOf ? view.asOf : {};
    const parts = names.map((name) => {
      const at = parse(asOf[name]);
      return name + (at === null ? " no reading yet" : " read " + clock(at));
    });
    return h("div", "note", parts.join(" · "));
  }

  function back(href, label) {
    return link("back", href, "‹ " + label);
  }

  function label(text, tag) {
    return h(tag || "h2", "label", text);
  }

  function dot(kind) {
    const mark = h("span", "dot" + (kind ? " " + kind : ""));
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }

  function chevron() {
    const mark = h("span", "chev", "›");
    mark.setAttribute("aria-hidden", "true");
    return mark;
  }

  /** A bar `pct` percent full. The width is set through the style object, which a content policy allows. */
  function bar(pct, hot) {
    const track = h("span", "bar");
    track.setAttribute("aria-hidden", "true");
    const fill = h("span", hot ? "hot" : "");
    fill.style.setProperty("width", Math.min(100, Math.max(0, pct)) + "%");
    track.append(fill);
    return track;
  }

  // ---------------------------------------------------------------------------------------------
  // Sandbox page
  // ---------------------------------------------------------------------------------------------

  const RANK = { asking: 0, blocked: 1, stalled: 2, working: 3, idle: 4, dormant: 5 };
  const CARD_STATES = ["asking", "blocked", "stalled"];

  function rankOf(state) {
    return Object.prototype.hasOwnProperty.call(RANK, state) ? RANK[state] : RANK.idle;
  }

  function compareRepos(a, b) {
    const byState = rankOf(a.state) - rankOf(b.state);
    if (byState !== 0) return byState;
    const left = parse(a.oldestOpenAt);
    const right = parse(b.oldestOpenAt);
    if (left !== right) {
      if (left === null) return 1;
      if (right === null) return -1;
      return left - right;
    }
    const x = txt(a.name);
    const y = txt(b.name);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  function needRow(item, now) {
    const row = item.repo ? link("need-row", repoHref(item.repo)) : h("div", "need-row");
    row.append(h("span", "who", item.repo ? item.repo : "Hands"));
    const middle = h("span");
    if (item.kind === "blocked") middle.append(h("span", "tag", "blocked"));
    else if (item.kind === "ask" && item.blocking) middle.append(h("span", "tag", "blocking"));
    middle.append(txt(item.text));
    if (item.recommend) middle.append(h("span", "rec", "Recommends: " + item.recommend));
    row.append(middle);
    const opened = parse(item.openedAt);
    row.append(h("span", "age", opened === null ? "" : span(now - opened)));
    return row;
  }

  function workerWords(worker, now) {
    const state = worker && worker.surfaceState ? worker.surfaceState : "no session";
    const turn = worker ? parse(worker.lastTurnAt) : null;
    return "worker " + state + (turn === null ? "" : ", last turn " + span(now - turn) + " ago");
  }

  function leaseWords(worker) {
    return worker && worker.leaseOpen ? "lease open" : "lease closed";
  }

  function repoCard(repo, needs, now) {
    const card = link("card repo-card attn", repoHref(repo.name));
    const head = h("div", "repo-head");
    const name = h("div", "repo-name");
    name.append(txt(repo.name), chevron());
    head.append(name);
    const opened = parse(repo.oldestOpenAt);
    const word = repo.state === "asking" ? "asking" : repo.state === "blocked" ? "blocked" : "stalled";
    head.append(
      h("span", repo.state === "stalled" ? "badge red" : "badge", word + (opened === null ? "" : " · " + span(now - opened))),
    );
    card.append(head);
    const item = needs.find((candidate) => candidate.repo === repo.name && candidate.kind !== "hands");
    if (item) {
      const line = h("div", null, txt(item.text));
      if (item.recommend) line.append(h("span", "rec", "Recommends: " + item.recommend));
      card.append(line);
    }
    const meta = h("div", "meta");
    meta.append("queue " + (num(repo.queueDepth) ?? 0) + " · " + workerWords(repo.worker, now) + " · " + leaseWords(repo.worker));
    if (num(repo.unseen) > 0) {
      meta.append(" · ");
      meta.append(h("span", "alert", repo.unseen + " unseen"));
    }
    card.append(meta);
    return card;
  }

  function repoRow(repo, now) {
    const row = link("row", repoHref(repo.name));
    const name = h("div", "name");
    name.append(dot(repo.state === "working" ? "blue" : "hollow"), txt(repo.name));
    row.append(name);
    const turn = parse(repo.worker ? repo.worker.lastTurnAt : null);
    const meta = h("div", "meta", "queue " + (num(repo.queueDepth) ?? 0) + (turn === null ? "" : " · last turn " + span(now - turn) + " ago"));
    if (num(repo.unseen) > 0) meta.append(" · ", h("span", "alert", repo.unseen + " unseen"));
    row.append(meta);
    return row;
  }

  function renderStandup(view) {
    const out = document.createDocumentFragment();
    const now = nowOf(view);
    const repos = list(view.repos).slice().sort(compareRepos);
    const needs = list(view.needsYou);
    const health = view.health || {};

    const top = h("div", "top");
    const row = h("div", "top-row");
    row.append(h("h1", null, txt(view.sandbox)), stamp(view));
    top.append(row, h("p", "sub", "Unseen changes, per repo"));
    const nav = h("nav", "toplinks");
    nav.setAttribute("aria-label", "Shortcuts");
    nav.append(
      link("alert", "#needs", "Needs me · " + needs.length),
      link("", "/health", num(health.expected) === null ? "All sessions" : "All " + health.expected + " sessions"),
    );
    top.append(nav);
    out.append(top);

    const band = h("section", "card attn");
    band.id = "needs";
    band.setAttribute("aria-labelledby", "needs-heading");
    const head = h("div", "band-head");
    const heading = label("Needs you · " + needs.length);
    heading.id = "needs-heading";
    head.append(dot("amber"), heading);
    band.append(head);
    if (needs.length === 0) band.append(h("div", "empty", "Nothing needs you right now."));
    else {
      const rows = h("div", "need-list");
      for (const item of needs) rows.append(needRow(item, now));
      band.append(rows);
    }
    out.append(band);

    const counts = h("div", "rollup");
    for (const state of ["asking", "blocked", "stalled", "working", "idle", "dormant"]) {
      const n = repos.filter((repo) => repo.state === state).length;
      if (n === 0) continue;
      const item = h("span");
      item.append(h("b", CARD_STATES.indexOf(state) >= 0 ? "alert" : "", String(n)), " " + state);
      counts.append(item);
    }
    out.append(counts);

    const stack = h("section", "repos");
    stack.setAttribute("aria-label", "Repos");
    for (const repo of repos.filter((candidate) => CARD_STATES.indexOf(candidate.state) >= 0)) {
      stack.append(repoCard(repo, needs, now));
    }
    const active = repos.filter((candidate) => CARD_STATES.indexOf(candidate.state) < 0 && candidate.state !== "dormant");
    if (active.length > 0) {
      const group = h("div", "card full");
      const rows = h("div", "rows");
      for (const repo of active) rows.append(repoRow(repo, now));
      group.append(rows);
      stack.append(group);
    }
    const dormant = repos.filter((candidate) => candidate.state === "dormant");
    if (dormant.length > 0) {
      const box = h("section", "card dormant full");
      const top2 = h("div", "section-head");
      top2.append(label("Dormant · " + dormant.length, "h2"), h("div", "meta", "tap to open"));
      const chips = h("div", "chips");
      for (const repo of dormant) {
        const chip = link("chip", repoHref(repo.name), txt(repo.name));
        const at = parse(repo.worker ? repo.worker.lastTurnAt : null) ?? parse(repo.lastDoneAt);
        if (at !== null) chip.append(h("span", "muted", "· " + span(now - at)));
        if (num(repo.unseen) > 0) chip.append(h("span", "muted", "· " + repo.unseen + " unseen"));
        chips.append(chip);
      }
      box.append(top2, chips, h("div", "note", "dormant = on the roster, idle past 24h, queue empty"));
      stack.append(box);
    }
    out.append(stack);

    const band2 = link("card health-band", "/health");
    const bandHead = h("div", "repo-head");
    const bandTitle = h("div", "repo-name");
    const clear = num(health.expected) !== null && num(health.holes) === 0 && num(health.hands) === 0 && num(health.held) === 0;
    // Nothing expected is nothing to call healthy, so "0 of 0 reporting" draws the neutral dot.
    const idle = num(health.expected) === 0 && clear;
    bandTitle.append(dot(idle ? "hollow" : clear ? "green" : "amber"), h("span", "label", "Health"));
    bandHead.append(bandTitle, chevron());
    const line = h("div", "line");
    if (num(health.expected) === null) line.append("no reading yet");
    else {
      line.append(h("b", null, health.reporting + " of " + health.expected), " reporting");
      if (num(health.holes) > 0) line.append(" · " + health.holes + " missing");
      line.append(" · " + (num(health.hands) > 0 ? health.hands + " for your hands" : "nothing for your hands"));
      if (num(health.held) > 0) line.append(" · " + health.held + (health.held === 1 ? " source held" : " sources held"));
    }
    band2.append(bandHead, line);
    out.append(band2, sources(view, ["roster", "queues", "plans", "ledger", "events", "registry", "usage"]));
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Repo page
  // ---------------------------------------------------------------------------------------------

  function repoName() {
    const prefix = "/repo/";
    if (location.pathname.indexOf(prefix) !== 0) return null;
    try {
      const name = decodeURIComponent(location.pathname.slice(prefix.length).replace(/\/+$/, ""));
      return name === "" ? null : name;
    } catch (error) {
      return null;
    }
  }

  function repoUrl() {
    const name = repoName();
    return name === null ? null : "/web/repo?name=" + encodeURIComponent(name);
  }

  function planRow(plan, now, upNext) {
    const row = plan.root && plan.path ? link("plan-row", planHref(plan.root, plan.path)) : h("div", "plan-row");
    const status = txt(plan.status).toLowerCase();
    const finished = status === "complete";
    const state = h("div", "state" + (upNext ? "" : finished ? " done" : status === "in progress" ? " doing" : ""));
    if (upNext) state.append(dot("hollow"), "Queued");
    else if (finished) state.append("✓ Done");
    else if (status === "in progress") state.append(dot("blue"), "Doing");
    else state.append(dot("hollow"), txt(plan.status) || "Plan");
    const body = h("div", "body");
    body.append(h("div", "title", txt(plan.title)));
    const meta = [];
    if (num(plan.section) !== null && num(plan.sectionCount) !== null) meta.push("section " + plan.section + " of " + plan.sectionCount);
    const changed = parse(plan.changedAt);
    if (changed !== null) meta.push("changed " + dayClock(changed, now));
    if (meta.length > 0) body.append(h("div", "meta", meta.join(" · ")));
    if (plan.next && !finished) body.append(h("div", "next", "Next: " + plan.next));
    row.append(state, body);
    if (plan.root && plan.path) row.append(chevron());
    return row;
  }

  function renderRepo(view) {
    const out = document.createDocumentFragment();
    const now = nowOf(view);
    const top = h("div", "top");
    top.append(back("/", "Standup"));
    const row = h("div", "top-row");
    row.append(h("h1", null, txt(view.name)), stamp(view));
    top.append(row);
    const since = parse(view.unseenSince);
    const catchUp = h("div", "top-row");
    const caughtUp = h("button", "linkbtn", "Caught up");
    caughtUp.type = "button";
    caughtUp.dataset.focusKey = "caught-up";
    caughtUp.addEventListener("click", () => sendCaughtUp(txt(view.name)));
    catchUp.append(
      h("p", "sub", since === null ? "No catch-up mark yet, so changed means the last 24 hours." : "Since you caught up, " + dayClock(since, now)),
      caughtUp,
    );
    top.append(catchUp);
    out.append(top);

    const cols = h("div", "repo-cols");
    const left = h("div", "stack");

    const changed = list(view.changed);
    const changedSection = h("section", "section");
    changedSection.append(
      label((since === null ? "Changed in the last 24 hours" : "Changed since " + dayClock(since, now)) + (view.changed === null ? "" : " · " + changed.length)),
    );
    if (view.changed === null) changedSection.append(h("div", "card pad muted", "No plans were swept for this repo."));
    else if (changed.length === 0) changedSection.append(h("div", "card pad muted", "Nothing has changed."));
    else {
      const card = h("div", "card");
      for (const plan of changed) card.append(planRow(plan, now, false));
      changedSection.append(card);
    }
    left.append(changedSection);

    const queued = list(view.upNext);
    const nextSection = h("section", "section");
    nextSection.append(label("Up next · " + queued.length));
    if (queued.length === 0) nextSection.append(h("div", "card pad muted", "Nothing is queued."));
    else {
      const card = h("div", "card");
      for (const plan of queued) card.append(planRow(plan, now, true));
      nextSection.append(card);
    }
    left.append(nextSection);

    const worker = view.worker || {};
    const box = h("section", "card pad worker");
    const head = h("div", "worker-head");
    const who = h("div", "who");
    who.append(dot(worker.surfaceState === "working" ? "blue" : "hollow"), h("h2", null, txt(worker.lineage || view.name) + ": Worker"));
    head.append(who, h("div", "meta", (worker.surfaceState || "no session") + " · " + leaseWords(worker)));
    const turn = parse(worker.lastTurnAt);
    box.append(head, h("div", "meta", turn === null ? "No turn recorded." : "Last turn " + dayClock(turn, now) + ", " + span(now - turn) + " ago."));

    cols.append(left, box);
    out.append(cols, sources(view, ["plans", "queues", "ledger", "events", "roster"]));
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Plan page
  // ---------------------------------------------------------------------------------------------

  function planParams() {
    const query = new URLSearchParams(location.search);
    const root = query.get("root");
    const path = query.get("path");
    return root && path ? { root: root, path: path } : null;
  }

  function planUrl() {
    const params = planParams();
    return params === null ? null : "/web/plan?root=" + encodeURIComponent(params.root) + "&path=" + encodeURIComponent(params.path);
  }

  function mark(kind, words) {
    const m = h("span", "mark " + kind, kind === "done" ? "✓" : kind === "now" ? "●" : "○");
    m.append(h("span", "sr", words));
    return m;
  }

  function renderPlan(view) {
    const out = document.createDocumentFragment();
    const now = nowOf(view);
    const sections = list(view.sections);
    const chapters = list(view.chapters);
    const finished = txt(view.status).toLowerCase() === "complete";

    const top = h("div", "top");
    top.append(back("/", "Standup"));
    const row = h("div", "top-row");
    row.append(h("h1", "plan-title", txt(view.title)), stamp(view));
    top.append(row);
    const chips = h("div", "chips-row");
    chips.append(
      h("span", finished ? "badge green" : "badge blue", txt(view.status) + (sections.length > 0 ? " · section " + chapters.length + " of " + sections.length : "")),
      h("span", "meta mono", txt(view.path)),
    );
    top.append(chips);
    out.append(top);

    const goal = h("section", "card pad section");
    goal.append(label("Goal"), h("p", "goal", view.goal ? view.goal : "This plan has no Goal section."));
    out.append(goal);

    const asks = list(view.openAsks);
    if (asks.length > 0) {
      const box = h("section", "section");
      box.append(label("Open asks · " + asks.length));
      const card = h("div", "card");
      for (const ask of asks) {
        const item = h("div", "ask");
        const text = h("div");
        if (ask.blocking) text.append(h("span", "tag", "blocking"));
        text.append(txt(ask.text));
        item.append(text);
        if (ask.recommend) item.append(h("div", "rec", "Recommends: " + ask.recommend));
        const opened = parse(ask.openedAt);
        if (opened !== null) item.append(h("div", "meta", "asked " + span(now - opened) + " ago"));
        card.append(item);
      }
      box.append(card);
      out.append(box);
    }

    const progress = h("section", "card pad section");
    progress.append(label("Progress"));
    if (sections.length === 0) progress.append(h("div", "meta", "This plan lists no sections."));
    else {
      const steps = h("ul", "steps");
      let current = -1;
      if (!finished) current = sections.findIndex((section) => !section.done);
      sections.forEach((section, index) => {
        const item = h("li");
        const isDone = finished || Boolean(section.done);
        item.append(
          isDone ? mark("done", "done") : index === current ? mark("now", "in flight") : mark("later", "waiting"),
          h("span", index === current ? "" : isDone ? "" : "muted", txt(section.name)),
        );
        steps.append(item);
      });
      progress.append(steps);
    }
    if (view.next) progress.append(h("div", "next-line", "Next: " + view.next));
    if (chapters.length > 0) {
      progress.append(label("Chapters · " + chapters.length, "h3"));
      const steps = h("ul", "steps");
      for (const chapter of chapters) {
        const item = h("li");
        item.append(mark("done", "closed"));
        const body = h("span", null, "Chapter " + chapter.number + ": " + txt(chapter.completed));
        if (chapter.next) body.append(h("span", "rec", "Next: " + chapter.next));
        item.append(body);
        steps.append(item);
      }
      progress.append(steps);
    }
    progress.append(sources(view, ["plans", "ledger"]));
    out.append(progress);
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Health page
  // ---------------------------------------------------------------------------------------------

  const WINDOW_NAMES = { five_hour: "5 Hr", seven_day: "7 Day" };
  const HOLE_WORDS = { "no-heartbeat": "no heartbeat", "stale-heartbeat": "heartbeat stale" };
  const SESSION_ORDER = { "needs you": 0, blocked: 0, exited: 1, idle: 2, working: 3 };
  const SESSIONS_SHOWN = 8;
  let sessionsExpanded = false;

  function sessionCell(session) {
    const state = txt(session.surfaceState);
    const cell = h("div", "cell");
    const kind = state === "working" ? "blue" : state === "needs you" || state === "blocked" ? "amber" : "hollow";
    const idle = state === "idle" || state === "exited" ? " · " + state + " " + span(num(session.idleFor) ?? 0) : state === "working" ? "" : " · " + state;
    cell.append(dot(kind), h("span", state === "working" ? "" : "muted", txt(session.name) + idle));
    return cell;
  }

  function sessionsSection(view) {
    const box = h("section", "section");
    const head = h("div", "section-head");
    head.append(label("Sessions"));
    const count = h("div");
    if (num(view.expected) === null) count.append("no reading yet");
    else count.append(h("b", null, String(view.reporting)), " of ", h("b", null, String(view.expected)), " expected are reporting");
    head.append(count);
    box.append(head);

    for (const hole of list(view.holes)) {
      const card = h("article", "card hole");
      const top = h("div", "hole-head");
      const why = Object.prototype.hasOwnProperty.call(HOLE_WORDS, hole.reason) ? HOLE_WORDS[hole.reason] : txt(hole.reason);
      top.append(h("h3", "repo-name", txt(hole.name) + ": Worker"), h("div", "why", why));
      card.append(top);
      box.append(card);
    }

    const sessions = list(view.sessions).slice().sort((a, b) => {
      const x = Object.prototype.hasOwnProperty.call(SESSION_ORDER, a.surfaceState) ? SESSION_ORDER[a.surfaceState] : 2;
      const y = Object.prototype.hasOwnProperty.call(SESSION_ORDER, b.surfaceState) ? SESSION_ORDER[b.surfaceState] : 2;
      return x - y;
    });
    const card = h("div", "card pad");
    if (sessions.length === 0) card.append(h("div", "muted", "No live sessions."));
    else {
      const grid = h("div", "grid");
      const shown = sessionsExpanded ? sessions : sessions.slice(0, SESSIONS_SHOWN);
      for (const session of shown) grid.append(sessionCell(session));
      card.append(grid);
      const rest = sessions.length - shown.length;
      if (rest > 0 || (sessionsExpanded && sessions.length > SESSIONS_SHOWN)) {
        const hidden = sessions.slice(SESSIONS_SHOWN);
        const states = Array.from(new Set(hidden.map((session) => txt(session.surfaceState))));
        const button = h(
          "button",
          "linkbtn",
          sessionsExpanded ? "Show fewer" : rest + " more" + (states.length === 1 ? ", all " + states[0] : ""),
        );
        button.type = "button";
        button.dataset.focusKey = "sessions-more";
        button.setAttribute("aria-expanded", sessionsExpanded ? "true" : "false");
        button.addEventListener("click", () => {
          sessionsExpanded = !sessionsExpanded;
          draw(lastView);
        });
        card.append(button);
      }
    }
    card.append(sources(view, ["roster", "queues", "registry"]));
    box.append(card);
    return box;
  }

  function windowLines(account) {
    const lines = [];
    if (account.fiveHour) lines.push({ name: WINDOW_NAMES.five_hour, window: account.fiveHour });
    if (account.sevenDay) lines.push({ name: WINDOW_NAMES.seven_day, window: account.sevenDay });
    for (const scoped of list(account.scoped)) lines.push({ name: txt(scoped.name), window: scoped });
    return lines;
  }

  function accountRow(account, now) {
    const box = h("div", "account");
    const head = h("div", "account-head");
    const who = h("span", "who", account.email ? account.email : "Account #" + account.number);
    if (account.active) who.append(h("span", "muted", " · active"));
    head.append(who);
    let bound = "";
    let elapsed = "";
    if (account.binding && num(account.binding.pct) > 0) {
      const name = Object.prototype.hasOwnProperty.call(WINDOW_NAMES, account.binding.name) ? WINDOW_NAMES[account.binding.name] : txt(account.binding.name);
      bound = "bound by " + name;
      if (num(account.elapsedPct) !== null) elapsed = Math.round(account.elapsedPct) + "% of the window elapsed";
    }
    if (account.failing) {
      const failing = "sign-in failing · " + account.consecutiveFailures + (account.consecutiveFailures === 1 ? " try" : " tries");
      bound = bound ? failing + " · " + bound : failing;
    }
    if (bound) head.append(h("span", "bound", bound));
    box.append(head);
    if (elapsed) box.append(h("div", "meta", elapsed));
    if (account.organizationName) box.append(h("div", "meta", txt(account.organizationName)));

    const lines = windowLines(account);
    const untouched = lines.length > 0 && lines.every((line) => num(line.window.pct) === 0);
    if (untouched) {
      const reset = lines.map((line) => parse(line.window.resetsAt)).find((at) => at !== null);
      box.append(h("div", "meta", "untouched · 0%" + (reset === undefined ? "" : " · resets " + until(reset - now))));
    } else if (lines.length > 0) {
      const grid = h("div", "windows");
      for (const line of lines) {
        const pct = num(line.window.pct) ?? 0;
        const reset = parse(line.window.resetsAt);
        grid.append(h("span", "muted", line.name), h("span", null, pct + "%"), bar(pct, pct >= 80), h("span", "muted", reset === null ? "" : until(reset - now)));
      }
      box.append(grid);
    }
    if (account.spend) {
      const spend = account.spend;
      const used = num(spend.used) === null || num(spend.limit) === null ? "" : " · " + spend.used + " of " + spend.limit + " " + txt(spend.currency);
      box.append(h("div", "meta", "Spend " + (num(spend.pct) ?? 0) + "%" + used));
    }
    return box;
  }

  function capacitySection(view, now) {
    const box = h("section", "section");
    const accounts = list(view.capacity);
    const head = h("div", "section-head");
    head.append(label("Capacity · " + accounts.length + (accounts.length === 1 ? " account" : " accounts")));
    const read = parse(view.asOf ? view.asOf.usage : null);
    head.append(h("div", "stamp", read === null ? "swap: no reading yet" : "swap read " + span(now - read) + " ago"));
    box.append(head);
    const card = h("div", "card");
    if (accounts.length === 0) card.append(h("div", "pad muted", view.asOf && view.asOf.usage === null ? "No reading yet." : "No accounts reporting."));
    for (const account of accounts) card.append(accountRow(account, now));
    box.append(card);
    return box;
  }

  function handsSection(view, now) {
    const box = h("section", "section");
    const hands = list(view.hands);
    box.append(label("Your hands · " + hands.length));
    const card = h("div", "card");
    if (hands.length === 0) card.append(h("div", "pad muted", "Nothing for your hands."));
    else {
      const items = h("ol", "hands");
      hands.forEach((hand, index) => {
        const item = h("li");
        item.append(h("div", "n", String(index + 1)));
        const body = h("div");
        body.append(h("div", "text", txt(hand.text)));
        const parts = [];
        if (hand.repo) parts.push(hand.repo);
        const opened = parse(hand.openedAt);
        if (opened !== null) parts.push(span(now - opened) + " ago");
        if (parts.length > 0) body.append(h("div", "meta", parts.join(" · ")));
        item.append(body);
        items.append(item);
      });
      card.append(items);
    }
    box.append(card);
    return box;
  }

  function renderHealth(view) {
    const out = document.createDocumentFragment();
    const now = nowOf(view);
    const top = h("div", "top");
    top.append(back("/", "Standup"));
    const row = h("div", "top-row");
    row.append(h("h1", null, "Health"), stamp(view));
    top.append(row);
    out.append(top);
    const cols = h("div", "health-cols");
    cols.append(sessionsSection(view), capacitySection(view, now), handsSection(view, now));
    out.append(cols);
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------------------------

  const page = PAGES[document.body.dataset.page];
  const app = document.getElementById("app");
  const notice = document.getElementById("notice");
  let lastView = null;
  let heldPolls = 0;
  let lastOk = null;

  class Unreadable extends Error {}

  function setNotice(message) {
    notice.textContent = message;
    notice.hidden = false;
  }

  /** Draws `view` whole off to the side and swaps it in, so a draw that throws leaves the last one. */
  function draw(view) {
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : undefined;
    const drawn = page.render(view);
    // Each link and button carries a key built from its href, counted per repeat, so a redraw puts focus back.
    const seen = new Map();
    for (const control of drawn.querySelectorAll("a[href], button")) {
      if (control.dataset.focusKey) continue;
      const href = control.getAttribute("href");
      const count = seen.get(href) ?? 0;
      seen.set(href, count + 1);
      control.dataset.focusKey = href + "|" + count;
    }
    app.replaceChildren(drawn);
    if (focused) {
      const again = Array.from(app.querySelectorAll("[data-focus-key]")).find((control) => control.dataset.focusKey === focused);
      if (again) again.focus();
    }
  }

  /** The text selection touching the page, which a redraw would throw away; focus comes back by its key. */
  function selected() {
    const selection = document.getSelection();
    return selection !== null && !selection.isCollapsed && selection.containsNode(app, true) ? selection : null;
  }

  async function fetchView(url) {
    let response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new Unreadable("the broker did not answer");
    }
    if (!response.ok) throw new Unreadable("the broker answered HTTP " + response.status);
    try {
      return await response.json();
    } catch (error) {
      throw new Unreadable("the broker's answer was not JSON");
    }
  }

  let seenSent = false;

  /**
   * Marks the plan seen: once per open, after the plan has been drawn once, never on a poll. A plan
   * that could not be read is never drawn, so a link to one that does not exist marks nothing. The
   * answer is ignored; the mark only moves what the standup page counts as unseen.
   */
  function sendSeen() {
    if (seenSent || document.body.dataset.page !== "plan") return;
    seenSent = true;
    fetch("/web/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(planParams()),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined);
  }

  let caughtUpSending = false;

  /**
   * The caught-up body: the repo, and the time of the older of the plans and ledger readings the
   * drawn page carries, so the broker stamps the mark with what the operator saw. The time is left
   * out when neither reading carries one.
   */
  function drawnAtOf(name) {
    const asOf = lastView && lastView.asOf ? lastView.asOf : {};
    const times = [asOf.plans, asOf.ledger].filter((value) => parse(value) !== null);
    const body = { repo: name };
    if (times.length > 0) body.drawnAt = times.reduce((a, b) => (parse(a) <= parse(b) ? a : b));
    return body;
  }

  /** Posts the caught-up mark for a repo once per tap, then draws the page again so it shows the result. */
  async function sendCaughtUp(name) {
    if (caughtUpSending) return;
    caughtUpSending = true;
    try {
      const response = await fetch("/web/caught-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(drawnAtOf(name)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Unreadable("the broker answered HTTP " + response.status);
      const view = await fetchView(page.url());
      draw(view);
      lastView = view;
      lastOk = Date.now();
      notice.hidden = true;
    } catch (error) {
      setNotice("Could not mark this repo caught up: " + (error instanceof Unreadable ? error.message : "the broker did not answer") + ".");
    } finally {
      caughtUpSending = false;
    }
  }

  async function poll(url) {
    let failure = null;
    try {
      const view = await fetchView(url);
      try {
        const selection = selected();
        if (selection === null || heldPolls >= HOLD_POLLS) {
          draw(view);
          heldPolls = 0;
          sendSeen();
        } else {
          // A selection holds the page still for a few polls, so it can be copied. The stamp and the reading's
          // age stay with what is drawn, so nothing on the page claims a newer reading than it shows.
          heldPolls += 1;
        }
        if (heldPolls === 0) {
          lastView = view;
          lastOk = Date.now();
        }
        notice.hidden = true;
      } catch (error) {
        failure = "the reading could not be drawn";
      }
    } catch (error) {
      failure = error instanceof Unreadable ? error.message : "the reading could not be fetched";
    }
    if (failure !== null) {
      if (lastView === null) {
        setNotice("Could not load: " + failure + ". Trying again every " + POLL_MS / 1000 + " seconds.");
        app.replaceChildren(h("p", "muted", "No reading yet."));
      } else {
        setNotice("Could not refresh: " + failure + ". Showing the last reading, " + span(Date.now() - lastOk) + " old.");
      }
    }
    setTimeout(() => poll(url), POLL_MS);
  }

  function start() {
    if (page === undefined) return;
    const url = page.url();
    if (url === null) {
      app.replaceChildren(h("p", "muted", document.body.dataset.page === "plan" ? "Open a plan from a repo page." : "No repo named in the address."));
      return;
    }
    poll(url);
  }

  start();
})();
