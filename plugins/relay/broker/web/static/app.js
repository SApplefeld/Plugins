// The web surface's pages: one script for all five. Each page names itself in `<body data-page>`,
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
  /** How long one thread post carrying a file may take at the broker, on top of the base wait. */
  const FILE_POST_MS = 30000;
  /** How many polls a text selection on the page may hold it still, so it can be copied. */
  const HOLD_POLLS = 6;

  /** How long a batch Agree may take: the broker agrees its items one by one, each a thread post and a hand-over. */
  function batchTimeoutMs(count) {
    return TIMEOUT_MS + TIMEOUT_MS * count;
  }

  /**
   * How long a say may take: the first thread post and the hand-over. The first post carries the
   * first file where the line has one, and any other file posts follow outside the request.
   */
  function sayTimeoutMs(fileCount) {
    return fileCount > 0 ? TIMEOUT_MS + FILE_POST_MS : TIMEOUT_MS;
  }

  const PAGES = {
    standup: { render: renderStandup, url: () => "/web/standup" },
    repo: { render: renderRepo, url: repoUrl },
    plan: { render: renderPlan, url: planUrl },
    health: { render: renderHealth, url: () => "/web/health" },
    "needs-me": { render: renderNeedsMe, url: () => "/web/needs-me" },
    talk: { render: renderTalk, url: talkUrl, accept: talkAccept, follow: true },
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
    // A rollout source neither read nor held draws nothing: a host with no git renders as it did before the source.
    const parts = names.filter((name) => name !== "rollout" || parse(asOf[name]) !== null || list(view && view.held).includes(name)).map((name) => {
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
  // Rollout
  // ---------------------------------------------------------------------------------------------

  /**
   * How long Mark rolled out may take at the broker: 15 minutes. The worst case waits on the repository's lock behind a pass's
   * ls-remote and first fetch (60 s plus 10 min), then runs the tap's own ls-remote, fetch and push at 60 s each, 14 minutes in all.
   */
  const ROLLOUT_POST_MS = 900000;

  /** The rows whose Mark rolled out is out, so a redraw keeps their buttons disabled until the answer. */
  const rolloutBusy = new Set();

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function objects(value) {
    return list(value).filter(isObject);
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  /** A day in the mockups' short form: today, the weekday within the last week, else month and day. */
  function dayWord(ms, now) {
    const day = new Date(ms);
    if (day.toDateString() === new Date(now).toDateString()) return "today";
    if (ms <= now && now - ms < 6 * 86400000) return day.toLocaleDateString(undefined, { weekday: "short" });
    return day.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function dayOf(iso, now) {
    const ms = parse(iso);
    return ms === null ? null : dayWord(ms, now);
  }

  /** A tag's `YYYY-MM-DD` date segment as month and day; a value of any other shape is shown as it came. */
  function tagDay(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(value));
    if (match === null) return txt(value);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const date = Number(match[3]);
    const day = new Date(year, month - 1, date);
    if (day.getFullYear() !== year || day.getMonth() !== month - 1 || day.getDate() !== date) return txt(value);
    return day.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function rolloutHeld(view) {
    return list(view.held).indexOf("rollout") >= 0;
  }

  /** A row the button can act on: it names its repository and its branch. */
  function rolloutRowOf(value) {
    return isObject(value) && txt(value.repo) !== "" && txt(value.branch) !== "";
  }

  function rolloutKey(row) {
    return JSON.stringify([row.repo, row.branch]);
  }

  function rolloutClient(row) {
    return txt(row.client) || txt(row.branch);
  }

  /**
   * The one toast the pages share: a line, and an optional command the operator can select and copy. Its live region is in the
   * page empty before the first message, so a screen reader announces that message. Focus moves to Dismiss where the tapped
   * button is disabled or gone, and returns to a rollout button when the toast is dismissed.
   */
  const toastBox = h("div", "toast");
  toastBox.setAttribute("role", "status");
  if (["standup", "repo", "needs-me"].indexOf(document.body.dataset.page) >= 0) document.body.append(toastBox);

  function showToast(words, command) {
    const body = h("div", "toast-body");
    body.append(h("span", null, words));
    if (command) body.append(h("code", "toast-code", command));
    const close = h("button", "toast-close", "Dismiss");
    close.type = "button";
    close.addEventListener("click", () => {
      const held = toastBox.contains(document.activeElement);
      toastBox.replaceChildren();
      if (held) {
        const next = document.querySelector("#app button.ro-button:not(:disabled)");
        if (next !== null) next.focus();
      }
    });
    toastBox.replaceChildren(body, close);
    const active = document.activeElement;
    if (active === null || active === document.body || active.disabled === true || !active.isConnected) close.focus();
  }

  /** Posts Mark rolled out for a row and shows the broker's answer in the toast; nothing is thrown. */
  async function postRollout(row) {
    let response;
    try {
      response = await fetch("/web/rollout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: row.repo, branch: row.branch }),
        signal: AbortSignal.timeout(ROLLOUT_POST_MS),
      });
    } catch (error) {
      const again = " Tapping again answers \"Already tagged\" if the tag landed.";
      if (error instanceof Error && error.name === "TimeoutError") showToast("The broker did not answer in 15 minutes, so the tag is not confirmed." + again);
      else showToast("The broker could not be reached, so the tag is not confirmed." + again);
      return;
    }
    let answer = null;
    let readable = true;
    try {
      answer = await response.json();
    } catch (error) {
      readable = false;
    }
    const body = isObject(answer) ? answer : {};
    if (response.status === 200) {
      if (!readable) showToast("The broker's answer was not JSON, so the tag is not confirmed.");
      else if (txt(body.tag) === "") showToast("The broker's answer named no tag, so the tag is not confirmed.");
      else if (txt(body.undo) === "") showToast("Tagged " + txt(body.tag) + ".");
      else showToast("Tagged " + txt(body.tag) + ". To undo it, run:", txt(body.undo));
    } else if (response.status === 409) {
      showToast(txt(body.tag) === "" ? "Already tagged." : "Already tagged: " + txt(body.tag));
    } else if (response.status === 502) {
      showToast("push failed" + (txt(body.kind) === "" ? "" : " (" + txt(body.kind) + ")"));
    } else {
      showToast("Mark rolled out failed: the broker answered HTTP " + response.status + ".");
    }
  }

  /** Marks one row rolled out. The button stays disabled until the answer, and the page reads its view again after it. */
  async function sendRollout(row) {
    const key = rolloutKey(row);
    if (rolloutBusy.has(key)) return;
    rolloutBusy.add(key);
    redrawNeeds();
    try {
      await postRollout(row);
    } finally {
      rolloutBusy.delete(key);
      await refreshView();
    }
  }

  function rolloutButton(row, cls) {
    const button = h("button", "ro-button " + cls, "Mark rolled out");
    button.type = "button";
    button.setAttribute("aria-label", "Mark rolled out, " + rolloutClient(row));
    button.disabled = rolloutBusy.has(rolloutKey(row));
    button.dataset.focusKey = "rollout|" + rolloutKey(row);
    button.addEventListener("click", () => sendRollout(row));
    return button;
  }

  /** The footer line of a card: what the counts are, and when the tags were read. */
  function rolloutFooter(words, readAt) {
    const at = parse(readAt);
    return h("div", "ro-foot", words + (at === null ? "" : " · tags " + clock(at)));
  }

  /** The sandbox page's card over every client branch, or nothing where the slot is null. A held source draws `tags unread` in place of the rows. */
  function rolloutCard(view) {
    const summary = view.rollout;
    if (!isObject(summary)) return null;
    const now = nowOf(view);
    const card = h("section", "card ro-card");
    card.setAttribute("aria-labelledby", "rollout-heading");
    const rows = objects(summary.rows);
    const waiting = rows.filter((row) => num(row.toRollOut) > 0);
    const held = rolloutHeld(view);

    const head = h("div", "ro-head");
    const heading = label(held ? "Rollout" : "Rollout · " + plural(num(summary.waiting) ?? waiting.length, "client", "clients") + " waiting");
    heading.id = "rollout-heading";
    head.append(heading);
    const oldest = dayOf(summary.oldestAt, now);
    if (held) head.append(h("div", "ro-sub held", "tags unread"));
    else head.append(h("div", "ro-sub", plural(num(summary.changes) ?? 0, "change", "changes") + (oldest === null ? "" : ", oldest " + oldest)));
    card.append(head);
    if (held) {
      card.append(rolloutFooter("the rows from the last read are not shown", summary.readAt));
      return card;
    }

    const shared = isObject(view.shared) ? objects(view.shared.rows) : [];
    if (waiting.length === 0 && shared.length === 0) return null;
    const full = h("div", "ro-full");
    for (const row of waiting) {
      const line = h("div", "ro-line");
      const text = h("span");
      const since = tagDay(row.lastTagDate) === "" ? ", no rollout tag yet" : " since " + tagDay(row.lastTagDate);
      text.append(h("b", null, rolloutClient(row)), " · " + num(row.toRollOut) + " merged" + since);
      line.append(text, h("span", "ro-day", dayOf(row.oldestAt, now) ?? ""));
      full.append(line);
    }
    for (const one of shared) {
      const line = h("div", "ro-line");
      const clients = num(one.clients) ?? 0;
      const at = num(one.atClients) ?? 0;
      const text = h("span", "muted");
      const merged = num(one.fannedOut) ?? 0;
      text.append(h("b", null, "Shared"), " · " + txt(one.title) + " merged to " + merged + ", at " + at + " of " + plural(clients, "client", "clients"));
      line.append(text, h("span", "ro-day", Math.max(0, clients - at) + " left"));
      full.append(line);
    }
    card.append(full);

    // The desktop layout draws the same rows as two lines, per the condensed mockup.
    const condensed = h("div", "ro-condensed");
    if (waiting.length > 0) {
      const line = h("div", "ro-flow");
      waiting.forEach((row, at) => {
        if (at > 0) line.append(" · ");
        const since = tagDay(row.lastTagDate) === "" ? ", no tag yet" : " since " + tagDay(row.lastTagDate);
        line.append(h("b", null, rolloutClient(row)), " ", h("span", "muted", "· " + num(row.toRollOut) + since));
      });
      condensed.append(line);
    }
    for (const one of shared) {
      const line = h("div", "ro-flow");
      const clients = num(one.clients) ?? 0;
      const at = num(one.atClients) ?? 0;
      const merged = num(one.fannedOut) ?? 0;
      line.append("Shared: " + txt(one.title) + " ", h("span", "muted", "· merged to " + merged + ", at " + at + " of " + clients + ", " + Math.max(0, clients - at) + " pending"));
      condensed.append(line);
    }
    card.append(condensed);
    card.append(rolloutFooter("commits on each branch past its last rollout tag", summary.readAt));
    return card;
  }

  /** The repo page's card for the client branch the persona's checkout is on, or nothing where the slot is null. */
  function rolloutRepoCard(view) {
    const row = view.rollout;
    if (!isObject(row)) return null;
    const now = nowOf(view);
    const card = h("section", "card pad attn ro-repo");
    card.setAttribute("aria-labelledby", "rollout-heading");
    const head = h("div", "ro-head");
    const heading = label("Rollout");
    heading.id = "rollout-heading";
    head.append(heading);
    const held = rolloutHeld(view);
    if (held) head.append(h("div", "ro-sub held", "tags unread"));
    else head.append(h("div", "ro-tag", txt(row.lastTag) === "" ? "no rollout tag yet" : txt(row.lastTag)));
    card.append(head);
    if (held) {
      card.append(rolloutFooter("the rows from the last read are not shown", row.readAt));
      return card;
    }

    const toRollOut = num(row.toRollOut) ?? 0;
    card.append(h("div", "ro-lead", plural(toRollOut, "change", "changes") + " merged since " + rolloutClient(row) + " last got a deploy" + (toRollOut > 0 ? ":" : ".")));
    const commits = objects(row.commits);
    if (commits.length > 0) {
      const grid = h("div", "ro-commits");
      for (const commit of commits) {
        const mark = h("span", "ro-check", "✓");
        mark.setAttribute("aria-hidden", "true");
        grid.append(mark, h("span", null, txt(commit.title) + (commit.fromDefault === true ? ", from main" : "")), h("span", "ro-day", dayOf(commit.at, now) ?? ""));
      }
      card.append(grid);
    }
    if (toRollOut > commits.length) card.append(h("div", "ro-more", "and " + (toRollOut - commits.length) + " more"));
    if (rolloutRowOf(row)) {
      const action = h("div", "ro-action");
      action.append(rolloutButton(row, "ro-button-repo"));
      card.append(action);
    }
    card.append(rolloutFooter("records a tag at the branch head; the deploy itself is yours", null));
    return card;
  }

  /** The Needs-me page's Roll out group, one row and one button per client branch with something waiting, or nothing where the slot is null. */
  function rolloutGroup(view) {
    if (!Array.isArray(view.rollout)) return null;
    const now = nowOf(view);
    const rows = objects(view.rollout);
    const held = rolloutHeld(view);
    if (!held && rows.length === 0) return null;
    const section = h("section", "section");
    section.setAttribute("aria-label", "Roll out");
    const head = h("div", "section-head");
    head.append(label("Roll out · " + (held ? "tags unread" : plural(rows.length, "client", "clients")), "h2"));
    section.append(head);
    const card = h("div", "card");
    if (held) card.append(h("div", "nm-none", "tags unread"));
    else {
      for (const row of rows) {
        const line = h("div", "ro-need");
        const text = h("div");
        text.append(h("b", null, rolloutClient(row)), " · " + (num(row.toRollOut) ?? 0) + " merged ");
        const parts = [];
        const oldest = dayOf(row.oldestAt, now);
        if (oldest !== null) parts.push("oldest " + oldest);
        parts.push(tagDay(row.lastTagDate) === "" ? "no rollout tag yet" : "last deploy " + tagDay(row.lastTagDate));
        if (txt(row.repo) !== "") parts.push(txt(row.repo));
        text.append(h("span", "muted", "· " + parts.join(" · ")));
        line.append(text);
        if (rolloutRowOf(row)) line.append(rolloutButton(row, "ro-button-need"));
        card.append(line);
      }
    }
    section.append(card);
    return section;
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
      link("alert", "/needs-me", "Needs me · " + needs.length),
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
    const rolloutBand = rolloutCard(view);
    if (rolloutBand !== null) out.append(rolloutBand);

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
    out.append(band2, sources(view, ["roster", "queues", "plans", "ledger", "events", "registry", "usage", "rollout"]));
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
    const rolloutBox = rolloutRepoCard(view);
    if (rolloutBox !== null) left.append(rolloutBox);

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
    // The worker's talk page, where its lineage is known; the plan page carries no lineage and links nowhere.
    if (txt(worker.lineage) !== "") {
      const talk = h("div", "meta");
      talk.append(link("", talkHref(txt(worker.lineage)), "Talk to " + txt(worker.lineage)));
      box.append(talk);
    }

    cols.append(left, box);
    out.append(cols, sources(view, ["plans", "queues", "ledger", "events", "roster", "rollout"]));
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
  const VERDICT_TITLES = { underused: "Underused this week", balanced: "Balanced this week", overcommitted: "Overcommitted this week" };
  const UNKNOWN_REASONS = {
    "no-accounts": "no account reporting a weekly window",
    "no-completed-plans": "no plan finished in the last 7 days",
    "no-queue": "the queue has not been read yet",
  };
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
    const kit = kitCard(view, nowOf(view));
    if (kit) box.append(kit);
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
    let projection = "";
    if (account.binding && num(account.binding.pct) > 0) {
      const name = Object.prototype.hasOwnProperty.call(WINDOW_NAMES, account.binding.name) ? WINDOW_NAMES[account.binding.name] : txt(account.binding.name);
      bound = "bound by " + name;
      if (account.lastsToReset === false) bound += " · dry before reset";
      else if (account.lastsToReset === true) projection = " · lasts to reset";
      if (num(account.elapsedPct) !== null) elapsed = Math.round(account.elapsedPct) + "% of the window elapsed";
    }
    if (account.failing) {
      const failing = "sign-in failing · " + account.consecutiveFailures + (account.consecutiveFailures === 1 ? " try" : " tries");
      bound = bound ? failing + " · " + bound : failing;
    }
    if (bound) {
      const boundCell = h("span", "bound", bound);
      if (projection) boundCell.append(h("span", "muted", projection));
      head.append(boundCell);
    }
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

  /** The sandbox's verdict: the word, the budget against the queue, the lever, and the formula's footer. A view without one draws nothing. */
  function verdictCard(view) {
    const verdict = view.verdict;
    if (!isObject(verdict)) return null;
    const card = h("div", "card verdict");
    const head = h("div", "verdict-head");
    const left = num(verdict.plansLeft);
    const queued = num(verdict.queued);
    if (verdict.word === "unknown") {
      head.append(h("div", "verdict-title", "No estimate yet"));
      card.append(head);
      if (Object.prototype.hasOwnProperty.call(UNKNOWN_REASONS, verdict.reason)) card.append(h("div", "meta", UNKNOWN_REASONS[verdict.reason]));
      return card;
    }
    head.append(h("div", "verdict-title", Object.prototype.hasOwnProperty.call(VERDICT_TITLES, verdict.word) ? VERDICT_TITLES[verdict.word] : txt(verdict.word)));
    if (queued !== null && (left !== null || verdict.word === "underused")) {
      // The word is chosen on unrounded figures, where overcommitted is always below the queue and underused always above it,
      // so those two take their mark from the word; rounding cannot pull a balanced figure below the queue.
      const mark = verdict.word === "overcommitted" ? "<" : verdict.word === "underused" ? ">" : left > queued ? ">" : "=";
      const tone = { underused: "blue", balanced: "green" };
      head.append(h("span", "badge " + (Object.prototype.hasOwnProperty.call(tone, verdict.word) ? tone[verdict.word] : ""), "budget " + mark + " queue"));
    }
    card.append(head);
    const rows = h("div", "verdict-rows");
    const spent = num(verdict.spentWeeks);
    const budget = spent === null ? "" : spent + " of " + plural(num(verdict.accounts) ?? 0, "account-week", "account-weeks") + " used";
    const plansLeft = left === null ? "" : "about " + plural(left, "plan", "plans") + " left";
    rows.append(h("div", "muted", "Budget"), h("div", null, [budget, plansLeft].filter(Boolean).join(" · ")));
    rows.append(h("div", "muted", "Queue"), h("div", null, plural(queued ?? 0, "plan", "plans") + " queued · " + (num(verdict.completedPlans) ?? 0) + " finished in the last 7 days"));
    card.append(rows);
    if (verdict.lever) card.append(h("div", "verdict-lever", txt(verdict.lever)));
    card.append(h("div", "verdict-foot", "cost per plan: estimate, account-weeks spent ÷ plans completed, last 7d"));
    return card;
  }

  /** The plugin release and the live sessions whose process started before it; a view without a kit draws nothing. */
  function kitCard(view, now) {
    const kit = view.kit;
    if (!isObject(kit)) return null;
    const total = num(kit.total) ?? 0;
    const behind = objects(kit.sessions).filter((session) => session.behind === true);
    const card = h("div", "card pad kit");
    const head = h("div", "section-head");
    head.append(h("h3", "label muted", "Kit version"));
    const count = h("div");
    count.append(h("b", null, String(Math.max(0, total - (num(kit.behind) ?? behind.length)))), " of " + total + " on current");
    head.append(count);
    card.append(head);
    const published = parse(kit.updatedAt);
    const line = h("div", "kit-line", published === null ? "Release time unknown." : "Published " + span(now - published) + " ago");
    if (kit.sha) line.append(" ", h("span", "muted mono", txt(kit.sha)));
    card.append(line);
    if (behind.length === 0) card.append(h("div", "meta", "all on current"));
    else card.append(h("div", "meta", (behind.length === 1 ? "A session whose process" : "Sessions whose process") + " started before the update: " + behind.map((session) => txt(session.name)).join(", ")));
    return card;
  }

  function capacitySection(view, now) {
    const box = h("section", "section");
    const accounts = list(view.capacity);
    const head = h("div", "section-head");
    head.append(label("Capacity · " + accounts.length + (accounts.length === 1 ? " account" : " accounts")));
    const read = parse(view.asOf ? view.asOf.usage : null);
    head.append(h("div", "stamp", read === null ? "swap: no reading yet" : "swap read " + span(now - read) + " ago"));
    box.append(head);
    const verdict = verdictCard(view);
    if (verdict) box.append(verdict);
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
  // Talk page
  // ---------------------------------------------------------------------------------------------

  /** The thread link is the one URL the page did not build from route text; only Discord's is drawn. */
  const DISCORD_PREFIX = "https://discord.com/";
  const KIND_WORDS = { mirror: "mirrored", prompt: "prompt", peer: "peer", question: "question", notice: "notice" };

  /** The receipt stages as the page words them; a line with none shows no word. */
  const RECEIPT_WORDS = { delivered: "delivered", "picked-up": "read", answered: "answered", warned: "warned" };
  /** What the broker's answer to a sent line means, in the operator's words. */
  const SEND_WORDS = {
    "no-session": "No live session; nothing was sent.",
    ended: "That session has ended; nothing was sent.",
    "no-thread": "The session has no Discord thread yet; nothing was sent.",
    "no-channel": "The session is not connected to the broker; nothing was sent.",
    rate: "Too many lines in the last minute; wait a moment and try again.",
    "unknown-file": "Those files are no longer held, so nothing was sent. They will be sent again on the next Send.",
    "no-question": "No question is waiting for a typed answer; nothing was sent.",
  };

  /** The most files one line may carry, the broker's own bound and the count one Discord message takes. */
  const MAX_FILES = 10;
  /** How long one file's upload may take: a file at the host's cap crosses a phone's link in well under this. */
  const UPLOAD_TIMEOUT_MS = 120000;
  /** A file link the view carries: the broker's download path and an id of the store's shape, and nothing else. */
  const FILE_URL = /^\/web\/file\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

  /**
   * What the talk page holds between polls: the lines drawn so far, the plan card read once, the
   * line being typed and the files picked for it, so a redraw keeps both, the last send's outcome,
   * and whether a pick or verdict is out and what the last one came to. `drawn` holds the keys of
   * the waiting cards on the page, `seeded` is whether a first reading has been settled, and `waiting`
   * is whether the last reading held any waiting card.
   */
  const talk = { lineage: null, lines: [], nextSeq: 0, ringStart: null, plan: null, draft: "", picked: [], sending: false, status: null, acting: false, pendingStatus: null, drawn: new Set(), seeded: false, waiting: false };

  /** A size in the short form a file chip shows: 512 B, 40 KB, 3.2 MB. */
  function byteSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function talkLineage() {
    const name = new URLSearchParams(location.search).get("lineage");
    return name === null || name === "" ? null : name;
  }

  /** A receipt still moving: the broker may report a later stage for this line on a later poll. */
  function receiptPending(line) {
    return line.receipt === "delivered" || line.receipt === "picked-up" || line.receipt === "warned";
  }

  /**
   * Where the next poll reads from: past every held line, or from the oldest held line whose receipt
   * is still moving, so the broker's answer carries that line again with its stage as it now stands.
   */
  function talkSince() {
    const pending = talk.lines.find(receiptPending);
    return pending === undefined ? talk.nextSeq : Math.min(talk.nextSeq, pending.seq - 1);
  }

  function talkUrl() {
    if (talk.lineage === null) talk.lineage = talkLineage();
    if (talk.lineage === null) return null;
    return "/web/talk?lineage=" + encodeURIComponent(talk.lineage) + "&since=" + talkSince();
  }

  function talkHref(lineage) {
    const params = planParams();
    return "/talk?lineage=" + encodeURIComponent(lineage) + (params === null ? "" : "&root=" + encodeURIComponent(params.root) + "&path=" + encodeURIComponent(params.path));
  }

  /**
   * Folds one answer into what the page holds and returns the view to draw. An answer for a lineage
   * the page has since left returns null and changes nothing, so the last good view stays. An
   * answer from a different ring than the one drawn, told by its start stamp or by a next sequence
   * number below the one held, means the broker restarted, so the held lines go and the whole ring
   * is read again.
   */
  async function talkAccept(view) {
    if (view.lineage !== talk.lineage) return null;
    const stamp = typeof view.ringStart === "string" ? view.ringStart : null;
    const restarted = stamp !== null && talk.ringStart !== null && stamp !== talk.ringStart;
    if (restarted || (num(view.nextSeq) !== null && view.nextSeq < talk.nextSeq)) {
      const lineage = talk.lineage;
      talk.lines = [];
      talk.nextSeq = 0;
      talk.ringStart = null;
      const whole = await fetchView(talkUrl());
      if (lineage !== talk.lineage) return null;
      return talkAccept(whole);
    }
    // A line already held comes back only when its receipt was still moving, and replaces the held
    // copy; a newer one is appended. Both arrive oldest first, so the held list stays in order.
    const seen = talk.lines.length === 0 ? 0 : talk.lines[talk.lines.length - 1].seq;
    for (const line of list(view.lines)) {
      const seq = num(line.seq);
      if (seq === null) continue;
      const held = talk.lines.findIndex((drawn) => drawn.seq === seq);
      if (held >= 0) talk.lines[held] = line;
      else if (seq > seen) talk.lines.push(line);
    }
    if (talk.lines.length > 200) talk.lines.splice(0, talk.lines.length - 200);
    talk.nextSeq = num(view.nextSeq) ?? talk.nextSeq;
    talk.ringStart = stamp ?? talk.ringStart;
    settlePending(view);
    return view;
  }

  /** The keys of the view's waiting cards: a question by its entry id, a request by its request id. A card with no id has no key, so it is neither drawn nor counted held. */
  function pendingKeys(view) {
    const { questions, permissions } = pendingOf(view);
    return questions
      .filter((entry) => txt(entry.entryId) !== "")
      .map((entry) => "q:" + txt(entry.entryId))
      .concat(permissions.filter((request) => txt(request.requestId) !== "").map((request) => "p:" + txt(request.requestId)));
  }

  /**
   * Decides which waiting cards are drawn, once per fresh reading. The first reading, and the first
   * after a lineage change, draws every card, and so does a reading that follows one holding no
   * waiting card at all. Otherwise a card that arrives is held behind the "more waiting" control until
   * the reader taps it, and a held card stays held when the drawn one leaves, so a button the reader is
   * about to press never moves and never changes to another request's. A card that has gone from the
   * view is forgotten.
   */
  function settlePending(view) {
    const keys = pendingKeys(view);
    const now = new Set(keys);
    for (const key of Array.from(talk.drawn)) if (!now.has(key)) talk.drawn.delete(key);
    if (!talk.seeded || !talk.waiting) for (const key of keys) talk.drawn.add(key);
    talk.waiting = keys.length > 0;
    talk.seeded = true;
  }

  /** Draws every card held behind the control, on the operator's tap. */
  function showHeld() {
    if (lastView === null) return;
    for (const key of pendingKeys(lastView)) talk.drawn.add(key);
    draw(lastView);
  }

  /** The tab's session storage, or null where the browser refuses it (private mode, a blocked store). */
  function tabStorage() {
    try {
      return window.sessionStorage;
    } catch (error) {
      return null;
    }
  }

  /** The key the Needs-me page leaves a Correct draft under, for the talk page to take. */
  const DRAFT_KEY = "channels.talk-draft";
  /** How long a Correct draft waits for the talk page: an older one is dropped unread. */
  const DRAFT_MAX_AGE_MS = 60 * 1000;
  /** The key the Needs-me page keeps the touched asks under. */
  const TOUCHED_KEY = "channels.needs-me.touched";

  /**
   * Takes the draft a Correct press left in this tab's storage into the composer, once: only where
   * it was left for this page's lineage within the last minute, and it is removed whether or not it was used. Nothing in the
   * address supplies a draft. It is only placed in the box: nothing is sent until the operator sends.
   */
  function takeDraft() {
    const store = tabStorage();
    if (store === null) return;
    try {
      const held = store.getItem(DRAFT_KEY);
      if (held === null) return;
      store.removeItem(DRAFT_KEY);
      const left = JSON.parse(held);
      const fresh = left !== null && typeof left === "object" && typeof left.at === "number" && Date.now() - left.at <= DRAFT_MAX_AGE_MS;
      if (fresh && left.lineage === talkLineage() && typeof left.draft === "string") talk.draft = left.draft.slice(0, 4000);
    } catch (error) {
      // A store or a held value that cannot be read leaves the composer empty.
    }
  }

  /** Leaves a draft for the talk page of one lineage, on a Correct press; a store that refuses leaves none. */
  function leaveDraft(lineage, draft) {
    const store = tabStorage();
    if (store === null) return;
    try {
      store.setItem(DRAFT_KEY, JSON.stringify({ lineage, draft, at: Date.now() }));
    } catch (error) {
      // No draft is carried; the talk page opens with an empty composer.
    }
  }

  /** Reads the plan's title and section count once, for the heading card; a failed read leaves the card out. */
  async function loadTalkPlan() {
    const url = planUrl();
    if (url === null) return;
    try {
      const view = await fetchView(url);
      talk.plan = { title: txt(view.title), sections: list(view.sections).length };
      if (lastView !== null) draw(lastView);
    } catch (error) {
      talk.plan = null;
    }
  }

  /** Reads the ring now, off the poll's timer, and draws what came back; an answer the page has left draws nothing. */
  async function refreshTalk() {
    const view = await talkAccept(await fetchView(talkUrl()));
    if (view === null) return;
    draw(view);
    lastView = view;
    lastOk = Date.now();
    notice.hidden = true;
  }

  /** Points the page at another lineage: the drawn lines go, and the whole ring is fetched. */
  async function retarget(lineage) {
    if (lineage === talk.lineage) return;
    talk.lineage = lineage;
    talk.lines = [];
    talk.nextSeq = 0;
    talk.status = null;
    talk.pendingStatus = null;
    talk.drawn = new Set();
    talk.seeded = false;
    talk.waiting = false;
    // A kept id names a file saved for the old lineage's session, so each pick is sent again.
    for (const pick of talk.picked) pick.id = null;
    history.replaceState(null, "", talkHref(lineage));
    try {
      await refreshTalk();
    } catch (error) {
      setNotice("Could not load " + lineage + ": " + (error instanceof Unreadable ? error.message : "the reading could not be drawn") + ".");
    }
  }

  /** Adds the files the picker chose to the line's files, up to `MAX_FILES`, and says so where some did not fit. */
  function pickFiles(chosen) {
    const room = MAX_FILES - talk.picked.length;
    const files = Array.from(chosen);
    for (const file of files.slice(0, Math.max(0, room))) talk.picked.push({ file, name: file.name, size: file.size, id: null });
    talk.status = files.length > room ? "A line carries at most " + MAX_FILES + " files; the rest were left out." : null;
    if (lastView !== null) draw(lastView);
  }

  /**
   * Sends one picked file to the broker for the given lineage's session and answers the id the line
   * names it by. A refusal throws with the operator's words for it.
   */
  async function uploadFile(pick, lineage) {
    const response = await fetch("/web/file?lineage=" + encodeURIComponent(lineage), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Web-File-Name": encodeURIComponent(pick.name) },
      body: pick.file,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (response.status === 413) throw new Unreadable(pick.name + " is larger than this host's file limit");
    if (response.status === 404) throw new Unreadable("no live session took " + pick.name);
    if (!response.ok) throw new Unreadable("the broker answered HTTP " + response.status + " to " + pick.name);
    const answer = await response.json();
    return txt(answer.id);
  }

  /**
   * Posts the typed line, and the files picked for it, to the broker as this operator's word. Each
   * file not yet sent goes up first and keeps the id it came back with on its pick, so a send tried
   * again names the kept ids and uploads only the files that have none. The broker answers what
   * became of the line: a delivered line clears the draft and the files and the ring is read at once
   * so the line draws back; any other answer, a refused file among them, leaves both in place and is
   * said under the composer. An answer that the files belong to no live session clears the kept ids,
   * so the next send uploads them again for the session now live. One send at a time: the `sending`
   * flag refuses a second send while one is out, and the input stays enabled through it, so the caret
   * and a phone's keyboard stay where they were.
   * Focus that fell to the body during the send, as it does when the Send button was tapped, is put
   * back in the composer.
   * The lineage is read once as the send begins, and every upload and the line itself go to it, so
   * a pill tapped while the send is out moves the page and never the line or its files.
   * With `answers`, the line is the typed answer to the question the session is held on: no file
   * rides it, the picks stay for the next line, and an answered line clears the draft as a
   * delivered one does.
   */
  async function sendLine(answers) {
    const answering = answers === true;
    const text = talk.draft.trim();
    const picked = answering ? [] : talk.picked.slice();
    const lineage = talk.lineage;
    if ((text === "" && picked.length === 0) || talk.sending || lineage === null) return;
    talk.sending = true;
    talk.status = "Sending.";
    if (lastView !== null) draw(lastView);
    try {
      for (const pick of picked) if (pick.id === null) pick.id = await uploadFile(pick, lineage);
      const ids = picked.map((pick) => pick.id);
      const response = await fetch("/web/say", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answering ? { lineage, text, answers: true } : { lineage, text, files: ids }),
        signal: AbortSignal.timeout(sayTimeoutMs(ids.length)),
      });
      if (!response.ok) throw new Unreadable("the broker answered HTTP " + response.status);
      const answer = await response.json();
      const status = txt(answer.status);
      if (status === "delivered" || status === "answered") {
        // Only the sent text is cleared. Words typed after it while the send was out are the next
        // draft, without the space that joined them; a draft that no longer starts with the sent
        // text was rewritten mid-send and is left as typed.
        const draft = talk.draft.trimStart();
        if (draft.startsWith(text)) talk.draft = draft.slice(text.length).trimStart();
        // The same for the files: those picked after the send began stay for the next line.
        talk.picked = talk.picked.filter((pick) => picked.indexOf(pick) < 0);
        talk.status = status === "answered" ? "Answered." : "Sent.";
      } else if (status === "unknown-file") {
        // The ids name files saved for a session no longer live; the picks stay for the next send.
        for (const pick of talk.picked) pick.id = null;
        talk.status = SEND_WORDS[status];
      } else {
        talk.status = Object.prototype.hasOwnProperty.call(SEND_WORDS, status) ? SEND_WORDS[status] : "The broker answered " + status + "; nothing was sent.";
      }
      talk.sending = false;
      await refreshTalk();
    } catch (error) {
      talk.status = "Could not send: " + (error instanceof Unreadable ? error.message : "the broker did not answer") + ".";
    } finally {
      talk.sending = false;
      if (lastView !== null) draw(lastView);
      const compose = document.getElementById("talk-compose");
      if (compose !== null && document.activeElement === document.body) compose.focus();
    }
  }

  /**
   * What the broker's answer to a pick, a release or a verdict means, in the operator's words. A
   * status with no entry here is said as the broker wrote it.
   */
  const PENDING_WORDS = {
    answered: "Answered.",
    released: "Released to the console; answer it there.",
    resolved: "Sent.",
    closed: "That has already closed; nothing was changed.",
    unanswerable: "This question can only be answered at the console.",
    "no-session": "No live session; nothing was sent.",
    ended: "That session has ended; nothing was sent.",
    "no-thread": "The session has no Discord thread yet; nothing was sent.",
  };

  /**
   * Posts one pick, release or verdict to the broker and reads the ring again, so the drawn
   * question or prompt shows what the desk now holds. One at a time, as a send is: the `acting`
   * flag refuses a second post while one is out. A select is answered `selected` and says nothing;
   * every other answer is said in the status line under the waiting block. The broker's answer
   * stays the status whatever the read after it does: a read that fails is said in the page's
   * notice, as a failed poll is. An answer that comes back after a pill moved the page to another
   * lineage is about a block no longer drawn, so it is dropped unsaid.
   */
  async function postPending(name, body) {
    const lineage = talk.lineage;
    if (talk.acting || lineage === null) return;
    talk.acting = true;
    if (lastView !== null) draw(lastView);
    try {
      let outcome;
      let answered = false;
      try {
        const response = await fetch("/web/" + name, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ lineage }, body)),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw new Unreadable("the broker answered HTTP " + response.status);
        const answer = await response.json();
        const status = txt(answer.status);
        if (status === "selected") outcome = null;
        else if (status === "incomplete") outcome = "Question " + (num(answer.questionNumber) ?? "") + " still needs a pick; nothing was submitted.";
        else outcome = Object.prototype.hasOwnProperty.call(PENDING_WORDS, status) ? PENDING_WORDS[status] : "The broker answered " + status + ".";
        answered = true;
      } catch (error) {
        outcome = "Could not send: " + (error instanceof Unreadable ? error.message : "the broker did not answer") + ".";
      }
      if (talk.lineage !== lineage) return;
      talk.pendingStatus = outcome;
      if (!answered) return;
      talk.acting = false;
      try {
        await refreshTalk();
      } catch (error) {
        setNotice("Could not refresh: " + (error instanceof Unreadable ? error.message : "the reading could not be drawn") + ". Showing the last reading.");
        return;
      }
      if (talk.lineage !== lineage) return;
      // Where nothing is waiting any longer the block is gone, so its outcome is said under the composer.
      if (lastView !== null && !hasPending(lastView)) {
        if (talk.pendingStatus !== null) talk.status = talk.pendingStatus;
        talk.pendingStatus = null;
      }
    } finally {
      talk.acting = false;
      if (lastView !== null) draw(lastView);
    }
  }

  /** A full-size button for the waiting block, its words set as text. */
  function pendingButton(cls, words, focusKey, onClick) {
    const button = h("button", cls, words);
    button.type = "button";
    button.disabled = talk.acting;
    button.dataset.focusKey = focusKey;
    button.addEventListener("click", onClick);
    return button;
  }

  /**
   * One held ask. Where the thread could answer it, each question's options are buttons that post
   * a pick by position, and Submit posts the whole; a multi-select toggles an option in or out of
   * what is chosen. Where the thread could not, the questions are drawn as text and the console
   * release is the one control, as the thread's own notice offers. The typed composer line answers
   * the whole ask once the thread's alert has landed, as a typed Discord reply does.
   */
  function questionCard(entry) {
    const id = txt(entry.entryId);
    const card = h("div", "ask");
    // Each question keeps its position in the ask, which is what a pick sends as its index.
    list(entry.questions).forEach((question, at) => {
      if (question === null || typeof question !== "object") return;
      const line = h("div", "ask-line");
      line.append(h("span", "ask-tag", "ASK:"), " ");
      if (txt(question.header) !== "") line.append(h("b", null, txt(question.header)), " · ");
      line.append(txt(question.question));
      card.append(line);
      if (entry.answerable !== true) return;
      const options = list(question.options).filter((option) => option !== null && typeof option === "object" && num(option.index) !== null);
      const group = h("div", "ask-options");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", txt(question.question) || "Options");
      const chosen = options.filter((option) => option.chosen === true).map((option) => option.index);
      for (const option of options) {
        const on = option.chosen === true;
        const button = pendingButton("ask-option" + (on ? " on" : ""), null, "ask-" + id + "-" + at + "-" + option.index, () => {
          const picks = question.multiSelect === true ? (on ? chosen.filter((index) => index !== option.index) : chosen.concat([option.index])) : [option.index];
          postPending("question", { entryId: id, action: "select", questionIndex: at, optionIndexes: picks });
        });
        button.setAttribute("aria-pressed", on ? "true" : "false");
        button.append(h("span", "ask-option-label", txt(option.label)));
        if (txt(option.description) !== "") button.append(h("span", "ask-option-desc", txt(option.description)));
        group.append(button);
      }
      card.append(group);
    });
    const controls = h("div", "ask-controls");
    if (entry.answerable === true) {
      controls.append(pendingButton("ask-submit", "Submit", "ask-" + id + "-submit", () => postPending("question", { entryId: id, action: "submit" })));
      if (entry.alerted === true) {
        const typed = pendingButton("ask-typed", "Send typed answer", "ask-" + id + "-typed", () => sendLine(true));
        typed.disabled = talk.acting || talk.sending;
        controls.append(typed);
      }
    }
    controls.append(pendingButton("ask-console", "Answer at console", "ask-" + id + "-console", () => postPending("question", { entryId: id, action: "console" })));
    card.append(controls);
    return card;
  }

  /** One open permission request: its tool, what it says it does and its input as text, and Deny and Allow. */
  function permissionCard(request) {
    const requestId = txt(request.requestId);
    const nonce = txt(request.nonce);
    const card = h("div", "perm");
    const head = h("div", "ask-line");
    head.append(h("span", "ask-tag", "PERMISSION:"), " ", h("b", null, txt(request.toolName)), " · request " + requestId);
    card.append(head);
    if (txt(request.description) !== "") card.append(h("div", "perm-what", txt(request.description)));
    if (txt(request.inputPreview) !== "") card.append(h("pre", "perm-input", txt(request.inputPreview)));
    const controls = h("div", "ask-controls");
    const verdict = (behavior) => () => postPending("permission", { requestId, behavior, nonce });
    controls.append(
      pendingButton("perm-deny", "Deny", "perm-" + requestId + "-deny", verdict("deny")),
      pendingButton("perm-allow", "Allow", "perm-" + requestId + "-allow", verdict("allow")),
    );
    card.append(controls);
    return card;
  }

  /** The view's held questions and open requests, each list holding objects alone. */
  function pendingOf(view) {
    const pending = view.pending !== null && typeof view.pending === "object" ? view.pending : {};
    return {
      questions: list(pending.questions).filter((entry) => entry !== null && typeof entry === "object"),
      permissions: list(pending.permissions).filter((request) => request !== null && typeof request === "object"),
    };
  }

  function hasPending(view) {
    const { questions, permissions } = pendingOf(view);
    return questions.length > 0 || permissions.length > 0;
  }

  /**
   * Whether the session is held on a question a typed line answers: one the thread could answer
   * whose alert has landed. In the Discord thread any operator message then answers it, so the
   * composer's line does too.
   */
  function takesTypedAnswer(view) {
    return pendingOf(view).questions.some((entry) => entry.answerable === true && entry.alerted === true);
  }

  /** What the live session is held on, or nothing where it holds nothing. */
  function pendingSection(view) {
    const { questions, permissions } = pendingOf(view);
    if (questions.length === 0 && permissions.length === 0) return null;
    const card = h("section", "card pad attn waiting");
    card.setAttribute("aria-label", "Waiting on you");
    card.append(label("Waiting on you", "h2"));
    // One slot of fixed height sits above the cards and is always drawn, so a card arriving behind it
    // changes the slot's words and nothing else: no drawn button moves, whether or not the reader is at the foot.
    const held = pendingKeys(view).filter((key) => !talk.drawn.has(key)).length;
    const slot = h("div", "held-slot");
    if (held > 0) {
      const more = h("button", "held-more", held + " more waiting");
      more.type = "button";
      more.dataset.focusKey = "held-more";
      more.addEventListener("click", showHeld);
      slot.append(more);
    } else {
      slot.append(h("span", "meta", "Nothing else waiting"));
    }
    card.append(slot);
    for (const entry of questions) if (talk.drawn.has("q:" + txt(entry.entryId))) card.append(questionCard(entry));
    for (const request of permissions) if (talk.drawn.has("p:" + txt(request.requestId))) card.append(permissionCard(request));
    if (talk.pendingStatus !== null) {
      const status = h("div", "meta send-status", talk.pendingStatus);
      status.setAttribute("role", "status");
      card.append(status);
    }
    return card;
  }

  function talkLabel(line, lineage) {
    const author = txt(line.author);
    if (author !== "") return author;
    if (line.kind === "inbound") return "Operator";
    if (line.kind === "reply" || line.kind === "mirror") return lineage;
    return Object.prototype.hasOwnProperty.call(KIND_WORDS, line.kind) ? KIND_WORDS[line.kind] : txt(line.kind);
  }

  function talkLine(line, lineage, now) {
    const mine = line.kind === "inbound" && line.senderClass === "operator";
    const box = h("div", "msg" + (mine ? " mine" : ""));
    const at = num(line.at);
    const head = h("div", "msg-head");
    const who = talkLabel(line, lineage);
    head.append(h("b", null, who), at === null ? "" : " · " + dayClock(at, now));
    if (line.senderClass === "participant") head.append(" · participant");
    if (Object.prototype.hasOwnProperty.call(KIND_WORDS, line.kind) && KIND_WORDS[line.kind] !== who) head.append(" · " + KIND_WORDS[line.kind]);
    if (Object.prototype.hasOwnProperty.call(RECEIPT_WORDS, line.receipt)) head.append(" · " + RECEIPT_WORDS[line.receipt]);
    box.append(head);
    const files = list(line.files).filter((file) => file !== null && typeof file === "object");
    // A line of files alone draws no empty bubble above them.
    if (txt(line.text) !== "" || files.length === 0) box.append(h("div", "bubble", txt(line.text)));
    if (files.length > 0) {
      const held = h("div", "line-files");
      for (const file of files) held.append(fileLink(file));
      box.append(held);
    }
    return box;
  }

  /**
   * One file a line carries: a download link where the view's url is the broker's download path with
   * an id of the store's shape, its href rebuilt from that id alone, and the name as text otherwise.
   */
  function fileLink(file) {
    const name = txt(file.name) || "file";
    const size = num(file.size);
    const words = size === null ? name : name + " · " + byteSize(size);
    const match = FILE_URL.exec(txt(file.url));
    if (match === null) return h("span", "file-link", words);
    const anchor = link("file-link", "/web/file/" + match[1], words);
    anchor.setAttribute("download", name);
    anchor.setAttribute("aria-label", "Download " + words);
    return anchor;
  }

  function renderTalk(view) {
    const out = document.createDocumentFragment();
    const now = num(parse(view.asOf)) ?? Date.now();
    const lineage = txt(view.lineage);
    const params = planParams();

    const top = h("div", "top");
    top.append(params === null ? back("/", "Standup") : back(planHref(params.root, params.path), talk.plan ? talk.plan.title || "Plan" : "Plan"));
    const row = h("div", "top-row");
    row.append(h("h1", null, lineage));
    top.append(row);
    out.append(top);

    if (talk.plan !== null) {
      const card = h("section", "card pad");
      card.setAttribute("aria-label", "Talking about");
      const head = h("div", "section-head");
      head.append(label("Talking about", "h2"));
      if (params !== null) head.append(link("tall", planHref(params.root, params.path), "Plan"));
      card.append(head);
      const what = h("div", "talk-about");
      what.append(h("b", null, talk.plan.title));
      if (talk.plan.sections > 0) what.append(" · " + talk.plan.sections + (talk.plan.sections === 1 ? " section" : " sections"));
      card.append(what);
      out.append(card);
    }

    const names = list(view.lineages).filter((name) => typeof name === "string");
    if (names.length > 0) {
      const pills = h("div", "chips");
      pills.setAttribute("role", "group");
      pills.setAttribute("aria-label", "Sessions to talk with");
      for (const name of names) {
        const pill = h("button", name === lineage ? "chip on" : "chip", name);
        pill.type = "button";
        pill.setAttribute("aria-pressed", name === lineage ? "true" : "false");
        pill.dataset.focusKey = "pill-" + name;
        pill.addEventListener("click", () => retarget(name));
        pills.append(pill);
      }
      out.append(pills);
    }

    const session = view.session;
    const thread = session && typeof session.threadLink === "string" && session.threadLink.indexOf(DISCORD_PREFIX) === 0 ? session.threadLink : null;
    const earlier = h("div", "talk-earlier");
    earlier.append(session ? "Earlier lines are in Discord." : "No live session for " + lineage + ". Earlier lines are in Discord.");
    if (thread !== null) earlier.append(" ", link("", thread, "Open the thread"));
    out.append(earlier);

    const lines = talk.lines;
    const transcript = h("section", "transcript");
    transcript.setAttribute("aria-label", "Conversation");
    if (lines.length === 0) transcript.append(h("div", "muted talk-empty", "No lines yet."));
    for (const line of lines) transcript.append(talkLine(line, lineage, now));
    out.append(transcript);

    const newest = lines.length === 0 ? null : num(lines[lines.length - 1].at);
    out.append(h("div", "note", (newest === null ? "no lines yet" : "newest line " + dayClock(newest, now)) + " · as of " + dayClock(now, now)));

    // What the session is held on, between the conversation and the composer, so the composer's
    // typed line sits under the question it can answer.
    const waiting = pendingSection(view);
    if (waiting !== null) out.append(waiting);

    // The composer. The draft lives in `talk.draft`, so a poll's redraw puts the typed text back,
    // and the input's focus key puts the caret back in it. While a question waits on a typed answer,
    // Enter and Send post the line as that answer, as a message in the Discord thread would be.
    const answering = takesTypedAnswer(view);
    const composer = h("div", "composer");
    const field = h("div", "composer-row");
    const input = h("input", "compose-input");
    input.type = "text";
    input.id = "talk-compose";
    input.maxLength = 4000;
    input.autocomplete = "off";
    input.enterKeyHint = "send";
    input.placeholder = "Message " + lineage;
    input.value = talk.draft;
    input.dataset.focusKey = "talk-compose";
    input.addEventListener("input", () => {
      talk.draft = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendLine(answering);
      }
    });
    const send = h("button", "send");
    send.type = "button";
    send.disabled = talk.sending;
    send.setAttribute("aria-label", "Send");
    send.textContent = "Send";
    send.dataset.focusKey = "talk-send";
    send.addEventListener("click", () => sendLine(answering));
    const compose = h("label", "sr", "Message to " + lineage);
    compose.htmlFor = "talk-compose";
    // The picker is the browser's own file input, kept out of sight; the Attach button opens it, so
    // the control the operator taps is a full-size button and the input's own drawing never shows.
    const picker = h("input", null);
    picker.type = "file";
    picker.multiple = true;
    picker.hidden = true;
    picker.id = "talk-file";
    picker.addEventListener("change", () => pickFiles(picker.files));
    const attach = h("button", "attach", "Attach");
    attach.type = "button";
    attach.disabled = talk.sending || talk.picked.length >= MAX_FILES;
    attach.setAttribute("aria-label", "Attach files");
    attach.dataset.focusKey = "talk-attach";
    attach.addEventListener("click", () => picker.click());
    field.append(compose, picker, attach, input, send);
    if (talk.picked.length > 0) {
      const chips = h("div", "file-chips");
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", "Files to send");
      talk.picked.forEach((pick, index) => {
        const chip = h("div", "file-chip");
        chip.append(h("span", "file-chip-name", pick.name + " · " + byteSize(pick.size)));
        const remove = h("button", "file-chip-remove", "×");
        remove.type = "button";
        remove.disabled = talk.sending;
        remove.setAttribute("aria-label", "Remove " + pick.name);
        remove.dataset.focusKey = "talk-remove-" + index;
        remove.addEventListener("click", () => {
          talk.picked = talk.picked.filter((held) => held !== pick);
          if (lastView !== null) draw(lastView);
        });
        chip.append(remove);
        chips.append(chip);
      });
      composer.append(chips);
    }
    const caption = h("div", "meta", "Your words and files land as the operator's, with the same standing as a Discord reply, and are posted into the thread where Discord accepts them.");
    if (answering) composer.append(field, h("div", "meta compose-answers", "A question is waiting: what you send here answers it, and picked files go with the next line."), caption);
    else composer.append(field, caption);
    if (talk.status !== null) {
      const status = h("div", "meta send-status", talk.status);
      status.setAttribute("role", "status");
      composer.append(status);
    }
    out.append(composer);
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Needs-me page
  // ---------------------------------------------------------------------------------------------

  /** The three orders the items can be read in; the groups stay in their places and the items move within them. */
  const SORTS = [
    { id: "kind", words: "By kind" },
    { id: "age", words: "By age" },
    { id: "blocking", words: "Blocking first" },
  ];

  /** What the broker's answer to an Agree means, in the operator's words. */
  const AGREE_WORDS = {
    delivered: "agreed, sent to the session",
    "no-session": "no live session, ask left open",
    ended: "that session has ended, ask left open",
    "no-thread": "the session has no Discord thread yet, ask left open",
    "no-channel": "the session is not connected to the broker, ask left open",
    rate: "too many lines in the last minute, ask left open",
    closed: "already closed",
    "already-agreed": "already agreed",
    "no-recommendation": "no recommendation to agree to",
    changed: "the recommendation changed since you read it, read it again",
    "refused: blocking": "refused: blocking, answer this one yourself",
  };

  /** The most items one batch carries where the view names no cap; the view's `maxBatch` is the broker's own bound. */
  const DEFAULT_MAX_BATCH = 64;

  /** The batch cap the needs-me view carries, or the default where it is absent. */
  function batchCap(view) {
    const cap = num(view.maxBatch);
    return cap !== null && cap >= 1 ? Math.floor(cap) : DEFAULT_MAX_BATCH;
  }

  /**
   * What the Needs-me page holds between polls: the order chosen, the asks the operator pressed Agree
   * or Correct on in this tab, kept in its session storage (the batch leaves these alone), the words beside each ask
   * from its last Agree, and whether an Agree is out.
   */
  const needsMe = { sort: "kind", touched: loadTouched(), statuses: new Map(), acting: false };

  /** The asks touched so far in this tab, read from its session storage; an unreadable store gives an empty set. */
  function loadTouched() {
    const store = tabStorage();
    if (store === null) return new Set();
    try {
      const held = JSON.parse(store.getItem(TOUCHED_KEY) ?? "[]");
      return new Set(Array.isArray(held) ? held.filter((key) => typeof key === "string") : []);
    } catch (error) {
      return new Set();
    }
  }

  /** Marks an ask touched, in memory and in the tab's session storage so a trip to another page keeps it; a store that refuses keeps the memory alone. */
  function touch(key) {
    needsMe.touched.add(key);
    const store = tabStorage();
    if (store === null) return;
    try {
      store.setItem(TOUCHED_KEY, JSON.stringify(Array.from(needsMe.touched)));
    } catch (error) {
      // The set in memory stands for this page's life.
    }
  }

  /** The key an ask is held under: its lineage and its id, since ids are the ledger's per persona. */
  function needsKey(item) {
    return JSON.stringify([item.repo, item.askId]);
  }

  function agreeWords(status) {
    return Object.prototype.hasOwnProperty.call(AGREE_WORDS, status) ? AGREE_WORDS[status] : "the broker answered " + status + ", ask left open";
  }

  /** The items of one group, each an object. */
  function groupItems(view, name) {
    const groups = view.groups !== null && typeof view.groups === "object" ? view.groups : {};
    return list(groups[name]).filter((item) => item !== null && typeof item === "object");
  }

  /**
   * The group's items in the chosen order. By kind and by age are both oldest first with undated items
   * last, so an ask that arrives on a poll lands after those drawn and none moves down under a tap;
   * blocking first keeps age within each half.
   */
  function sortedItems(items) {
    const indexed = items.map((item, index) => ({ item, index }));
    const byAge = (a, b) => {
      const x = parse(a.item.openedAt);
      const y = parse(b.item.openedAt);
      if (x !== y) {
        if (x === null) return 1;
        if (y === null) return -1;
        return x - y;
      }
      return a.index - b.index;
    };
    if (needsMe.sort === "age" || needsMe.sort === "kind") indexed.sort(byAge);
    else if (needsMe.sort === "blocking") indexed.sort((a, b) => (b.item.blocking === true) - (a.item.blocking === true) || byAge(a, b));
    return indexed.map((one) => one.item);
  }

  /** An ask the broker can agree to: it names its lineage and id, and carries a recommendation. */
  function agreeable(item) {
    return item.kind === "ask" && txt(item.repo) !== "" && txt(item.askId) !== "" && txt(item.recommend).trim() !== "";
  }

  /** Posts to an Agree route and answers its JSON; a refusal or a broken answer throws with the words for it. */
  async function postAgree(name, body, timeoutMs) {
    let response;
    try {
      response = await fetch("/web/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
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

  /** Draws the page again from the last reading, so a status or a touch shows at once. */
  function redrawNeeds() {
    if (lastView !== null) draw(lastView);
  }

  /**
   * Fetches the reading again and draws it, so an ask whose recommendation changed, or a rollout just marked, shows the new
   * text now rather than on the next poll; a fetch that fails draws the last reading instead.
   */
  async function refreshView() {
    try {
      const view = await fetchView(page.url());
      lastView = view;
      lastOk = Date.now();
      draw(view);
    } catch (error) {
      redrawNeeds();
    }
  }

  /** The body an Agree sends: the ask, its lineage and the recommendation this page drew, which the broker matches before it delivers. */
  function agreeBody(item) {
    return { askId: item.askId, repo: item.repo, recommend: txt(item.recommend) };
  }

  /** The words beside an ask whose Agree could not be confirmed: the broker may or may not have sent it. */
  function unconfirmed(error) {
    return (error instanceof Unreadable ? error.message : "no answer") + ", so the Agree is not confirmed";
  }

  /** Agrees to one ask. One Agree at a time: the `acting` flag refuses a second while one is out. */
  async function sendAgree(item) {
    if (needsMe.acting) return;
    const key = needsKey(item);
    touch(key);
    needsMe.acting = true;
    needsMe.statuses.set(key, "sending");
    redrawNeeds();
    let changed = false;
    try {
      const answer = await postAgree("agree", agreeBody(item), TIMEOUT_MS);
      changed = txt(answer.status) === "changed";
      needsMe.statuses.set(key, agreeWords(txt(answer.status)));
    } catch (error) {
      needsMe.statuses.set(key, unconfirmed(error));
    } finally {
      needsMe.acting = false;
      if (changed) await refreshView();
      else redrawNeeds();
    }
  }

  /** Agrees to the untouched asks in the order drawn, the first `cap`, and shows the broker's word beside each. */
  async function sendBatch(items, cap) {
    const sent = items.slice(0, cap);
    if (needsMe.acting || sent.length === 0) return;
    for (const item of sent) {
      touch(needsKey(item));
      needsMe.statuses.set(needsKey(item), "sending");
    }
    needsMe.acting = true;
    redrawNeeds();
    let changed = false;
    try {
      const answer = await postAgree("agree-batch", { items: sent.map(agreeBody) }, batchTimeoutMs(sent.length));
      const results = list(answer.results);
      sent.forEach((item, at) => {
        const result = results[at];
        const status = result !== null && typeof result === "object" ? txt(result.status) : null;
        if (status === "changed") changed = true;
        needsMe.statuses.set(needsKey(item), status !== null ? agreeWords(status) : "no answer for this one, so the Agree is not confirmed");
      });
    } catch (error) {
      for (const item of sent) needsMe.statuses.set(needsKey(item), unconfirmed(error));
    } finally {
      needsMe.acting = false;
      if (changed) await refreshView();
      else redrawNeeds();
    }
  }

  /** The page the Correct link opens: the asking session's talk page. The press leaves the draft in the tab's storage. */
  function correctHref(item) {
    return "/talk?lineage=" + encodeURIComponent(item.repo);
  }

  /** One item: who and how long, what it says, what is recommended, and for an ask Agree and Correct with the broker's last word. */
  function needsItem(item, now) {
    const box = h("div", "nm-item");
    const head = h("div", "nm-head");
    const who = h("span", "nm-who", item.repo ? txt(item.repo) : "Hands");
    const opened = parse(item.openedAt);
    if (item.kind === "blocked") who.append(" ", h("span", "tag", "blocked"));
    else if (item.kind === "ask" && item.blocking === true) who.append(" ", h("span", "tag", "blocking"));
    head.append(who, h("span", "nm-age", opened === null ? "" : span(now - opened)));
    box.append(head, h("div", "nm-text", txt(item.text)));
    if (txt(item.recommend) !== "") box.append(h("div", "rec", "Recommends: " + txt(item.recommend)));
    if (item.kind !== "ask" || txt(item.repo) === "") return box;

    const key = needsKey(item);
    const controls = h("div", "nm-controls");
    if (agreeable(item)) {
      const agreeButton = h("button", "nm-agree", "Agree");
      agreeButton.type = "button";
      agreeButton.disabled = needsMe.acting;
      agreeButton.dataset.focusKey = "agree|" + key;
      agreeButton.addEventListener("click", () => sendAgree(item));
      controls.append(agreeButton);
    }
    const correct = link("nm-correct", correctHref(item), "Correct");
    correct.dataset.focusKey = "correct|" + key;
    // The press is what makes the ask touched; the link itself opens the talk page.
    correct.addEventListener("click", () => {
      touch(key);
      leaveDraft(item.repo, 'Correction on "' + txt(item.text) + '": ');
    });
    controls.append(correct);
    if (txt(item.recommend).trim() === "") controls.append(h("span", "meta", "no recommendation to agree to"));
    box.append(controls);
    const words = needsMe.statuses.get(key);
    if (words !== undefined) {
      const status = h("div", "meta nm-status", words);
      status.setAttribute("role", "status");
      box.append(status);
    }
    return box;
  }

  /** One group: its label with a count and an optional note, then its items in the chosen order, or a line saying there are none. */
  function needsGroup(view, name, words, note, now, attn) {
    const items = sortedItems(groupItems(view, name));
    const section = h("section", "section");
    section.setAttribute("aria-label", words);
    const head = h("div", "section-head");
    head.append(label(words + " · " + items.length, "h2"));
    if (note) head.append(h("div", "meta", note));
    section.append(head);
    const card = h("div", attn && items.length > 0 ? "card attn" : "card");
    if (items.length === 0) card.append(h("div", "nm-none", "Nothing here."));
    for (const item of items) card.append(needsItem(item, now));
    section.append(card);
    return section;
  }

  function renderNeedsMe(view) {
    const out = h("div", "nm");
    const now = nowOf(view);
    const all = ["blocked", "ask", "hands"].flatMap((name) => groupItems(view, name));
    const dated = all.map((item) => parse(item.openedAt)).filter((at) => at !== null);

    const top = h("div", "top");
    top.append(back("/", txt(view.sandbox) || "Standup"));
    const row = h("div", "top-row");
    const title = h("h1", null, "Needs me");
    title.append(h("span", "nm-count", " · " + all.length));
    row.append(title, stamp(view));
    top.append(row);
    if (dated.length > 0) top.append(h("p", "sub", "oldest " + span(now - Math.min.apply(null, dated))));
    out.append(top);

    const sorts = h("div", "nm-sort");
    sorts.setAttribute("role", "group");
    sorts.setAttribute("aria-label", "Order");
    for (const sort of SORTS) {
      const button = h("button", sort.id === needsMe.sort ? "nm-sort-button on" : "nm-sort-button", sort.words);
      button.type = "button";
      button.setAttribute("aria-pressed", sort.id === needsMe.sort ? "true" : "false");
      button.dataset.focusKey = "sort|" + sort.id;
      button.addEventListener("click", () => {
        needsMe.sort = sort.id;
        redrawNeeds();
      });
      sorts.append(button);
    }
    out.append(sorts);

    const rolloutNeeds = rolloutGroup(view);
    out.append(
      needsGroup(view, "blocked", "Blocked on you", null, now, true),
      needsGroup(view, "ask", "Asks", "each proceeds on its recommendation", now, false),
      ...(rolloutNeeds === null ? [] : [rolloutNeeds]),
      needsGroup(view, "hands", "Your hands", null, now, false),
      sources(view, ["roster", "queues", "ledger", "events", "registry", "usage", "rollout"]),
    );

    // The batch is over the asks in the order drawn that the operator has not touched.
    const untouched = sortedItems(groupItems(view, "ask")).filter((item) => agreeable(item) && !needsMe.touched.has(needsKey(item)));
    const bar = h("div", "nm-batch");
    const batch = h("button", "nm-batch-button");
    batch.type = "button";
    batch.disabled = needsMe.acting || untouched.length === 0;
    batch.dataset.focusKey = "batch";
    const cap = batchCap(view);
    const count = Math.min(untouched.length, cap);
    const blocking = untouched.slice(0, count).filter((item) => item.blocking === true).length;
    batch.textContent =
      untouched.length === 0
        ? "No untouched recommendations to agree with"
        : (untouched.length > cap ? "Agree with " + count + " of the " + untouched.length : "Agree with the " + count) +
          (count === 1 && untouched.length <= cap ? " recommendation" : " recommendations") +
          " I haven't touched" +
          (blocking > 0 ? " (" + blocking + " blocking, which " + (blocking === 1 ? "is" : "are") + " refused)" : "");
    batch.addEventListener("click", () => sendBatch(untouched, cap));
    bar.append(batch, h("div", "meta nm-batch-note", "Each lands as your word with the time. A blocking ask is refused and stays open for you."));
    out.append(bar);
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
    // A page that follows its newest content stays at the foot when the reader was there, and starts there.
    const follow = page.follow === true && (lastView === null || window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80);
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
    if (follow) window.scrollTo(0, document.documentElement.scrollHeight);
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

  /** A line being typed in the composer: a redraw would move the caret to its end mid-word. */
  function composing() {
    const active = document.activeElement;
    return active !== null && active.id === "talk-compose" && active.value !== "";
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

  async function poll() {
    let failure = null;
    try {
      const view = await fetchView(page.url());
      try {
        const selection = selected();
        let shown = view;
        if ((selection === null && !composing()) || heldPolls >= HOLD_POLLS) {
          if (page.accept) shown = await page.accept(view);
          if (shown === null) {
            // An answer the page has moved past: nothing is drawn and the last good view stays.
            setTimeout(poll, POLL_MS);
            return;
          }
          draw(shown);
          heldPolls = 0;
          sendSeen();
        } else {
          // A selection, or a line being typed, holds the page still for a few polls, so it can be copied or
          // finished. The stamp and the reading's age stay with what is drawn, so nothing on the page claims a
          // newer reading than it shows.
          heldPolls += 1;
        }
        if (heldPolls === 0) {
          lastView = shown;
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
    setTimeout(poll, POLL_MS);
  }

  function start() {
    if (page === undefined) return;
    const url = page.url();
    if (url === null) {
      const empty = { plan: "Open a plan from a repo page.", talk: "No session named in the address." };
      app.replaceChildren(h("p", "muted", empty[document.body.dataset.page] ?? "No repo named in the address."));
      return;
    }
    if (document.body.dataset.page === "talk") {
      takeDraft();
      loadTalkPlan();
    }
    poll();
  }

  start();
})();
