// The web surface's one script, loaded by the shell page after markdown.js, whose renderer it
// calls. The shell reads which screen to draw from the address, through the route table below,
// fetches that screen's view, the siblings reading and the summary from the broker every five
// seconds, builds the rail and the screen as a tree of nodes and patches the live tree from it, so
// a node whose key persists keeps its scroll, its selection, its focus and the words typed in it
// across every refresh. A link to another screen moves the address with `history.pushState` and
// draws that screen here, with no page load, and the back button returns through `popstate`.
// The page holds no state the broker does not, apart from which session list is expanded.
//
// Render rule: every string in a view was written by a session or a person and is hostile to the
// page. View text goes in through `textContent`, `append` of a string, or the text nodes
// `markdown.js`'s renderer builds inside its fixed elements, never as markup, and a link is fixed
// route text plus `encodeURIComponent` of a view value. Nothing here builds HTML, and the patch
// copies text nodes and attribute values from the built tree to the live one, never markup.
"use strict";

(function () {
  const POLL_MS = 5000;
  const TIMEOUT_MS = 8000;
  /** How long one thread post carrying a file may take at the broker, on top of the base wait. */
  const FILE_POST_MS = 30000;

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
    today: { render: renderToday, url: () => "/web/today" },
    standup: { render: renderStandupScreen, url: () => "/web/standup", accept: standupAccept },
    repo: { render: renderRepoScreen, url: repoUrl },
    plan: { render: renderPlanScreen, url: planUrl, accept: planAccept },
    health: { render: renderHealth, url: () => "/web/health" },
    ask: { render: renderAsk, url: askUrl, gone: askGone },
    talk: { render: renderTalkScreen, url: talkUrl, accept: talkAccept, follow: true },
    workers: { render: renderWorkers, url: () => "/web/workers" },
    changelog: { render: renderChangelog, url: changelogUrl },
  };

  // ---------------------------------------------------------------------------------------------
  // The route table: the screen each path opens, and the query keys each screen reads
  // ---------------------------------------------------------------------------------------------

  /** The fixed path of each screen, the paths the broker serves the shell on; the repo screen is `REPO_PREFIX` plus the name. */
  const SCREEN_PATHS = { today: "/today", standup: "/repos", ask: "/ask", plan: "/plan", health: "/health", talk: "/talk", workers: "/workers", changelog: "/changelog" };
  const REPO_PREFIX = "/repo/";

  /**
   * The other paths that open a screen: the root opens Today, and so does the former Needs me path, so
   * a link into the old inbox lands on Today. Each reads its screen's query keys, so such a link keeps
   * its `item` and loses any key Today does not read, its `chip` among them.
   */
  const PATH_ALIASES = { "/": "today", "/needs-me": "today" };

  /** The query keys each screen reads, in the order a path the shell builds carries them; a key off the list is dropped. */
  const SCREEN_KEYS = { today: ["item"], standup: [], ask: ["repo", "id"], plan: ["root", "path", "repo", "branch"], health: [], talk: ["lineage", "root", "path"], repo: [], workers: ["name"], changelog: ["repo"] };

  /** The list row a query selects: the Today screen's `item`, or the Workers screen's `name`, the persona's; null where it names none. */
  function selectedOf(query) {
    if (typeof query.item === "string") return query.item;
    return typeof query.name === "string" ? query.name : null;
  }

  /**
   * The screen and query an address names, or null for a path the shell has no screen for. `where`
   * is a Location or an anchor, read for its `pathname` and `search` alone. `name` is the repo
   * screen's repo, decoded, or null on any other screen; a repo path whose encoding is broken names
   * no screen. `query` holds the screen's own keys and no other, and `item` is the list row the
   * query selects, by its key, or null.
   */
  function routeOf(where) {
    if (!isObject(where)) return null;
    const pathname = txt(where.pathname);
    let screen = null;
    let name = null;
    if (pathname.indexOf(REPO_PREFIX) === 0 && pathname.length > REPO_PREFIX.length) {
      screen = "repo";
      try {
        name = decodeURIComponent(pathname.slice(REPO_PREFIX.length).replace(/\/+$/, ""));
      } catch (error) {
        return null;
      }
    } else {
      for (const known of Object.keys(SCREEN_PATHS)) if (SCREEN_PATHS[known] === pathname) screen = known;
      if (screen === null && Object.prototype.hasOwnProperty.call(PATH_ALIASES, pathname)) screen = PATH_ALIASES[pathname];
    }
    if (screen === null) return null;
    const search = new URLSearchParams(txt(where.search));
    const query = {};
    for (const key of SCREEN_KEYS[screen]) {
      const value = search.get(key);
      if (value !== null) query[key] = value;
    }
    return { screen, name, query, item: selectedOf(query) };
  }

  /**
   * The path of a route, built from the table and the route's own keys alone: the screen's fixed
   * path, or the repo prefix and the encoded name, then the query keys the screen reads, each
   * encoded. This is the only text `history.pushState` and `history.replaceState` take, so nothing
   * a reading carries can move the address anywhere but the screens the shell has.
   */
  function pathOf(at) {
    const base = at.screen === "repo" ? REPO_PREFIX + encodeURIComponent(txt(at.name)) : SCREEN_PATHS[at.screen];
    const pairs = SCREEN_KEYS[at.screen]
      .filter((key) => typeof at.query[key] === "string")
      .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(at.query[key]));
    return pairs.length === 0 ? base : base + "?" + pairs.join("&");
  }

  /** The route to a screen with no repo name, in the shape `routeOf` reads from an address: its query, and the row the query selects or null. */
  function routeTo(screen, query) {
    return { screen, name: null, query, item: selectedOf(query) };
  }
  /**
   * The path of a route with no list row selected, by `item` or by a worker's `name`, which tells one
   * screen's reading from another's: a selected row is a row of the reading already held.
   */
  function placeOf(at) {
    const query = Object.assign({}, at.query);
    delete query.item;
    delete query.name;
    return pathOf({ screen: at.screen, name: at.name, query });
  }

  // ---------------------------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------------------------

  /**
   * An element with fixed classes and, when given, text set as text and a key written as its
   * `data-key`. The patch pairs a built element with the live one of the same key among its
   * siblings, so a list row's key is the item's identity and a static part's is the name its
   * builder gives it; an element with no key pairs by position with a live one of its tag.
   */
  function h(tag, cls, text, key) {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text !== undefined && text !== null) element.textContent = text;
    if (typeof key === "string") element.dataset.key = key;
    return element;
  }

  /**
   * An element with fixed classes holding a persona's text drawn as markdown blocks, through
   * `markdown.js`'s renderer over `document`, so every byte of the text reaches the page as a text
   * node and never as markup.
   */
  function md(tag, cls, text, key) {
    const element = h(tag, cls, null, key);
    element.append(...window.markdownBlocks(txt(text), document));
    return element;
  }

  /**
   * An element holding text the clock moves while the data stands still, an age or a read time,
   * marked `data-clock` so the patch updates its text without flagging it changed. Every such text
   * sits alone in one of these, apart from the data words around it.
   */
  function clockText(tag, cls, text, key) {
    const element = h(tag, cls, text, key);
    element.dataset.clock = "";
    return element;
  }

  /** A link to a fixed route; the caller builds `href` from route text and encoded values only. */
  function link(cls, href, text, key) {
    const anchor = h("a", cls, text, key);
    anchor.href = href;
    return anchor;
  }

  /** The handlers each built node was given, by node, so a kept live node can take its fresh twin's. */
  const handlers = new WeakMap();

  /**
   * Binds a handler to a built node and records it. A handler closes over the view it was built
   * from, so when the patch keeps a live node it drops the handlers that node was built with and
   * binds the ones its fresh twin carries; a handler reads the node it fires on from the event,
   * never from the variable it was built beside, which names the fresh twin.
   */
  function listen(node, type, handler) {
    node.addEventListener(type, handler);
    const held = handlers.get(node);
    if (held === undefined) handlers.set(node, [[type, handler]]);
    else held.push([type, handler]);
  }

  function repoHref(name) {
    return "/repo/" + encodeURIComponent(name);
  }

  /** A plan's address through the route table, carrying `repo`, the repo whose plans its list pane holds, where it is not empty. */
  function planHref(root, path, repo) {
    const query = { root, path };
    if (repo !== "") query.repo = repo;
    return pathOf({ screen: "plan", name: null, query });
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
    box.append(clockText("span", null, times.length > 0 ? "as of " + dayClock(Math.min.apply(null, times), now) : "no reading yet"));
    for (const name of list(view.held)) {
      const at = parse(asOf[name]);
      const line = h("span", "held", at === null ? txt(name) + ": no reading yet" : txt(name) + " held ");
      if (at !== null) line.append(clockText("span", null, span(now - at)));
      box.append(" ", line);
    }
    return box;
  }

  /**
   * The line of per-source read times that ends a page. `unreadRollout` set draws a rollout source
   * neither read nor held as having no reading yet, for a screen whose only source it is.
   */
  function sources(view, names, unreadRollout) {
    const asOf = view && view.asOf ? view.asOf : {};
    // A rollout source neither read nor held draws nothing: a host with no git renders as it did before the source.
    const shown = names.filter((name) => name !== "rollout" || unreadRollout === true || parse(asOf[name]) !== null || list(view && view.held).includes(name));
    const note = h("div", "note");
    shown.forEach((name, index) => {
      const at = parse(asOf[name]);
      if (index > 0) note.append(" · ");
      if (at === null) note.append(name + " no reading yet");
      else note.append(name + " read ", clockText("span", null, clock(at)));
    });
    return note;
  }

  function back(href, label) {
    return link("back", href, "‹ " + label);
  }

  function label(text, tag) {
    return h(tag || "h2", "label", text);
  }

  /**
   * A section's header on the overview, Today, worker, plan and ask pages: the name, then " · " and the
   * count where one is given, as one small uppercase heading in a row with a rule beneath. A node the
   * caller appends after the heading sits at the row's right. The health page keeps `label`.
   */
  function cardHead(text, count, tag, id) {
    const head = h("div", "card-h");
    const title = h(tag || "h2", "card-h-title", count === null || count === undefined ? text : text + " · " + count);
    if (id) title.id = id;
    head.append(title);
    return head;
  }

  /**
   * A recommendation on its own line: "Recommends" in the header's label style, then the text beside it,
   * set as text. A hidden ": " between the two keeps the read-aloud and copied form "Recommends: <text>".
   */
  function recRow(text) {
    const row = h("div", "rec");
    row.append(h("span", "rec-label", "Recommends"), h("span", "sr", ": "), h("span", "rec-text", text));
    return row;
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

  /**
   * The Steer composer's state, kept across redraws: whether it is open, the line being typed, whether
   * a post is out, and the one line the last answer left on the card.
   */
  const steer = { open: false, draft: "", sending: false, status: null };

  /** Opens or closes the composer. Closing drops the draft and the status line; opening puts the caret in the line. */
  function toggleSteer() {
    steer.open = !steer.open;
    if (!steer.open) {
      steer.draft = "";
      steer.status = null;
    }
    redrawNeeds();
    if (steer.open) {
      const input = document.getElementById("steer-text");
      if (input !== null) input.focus();
    }
  }

  /**
   * Posts the typed line as the ledger's next item. One post at a time: the line and Send are disabled
   * while it is out. On 200 the composer closes and the page reads its view again, so the card draws
   * the new heading now rather than on the next poll; any other answer, or none, leaves the line in
   * place with one status line under it naming what the broker said.
   */
  async function sendSteer() {
    if (steer.sending) return;
    const text = steer.draft.trim();
    if (text === "") {
      steer.status = "Type a line first.";
      redrawNeeds();
      return;
    }
    // Read before the redraw below disables the line, since a disabled line drops the focus it held.
    const held = document.getElementById("steer-composer") !== null && document.getElementById("steer-composer").contains(document.activeElement);
    steer.sending = true;
    steer.status = null;
    redrawNeeds();
    let response = null;
    try {
      response = await fetch("/web/steer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      steer.status = "The broker could not be reached, so the line is not confirmed.";
    }
    steer.sending = false;
    const sent = response !== null && response.status === 200;
    if (sent) {
      steer.open = false;
      steer.draft = "";
      steer.status = null;
    } else if (response !== null) {
      steer.status = response.status === 400
        ? "Steer refused the line: keep it to 200 characters, with no tab or line break."
        : "Steer failed: the broker answered HTTP " + response.status + ".";
    }
    redrawNeeds();
    if (sent) {
      // The composer is gone with the focus it held, so focus returns to the button that opened it.
      const button = held ? app.querySelector('[data-key="steer"]') : null;
      if (button !== null) button.focus();
      await refreshView();
    } else if (held) {
      // The line was kept with the broker's answer under it, so focus returns to it for another try.
      const input = document.getElementById("steer-text");
      if (input !== null) input.focus();
    }
  }

  /** The one-line composer the Steer button opens: a labelled line, Send, and the status line where there is one. */
  function steerComposer() {
    // Keyed, so the line above it that the ledger's date draws never takes the composer's place, and its field, by position.
    const box = h("div", "steer-composer", null, "steer-composer");
    box.id = "steer-composer";
    const row = h("div", "steer-row");
    const caption = h("label", "sr", "Your direction, one line");
    caption.htmlFor = "steer-text";
    const input = h("input", "compose-input");
    input.type = "text";
    input.id = "steer-text";
    // The broker's 400 status enforces the 200 code-point rule; this cap, two code units per code point, only stops runaway typing.
    input.maxLength = 400;
    input.autocomplete = "off";
    input.enterKeyHint = "send";
    input.placeholder = "One line of direction";
    input.value = steer.draft;
    input.disabled = steer.sending;
    input.dataset.key = "steer-text";
    listen(input, "input", (event) => {
      steer.draft = event.currentTarget.value;
    });
    listen(input, "keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        sendSteer();
      }
    });
    const send = h("button", "send", "Send");
    send.type = "button";
    send.disabled = steer.sending;
    send.dataset.key = "steer-send";
    listen(send, "click", () => sendSteer());
    row.append(caption, input, send);
    box.append(row);
    if (steer.status !== null) {
      const status = h("div", "meta send-status", steer.status);
      status.setAttribute("role", "status");
      box.append(status);
    }
    return box;
  }

  /**
   * The direction ledger's heading card: the standup page's carries the Steer button and, once it is
   * tapped, the composer; the repo page's carries who set it. The words are the operator's own and go
   * in as text. The ledger's date has no time of day, so it is drawn as the month and day `tagDay` draws.
   */
  function headingCard(view, onRepo) {
    const heading = view.heading;
    if (!isObject(heading)) return null;
    const card = h("section", "card pad heading-card", null, "heading");
    // The repo detail sits beside the standup list on the repo screen, so its heading takes an id of its own.
    const headingId = onRepo ? "repo-direction-heading" : "direction-heading";
    card.setAttribute("aria-labelledby", headingId);
    const head = cardHead("Heading · " + txt(onRepo ? view.name : view.sandbox), null, "h2", headingId);
    const date = txt(heading.date) === "" ? null : tagDay(heading.date);
    if (onRepo) {
      if (date !== null) head.append(h("div", "heading-by", "set by you · " + date));
    } else {
      const button = h("button", "steer", steer.open ? "Cancel" : "Steer");
      button.type = "button";
      button.disabled = steer.sending;
      button.setAttribute("aria-expanded", steer.open ? "true" : "false");
      if (steer.open) button.setAttribute("aria-controls", "steer-composer");
      button.dataset.key = "steer";
      listen(button, "click", toggleSteer);
      head.append(button);
    }
    card.append(head);
    const words = txt(heading.text);
    card.append(h("p", "heading-text", words === "" ? "No direction yet." : words));
    if (!onRepo && date !== null) card.append(h("div", "meta", "your words · " + date));
    if (!onRepo && steer.open) card.append(steerComposer());
    return card;
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

  /** A publish row Mark published can act on: a row the button can act on that carries the trunk head it read. */
  function publishRowOf(value) {
    return rolloutRowOf(value) && txt(value.head) !== "";
  }

  /**
   * A publish tag's age from its `YYYY-MM-DD` date, in whole local days: "today", else "3d ago". Null where the tag's name
   * carried no date, so the row is drawn without an age.
   */
  function tagAge(value, now) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(value));
    if (match === null) return null;
    const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(day.getTime())) return null;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const days = Math.round((today.getTime() - day.getTime()) / 86400000);
    return days <= 0 ? "today" : span(days * 86400000) + " ago";
  }

  /** A publish row's line: "2 commits on trunk since publish-20261020, 2d ago", the age left out where the tag has none. */
  function publishSince(row, now) {
    const age = tagAge(row.lastTagDate, now);
    return plural(num(row.toPublish) ?? 0, "commit", "commits") + " on trunk since " + txt(row.lastTag) + (age === null ? "" : ", " + age);
  }

  /**
   * The one toast the pages share: a line, and an optional command the operator can select and copy. Its live region is in the
   * page empty before the first message, so a screen reader announces that message. Focus moves to Dismiss where the tapped
   * button is disabled or gone, and returns to a rollout button when the toast is dismissed. A toast
   * given an `action`, `{ words, run }`, carries that one button in Dismiss's place, whose tap runs it;
   * the caller clears that toast itself. Answers the toast's body, so a caller can tell its toast is
   * still the one shown. A Today dismissal whose Undo toast this one replaces is posted at once, as
   * a second Dismiss posts it, so no item leaves later with no Undo on screen. Every toast shows its
   * own line, then its command, then each of `toastNotes` on a line of its own, oldest first; null
   * words draw the notes alone.
   */
  const toastBox = h("div", "toast");
  toastBox.setAttribute("role", "status");

  /**
   * The words of each failed Dismiss post, oldest first. They ride on whatever toast is up and on every
   * toast after it, so no toast, Undo's included, covers them before the operator reads them, and only
   * a tap on a toast's Dismiss button empties the list.
   */
  const toastNotes = [];

  /** One failed Dismiss's words as a line of a toast. */
  function toastNote(words) {
    return h("span", "toast-note", words);
  }

  function showToast(words, command, action) {
    const shown = needsMe.pending;
    const displaced = shown !== null && shown.toast !== null && toastBox.contains(shown.toast);
    if (displaced) postDismiss(shown);
    const body = h("div", "toast-body");
    if (words !== null) body.append(h("span", null, words));
    if (command) body.append(h("code", "toast-code", command));
    for (const note of toastNotes) body.append(toastNote(note));
    let close;
    if (action) {
      close = h("button", "toast-close toast-act", action.words);
      close.type = "button";
      listen(close, "click", () => action.run());
    } else {
      close = h("button", "toast-close", "Dismiss");
      close.type = "button";
      listen(close, "click", () => {
        const held = toastBox.contains(document.activeElement);
        toastNotes.length = 0;
        toastBox.replaceChildren();
        if (held) {
          const next = document.querySelector("#app button.ro-button:not(:disabled)");
          if (next !== null) next.focus();
        }
      });
    }
    toastBox.replaceChildren(body, close);
    const active = document.activeElement;
    if (active === null || active === document.body || active.disabled === true || !active.isConnected) close.focus();
    return body;
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
    button.dataset.key = "rollout|" + rolloutKey(row);
    listen(button, "click", () => sendRollout(row));
    return button;
  }

  /**
   * Posts Mark published for a publish row and shows the broker's answer in the toast; nothing is thrown. The post carries
   * the trunk head the row showed, so the broker tags only that commit and answers 409 with the head it fetched where the
   * trunk has moved since. The broker's answer to a tag carries the tag, what the push starts and the undo command, and
   * the toast shows all three as the broker sent them.
   */
  async function postPublish(row) {
    let response;
    try {
      response = await fetch("/web/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: row.repo, head: txt(row.head) }),
        signal: AbortSignal.timeout(ROLLOUT_POST_MS),
      });
    } catch (error) {
      const again = " Tapping again answers \"Already published\" if the tag landed.";
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
      else showToast("Tagged " + txt(body.tag) + "." + (txt(body.starts) === "" ? "" : " " + txt(body.starts)) + " To undo it, run:", txt(body.undo));
    } else if (response.status === 409) {
      // A head in the answer is the trunk's now, past the one the row showed; the view read after this tap shows it.
      if (txt(body.head) !== "") showToast("Not published: new commits landed on the trunk since the page read it. Tap Mark published again to publish the head shown now.");
      else showToast(txt(body.tag) === "" ? "Already published: the trunk head carries a publish tag." : "Already published: " + txt(body.tag));
    } else if (response.status === 502) {
      // A timeout is the one kind where the push may have gone through after the broker stopped waiting.
      const kind = txt(body.kind);
      const landed = kind === "timeout" ? " The tag may have landed. Tapping again answers \"Already published\" if it did." : "";
      showToast("Mark published failed" + (kind === "" ? "" : " (" + kind + ")") + "." + landed);
    } else {
      showToast("Mark published failed: the broker answered HTTP " + response.status + ".");
    }
  }

  /** Marks one publish row published. The button stays disabled until the answer, and the page reads its view again after it. */
  async function sendPublish(row) {
    const key = rolloutKey(row);
    if (rolloutBusy.has(key)) return;
    rolloutBusy.add(key);
    redrawNeeds();
    try {
      await postPublish(row);
    } finally {
      rolloutBusy.delete(key);
      await refreshView();
    }
  }

  /** The Mark published button for a publish row, which sits where a client row carries Mark rolled out. */
  function publishButton(row, cls) {
    const button = h("button", "ro-button " + cls, "Mark published");
    button.type = "button";
    button.setAttribute("aria-label", "Mark published, " + txt(row.repo));
    button.disabled = rolloutBusy.has(rolloutKey(row));
    button.dataset.key = "publish|" + rolloutKey(row);
    listen(button, "click", () => sendPublish(row));
    return button;
  }

  /** The footer line of a card: what the counts are, and when the tags were read. */
  function rolloutFooter(words, readAt) {
    const at = parse(readAt);
    const foot = h("div", "ro-foot", words);
    if (at !== null) foot.append(" · tags ", clockText("span", null, clock(at)));
    return foot;
  }

  /** A shared row's key: its repository and commit sha, or its place among the rows where the view carries no sha. */
  function sharedKey(one, index) {
    return "shared:" + (txt(one.sha) === "" ? "#" + String(index) : txt(one.repo) + "@" + txt(one.sha));
  }

  /** The sandbox page's card over every client branch, or nothing where the slot is null. A held source draws `tags unread` in place of the rows. */
  function rolloutCard(view) {
    const summary = view.rollout;
    if (!isObject(summary)) return null;
    const now = nowOf(view);
    const card = h("section", "card ro-card panel");
    card.dataset.key = "rollout";
    card.setAttribute("aria-labelledby", "rollout-heading");
    const rows = objects(summary.rows);
    const waiting = rows.filter((row) => num(row.toRollOut) > 0);
    const publishing = objects(summary.publish).filter((row) => num(row.toPublish) > 0);
    const held = rolloutHeld(view);

    // The count names clients only where every row waiting is a client branch; a publish row is a repository, so a mix reads "waiting" alone.
    const count = num(summary.waiting) ?? waiting.length + publishing.length;
    const head = cardHead("Rollout", held ? null : (publishing.length === 0 ? plural(count, "client", "clients") : count) + " waiting", "h2", "rollout-heading");
    head.classList.add("ro-head");
    const oldest = dayOf(summary.oldestAt, now);
    if (held) head.append(h("div", "ro-sub held", "tags unread"));
    else head.append(h("div", "ro-sub", plural(num(summary.changes) ?? 0, "change", "changes") + (oldest === null ? "" : ", oldest " + oldest)));
    card.append(head);
    if (held) {
      card.append(rolloutFooter("the rows from the last read are not shown", summary.readAt));
      return card;
    }

    const shared = isObject(view.shared) ? objects(view.shared.rows) : [];
    if (waiting.length === 0 && publishing.length === 0 && shared.length === 0) return null;
    const full = h("div", "ro-full");
    for (const row of waiting) {
      const line = h("div", "ro-line", null, "client:" + rolloutKey(row));
      const text = h("span");
      const since = tagDay(row.lastTagDate) === "" ? ", no rollout tag yet" : " since " + tagDay(row.lastTagDate);
      text.append(h("b", null, rolloutClient(row)), " · " + num(row.toRollOut) + " merged" + since);
      line.append(text, h("span", "ro-day", dayOf(row.oldestAt, now) ?? ""));
      full.append(line);
    }
    for (const row of publishing) {
      const line = h("div", "ro-line", null, "publish:" + txt(row.repo));
      const text = h("span");
      text.append(h("b", null, txt(row.repo)), " · " + publishSince(row, now));
      line.append(text, h("span", "ro-day", dayOf(row.oldestAt, now) ?? ""));
      full.append(line);
    }
    // A shared row's key is its repository and commit, and its place in the list where the view carries no commit.
    for (const [index, one] of shared.entries()) {
      const line = h("div", "ro-line", null, sharedKey(one, index));
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
      const line = h("div", "ro-flow", null, "clients");
      waiting.forEach((row, at) => {
        if (at > 0) line.append(" · ");
        const since = tagDay(row.lastTagDate) === "" ? ", no tag yet" : " since " + tagDay(row.lastTagDate);
        line.append(h("b", null, rolloutClient(row)), " ", h("span", "muted", "· " + num(row.toRollOut) + since));
      });
      condensed.append(line);
    }
    for (const row of publishing) {
      const line = h("div", "ro-flow", null, "publish:" + txt(row.repo));
      line.append(h("b", null, txt(row.repo)), " ", h("span", "muted", "· " + publishSince(row, now)));
      condensed.append(line);
    }
    for (const [index, one] of shared.entries()) {
      const line = h("div", "ro-flow", null, sharedKey(one, index));
      const clients = num(one.clients) ?? 0;
      const at = num(one.atClients) ?? 0;
      const merged = num(one.fannedOut) ?? 0;
      line.append("Shared: " + txt(one.title) + " ", h("span", "muted", "· merged to " + merged + ", at " + at + " of " + clients + ", " + Math.max(0, clients - at) + " pending"));
      condensed.append(line);
    }
    card.append(condensed);
    const counted = publishing.length === 0 ? "commits on each branch past its last rollout tag" : "commits past each branch's last rollout tag or the trunk's last publish tag";
    card.append(rolloutFooter(counted, summary.readAt));
    return card;
  }

  /** The repo page's card for the client branch the persona's checkout is on, or nothing where the slot is null. */
  function rolloutRepoCard(view) {
    const row = view.rollout;
    if (!isObject(row)) return null;
    const now = nowOf(view);
    const card = h("section", "card pad attn ro-repo", null, "rollout");
    // The repo detail sits beside the standup list, whose rollout card holds the plain id, so this one takes its own.
    card.setAttribute("aria-labelledby", "repo-rollout-heading");
    const head = cardHead("Rollout", null, "h2", "repo-rollout-heading");
    head.classList.add("ro-head");
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
      // A commit row's key is its sha, and its place in the list where the view carries none.
      for (const [index, commit] of commits.entries()) {
        const key = "commit:" + (txt(commit.sha) || "#" + String(index));
        const mark = h("span", "ro-check", "✓", key + ":mark");
        mark.setAttribute("aria-hidden", "true");
        grid.append(mark, h("span", null, txt(commit.title) + (commit.fromDefault === true ? ", from main" : ""), key), h("span", "ro-day", dayOf(commit.at, now) ?? "", key + ":day"));
      }
      card.append(grid);
    }
    // Keyed, since it comes and goes between readings and the button's row after it must not pair with it by place.
    if (toRollOut > commits.length) card.append(h("div", "ro-more", "and " + (toRollOut - commits.length) + " more", "more"));
    if (rolloutRowOf(row)) {
      const action = h("div", "ro-action");
      action.append(rolloutButton(row, "ro-button-repo"));
      card.append(action);
    }
    card.append(rolloutFooter("records a tag at the branch head; the deploy itself is yours", null));
    return card;
  }

  /** The repo page's card for the repository the persona's checkout reads where it ships by publish tags, or nothing where the slot is null. */
  function publishRepoCard(view) {
    const row = view.publish;
    if (!isObject(row)) return null;
    const now = nowOf(view);
    const card = h("section", "card pad attn ro-repo", null, "rollout");
    // The repo detail sits beside the standup list, whose rollout card holds the plain id, so this one takes its own.
    card.setAttribute("aria-labelledby", "repo-rollout-heading");
    const head = cardHead("Rollout", null, "h2", "repo-rollout-heading");
    head.classList.add("ro-head");
    const held = rolloutHeld(view);
    if (held) head.append(h("div", "ro-sub held", "tags unread"));
    else head.append(h("div", "ro-tag", txt(row.lastTag)));
    card.append(head);
    if (held) {
      card.append(rolloutFooter("the rows from the last read are not shown", row.readAt));
      return card;
    }

    const toPublish = num(row.toPublish) ?? 0;
    card.append(h("div", "ro-lead", publishSince(row, now) + (toPublish > 0 ? ":" : ".")));
    const commits = objects(row.commits);
    if (commits.length > 0) {
      const grid = h("div", "ro-commits");
      // A commit row's key is its sha, and its place in the list where the view carries none.
      for (const [index, commit] of commits.entries()) {
        const key = "commit:" + (txt(commit.sha) || "#" + String(index));
        const mark = h("span", "ro-check", "✓", key + ":mark");
        mark.setAttribute("aria-hidden", "true");
        grid.append(mark, h("span", null, txt(commit.title), key), h("span", "ro-day", dayOf(commit.at, now) ?? "", key + ":day"));
      }
      card.append(grid);
    }
    // Keyed, since it comes and goes between readings and the button's row after it must not pair with it by place.
    if (toPublish > commits.length) card.append(h("div", "ro-more", "and " + (toPublish - commits.length) + " more", "more"));
    if (publishRowOf(row)) {
      const action = h("div", "ro-action");
      action.append(publishButton(row, "ro-button-repo"));
      card.append(action);
    }
    card.append(rolloutFooter("tags the trunk head; the tag starts the publish workflow", null));
    return card;
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

  /** An ask's id on the Today detail: its repo, a colon and its ask id, unencoded, or null for any other item. */
  function askKey(item) {
    return item.kind === "ask" && txt(item.askId) !== "" ? txt(item.repo) + ":" + txt(item.askId) : null;
  }

  /**
   * The key a Needs-you item's row is drawn under: an ask's and a blocked run's `itemKey`, and a
   * hands item's repo and text, since the view gives it no id.
   */
  function itemRowKey(item) {
    return item.kind === "hands" ? JSON.stringify([item.repo, "hands", txt(item.text)]) : itemKey(item);
  }

  /** The ask page of an item that is an ask naming its repo and id, or null for any other item. */
  function askHrefOf(item) {
    return item.kind === "ask" && txt(item.repo) !== "" && txt(item.askId) !== ""
      ? "/ask?repo=" + encodeURIComponent(item.repo) + "&id=" + encodeURIComponent(item.askId)
      : null;
  }

  /** Appends "worker <state>" to `line`, and ", last turn <age> ago" where the worker has had one, the age as `clockText`. */
  function workerWords(line, worker, now) {
    const state = worker && worker.surfaceState ? worker.surfaceState : "no session";
    const turn = worker ? parse(worker.lastTurnAt) : null;
    line.append("worker " + state);
    if (turn !== null) line.append(", last turn ", clockText("span", null, span(now - turn)), " ago");
  }

  function leaseWords(worker) {
    return worker && worker.leaseOpen ? "lease open" : "lease closed";
  }

  // The Today screen draws a need whole, so the repo card's need line is a pointer cut at this many code points.
  const NEED_POINTER_POINTS = 80;

  /** `text` cut to its first `points` code points, an ellipsis marking a cut. */
  function cutPoints(text, points) {
    const characters = Array.from(text);
    return characters.length <= points ? text : characters.slice(0, points).join("") + "…";
  }

  /**
   * A repo that needs the operator, as a card: its head links to the repo page and its need line, one
   * line, to the ask page for an ask and to the repo page otherwise, so the card holds two links side by
   * side rather than one inside the other. The card of the repo the detail pane shows is marked.
   */
  function repoCard(repo, needs, now, selected) {
    const card = h("div", selected ? "card repo-card attn sel" : "card repo-card attn", null, "repo:" + txt(repo.name));
    if (selected) card.setAttribute("aria-current", "true");
    const head = link("repo-head", repoHref(repo.name));
    const name = h("div", "repo-name");
    name.append(txt(repo.name), chevron());
    head.append(name);
    const opened = parse(repo.oldestOpenAt);
    const item = needs.find((candidate) => candidate.repo === repo.name && candidate.kind !== "hands");
    // The badge names the repo's own state where it is one a need explains, else the kind of need it holds.
    const word = CARD_STATES.indexOf(repo.state) >= 0 ? repo.state : item && item.kind === "ask" ? "asking" : "blocked";
    const badge = h("span", repo.state === "stalled" ? "badge red" : "badge", word);
    if (opened !== null) badge.append(" · ", clockText("span", null, span(now - opened)));
    head.append(badge);
    card.append(head);
    if (item) card.append(link("need-line", askHrefOf(item) ?? repoHref(repo.name), cutPoints(txt(item.text), NEED_POINTER_POINTS)));
    const meta = h("div", "meta");
    meta.append("queue " + (num(repo.queueDepth) ?? 0) + " · ");
    workerWords(meta, repo.worker, now);
    meta.append(" · " + leaseWords(repo.worker));
    if (num(repo.unseen) > 0) {
      meta.append(" · ");
      meta.append(h("span", "alert", repo.unseen + " unseen"));
    }
    card.append(meta);
    return card;
  }

  /** A repo's row in the standup list, a link to its repo screen, marked where it is the repo the detail pane shows. */
  function repoRow(repo, now, selected) {
    const row = link(selected ? "row sel" : "row", repoHref(repo.name), null, "repo:" + txt(repo.name));
    if (selected) row.setAttribute("aria-current", "true");
    const name = h("div", "name");
    name.append(dot(repo.state === "working" ? "blue" : "hollow"), txt(repo.name));
    // A stalled repo with nothing to answer is a row carrying the stalled word. The view holds no time it stalled.
    if (repo.state === "stalled") name.append(h("span", "badge red", "stalled"));
    row.append(name);
    const turn = parse(repo.worker ? repo.worker.lastTurnAt : null);
    const step = repo.step && num(repo.step.section) !== null && num(repo.step.sectionCount) !== null ? repo.step : null;
    const meta = h("div", "meta", "queue " + (num(repo.queueDepth) ?? 0) + (step === null ? "" : " · section " + step.section + " of " + step.sectionCount));
    if (turn !== null) meta.append(" · last turn ", clockText("span", null, span(now - turn)), " ago");
    if (num(repo.unseen) > 0) meta.append(" · ", h("span", "alert", repo.unseen + " unseen"));
    row.append(meta);
    if (step !== null && txt(step.next) !== "") row.append(h("div", "meta next", "Next: " + step.next));
    return row;
  }

  /**
   * The standup as the list pane: the direction heading with its Steer composer, the rollout card, the
   * workers' counts, the repos sorted by state, the health band and the read times, as one column. The
   * needs are Today's list, so each needy repo's card keeps its own need line and no band repeats them.
   * `selectedName` is the repo the detail pane shows, whose card, row or chip is marked.
   */
  function renderStandup(view, selectedName) {
    const out = document.createDocumentFragment();
    const now = nowOf(view);
    const repos = list(view.repos).slice().sort(compareRepos);
    const needs = list(view.needsYou);
    const health = view.health || {};

    const top = h("div", "top", null, "top");
    const row = h("div", "top-row");
    row.append(h("h1", null, txt(view.sandbox)), stamp(view));
    top.append(row, h("p", "sub", "Unseen changes, per repo"));
    out.append(top);

    // The direction leads and the workers follow; neither column draws a box of its own, so
    // the sections stack as one column in the list pane at every width.
    const cols = h("div", "standup-cols", null, "cols");
    const main = h("div", "standup-main");
    const side = h("div", "standup-side");
    cols.append(main, side);
    out.append(cols);

    const headingBand = headingCard(view, false);
    if (headingBand !== null) main.append(headingBand);
    const rolloutBand = rolloutCard(view);
    if (rolloutBand !== null) main.append(rolloutBand);

    // The rollup counts workers, so each chip names its unit, as "2 workers asking" or "1 worker idle".
    // The head is drawn only beside counts, so the column's parts carry keys and never pair by place.
    const counts = h("div", "rollup", null, "rollup");
    for (const state of ["asking", "blocked", "stalled", "working", "idle", "dormant"]) {
      const n = repos.filter((repo) => repo.state === state).length;
      if (n === 0) continue;
      const item = h("span", null, null, "state:" + state);
      item.append(h("b", CARD_STATES.indexOf(state) >= 0 ? "alert" : "", String(n)), (n === 1 ? " worker " : " workers ") + state);
      counts.append(item);
    }
    if (counts.firstChild !== null) {
      const workersHead = cardHead("Workers", null, "h2");
      workersHead.dataset.key = "workers-head";
      side.append(workersHead);
    }
    side.append(counts);

    const stack = h("section", "repos", null, "repos");
    stack.setAttribute("aria-label", "Repos");
    // A repo with an ask or a blocked item among the needs needs the operator and draws as a card; every other
    // repo draws as a row, or as a chip in the dormant box.
    const needy = new Set(needs.filter((item) => item.kind === "ask" || item.kind === "blocked").map((item) => item.repo));
    // The cards and rows share one wrapper, a bounded panel on a wide screen and no box of its own on a phone.
    const repoList = h("div", "repo-list panel");
    repoList.dataset.key = "repos";
    for (const repo of repos.filter((candidate) => needy.has(candidate.name))) {
      repoList.append(repoCard(repo, needs, now, repo.name === selectedName));
    }
    const active = repos.filter((candidate) => !needy.has(candidate.name) && candidate.state !== "dormant");
    if (active.length > 0) {
      const group = h("div", "card", null, "active");
      const rows = h("div", "rows");
      for (const repo of active) rows.append(repoRow(repo, now, repo.name === selectedName));
      group.append(rows);
      repoList.append(group);
    }
    if (repoList.firstChild !== null) stack.append(repoList);
    const dormant = repos.filter((candidate) => !needy.has(candidate.name) && candidate.state === "dormant");
    if (dormant.length > 0) {
      const box = h("section", "card dormant", null, "dormant-box");
      const top2 = cardHead("Dormant", dormant.length, "h2");
      top2.append(h("div", "meta", "tap to open"));
      const chips = h("div", "chips panel");
      chips.dataset.key = "dormant";
      for (const repo of dormant) {
        const chip = link(repo.name === selectedName ? "chip sel" : "chip", repoHref(repo.name), txt(repo.name), "repo:" + txt(repo.name));
        if (repo.name === selectedName) chip.setAttribute("aria-current", "true");
        const at = parse(repo.worker ? repo.worker.lastTurnAt : null) ?? parse(repo.lastDoneAt);
        if (at !== null) chip.append(clockText("span", "muted", "· " + span(now - at)));
        if (num(repo.unseen) > 0) chip.append(h("span", "muted", "· " + repo.unseen + " unseen"));
        chips.append(chip);
      }
      box.append(top2, chips, h("div", "note", "dormant = on the roster, idle past 24h, queue empty"));
      stack.append(box);
    }
    side.append(stack);

    const band2 = link("card health-band", "/health", null, "health");
    const bandHead = cardHead("Health", null, "span");
    const clear = num(health.expected) !== null && num(health.holes) === 0 && num(health.hands) === 0 && num(health.held) === 0;
    // Nothing expected is nothing to call healthy, so "0 of 0 reporting" draws the neutral dot.
    const idle = num(health.expected) === 0 && clear;
    bandHead.prepend(dot(idle ? "hollow" : clear ? "green" : "amber"));
    bandHead.append(chevron());
    const line = h("div", "line");
    if (num(health.expected) === null) line.append("no reading yet");
    else {
      line.append(h("b", null, health.reporting + " of " + health.expected), " reporting");
      if (num(health.holes) > 0) line.append(" · " + health.holes + " missing");
      line.append(" · " + (num(health.hands) > 0 ? health.hands + " for your hands" : "nothing for your hands"));
      if (num(health.held) > 0) line.append(" · " + health.held + (health.held === 1 ? " source held" : " sources held"));
    }
    band2.append(bandHead, line);
    side.append(band2);
    out.append(sources(view, ["roster", "queues", "plans", "ledger", "events", "registry", "usage", "rollout"]));
    return out;
  }

  /**
   * The name of the repo the standup list draws first: the first repo needing the operator, else the
   * first active one, else the first dormant one, in the order `renderStandup` draws them; null where
   * the reading holds no repo.
   */
  function firstRepoName(view) {
    const repos = list(view.repos).slice().sort(compareRepos);
    const needy = new Set(list(view.needsYou).filter((item) => item.kind === "ask" || item.kind === "blocked").map((item) => item.repo));
    const first = repos.find((repo) => needy.has(repo.name)) ?? repos.find((repo) => repo.state !== "dormant") ?? repos[0];
    return first === undefined || txt(first.name) === "" ? null : txt(first.name);
  }

  /**
   * The repo reading a screen draws beside its own: the standup's first repo, which its detail pane
   * shows while no repo is selected, and the plan screen's repo, whose plans its list pane holds;
   * null until one arrives.
   */
  let repoBeside = null;

  /**
   * Takes a standup reading and, after it, the repo reading of the repo its list draws first, for the
   * detail pane. A failed repo read is not the screen's: the standup is drawn, with the last repo
   * reading where it is still that repo's. A repo reading arriving after the shell moved to another
   * screen visit is dropped.
   */
  async function standupAccept(view) {
    const here = visit;
    const name = firstRepoName(view);
    if (name === null) {
      repoBeside = null;
      return view;
    }
    try {
      const repo = await fetchView(repoUrlOf(name));
      if (here === visit) repoBeside = repo;
    } catch (error) {
      // Kept as it was: the detail pane draws the last reading while it is this repo's, and a line otherwise.
    }
    return view;
  }

  /** The detail pane's repo by name: its reading where the shell holds that repo's, else a line saying it is being read. */
  function repoDetailOf(name) {
    if (name === null) return h("p", "muted", "No repo is on the roster.");
    if (!isObject(repoBeside) || txt(repoBeside.name) !== name) return h("p", "muted", "Reading " + name + ".");
    return renderRepo(repoBeside);
  }

  /**
   * The standup screen: the standup in the list pane, and in the detail pane the repo its list draws
   * first, which is the row marked; a tapped repo opens the repo screen, whose list pane is this one.
   */
  function renderStandupScreen(view) {
    const first = firstRepoName(view);
    const out = document.createDocumentFragment();
    out.append(pane("list", renderStandup(view, first)), detailPane(SCREEN_PATHS.standup, repoDetailOf(first)));
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

  /** The repo view's address for a repo by name, route text plus the encoded name. */
  function repoUrlOf(name) {
    return "/web/repo?name=" + encodeURIComponent(name);
  }

  function repoUrl() {
    const name = repoName();
    return name === null ? null : repoUrlOf(name);
  }

  /**
   * A plan's row: a link to the plan screen, through the route table, carrying the repo the row is
   * drawn under so that screen lists the repo's plans beside it, and the branch a queued plan is read
   * from where the row names one, and marked where it is the plan the detail pane shows. A row with no
   * root or path draws unlinked.
   */
  function planRow(plan, now, upNext, repo, selected) {
    const key = "plan:" + txt(plan.root) + ":" + (txt(plan.path) || txt(plan.title));
    const cls = selected ? "plan-row sel" : "plan-row";
    const query = { root: txt(plan.root), path: txt(plan.path), repo };
    if (txt(plan.branch) !== "") query.branch = txt(plan.branch);
    const href = pathOf({ screen: "plan", name: null, query });
    const row = plan.root && plan.path ? link(cls, href, null, key) : h("div", cls, null, key);
    if (selected) row.setAttribute("aria-current", "true");
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
    const serves = txt(plan.serves);
    if (meta.length > 0 || serves !== "") {
      const line = h("div", "meta", meta.join(" · "));
      if (serves !== "") {
        if (meta.length > 0) line.append(" · ");
        line.append(h("span", serves.toLowerCase() === "none" ? "alert" : null, "serves " + serves));
      }
      body.append(line);
    }
    if (plan.next && !finished) body.append(h("div", "next", "Next: " + plan.next));
    row.append(state, body);
    if (plan.root && plan.path) row.append(chevron());
    return row;
  }

  /**
   * A repo's two plan lists, Up next and Changed since the catch-up mark, as the repo detail and the
   * plan screen's list pane both draw them. `selected` is the root and path of the plan the detail
   * pane shows, whose row is marked, or null.
   */
  function planSections(view, now, selected) {
    const repo = txt(view.name);
    const since = parse(view.unseenSince);
    const isSelected = (plan) => selected !== null && txt(plan.root) === selected.root && txt(plan.path) === selected.path;

    const queued = list(view.upNext);
    const nextSection = h("section", "section", null, "up-next");
    nextSection.append(cardHead("Up next", queued.length));
    if (queued.length === 0) nextSection.append(h("div", "card pad muted", "Nothing is queued."));
    else {
      const card = h("div", "card");
      for (const plan of queued) card.append(planRow(plan, now, true, repo, isSelected(plan)));
      nextSection.append(card);
    }

    const changed = list(view.changed);
    const changedSection = h("section", "section", null, "changed");
    changedSection.append(
      cardHead(since === null ? "Changed in the last 24 hours" : "Changed since " + dayClock(since, now), view.changed === null ? null : changed.length),
    );
    if (view.changed === null) changedSection.append(h("div", "card pad muted", "No plans were swept for this repo."));
    else if (changed.length === 0) changedSection.append(h("div", "card pad muted", "Nothing has changed."));
    else {
      const card = h("div", "card");
      for (const plan of changed) card.append(planRow(plan, now, false, repo, isSelected(plan)));
      changedSection.append(card);
    }
    return [nextSection, changedSection];
  }

  /**
   * A repo's detail: its name and catch-up mark, its plans, its heading, its rollout and its worker,
   * drawn in the detail pane of the repo screen and of the standup screen.
   */
  function renderRepo(view) {
    const out = document.createDocumentFragment();
    const now = nowOf(view);
    const top = h("div", "top");
    top.append(back(SCREEN_PATHS.standup, "Standup"));
    const row = h("div", "top-row");
    row.append(h("h1", null, txt(view.name)), stamp(view));
    top.append(row);
    const since = parse(view.unseenSince);
    const catchUp = h("div", "top-row");
    const caughtUp = h("button", "linkbtn", "Caught up");
    caughtUp.type = "button";
    caughtUp.dataset.key = "caught-up:" + txt(view.name);
    listen(caughtUp, "click", () => sendCaughtUp(txt(view.name), view));
    catchUp.append(
      h("p", "sub", since === null ? "No catch-up mark yet, so changed means the last 24 hours." : "Since you caught up, " + dayClock(since, now)),
      caughtUp,
    );
    top.append(catchUp);
    out.append(top);

    const cols = h("div", "repo-cols");
    const left = h("div", "stack");

    const [nextSection, changedSection] = planSections(view, now, null);
    left.append(nextSection);
    left.append(changedSection);

    // The worker page leads with what is queued, then what changed, then the Heading and Rollout cards.
    // A repository ships one way, so at most one of the two slots holds a row.
    const headingBox = headingCard(view, true);
    if (headingBox !== null) left.append(headingBox);
    const rolloutBox = rolloutRepoCard(view) ?? publishRepoCard(view);
    if (rolloutBox !== null) left.append(rolloutBox);

    const worker = view.worker || {};
    const box = h("section", "card pad worker", null, "worker");
    const head = cardHead(txt(worker.lineage || view.name) + ": Worker", null, "h2");
    head.prepend(dot(worker.surfaceState === "working" ? "blue" : "hollow"));
    head.append(h("div", "meta", (worker.surfaceState || "no session") + " · " + leaseWords(worker)));
    const turn = parse(worker.lastTurnAt);
    const last = h("div", "meta", turn === null ? "No turn recorded." : "Last turn " + dayClock(turn, now) + ", ");
    if (turn !== null) last.append(clockText("span", null, span(now - turn)), " ago.");
    box.append(head, last);
    // The worker's talk page, where its lineage is known; the plan page carries no lineage and links nowhere.
    if (txt(worker.lineage) !== "") {
      const talk = h("div", "meta");
      talk.append(link("worker-talk", talkHref(txt(worker.lineage)), "Talk to " + txt(worker.lineage)));
      box.append(talk);
    }

    cols.append(left, box);
    out.append(cols, sources(view, ["plans", "queues", "ledger", "events", "roster", "rollout"]));
    return out;
  }

  /**
   * The repo screen: the standup in the list pane with this repo marked, from the standup reading the
   * screen takes beside its own each pass, and this repo's detail in the detail pane, the sheet on a
   * phone, which closes to the standup.
   */
  function renderRepoScreen(view) {
    // The row marked is the address's repo, so the list follows the place even before its reading lands.
    const name = repoName() ?? txt(view.name);
    const listed = isObject(standupView) ? renderStandup(standupView, name) : h("p", "muted", "Reading the standup.");
    const out = document.createDocumentFragment();
    out.append(pane("list", listed), detailPane(SCREEN_PATHS.standup, renderRepo(view)));
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

  /**
   * The plan reading's address for a configured root and a plan path, route text plus the encoded
   * values, and the encoded branch where one is given, which has the broker read the plan from it.
   */
  function planUrlOf(root, path, branch) {
    const url = "/web/plan?root=" + encodeURIComponent(root) + "&path=" + encodeURIComponent(path);
    return typeof branch === "string" && branch !== "" ? url + "&branch=" + encodeURIComponent(branch) : url;
  }

  /** The plan screen's reading, from the address's root and path, and its branch where it names one. */
  function planUrl() {
    const params = planParams();
    return params === null ? null : planUrlOf(params.root, params.path, new URLSearchParams(location.search).get("branch"));
  }

  /**
   * The repo whose plans the plan screen's list pane holds, for the plan reading `view`: the repo the
   * address names in its `repo` key; else the repo the first open ask on the plan names, since the plan view
   * lists the asks of the repos whose folder is the plan's root. Null where neither names one: the
   * plan's root is a folder name, and a repo is named for its persona, so the root names no repo.
   */
  function planRepoOf(view) {
    const named = new URLSearchParams(location.search).get("repo");
    if (named !== null && named !== "") return named;
    const asked = list(isObject(view) ? view.openAsks : null).find((ask) => isObject(ask) && txt(ask.repo) !== "");
    return asked === undefined ? null : txt(asked.repo);
  }

  /**
   * Takes a plan reading and, after it, the reading of the repo whose plans the list pane holds. A
   * failed repo read is not the screen's: the plan is drawn, with the last repo reading where it is
   * still that repo's. A repo reading arriving after the shell moved to another screen visit is dropped.
   */
  async function planAccept(view) {
    const here = visit;
    const name = planRepoOf(view);
    if (name === null) return view;
    try {
      const repo = await fetchView(repoUrlOf(name));
      if (here === visit) repoBeside = repo;
    } catch (error) {
      // Kept as it was: a list that cannot refresh shows the last reading rather than vanishing.
    }
    return view;
  }

  /**
   * The plan screen's list pane: the repo's plans, Up next and Changed, with this plan's row marked,
   * from the repo reading the screen takes beside its own each pass. A plan for which no repo is
   * named lists none and says so, with the way back to the standup.
   */
  function planList(name) {
    const out = document.createDocumentFragment();
    const top = h("div", "top", null, "top");
    top.append(name === null ? back(SCREEN_PATHS.standup, "Standup") : back(repoHref(name), name));
    const row = h("div", "top-row");
    row.append(h("h1", null, "Plans"));
    top.append(row);
    out.append(top);
    if (name === null) out.append(h("p", "muted", "No repo is named for this plan, so no plan list is drawn beside it."));
    else if (!isObject(repoBeside) || txt(repoBeside.name) !== name) out.append(h("p", "muted", "Reading " + name + "."));
    else {
      const [nextSection, changedSection] = planSections(repoBeside, nowOf(repoBeside), planParams());
      out.append(nextSection, changedSection);
    }
    return out;
  }

  /**
   * The plan screen: its repo's plans in the list pane and the plan in the detail pane, the sheet on a
   * phone, which closes back to the screen it was opened from, or to Today, as `closesBack` says.
   */
  function renderPlanScreen(view) {
    const name = planRepoOf(view);
    const out = document.createDocumentFragment();
    out.append(pane("list", planList(name)), detailPane(SCREEN_PATHS.today, renderPlan(view)));
    return out;
  }

  function mark(kind, words) {
    const m = h("span", "mark " + kind, kind === "done" ? "✓" : kind === "now" ? "●" : "○");
    m.append(h("span", "sr", words));
    return m;
  }

  /** The brief part the page draws in amber and opens below a rule, as the kit names it. */
  const ASSUMES_LABEL = "It assumes";

  /** One grid of label and text rows; the assumptions label draws in the page's amber. */
  function briefGrid(parts) {
    const grid = h("div", "brief-grid");
    for (const part of parts) {
      grid.append(h("div", "brief-label" + (part.label === ASSUMES_LABEL ? " assumes" : ""), part.label), md("div", "brief-text", part.text));
    }
    return grid;
  }

  /**
   * The brief card, or null where the view carries no usable brief. Parts keep file order, and the
   * ones from `It assumes` on draw below a rule, as the mockup does. Every value is set as text.
   */
  function briefCard(brief) {
    const parts = brief && typeof brief === "object" ? list(brief.parts).filter((part) => part && txt(part.label) !== "" && txt(part.text) !== "") : [];
    if (parts.length === 0) return null;
    const card = h("section", "card pad section brief");
    card.setAttribute("aria-label", "Brief");
    const split = parts.findIndex((part) => part.label === ASSUMES_LABEL);
    if (split <= 0) card.append(briefGrid(parts));
    else card.append(briefGrid(parts.slice(0, split)), h("div", "brief-rule"), briefGrid(parts.slice(split)));
    return card;
  }

  /**
   * "Read from <branch> at <short sha>, <age> ago" for a plan the broker read from its branch, the age
   * left out where the commit's date does not parse, or null where the view carries no usable source,
   * as on a plan swept from disk. Every value is set as text.
   */
  function sourceLine(source, now) {
    if (!isObject(source) || txt(source.branch) === "" || txt(source.commit) === "") return null;
    const line = h("div", "meta", "Read from " + txt(source.branch) + " at " + txt(source.commit).slice(0, 7), "plan-source");
    const at = parse(source.committedAt);
    if (at !== null) line.append(", ", clockText("span", null, span(now - at)), " ago");
    return line;
  }

  function renderPlan(view) {
    const out = document.createDocumentFragment();
    const now = nowOf(view);
    const sections = list(view.sections);
    const chapters = list(view.chapters);
    const finished = txt(view.status).toLowerCase() === "complete";

    const top = h("div", "top");
    top.append(back(SCREEN_PATHS.standup, "Standup"));
    const row = h("div", "top-row");
    row.append(h("h1", "plan-title", txt(view.title)), stamp(view));
    top.append(row);
    const chips = h("div", "chips-row");
    chips.append(
      h("span", finished ? "badge green" : "badge blue", txt(view.status) + (sections.length > 0 ? " · section " + chapters.length + " of " + sections.length : "")),
    );
    const serves = txt(view.serves);
    if (serves !== "") chips.append(h("span", serves.toLowerCase() === "none" ? "badge serves" : "badge plain serves", "serves " + serves));
    chips.append(h("span", "meta mono", txt(view.path)));
    top.append(chips);
    out.append(top);

    const source = sourceLine(view.source, now);
    if (source !== null) out.append(source);

    const brief = briefCard(view.brief);
    if (brief !== null) out.append(brief);
    else {
      const goal = h("section", "card pad section");
      goal.append(cardHead("Goal"), md("div", "goal", txt(view.goal).trim() !== "" ? view.goal : "This plan has no Goal section."));
      out.append(goal);
    }

    const asks = list(view.openAsks);
    // The asks come and go between readings, so the section is keyed and Progress after it never pairs with it by place.
    if (asks.length > 0) {
      const box = h("section", "section", null, "asks");
      box.append(cardHead("Open asks", asks.length));
      const card = h("div", "card");
      for (const ask of asks) {
        const item = h("div", "ask", null, itemRowKey(ask));
        const text = h("div");
        if (ask.blocking) text.append(h("span", "tag", "blocking"));
        text.append(txt(ask.text));
        item.append(text);
        if (ask.recommend) item.append(recRow(ask.recommend));
        const opened = parse(ask.openedAt);
        if (opened !== null) {
          const asked = h("div", "meta", "asked ");
          asked.append(clockText("span", null, span(now - opened)), " ago");
          item.append(asked);
        }
        card.append(item);
      }
      box.append(card);
      out.append(box);
    }

    const progress = h("section", "card pad section");
    progress.append(cardHead("Progress"));
    if (sections.length === 0) progress.append(h("div", "meta", "This plan lists no sections."));
    else {
      const steps = h("ul", "steps", null, "sections");
      let current = -1;
      if (!finished) current = sections.findIndex((section) => !section.done);
      sections.forEach((section, index) => {
        const item = h("li", null, null, "section:" + txt(section.name));
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
      progress.append(cardHead("Chapters", chapters.length, "h3"));
      const steps = h("ul", "steps", null, "chapters");
      for (const chapter of chapters) {
        const item = h("li", null, null, "chapter:" + String(chapter.number));
        item.append(mark("done", "closed"));
        const body = h("span", null, "Chapter " + chapter.number + ": " + txt(chapter.completed));
        if (chapter.next) body.append(h("span", "chapter-next", "Next: " + chapter.next));
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
  // The tone each verdict word is drawn in, by the class the verdict card's badge and the folded rail's dot take; amber is
  // the badge's own colour, and a word with no entry, unknown, takes no tone.
  const VERDICT_TONES = { underused: "blue", balanced: "green", overcommitted: "amber" };
  const UNKNOWN_REASONS = {
    "no-accounts": "no account reporting a weekly window",
    "no-completed-plans": "no plan finished in the last 7 days",
    "no-queue": "the queue has not been read yet",
  };
  const SESSION_ORDER = { "needs you": 0, blocked: 0, working: 1, idle: 2, exited: 3 };
  const SESSIONS_SHOWN = 8;
  let sessionsExpanded = false;

  /** One session in the health list, a link to the talk screen for its lineage, the persona name the talk view keys on, or its name where it has none. */
  function sessionCell(session) {
    const state = txt(session.surfaceState);
    const cell = link("cell", talkHref(txt(session.lineage) || txt(session.name)), null, "session:" + txt(session.name));
    const kind = state === "working" ? "blue" : state === "needs you" || state === "blocked" ? "amber" : "hollow";
    const idle = state === "idle" || state === "exited";
    const words = h("span", state === "working" ? "" : "muted", txt(session.name) + (idle ? " · " + state + " " : state === "working" ? "" : " · " + state));
    if (idle) words.append(clockText("span", null, span(num(session.idleFor) ?? 0)));
    cell.append(dot(kind), words);
    return cell;
  }

  function sessionsSection(view) {
    const box = h("section", "section", null, "sessions");
    const head = h("div", "section-head");
    head.append(label("Sessions"));
    const count = h("div");
    if (num(view.expected) === null) count.append("no reading yet");
    else count.append(h("b", null, String(view.reporting)), " of ", h("b", null, String(view.expected)), " expected are reporting");
    head.append(count);
    box.append(head);

    for (const hole of list(view.holes)) {
      const card = h("article", "card hole", null, "hole:" + txt(hole.name));
      const top = h("div", "hole-head");
      const why = Object.prototype.hasOwnProperty.call(HOLE_WORDS, hole.reason) ? HOLE_WORDS[hole.reason] : txt(hole.reason);
      top.append(h("h3", "repo-name", txt(hole.name) + ": Worker"), h("div", "why", why));
      card.append(top);
      box.append(card);
    }

    const sessions = list(view.sessions).slice().sort((a, b) => {
      const x = Object.prototype.hasOwnProperty.call(SESSION_ORDER, a.surfaceState) ? SESSION_ORDER[a.surfaceState] : 2;
      const y = Object.prototype.hasOwnProperty.call(SESSION_ORDER, b.surfaceState) ? SESSION_ORDER[b.surfaceState] : 2;
      return x - y || txt(a.name).localeCompare(txt(b.name), undefined, { sensitivity: "base" });
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
        button.dataset.key = "sessions-more";
        button.setAttribute("aria-expanded", sessionsExpanded ? "true" : "false");
        listen(button, "click", () => {
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

  /**
   * One account's card: the binding window's name and percentage as the headline, the account and its
   * projection under it, and every window's bar at the foot, an untouched account's at 0% included.
   */
  function accountRow(account, now) {
    const box = h("div", "card account", null, "account:" + (txt(account.email) || String(account.number)));
    const lines = windowLines(account);
    const untouched = lines.length > 0 && lines.every((line) => num(line.window.pct) === 0);
    const head = h("div", "account-head");
    let elapsed = "";
    let projection = "";
    if (account.binding && num(account.binding.pct) > 0) {
      const name = Object.prototype.hasOwnProperty.call(WINDOW_NAMES, account.binding.name) ? WINDOW_NAMES[account.binding.name] : txt(account.binding.name);
      const pct = num(account.binding.pct);
      head.append(h("span", "binding" + (pct >= 80 ? " hot" : ""), name + " " + pct + "%"));
      if (account.lastsToReset === false) projection = "dry before reset";
      else if (account.lastsToReset === true) projection = "lasts to reset";
      if (num(account.elapsedPct) !== null) elapsed = Math.round(account.elapsedPct) + "% of the window elapsed";
    } else {
      head.append(h("span", "binding muted", untouched ? "untouched · 0%" : "no window bound"));
    }
    if (projection) head.append(h("span", account.lastsToReset === false ? "bound" : "muted", projection));
    box.append(head);
    const who = h("div", "who", account.email ? account.email : "Account #" + account.number);
    if (account.active) who.append(h("span", "muted", " · active"));
    box.append(who);
    if (account.failing) {
      box.append(h("div", "bound", "sign-in failing · " + account.consecutiveFailures + (account.consecutiveFailures === 1 ? " try" : " tries")));
    }
    if (elapsed) box.append(h("div", "meta", elapsed));
    if (account.organizationName) box.append(h("div", "meta", txt(account.organizationName)));
    if (account.spend) {
      const spend = account.spend;
      const used = num(spend.used) === null || num(spend.limit) === null ? "" : " · " + spend.used + " of " + spend.limit + " " + txt(spend.currency);
      box.append(h("div", "meta", "Spend " + (num(spend.pct) ?? 0) + "%" + used));
    }

    // The windows close the card, so the bars of cards side by side end level. The lines above them
    // come and go with the account's state, so the grid is keyed and never pairs with one by place.
    if (lines.length > 0) {
      const grid = h("div", "windows", null, "windows");
      for (const line of lines) {
        const pct = num(line.window.pct) ?? 0;
        const reset = parse(line.window.resetsAt);
        const key = "window:" + line.name;
        const track = bar(pct, pct >= 80);
        track.dataset.key = key + ":bar";
        grid.append(h("span", "muted", line.name, key), h("span", null, pct + "%", key + ":pct"), clockText("span", "muted reset", reset === null ? "" : until(reset - now), key + ":reset"), track);
      }
      box.append(grid);
    }
    return box;
  }

  /** The tone class of a verdict word, or "" for a word with none. */
  function verdictTone(word) {
    return Object.prototype.hasOwnProperty.call(VERDICT_TONES, word) ? VERDICT_TONES[word] : "";
  }

  /** The sandbox's verdict: the word, the budget against the queue, the lever, and the formula's footer. A view without one draws nothing. */
  function verdictCard(view) {
    const verdict = view.verdict;
    if (!isObject(verdict)) return null;
    // Keyed, since a view may carry no verdict and the account tiles after it must not pair with it by place.
    const card = h("div", "card verdict", null, "verdict");
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
      head.append(h("span", "badge " + verdictTone(verdict.word), "budget " + mark + " queue"));
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
    const behindCount = num(kit.behind) ?? behind.length;
    const card = h("div", "card pad kit");
    const head = h("div", "section-head");
    head.append(h("h3", "label muted", "Kit version"));
    const count = h("div");
    if (behindCount > 0) count.append(h("b", null, String(behindCount)), " of " + total + " started before the update");
    else count.append("all ", h("b", null, String(total)), " on current");
    head.append(count);
    card.append(head);
    const published = parse(kit.updatedAt);
    const line = h("div", "kit-line", published === null ? "Release time unknown." : "Published ");
    if (published !== null) line.append(clockText("span", null, span(now - published)), " ago");
    if (kit.sha) line.append(" ", h("span", "muted mono", txt(kit.sha)));
    card.append(line);
    if (behind.length > 0) card.append(h("div", "meta", "Restart to take it: " + behind.map((session) => txt(session.name)).join(", ")));
    return card;
  }

  function capacitySection(view, now) {
    const box = h("section", "section", null, "capacity");
    const accounts = list(view.capacity);
    const head = h("div", "section-head");
    head.append(label("Capacity · " + accounts.length + (accounts.length === 1 ? " account" : " accounts")));
    const read = parse(view.asOf ? view.asOf.usage : null);
    const swap = h("div", "stamp", read === null ? "swap: no reading yet" : "swap read ");
    if (read !== null) swap.append(clockText("span", null, span(now - read)), " ago");
    head.append(swap);
    box.append(head);
    const verdict = verdictCard(view);
    if (verdict) box.append(verdict);
    if (accounts.length === 0) {
      const card = h("div", "card");
      card.append(h("div", "pad muted", view.asOf && view.asOf.usage === null ? "No reading yet." : "No accounts reporting."));
      box.append(card);
      return box;
    }
    const tiles = h("div", "accounts");
    for (const account of accounts) tiles.append(accountRow(account, now));
    box.append(tiles);
    return box;
  }

  function handsSection(view, now) {
    const box = h("section", "section", null, "hands");
    const hands = list(view.hands);
    box.append(label("Your hands · " + hands.length));
    const card = h("div", "card");
    if (hands.length === 0) card.append(h("div", "pad muted", "Nothing for your hands."));
    else {
      const items = h("ol", "hands");
      hands.forEach((hand, index) => {
        const item = h("li", null, null, itemRowKey(hand));
        item.append(h("div", "n", String(index + 1)));
        const body = h("div");
        body.append(h("div", "text", txt(hand.text)));
        const opened = parse(hand.openedAt);
        if (hand.repo || opened !== null) {
          const meta = h("div", "meta", hand.repo ? String(hand.repo) : null);
          if (hand.repo && opened !== null) meta.append(" · ");
          if (opened !== null) meta.append(clockText("span", null, span(now - opened)), " ago");
          body.append(meta);
        }
        item.append(body);
        items.append(item);
      });
      card.append(items);
    }
    box.append(card);
    return box;
  }

  // ---------------------------------------------------------------------------------------------
  // Sibling sandboxes: the pills at the rail's foot on every screen and the health screen's card
  // ---------------------------------------------------------------------------------------------

  /**
   * The path a sibling pill opens on the sibling, by the screen drawn: the screens that name no
   * object of this sandbox open the same screen on a sibling running this build, and the others open
   * the sibling's root path.
   * The href is the sibling's origin, from this broker's own configuration, plus one of these fixed paths.
   */
  const RAIL_PATHS = { today: "/", standup: "/repos", health: "/health" };

  /**
   * The one shape an origin may take to be drawn as a link: plain HTTP to a tailnet address and port.
   * Each of the last two octets is 0 to 255 with no leading zero, as the server's isTailnetAddress reads one.
   */
  const SIBLING_ORIGIN = /^http:\/\/100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9]):[0-9]{1,5}$/;

  /** The broker's last poll of the siblings, or null before one is read; drawn beside every view. */
  let siblingsView = null;

  /** The time the siblings reading is read against: the broker's pass time, else the browser's clock. */
  function siblingsNow(view) {
    const at = parse(view.asOf);
    return at === null ? Date.now() : at;
  }

  /**
   * `Name · <count>`, `Name · unreachable since <time>`, or `Name · not polled yet` before the
   * broker's first poll of that sibling settles, as text nodes, with the count's tone.
   */
  function siblingWords(pill, sibling, now) {
    pill.append(txt(sibling.name), " · ");
    if (isObject(sibling.summary)) {
      const count = num(sibling.summary.needsYou) ?? 0;
      pill.append(h("span", "count" + (count > 0 ? " amber" : ""), String(count)));
      return;
    }
    const since = parse(sibling.unreachableSince);
    pill.append(h("span", "count down", since === null ? "not polled yet" : "unreachable since " + dayClock(since, now)));
  }

  /**
   * One pill per sibling after this sandbox's own, or null with no sibling configured. A pill is a
   * link only where the origin has the one shape the broker builds, and every word on it is the
   * configured name or a value the broker's parse admitted.
   */
  function sandboxRail(view) {
    if (!isObject(view)) return null;
    const siblings = list(view.siblings);
    if (siblings.length === 0) return null;
    const now = siblingsNow(view);
    const pills = h("nav", "sandboxes", null, "sandboxes");
    pills.setAttribute("aria-label", "Sandboxes");
    const path = Object.prototype.hasOwnProperty.call(RAIL_PATHS, screen) ? RAIL_PATHS[screen] : "";
    for (const sibling of siblings) {
      if (!isObject(sibling)) continue;
      const origin = txt(sibling.origin);
      const key = "sibling:" + txt(sibling.name);
      const pill = SIBLING_ORIGIN.test(origin) ? link("pill", origin + path, null, key) : h("span", "pill", null, key);
      siblingWords(pill, sibling, now);
      pills.append(pill);
    }
    return pills;
  }

  /** The health page's "Other sandboxes" card: every count the summary carries, one row per sibling. */
  function otherSandboxes(view) {
    if (!isObject(view)) return null;
    const siblings = list(view.siblings);
    if (siblings.length === 0) return null;
    const now = siblingsNow(view);
    const box = h("div", "others");
    box.append(label("Other sandboxes"));
    const card = h("div", "card");
    for (const sibling of siblings) {
      if (!isObject(sibling)) continue;
      const row = h("div", "row", null, "sibling:" + txt(sibling.name));
      row.append(h("span", "name", txt(sibling.name)));
      const words = h("span", "meta");
      const summary = sibling.summary;
      if (isObject(summary)) {
        const expected = num(summary.expected);
        const reporting = num(summary.reporting);
        const needs = num(summary.needsYou) ?? 0;
        words.append(
          (expected === null || reporting === null ? "no roster yet" : reporting + " of " + expected) +
            " · " + plural(num(summary.capacity && summary.capacity.accounts) ?? 0, "account", "accounts") + " · ",
          h("span", needs > 0 ? "alert" : "", needs + " needs you"),
          " · " + (num(summary.yourHands) ?? 0) + " in your hands",
        );
      } else {
        const since = parse(sibling.unreachableSince);
        words.append(since === null ? "not polled yet" : "unreachable since " + dayClock(since, now));
      }
      row.append(words);
      card.append(row);
    }
    const read = parse(view.asOf);
    const note = h("div", "note", "counts only, polled over the tailnet · " + (read === null ? "no poll yet" : "as of "));
    if (read !== null) note.append(clockText("span", null, dayClock(read, now)));
    card.append(note);
    box.append(card);
    return box;
  }

  /**
   * The health screen: the sessions in the list pane, each a link to its talk screen, and the
   * capacity with its verdict, the hands and the other sandboxes in the detail pane. No row is
   * selected, so the phone stacks the two panes in its one column.
   */
  function renderHealth(view) {
    const out = document.createDocumentFragment();
    const now = nowOf(view);
    const top = h("div", "top", null, "top");
    const row = h("div", "top-row");
    row.append(h("h1", null, "Health"), stamp(view));
    top.append(row);
    const hands = handsSection(view, now);
    // Under the hands, where the mockup places it: the other sandboxes are the operator's, not a session's.
    const others = otherSandboxes(siblingsView);
    if (others !== null) hands.append(others);
    out.append(pane("list", top, sessionsSection(view)), pane("detail", capacitySection(view, now), hands));
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Changelog page
  // ---------------------------------------------------------------------------------------------

  /** The rows the Changelog screen asks for at first and adds per Show older, and the most one answer holds: the broker's default and ceiling. */
  const CHANGELOG_STEP = 30;
  const CHANGELOG_MAX = 300;

  /** The parts an entry draws closed; the rest open with its Corrects and Corrected by lines on a tap. */
  const CHANGELOG_SHOWN = ["What changed", "Why"];

  /**
   * What the Changelog screen holds for one visit: the rows it asks for, and the entries opened, by
   * key, so the poll's redraw keeps an opened entry open. A move to another screen or filter resets both.
   */
  const changelogHeld = { count: CHANGELOG_STEP, open: new Set() };

  /** The repository the address filters on, or null for every repository. */
  function changelogRepo() {
    const repo = new URLSearchParams(location.search).get("repo");
    return repo === null || repo === "" ? null : repo;
  }

  /** The Changelog reading: the address's repository where it names one, and the count where Show older has raised it. */
  function changelogUrl() {
    const repo = changelogRepo();
    const pairs = [];
    if (repo !== null) pairs.push("repo=" + encodeURIComponent(repo));
    if (changelogHeld.count !== CHANGELOG_STEP) pairs.push("count=" + changelogHeld.count);
    return pairs.length === 0 ? "/web/changelog" : "/web/changelog?" + pairs.join("&");
  }

  /** The filter: All, then each repository the view lists, and the filtered one where the view lists no record for it, the one shown marked. */
  function changelogFilter(repos, filter) {
    const names = repos.map((repo) => txt(repo.repo)).filter((name) => name !== "");
    if (filter !== null && !names.includes(filter)) names.push(filter);
    const nav = h("nav", "chips cl-filter", null, "cl-filter");
    nav.setAttribute("aria-label", "Repository");
    const choice = (words, query, on, key) => {
      const anchor = link(on ? "chip on" : "chip", pathOf(routeTo("changelog", query)), words, key);
      if (on) anchor.setAttribute("aria-current", "page");
      return anchor;
    };
    nav.append(choice("All", {}, filter === null, "filter-all"));
    for (const name of names) nav.append(choice(name, { repo: name }, name === filter, "filter:" + name));
    return nav;
  }

  /**
   * One line per stale repository, under a filter too, so these lines and the empty words' stale check
   * read the same repositories: its name and its last good read, or that it has not been read yet.
   */
  function changelogStale(repos, now) {
    const box = h("div", "cl-stale", null, "cl-stale");
    for (const repo of repos) {
      const name = txt(repo.repo);
      if (repo.stale !== true) continue;
      const at = parse(repo.readAt);
      const line = h("p", "cl-stale-line", null, "stale:" + name);
      if (at === null) line.append(name + ": has not been read yet");
      else line.append(name + ": last good read ", clockText("span", null, dayClock(at, now)));
      box.append(line);
    }
    return box.childNodes.length === 0 ? null : box;
  }

  /** The key the patch pairs an entry by, and the open set holds it under: its repository and path. */
  function changelogKey(entry) {
    return "entry:" + txt(entry.repo) + ":" + txt(entry.path);
  }

  /** A reference line, Corrects or Corrected by, with the other entry's path as text. */
  function changelogRef(words, path) {
    const line = h("p", "cl-ref");
    line.append(words + " ", h("span", "mono", path));
    return line;
  }

  /**
   * One entry: its title, kind, product and repository, then What changed and Why, and a toggle that
   * opens the other parts and the Corrects and Corrected by lines. An unreadable row draws its path and
   * that the file is not a changelog entry. Every value is set as text, a part's through `briefGrid`.
   */
  function changelogEntry(entry) {
    const key = changelogKey(entry);
    const card = h("article", "card pad cl-entry", null, key);
    const meta = h("div", "cl-meta");
    if (entry.unreadable === true) {
      meta.append(h("span", "cl-repo", txt(entry.repo)));
      card.append(h("p", "cl-path mono", txt(entry.path)), h("p", "muted cl-unreadable", "This file is not a changelog entry."), meta);
      return card;
    }
    if (txt(entry.kind) !== "") meta.append(h("span", "badge cl-kind", txt(entry.kind)));
    if (txt(entry.product) !== "") meta.append(h("span", "cl-product", txt(entry.product)));
    meta.append(h("span", "cl-repo", txt(entry.repo)));
    // The title's id names it to the toggle below. Encoding the key keeps whitespace out of the id,
    // since `aria-describedby` reads a space-separated list of ids.
    const titleId = "cl-title:" + encodeURIComponent(key);
    const title = h("h3", "cl-title", txt(entry.title || entry.path));
    title.id = titleId;
    card.append(title, meta);
    const parts = list(entry.parts).filter((part) => part && txt(part.label) !== "" && txt(part.text) !== "");
    const shown = parts.filter((part) => CHANGELOG_SHOWN.includes(part.label));
    const rest = parts.filter((part) => !CHANGELOG_SHOWN.includes(part.label));
    const corrects = txt(entry.corrects);
    const correctedBy = txt(entry.correctedBy);
    if (shown.length > 0) card.append(briefGrid(shown));
    if (rest.length === 0 && corrects === "" && correctedBy === "") return card;
    const open = changelogHeld.open.has(key);
    if (open) {
      if (rest.length > 0) card.append(briefGrid(rest));
      if (corrects !== "") card.append(changelogRef("Corrects:", corrects));
      if (correctedBy !== "") card.append(changelogRef("Corrected by:", correctedBy));
    }
    const button = h("button", "linkbtn cl-toggle", open ? "Show less" : "Show more", "toggle");
    button.type = "button";
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.setAttribute("aria-describedby", titleId);
    listen(button, "click", () => {
      if (changelogHeld.open.has(key)) changelogHeld.open.delete(key);
      else changelogHeld.open.add(key);
      redrawNeeds();
    });
    card.append(button);
    return card;
  }

  /**
   * The entries in the view's order, with a day heading wherever a row's local landing day differs from
   * the row above it. A heading is keyed by its day and that day's run ordinal, 0 for the day's first
   * run, so a new entry landing under an unchanged heading leaves the heading's key, and the heading, as it was.
   */
  function changelogList(entries, now) {
    const box = h("div", "cl-list", null, "cl-list");
    const runs = new Map();
    let lastDay = null;
    for (const entry of entries) {
      const ms = parse(entry.at);
      const day = ms === null ? null : new Date(ms).toDateString();
      if (day !== null && day !== lastDay) {
        const run = runs.get(day) ?? 0;
        runs.set(day, run + 1);
        box.append(h("h2", "cl-day", dayOf(entry.at, now), "day:" + day + ":" + run));
      }
      lastDay = day;
      box.append(changelogEntry(entry));
    }
    return box;
  }

  /** What follows the list: Show older, the line to pick a repository at the ceiling with no filter set, or the count of older entries in the folder. */
  function changelogFoot(view, filter) {
    const count = changelogHeld.count;
    if (view.more === true && count < CHANGELOG_MAX) {
      const button = h("button", "linkbtn cl-older", "Show older", "cl-older");
      button.type = "button";
      listen(button, "click", () => {
        changelogHeld.count = Math.min(CHANGELOG_MAX, changelogHeld.count + CHANGELOG_STEP);
        refreshView();
      });
      return button;
    }
    if (view.more === true) return filter === null ? h("p", "muted cl-foot", "Pick a repository to reach older entries.", "cl-foot") : null;
    const older = num(view.older);
    if (older === null || older <= 0) return null;
    const folder = filter === null ? " in each repository's docs/changelog/ folder." : " in the repository's docs/changelog/ folder.";
    return h("p", "muted cl-foot", plural(older, "older entry is", "older entries are") + folder, "cl-foot");
  }

  /**
   * The Changelog screen, drawn as one pane: the repository filter, a line per stale repository, the
   * entries under their day headings, then Show older or the line that stands for it. With no entries
   * from a rollout source that has been read, and nothing held or stale to explain it, the screen says
   * no entry has landed yet; a source not yet read draws no such words, since nothing was read.
   */
  function renderChangelog(view) {
    const now = nowOf(view);
    const repos = objects(view.repos);
    const filter = typeof view.repo === "string" ? view.repo : null;
    const entries = objects(view.entries);
    const top = h("div", "top", null, "top");
    const row = h("div", "top-row");
    row.append(h("h1", null, "Changelog"), stamp(view));
    top.append(row);
    const parts = [top, changelogFilter(repos, filter)];
    const stale = changelogStale(repos, now);
    if (stale !== null) parts.push(stale);
    if (entries.length > 0) parts.push(changelogList(entries, now));
    else if (parse(isObject(view.asOf) ? view.asOf.rollout : null) !== null && !list(view.held).includes("rollout") && !repos.some((repo) => repo.stale === true)) {
      parts.push(h("p", "muted cl-empty", "No changelog entries have landed yet.", "cl-empty"));
    }
    const foot = changelogFoot(view, filter);
    if (foot !== null) parts.push(foot);
    // Rollout is this screen's only source, so an unread one still draws its note rather than leave the screen silent.
    parts.push(sources(view, ["rollout"], true));
    const out = document.createDocumentFragment();
    out.append(pane("whole", ...parts));
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Talk page
  // ---------------------------------------------------------------------------------------------

  /** The thread link is the one URL the page did not build from route text; only Discord's is drawn. */
  const DISCORD_PREFIX = "https://discord.com/";
  const KIND_WORDS = { mirror: "mirrored", prompt: "prompt", peer: "peer", question: "question", notice: "notice" };

  /** The receipt stages as the page words them; a line with none shows no word. */
  const RECEIPT_WORDS = { delivered: "delivered", "picked-up": "read", answered: "answered", noted: "noted", warned: "warned" };
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

  /** What the status line says while a sent line's request has timed out and the ring has not carried it. */
  const UNCONFIRMED_WORDS = "The broker has not answered yet. The line shows here once it lands.";
  /**
   * How long an echo whose request ended with no readable answer reads not yet confirmed before it
   * reads may not have sent: past this, the operator looks for the line in the thread rather than waits.
   */
  const UNSENT_MARK_MS = 5 * 60 * 1000;

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
   * is whether the last reading held any waiting card. `echoes` holds the lines the composer sent
   * that the ring has not carried back yet, each drawn after the ring's lines until a poll brings
   * its own copy. A line of files alone has no words to draw, so its echo is held and never shown.
   */
  const talk = { lineage: null, lines: [], echoes: [], nextSeq: 0, ringStart: null, plan: null, draft: "", picked: [], sending: false, sends: 0, status: null, acting: false, pendingStatus: null, drawn: new Set(), seeded: false, waiting: false };

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
      talk.echoes = [];
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
      else if (seq > seen) {
        talk.lines.push(line);
        landEcho(line);
      }
    }
    if (talk.lines.length > 200) talk.lines.splice(0, talk.lines.length - 200);
    talk.nextSeq = num(view.nextSeq) ?? talk.nextSeq;
    talk.ringStart = stamp ?? talk.ringStart;
    settlePending(view);
    return view;
  }

  /**
   * The code points the broker strips from a line before its ring copy, `isInvisible` in
   * `broker/sanitize.ts`: C0 but the tab, DEL, the soft hyphen, the Arabic letter mark, the
   * zero-width family and the bidi marks, the bidi embeddings and isolates, the word joiner family, the variation selectors, the
   * byte order mark and the tag block. A phone's emoji keyboard adds a variation selector to many
   * emoji, so the typed words and the ring's copy differ until both pass through this.
   */
  function invisibleCode(code) {
    return (code <= 0x1f && code !== 0x09) || code === 0x7f || code === 0x00ad || code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x2064) || (code >= 0x2066 && code <= 0x2069) ||
      (code >= 0xfe00 && code <= 0xfe0f) || code === 0xfeff || (code >= 0xe0000 && code <= 0xe007f);
  }

  /**
   * A line's words as the match compares them: the invisible class gone and the ends trimmed. The
   * three odd line breaks U+0085, U+2028 and U+2029 go too, because the broker turns each into a
   * newline before the ring copy and the newline goes here as a control, so the typed line must lose
   * them as well or it never pairs with its copy.
   */
  function matchWords(text) {
    return Array.from(text).filter((character) => {
      const code = character.codePointAt(0);
      return !invisibleCode(code) && code !== 0x85 && code !== 0x2028 && code !== 0x2029;
    }).join("").trim();
  }

  /**
   * Takes the echo a landed line's words pair with off the list and marks it landed, or answers null
   * where none has those words. An echo whose request is out or was delivered is taken before one
   * whose request ended with no readable answer, since a line resent after such an end is the one
   * the broker is known to hold. A line of files alone carries no words, so its held echo pairs with
   * words that are empty.
   */
  function takeEcho(words) {
    const matches = (echo) => matchWords(echo.text) === words;
    let at = talk.echoes.findIndex((echo) => echo.mark !== "not yet confirmed" && matches(echo));
    if (at < 0) at = talk.echoes.findIndex(matches);
    if (at < 0) return null;
    const [echo] = talk.echoes.splice(at, 1);
    echo.landed = true;
    return echo;
  }

  /**
   * Drops the echo a newly arrived ring line carries back: an inbound operator line whose author
   * ends in " (page)" and whose words are the echo's, both read through `matchWords`. Only a line
   * arriving for the first time is matched, so two sends of the same words each wait for a line of
   * their own, in `takeEcho`'s order. A
   * landed line was delivered, so while no send has started since and no delivered answer settled
   * it first, the composer settles as a delivered line's does, at the landing even while the
   * request is still out, and a status still speaking of the send reads Sent., or Answered. for a
   * typed answer to a held question. A later send owns the
   * composer and the status, so a landing after it changes neither.
   */
  function landEcho(line) {
    if (line.kind !== "inbound" || line.senderClass !== "operator" || !txt(line.author).endsWith(" (page)")) return;
    const echo = takeEcho(matchWords(txt(line.text)));
    if (echo === null || echo.settled || echo.send !== talk.sends) return;
    settleLanded(echo);
    // Settled here, so a refusal that moves this landing by `moveLanding` knows the composer took it.
    echo.settled = true;
    if (talk.status === UNCONFIRMED_WORDS || talk.status === "Sending.") talk.status = echo.answering ? "Answered." : "Sent.";
  }

  /**
   * Moves the landing a refused send's echo took to the next echo with the same words, and answers
   * whether one took it. The broker's refusal says this send delivered nothing, so the line that
   * landed was an earlier send of the same words, which still waits on the list. With no such echo
   * the landing stays where it is, since a line on the page is the broker's word that it holds one.
   * Where the landing settled the composer, by `settleLanded` in `landEcho`, it took the refused
   * send's files out of the picks and its words out of the composer. The picks come back, ahead of
   * any picked since, less the files the earlier send carried, which it delivered. The words both
   * sends carried leave: the composer is not touched again, so a draft typed since the landing,
   * the words among it or not, stays as typed.
   */
  function moveLanding(echo) {
    const taken = takeEcho(matchWords(echo.text));
    if (taken === null) return false;
    if (echo.settled) {
      const back = echo.picked.filter((pick) => talk.picked.indexOf(pick) < 0).concat(talk.picked);
      talk.picked = back.filter((pick) => taken.picked.indexOf(pick) < 0);
    }
    return true;
  }

  /**
   * The mark an echo draws. One whose request ended with no readable answer reads not yet confirmed
   * until the timer that end set, `UNSENT_MARK_MS` long, flags it unsent, then may not have sent,
   * which stays until the echo lands or a change of persona, a reload or a broker restart clears
   * it. The timer is the one clock, so a wall clock moved back cannot hold the first mark past the
   * moment. The mark held on the echo is unchanged, so the echo still pairs in `takeEcho`'s order.
   */
  function echoMark(echo) {
    return echo.mark === "not yet confirmed" && echo.unsent ? "may not have sent" : echo.mark;
  }

  /**
   * Takes a landed line's words out of the composer and its files out of the picks, as a delivered
   * line's are. A draft that is the words as `matchWords` compares them is the line itself, however
   * the two differ in the invisible class, so it clears whole and leaves no invisible remainder to
   * send. A draft that no longer starts with the words was rewritten and is left as typed.
   */
  function settleLanded(echo) {
    const words = matchWords(echo.text);
    const draft = talk.draft.trimStart();
    if (words !== "" && matchWords(draft) === words) talk.draft = "";
    else if (echo.text !== "" && draft.startsWith(echo.text)) talk.draft = draft.slice(echo.text.length).trimStart();
    talk.picked = talk.picked.filter((pick) => echo.picked.indexOf(pick) < 0);
  }

  /** Takes one echo off the page, where it is still there. */
  function dropEcho(echo) {
    const at = talk.echoes.indexOf(echo);
    if (at >= 0) talk.echoes.splice(at, 1);
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

  /** The key the Today and ask pages keep the touched asks under. */
  const TOUCHED_KEY = "channels.needs-me.touched";

  /** Reads the plan's title and section count once, for the heading card; a failed read leaves the card out. */
  async function loadTalkPlan() {
    const url = planUrl();
    if (url === null) return;
    const here = visit;
    const lineage = talk.lineage;
    try {
      const view = await fetchView(url);
      if (here !== visit || talk.lineage !== lineage) return;
      talk.plan = { title: txt(view.title), sections: list(view.sections).length };
      if (lastView !== null) draw(lastView);
    } catch (error) {
      talk.plan = null;
    }
  }

  /**
   * Reads the ring now, off the poll's timer, and draws what came back. An answer the page has left
   * draws nothing: one for another lineage, or one arriving after the shell moved to another screen
   * visit, so a talk view is never drawn through another screen's renderer.
   */
  async function refreshTalk() {
    const here = visit;
    const view = await talkAccept(await fetchView(talkUrl()));
    if (view === null || here !== visit) return;
    draw(view);
    lastView = view;
    lastOk = Date.now();
    notice.hidden = true;
  }

  /** Points the talk state at a lineage and drops what was held for the last one: its lines, echoes, ring, statuses and plan. */
  function resetTalk(lineage) {
    talk.lineage = lineage;
    talk.lines = [];
    talk.echoes = [];
    talk.nextSeq = 0;
    talk.ringStart = null;
    talk.plan = null;
    talk.status = null;
    talk.pendingStatus = null;
    talk.drawn = new Set();
    talk.seeded = false;
    talk.waiting = false;
    // A kept id names a file saved for the old lineage's session, so each pick is sent again.
    for (const pick of talk.picked) pick.id = null;
  }

  /**
   * Points the page at another lineage: the drawn lines go, and the whole ring is fetched. The
   * address and the place the shell holds move together, so a later link to either lineage is told
   * apart from the screen drawn. The entry keeps its state, so Close still steps back where `closesBack` says so.
   */
  async function retarget(lineage) {
    if (lineage === talk.lineage) return;
    resetTalk(lineage);
    history.replaceState(history.state, "", talkPath(lineage));
    const at = routeOf(window.location);
    if (at !== null) lastPlace = placeOf(at);
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
   * Posts one line to the say route and answers the status word the broker gave it. The talk
   * composer and the Workers board's acts both send through here. An answer that is not a 2xx throws
   * an `Unreadable` carrying its HTTP status; a timeout, a dropped connection or a body that is not
   * JSON throws as the browser threw it.
   */
  async function postSay(body, timeoutMs) {
    const response = await fetch("/web/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Unreadable("the broker answered HTTP " + response.status, response.status);
    const answer = await response.json();
    return txt(answer.status);
  }

  /**
   * Whether a failed say post was the broker refusing the line: a 4xx, so nothing was sent. A 5xx
   * may come after the broker read the line, and a post with no answer may have landed, so the
   * state of either is unknown.
   */
  function refusedSay(error) {
    return error instanceof Unreadable && error.status !== null && error.status >= 400 && error.status < 500;
  }

  /** The status line's words for the say route's status word: Sent or Answered for a line that landed, else why nothing was sent. */
  function sayWords(status) {
    if (status === "delivered") return "Sent.";
    if (status === "answered") return "Answered.";
    return Object.prototype.hasOwnProperty.call(SEND_WORDS, status) ? SEND_WORDS[status] : "The broker answered " + status + "; nothing was sent.";
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
   * The line's words draw as an echo marked sending once its files are up, and a poll that
   * carries the ring's own copy replaces it. The broker's readable answer that nothing was sent, and its refusal with an
   * HTTP 4xx, take the echo away. A request that ends any other way once it is out, by a timeout, a
   * dropped connection, an HTTP 5xx or an unreadable body, keeps it, marked not yet confirmed, since
   * the broker may still deliver the line; `echoMark` reads it may not have sent once the timer set
   * at that end, `UNSENT_MARK_MS` long, flags it, and the timer draws the page then, since a broker
   * that is down answers no poll. A refusal of a send whose echo already took a landing, while an
   * earlier send of the same words still waits, moves that landing to the earlier send, by
   * `moveLanding`, which gives the refused send's files back to the picks. A failure
   * before the request goes out, such as an upload
   * the broker refused, sent nothing. A line of files alone keeps an echo the transcript never
   * draws, so its landing settles the picks as a line with words does.
   */
  async function sendLine(answers) {
    const answering = answers === true;
    const text = talk.draft.trim();
    const picked = answering ? [] : talk.picked.slice();
    const lineage = talk.lineage;
    if ((text === "" && picked.length === 0) || talk.sending || lineage === null) return;
    talk.sending = true;
    const send = ++talk.sends;
    talk.status = "Sending.";
    if (lastView !== null) draw(lastView);
    let echo = null;
    let posted = false;
    let said = false;
    try {
      for (const pick of picked) if (pick.id === null) pick.id = await uploadFile(pick, lineage);
      const ids = picked.map((pick) => pick.id);
      // A line of files alone has no words to draw, so its echo is held and never shown. A pill
      // tapped during the uploads moved the page, so the echo is kept only where the page still
      // shows the line's persona.
      if (lineage === talk.lineage) {
        echo = { text, picked, send, answering, author: "You (page)", at: Date.now(), mark: "sending", unsent: false, landed: false, settled: false, shown: matchWords(text) !== "" };
        talk.echoes.push(echo);
        if (echo.shown && lastView !== null) draw(lastView);
      }
      posted = true;
      const status = await postSay(answering ? { lineage, text, answers: true } : { lineage, text, files: ids }, sayTimeoutMs(ids.length));
      said = true;
      // A line a poll carried back while the request was out settled at its landing, so the answer
      // changes nothing, and the ring is not read again, since the poll that carried it just was.
      // Save where the answer refuses the send while an earlier send of the same words still waits:
      // the refusal says this send delivered nothing, so the landing was that earlier send's and
      // moves to it, and the refusal stands.
      if (echo !== null && echo.landed && (status === "delivered" || status === "answered" || !moveLanding(echo))) return;
      if (status !== "delivered" && status !== "answered") dropEcho(echo);
      if (status === "delivered" || status === "answered") {
        // Only the sent text is cleared. Words typed after it while the send was out are the next
        // draft, without the space that joined them; a draft that no longer starts with the sent
        // text was rewritten mid-send and is left as typed.
        const draft = talk.draft.trimStart();
        if (draft.startsWith(text)) talk.draft = draft.slice(text.length).trimStart();
        // The same for the files: those picked after the send began stay for the next line.
        talk.picked = talk.picked.filter((pick) => picked.indexOf(pick) < 0);
        if (echo !== null) echo.settled = true;
      } else if (status === "unknown-file") {
        // The ids name files saved for a session no longer live; the picks stay for the next send.
        for (const pick of talk.picked) pick.id = null;
      }
      talk.status = sayWords(status);
      talk.sending = false;
      await refreshTalk();
    } catch (error) {
      // Once the broker has answered, the answer's words stand and a failed read after it is the
      // poll's notice to give. A pill tapped while the send was out moved the page, so its status is
      // left to the persona it now shows. A line a poll carried back while the request was out
      // settled at its landing, so the request's end changes nothing. A request that went
      // out and ended with no readable answer leaves the broker's state unknown, so its echo stays,
      // not yet confirmed, save a 4xx, which is the broker's refusal. An echo cleared before it
      // landed, by a change of persona or a broker restart, takes no such words, since no landing
      // would take them back. A 4xx refusing a send whose echo took a landing, while an earlier
      // send of the same words still waits, moves the landing to that send and the refusal stands.
      if (!said) {
        const here = lineage === talk.lineage;
        const refused = refusedSay(error);
        if (echo !== null && echo.landed && !(refused && moveLanding(echo))) {
          // Settled at its landing.
        } else if (posted && !refused) {
          if (echo !== null) {
            echo.mark = "not yet confirmed";
            // The mark `echoMark` draws changes `UNSENT_MARK_MS` after this end, on the timer's own
            // clock, which flags the echo unsent at that moment and draws it. A broker that is down
            // fails every poll, which draws nothing, so no poll's draw can be relied on to carry the
            // mark. An echo landed or cleared by then is off the list and draws nothing. The end is
            // set once per send, so an echo gets one timer.
            setTimeout(() => {
              echo.unsent = true;
              if (lastView !== null && talk.echoes.indexOf(echo) >= 0) draw(lastView);
            }, UNSENT_MARK_MS);
          }
          if (here && echo !== null && talk.echoes.indexOf(echo) >= 0) talk.status = UNCONFIRMED_WORDS;
        } else {
          dropEcho(echo);
          if (here) talk.status = "Could not send: " + (error instanceof Unreadable ? error.message : "the broker did not answer") + ".";
        }
      }
    } finally {
      talk.sending = false;
      // One send is out at a time, so a status still saying so is this send's, and it has ended.
      if (talk.status === "Sending.") talk.status = null;
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
   * lineage is about a block no longer drawn, so it is dropped unsaid. Once the shell has moved to
   * another screen visit, the reading it holds is that screen's, and the block is never looked for in it.
   */
  async function postPending(name, body) {
    const lineage = talk.lineage;
    const here = visit;
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
      // A refresh from another screen visit drew nothing, so the reading held is not this lineage's.
      if (talk.lineage !== lineage || here !== visit) return;
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
  function pendingButton(cls, words, key, onClick) {
    const button = h("button", cls, words);
    button.type = "button";
    button.disabled = talk.acting;
    button.dataset.key = key;
    listen(button, "click", onClick);
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
    const card = h("div", "ask", null, "q:" + id);
    // Each question keeps its position in the ask, which is what a pick sends as its index.
    list(entry.questions).forEach((question, at) => {
      if (question === null || typeof question !== "object") return;
      const line = h("div", "ask-line", null, "question:" + at);
      line.append(h("span", "ask-tag", "ASK:"), " ");
      if (txt(question.header) !== "") line.append(h("b", null, txt(question.header)), " · ");
      line.append(txt(question.question));
      card.append(line);
      if (entry.answerable !== true) return;
      const options = list(question.options).filter((option) => option !== null && typeof option === "object" && num(option.index) !== null);
      const group = h("div", "ask-options", null, "options:" + at);
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
    const card = h("div", "perm", null, "p:" + requestId);
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
    const card = h("section", "card pad attn waiting", null, "waiting");
    card.setAttribute("aria-label", "Waiting on you");
    card.append(label("Waiting on you", "h2"));
    // One slot of fixed height sits above the cards and is always drawn, so a card arriving behind it
    // changes the slot's words and nothing else: no drawn button moves, whether or not the reader is at the foot.
    const held = pendingKeys(view).filter((key) => !talk.drawn.has(key)).length;
    const slot = h("div", "held-slot");
    if (held > 0) {
      const more = h("button", "held-more", held + " more waiting");
      more.type = "button";
      more.dataset.key = "held-more";
      listen(more, "click", showHeld);
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

  /**
   * A talk line's head: its author, its time, and its class where a participant wrote it, so a
   * participant who took the operator's name still reads as one. The talk page and an item's Context
   * both draw it.
   */
  function talkHead(line, lineage, now) {
    const at = num(line.at);
    const head = h("div", "msg-head");
    const who = talkLabel(line, lineage);
    head.append(h("b", null, who), at === null ? "" : " · " + dayClock(at, now));
    if (line.senderClass === "participant") head.append(" · participant");
    if (Object.prototype.hasOwnProperty.call(KIND_WORDS, line.kind) && KIND_WORDS[line.kind] !== who) head.append(" · " + KIND_WORDS[line.kind]);
    if (Object.prototype.hasOwnProperty.call(RECEIPT_WORDS, line.receipt)) head.append(" · " + RECEIPT_WORDS[line.receipt]);
    if (typeof line.echo === "string") head.append(" · " + line.echo);
    return head;
  }

  function talkLine(line, lineage, now, key) {
    const mine = line.kind === "inbound" && line.senderClass === "operator";
    const box = h("div", "msg" + (mine ? " mine" : ""), null, key);
    box.append(talkHead(line, lineage, now));
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
    top.append(params === null ? back(SCREEN_PATHS.standup, "Standup") : back(planHref(params.root, params.path, lineage), talk.plan ? talk.plan.title || "Plan" : "Plan"));
    const row = h("div", "top-row");
    row.append(h("h1", null, lineage));
    top.append(row);
    out.append(top);

    // The plan card and the session pills arrive after the first draw, so each is keyed and the parts after them never pair with them by place.
    if (talk.plan !== null) {
      const card = h("section", "card pad", null, "about");
      card.setAttribute("aria-label", "Talking about");
      const head = h("div", "section-head");
      head.append(label("Talking about", "h2"));
      if (params !== null) head.append(link("tall", planHref(params.root, params.path, lineage), "Plan"));
      card.append(head);
      const what = h("div", "talk-about");
      what.append(h("b", null, talk.plan.title));
      if (talk.plan.sections > 0) what.append(" · " + talk.plan.sections + (talk.plan.sections === 1 ? " section" : " sections"));
      card.append(what);
      out.append(card);
    }

    const names = list(view.lineages).filter((name) => typeof name === "string");
    if (names.length > 0) {
      const pills = h("div", "chips", null, "pills");
      pills.setAttribute("role", "group");
      pills.setAttribute("aria-label", "Sessions to talk with");
      for (const name of names) {
        const pill = h("button", name === lineage ? "chip on" : "chip", name);
        pill.type = "button";
        pill.setAttribute("aria-pressed", name === lineage ? "true" : "false");
        pill.dataset.key = "pill-" + name;
        listen(pill, "click", () => retarget(name));
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
    const transcript = h("section", "transcript", null, "transcript");
    transcript.setAttribute("aria-label", "Conversation");
    const shown = talk.echoes.filter((echo) => echo.shown);
    if (lines.length === 0 && shown.length === 0) transcript.append(h("div", "muted talk-empty", "No lines yet."));
    // A ring line's key is its sequence number, and an echo's the count of the send that made it.
    for (const line of lines) transcript.append(talkLine(line, lineage, now, "line:" + String(line.seq)));
    // Sent lines the ring has not carried back yet, in the operator's own style.
    for (const echo of shown) transcript.append(talkLine({ kind: "inbound", senderClass: "operator", author: echo.author, text: echo.text, at: echo.at, echo: echoMark(echo) }, lineage, now, "echo:" + String(echo.send)));
    out.append(transcript);

    const newest = lines.length === 0 ? null : num(lines[lines.length - 1].at);
    const note = h("div", "note", (newest === null ? "no lines yet" : "newest line " + dayClock(newest, now)) + " · as of ");
    note.append(clockText("span", null, dayClock(now, now)));
    out.append(note);

    // What the session is held on, between the conversation and the composer, so the composer's
    // typed line sits under the question it can answer.
    const waiting = pendingSection(view);
    if (waiting !== null) out.append(waiting);

    // The composer. The draft lives in `talk.draft` and is what the line is built with, so the patch
    // keeps the live line, its caret and its focus. While a question waits on a typed answer,
    // Enter and Send post the line as that answer, as a message in the Discord thread would be.
    const answering = takesTypedAnswer(view);
    const composer = h("div", "composer", null, "composer");
    // The file chips draw above the row only while files are picked, so the row is keyed and its line never pairs with the chips by place.
    const field = h("div", "composer-row", null, "row");
    const input = h("input", "compose-input");
    input.type = "text";
    input.id = "talk-compose";
    input.maxLength = 4000;
    input.autocomplete = "off";
    input.enterKeyHint = "send";
    input.placeholder = "Message " + lineage;
    input.value = talk.draft;
    input.dataset.key = "talk-compose";
    listen(input, "input", (event) => {
      talk.draft = event.currentTarget.value;
    });
    listen(input, "keydown", (event) => {
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
    send.dataset.key = "talk-send";
    listen(send, "click", () => sendLine(answering));
    const compose = h("label", "sr", "Message to " + lineage);
    compose.htmlFor = "talk-compose";
    // The picker is the browser's own file input, kept out of sight; the Attach button opens it, so
    // the control the operator taps is a full-size button and the input's own drawing never shows.
    const picker = h("input", null);
    picker.type = "file";
    picker.multiple = true;
    picker.hidden = true;
    picker.id = "talk-file";
    picker.dataset.key = "talk-file";
    listen(picker, "change", (event) => pickFiles(event.currentTarget.files));
    const attach = h("button", "attach", "Attach");
    attach.type = "button";
    attach.disabled = talk.sending || talk.picked.length >= MAX_FILES;
    attach.setAttribute("aria-label", "Attach files");
    attach.dataset.key = "talk-attach";
    // The picker on the page, which is the one the operator's choice lands on, rather than the one built beside this button.
    listen(attach, "click", () => document.getElementById("talk-file").click());
    field.append(compose, picker, attach, input, send);
    if (talk.picked.length > 0) {
      const chips = h("div", "file-chips", null, "files");
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", "Files to send");
      talk.picked.forEach((pick, index) => {
        // A picked file has no id until it is sent, so its chip's key carries its place among the picks.
        const chip = h("div", "file-chip", null, "file:" + String(index) + ":" + pick.name);
        chip.append(h("span", "file-chip-name", pick.name + " · " + byteSize(pick.size)));
        const remove = h("button", "file-chip-remove", "×");
        remove.type = "button";
        remove.disabled = talk.sending;
        remove.setAttribute("aria-label", "Remove " + pick.name);
        remove.dataset.key = "talk-remove-" + index;
        listen(remove, "click", () => {
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

  /** The talk screen's path for a lineage, through the route table, keeping the plan the address names. */
  function talkPath(lineage) {
    const params = planParams();
    const query = params === null ? { lineage } : { lineage, root: params.root, path: params.path };
    return pathOf({ screen: "talk", name: null, query });
  }

  /**
   * The talk screen's list pane: the lineages the talk view lists, by name, the addressed one among
   * them even where its session has ended, each a link to its talk screen, with the one the composer
   * talks to marked.
   */
  function talkList(view) {
    const out = document.createDocumentFragment();
    const lineage = txt(view.lineage);
    const top = h("div", "top", null, "top");
    const row = h("div", "top-row");
    row.append(h("h1", null, "Talk"));
    top.append(row);
    out.append(top);
    const names = list(view.lineages).filter((name) => typeof name === "string" && name !== "").sort();
    if (names.length === 0) {
      out.append(h("p", "muted", "No live session to talk with."));
      return out;
    }
    const card = h("div", "card", null, "lineages");
    card.setAttribute("aria-label", "Sessions to talk with");
    const rows = h("div", "rows");
    for (const name of names) {
      const on = name === lineage;
      const pick = link(on ? "row sel" : "row", talkPath(name), null, "lineage:" + name);
      if (on) pick.setAttribute("aria-current", "true");
      const words = h("div", "name");
      words.append(dot(on ? "blue" : "hollow"), name);
      pick.append(words);
      rows.append(pick);
    }
    card.append(rows);
    out.append(card);
    return out;
  }

  /**
   * The talk screen: the sessions to talk with in the list pane, and the composer with the lines, the
   * waiting prompts and the session pills in the detail pane, the sheet on a phone. Talk has no list
   * of its own without a lineage, so the sheet's Close steps back to the screen it was opened from, as
   * `closesBack` says, and on a load closes to the health screen, whose list holds the sessions.
   */
  function renderTalkScreen(view) {
    const out = document.createDocumentFragment();
    out.append(pane("list", talkList(view)), detailPane(SCREEN_PATHS.health, renderTalk(view)));
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Today page
  // ---------------------------------------------------------------------------------------------

  /**
   * What the broker's answer to an act means, in the operator's words: the router's word for the line,
   * or the broker's reason for sending none. `actWords` reads `delivered` as the act's own word with the
   * session it went to, and a blocked run's `changed` as its own.
   */
  const ACT_WORDS = {
    "no-session": "no live session, left open",
    ended: "that session has ended, left open",
    "no-thread": "the session has no Discord thread yet, left open",
    "no-channel": "the session is not connected to the broker, left open",
    rate: "too many lines in the last minute, left open",
    empty: "the line was empty, so nothing was sent, left open",
    "unknown-file": "a file the line named is no longer held, so nothing was sent, left open",
    closed: "already closed",
    handled: "dismissed",
    "already-acted": "already acted on from a page",
    "no-recommendation": "no recommendation to agree to",
    changed: "the ask changed since you read it, read it again",
    "refused: blocking": "refused: blocking, answer this one yourself",
  };

  /** The word a delivered line reads, by the act that sent it. */
  const DELIVERED_WORDS = { agree: "agreed", correct: "answered", dismiss: "dismissed" };

  /** Each act's name, for the words beside an item whose answer could not be read; the `correct` route's act is Answer on the page. */
  const ACT_NAMES = { agree: "Agree", correct: "Answer", dismiss: "Dismiss" };

  /** How long a dismissed item's toast offers Undo before its Dismiss is posted. */
  const UNDO_MS = 5000;

  /** How far left a card on the phone layout must travel under a finger to dismiss it. */
  const SWIPE_PX = 80;

  /** How far a pointer may travel on a card and still be a tap that selects the row. */
  const TAP_SLOP_PX = 10;

  /** The phone layout, under the stylesheet's first breakpoint, where a card takes the swipe. */
  const PHONE_QUERY = "(max-width: 699px)";

  /** The one origin a review's Open PR link may point at; the broker admits the URL under a github.com pull request pattern too. */
  const GITHUB_PREFIX = "https://github.com/";

  /** A blocked run's `changed`: the reason the page drew is no longer the block's. */
  const BLOCK_CHANGED_WORDS = "the block's reason changed since you read it, read it again";

  /** A review's `changed`: the pull request's ready line or its number is no longer the one the page drew. */
  const REVIEW_CHANGED_WORDS = "the pull request changed since you read it, read it again";

  /**
   * A Today headline is cut at this many code points, an ellipsis marking the cut, and the whole
   * text is in the item's Context. Two upstream readers cut a text with no mark before it reaches the
   * page. The broker's ledger reader keeps 1,000 code points of an ask's stored question, which is
   * `<question>? Recommend: <recommend>`: a cut in the Recommend tail goes with the segment the views
   * drop, and a cut in the question itself leaves a question longer than this bound. The persona
   * plugin keeps 300 UTF-16 units of a session's `BLOCKED:` line for a blocked run's reason. A bound
   * under both makes every such text end in the ellipsis here.
   */
  const HEADLINE_POINTS = 200;

  /** The conversation kinds a Context draws from the session's talk ring, and how many of the newest. */
  const CONTEXT_KINDS = ["reply", "mirror", "prompt", "inbound"];
  const CONTEXT_LINES = 5;

  /** The most items one batch carries where the view names no cap; the view's `maxBatch` is the broker's own bound. */
  const DEFAULT_MAX_BATCH = 64;

  /** The batch cap the Today view carries, or the default where it is absent. */
  function batchCap(view) {
    const cap = num(view.maxBatch);
    return cap !== null && cap >= 1 ? Math.floor(cap) : DEFAULT_MAX_BATCH;
  }

  /**
   * What the Today and ask pages hold between polls: the asks the operator acted
   * on in this tab, kept in its session storage, which the batch leaves alone; the words beside each
   * item from its last act; whether an act is out, and the items it is out for; each item whose line
   * was delivered, with the reading it was drawn from, which a newer reading replaces; the Answer box
   * open, by its item's key, with its draft; each open Context, by its item's key; and the Context the
   * Today detail pane read for the item it shows, the brief, plan title and conversation it draws or
   * an approve item's plan,
   * with the reading it was read under, dropped once the detail shows another item so a return reads
   * it afresh, or once a newer reading is drawn where the read failed. `processing`
   * holds each item whose Agree was tapped, until a reading no longer carries it or the post fails.
   * `pending` is the dismissal whose toast is up, `{ key, item, timer, toast }`, and `posting` the keys
   * whose Dismiss post is out; every draw leaves the items under either off the list and the counts.
   * `swipe` is the card a finger is on,
   * `{ key, pointer, x, y, moved, sideways }`, and `swiped` the key of the card whose swipe ended, so
   * the tap that ends it does not select the row.
   */
  const needsMe = {
    touched: loadTouched(),
    statuses: new Map(),
    acting: false,
    out: new Set(),
    delivered: new Map(),
    correct: null,
    context: new Map(),
    detail: new Map(),
    processing: new Set(),
    pending: null,
    posting: new Set(),
    swipe: null,
    swiped: null,
  };

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

  /** The key any item's page state is held under: an ask's `needsKey`, a blocked run's lineage and queue entry, a review's lineage and queue entry. */
  function itemKey(item) {
    if (item.kind === "review") return JSON.stringify([item.repo, "review", txt(item.entryId)]);
    return item.kind === "blocked" ? JSON.stringify([item.repo, "blocked", txt(item.entryId)]) : needsKey(item);
  }

  /** When an item came up: a review's ready time, any other item's opening time; null where it names none. */
  function openedOf(one) {
    return parse(one.kind === "review" ? one.readyAt : one.openedAt);
  }

  /** Whether every draw leaves the item off: its Dismiss toast is up, or its Dismiss post is out. */
  function dismissing(one) {
    const key = itemKey(one);
    return (needsMe.pending !== null && needsMe.pending.key === key) || needsMe.posting.has(key);
  }

  /** A review's or a Workers row's pull request number where it is a positive integer, the key a review Dismiss names where there is one; null otherwise. */
  function reviewNumber(one) {
    const number = num(one.pullRequest);
    return number !== null && Number.isInteger(number) && number > 0 ? number : null;
  }

  /**
   * Whether the item takes Dismiss: an ask naming its id, a blocked run naming its queue entry, and a
   * review naming its queue entry, keyed by its pull request number where it has one. A hands item never does.
   */
  function dismissable(one) {
    if (txt(one.repo) === "") return false;
    if (one.kind === "ask") return txt(one.askId) !== "";
    if (one.kind === "blocked") return txt(one.entryId) !== "";
    return one.kind === "review" && txt(one.entryId) !== "";
  }

  /** The words beside an item once its act is answered; a status the table lacks is named as the broker said it. */
  function actWords(status, act, item) {
    if (status === "delivered") return DELIVERED_WORDS[act] + ", sent to " + txt(item.repo);
    if (status === "changed" && item.kind === "blocked") return BLOCK_CHANGED_WORDS;
    if (status === "changed" && item.kind === "review") return REVIEW_CHANGED_WORDS;
    return Object.prototype.hasOwnProperty.call(ACT_WORDS, status) ? ACT_WORDS[status] : "the broker answered " + status + ", left open";
  }

  /** An ask the broker can agree to: it names its lineage and id, and carries a recommendation. */
  function agreeable(item) {
    return item.kind === "ask" && txt(item.repo) !== "" && txt(item.askId) !== "" && txt(item.recommend).trim() !== "";
  }

  /** Whether a delivered line hides the item from this reading: the reading it was drawn from when the answer came. */
  function deliveredIn(view, item) {
    return needsMe.delivered.get(itemKey(item)) === view;
  }

  /** Posts to an act route and answers its JSON; a refusal or a broken answer throws with the words for it. */
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
    if (!response.ok) throw new Unreadable("the broker answered HTTP " + response.status, response.status);
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
   * Fetches the reading again, with the readings drawn beside it as the poll reads them, and draws it,
   * so an ask whose recommendation changed, or a rollout just marked, shows the new text now in both
   * panes rather than on the next poll; a fetch that fails draws the last reading instead. An answer
   * arriving after the shell moved to another screen visit draws nothing, so a reading is never drawn
   * through another screen's renderer, and neither does a Changelog answer for a count or filter the
   * screen no longer asks for, so a late shorter list never replaces the longer one Show older drew.
   */
  async function refreshView() {
    const here = visit;
    try {
      const url = page.url();
      const [read] = await Promise.all([fetchView(url), fetchBeside()]);
      if (here !== visit || (screen === "changelog" && url !== changelogUrl())) return;
      const view = await acceptView(read, here);
      if (view === null || here !== visit) return;
      lastView = view;
      lastOk = Date.now();
      draw(view);
    } catch (error) {
      if (here !== visit) return;
      if (isGone(error)) drawGone();
      else redrawNeeds();
    }
  }

  /**
   * The body an Agree sends: the ask, its lineage, the recommendation this page drew, and the question
   * and the two times that name the version it drew, each of which the broker matches before it delivers.
   */
  function agreeBody(item) {
    return { askId: item.askId, repo: item.repo, recommend: txt(item.recommend), question: txt(item.text), openedAt: item.openedAt, reraisedAt: item.reraisedAt };
  }

  /** The words beside an item whose act could not be confirmed: the broker may or may not have sent it. */
  function unconfirmed(error, act) {
    return (error instanceof Unreadable ? error.message : "no answer") + ", so the " + ACT_NAMES[act] + " is not confirmed";
  }

  /**
   * Sends one act on one item and draws the broker's word beside it. One act at a time: the `acting`
   * flag refuses a second while one is out, and every act button is disabled until the answer. The item
   * takes the acting highlight and reads `sending` at once. A delivered line takes the item off the
   * reading it was drawn from, so it leaves the list on that redraw and the next reading decides again;
   * any other answer, or none, leaves it with the broker's word and its buttons live. A `changed` reads
   * the view again, so the item shows the text the broker now holds. A review's Dismiss delivers no
   * line and answers `handled` once its mark is written, which takes the item off as a delivered line
   * does. Answers whether it was delivered or, for that Dismiss, handled. A caller passing `said`
   * finds the words set beside the item in `said.words`, taken before the redraw, which drops the words
   * of an item the reading no longer holds.
   */
  async function sendAct(item, act, body, said = null) {
    if (needsMe.acting) return false;
    const key = itemKey(item);
    if (item.kind === "ask") touch(key);
    needsMe.acting = true;
    needsMe.out.add(key);
    needsMe.statuses.set(key, "sending");
    redrawNeeds();
    // The visit the act was sent on: once the shell has moved on, the reading held is another screen's.
    const here = visit;
    let status = null;
    try {
      const answer = await postAgree(act, body, TIMEOUT_MS);
      status = txt(answer.status);
      needsMe.statuses.set(key, actWords(status, act, item));
    } catch (error) {
      needsMe.statuses.set(key, unconfirmed(error, act));
    } finally {
      needsMe.acting = false;
      needsMe.out.delete(key);
      if (said !== null) said.words = needsMe.statuses.get(key) ?? null;
      if (landed(status, act)) {
        if (lastView !== null && here === visit) needsMe.delivered.set(key, lastView);
        if (needsMe.correct !== null && needsMe.correct.key === key) needsMe.correct = null;
      }
      if (status === "changed") await refreshView();
      else redrawNeeds();
    }
    return landed(status, act);
  }

  /** Whether an act's answer means it took: a delivered line, or a review Dismiss's written mark. */
  function landed(status, act) {
    return status === "delivered" || (act === "dismiss" && status === "handled");
  }

  /**
   * Agrees to one ask on the recommendation this page drew. The item is processing from the tap: its
   * buttons are disabled and it reads "processing" until a reading no longer carries it, so a delivered
   * Agree whose ask the next reading still holds stays disabled rather than offering a second tap. An
   * Agree that was refused, or whose answer could not be read, ends processing with the broker's word,
   * and the buttons come back.
   */
  async function sendAgree(item) {
    const key = itemKey(item);
    if (needsMe.acting) return false;
    needsMe.processing.add(key);
    const delivered = await sendAct(item, "agree", agreeBody(item));
    if (!delivered) {
      needsMe.processing.delete(key);
      redrawNeeds();
    }
    return delivered;
  }

  /**
   * Dismisses one item: an ask by its id with the question, the two times and the recommendation this
   * page drew, the recommendation as the view gave it, null kept as null, a blocked
   * run by its queue entry and the text the view gave it, each of which the broker matches byte for
   * byte, and a review by its lineage and pull request number, or its queue entry's id where it has no number. The body is built from `item` as held
   * at the call, so a Dismiss posted after its Undo notice sends what the operator tapped, never a
   * later reading. `said` is passed to `sendAct` for the words set beside the item.
   */
  function sendDismiss(item, said = null) {
    let body;
    if (item.kind === "review") {
      const number = reviewNumber(item);
      body = number === null ? { kind: "review", repo: item.repo, entryId: item.entryId, readyAt: item.readyAt } : { kind: "review", repo: item.repo, pullRequest: number };
    } else
      body =
        item.kind === "blocked"
          ? { kind: "blocked", repo: item.repo, entryId: item.entryId, reason: txt(item.text) }
          : {
              kind: "ask",
              askId: item.askId,
              repo: item.repo,
              question: txt(item.text),
              openedAt: item.openedAt,
              reraisedAt: item.reraisedAt,
              recommend: item.recommend,
            };
    return sendAct(item, "dismiss", body, said);
  }

  /** Waits until no act is out, so a Dismiss whose toast expired during another act is posted after it rather than refused. */
  async function whenIdle() {
    while (needsMe.acting) await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /** What a dismissal's toast names the item by: a review's plan title, any other item's text, cut short. */
  function dismissHeadline(one) {
    return cutPoints(txt(one.kind === "review" ? one.title : one.text), 60);
  }

  /**
   * Takes a dismissal's toast down where it is still the one shown; a later toast that replaced it is
   * left alone. Where failure notes are held, a plain toast carries them on in its place, so the notes
   * stay until the operator taps Dismiss.
   */
  function clearDismissToast(pending) {
    if (pending.toast === null || !toastBox.contains(pending.toast)) return;
    if (toastNotes.length > 0) showToast(null);
    else toastBox.replaceChildren();
  }

  /**
   * Adds a failed Dismiss's words to the toast notes and to the toast up now, as a line below its own
   * line and command, so a dismissal's Undo and a tag's undo command both stay on screen. With no toast
   * up, a plain toast of the notes opens.
   */
  function showDismissFailure(words) {
    toastNotes.push(words);
    const body = toastBox.querySelector(".toast-body");
    if (body === null) showToast(null);
    else body.append(toastNote(words));
  }

  /**
   * Dismisses an item from the Today list with Undo, or marks an approve item Done: the item leaves the list and the counts at once,
   * and a toast names it with Undo for `UNDO_MS`. Its Dismiss is posted when the toast expires, never
   * before; Undo restores it and posts nothing. A second Dismiss while a toast is up posts the first at
   * once and starts its own toast. Nothing posts from an unload, so an item whose page closes during its
   * toast is back on the next load, as the toast says. Where the address selects the item, the selection
   * moves off it, so the detail shows the next item rather than one leaving. The Undo toast carries any
   * failure notes below its line, as every toast does.
   */
  function dismissLater(one) {
    // A processing item takes no Dismiss, whether from its button, its key or a swipe.
    if (!dismissable(one) || dismissing(one) || needsMe.processing.has(itemKey(one))) return;
    if (needsMe.pending !== null) postDismiss(needsMe.pending);
    const pending = { key: itemKey(one), item: one, timer: null, toast: null };
    needsMe.pending = pending;
    pending.timer = setTimeout(() => postDismiss(pending), UNDO_MS);
    if (screen === "today" && item === itemRowKey(one)) go(routeTo("today", {}), true);
    else redrawNeeds();
    // An approve item's Dismiss is its Done, so the toast names the act the operator tapped.
    const done = one.kind === "review" ? "Done " : "Dismissed ";
    pending.toast = showToast(done + dismissHeadline(one) + ". It stays open if this page closes now.", null, { words: "Undo", run: () => undoDismiss(pending) });
  }

  /**
   * Undo on a dismissal's toast: the item comes back and nothing is posted, and any failure notes the
   * toast carried stay on the plain toast that follows. A toast already expired or posted does nothing.
   */
  function undoDismiss(pending) {
    if (needsMe.pending !== pending) return;
    clearTimeout(pending.timer);
    needsMe.pending = null;
    clearDismissToast(pending);
    redrawNeeds();
  }

  /**
   * Posts a dismissal whose toast expired or was cut short by a second Dismiss, exactly as the Dismiss
   * button once posted it, after any act already out. The item stays off the list until the answer:
   * a delivered line stands in its place as an act's does, and a refusal or no answer brings it back
   * with the broker's word beside it, selected where the address selects no other item, so the detail
   * shows that word. The same word shows in a toast whatever is selected and whichever screen is open,
   * since the operator tapped Dismiss five seconds before and may be reading anything now, as a note
   * added below whatever toast is up rather than in place of it. Nothing is posted again.
   */
  async function postDismiss(pending) {
    if (needsMe.pending !== pending) return;
    clearTimeout(pending.timer);
    needsMe.pending = null;
    clearDismissToast(pending);
    needsMe.posting.add(pending.key);
    let took = false;
    const said = { words: null };
    try {
      await whenIdle();
      took = await sendDismiss(pending.item, said);
    } finally {
      needsMe.posting.delete(pending.key);
    }
    // The broker's word is the one sendAct set and captured before its own redraw, which drops the words of an item the reading no longer holds.
    const words = took ? null : said.words ?? unconfirmed(null, "dismiss");
    if (!took && screen === "today" && item === null) go(routeTo("today", todayQuery(itemRowKey(pending.item))), true);
    else redrawNeeds();
    const failure = pending.item.kind === "review" ? "Done on " + dismissHeadline(pending.item) + " did not take: " : "Dismiss of " + dismissHeadline(pending.item) + " not done: ";
    if (words !== null) showDismissFailure(failure + words + ".");
  }

  /** How many code points of a worker's text a Discuss draft quotes, the broker's own bound on every text a line quotes. */
  const QUOTED_POINTS = 200;

  /**
   * A worker's text in the form the broker quotes it into a line: each control character and line
   * break made a space, runs of whitespace made one, the ends trimmed, each double quote made a single
   * one, then cut to `QUOTED_POINTS` with the ellipsis paid out of the bound, in code points and in
   * UTF-16 units alike. Set inside one pair of double quotes, it can neither leave them nor start a line.
   */
  function quotedText(text) {
    const flat = txt(text)
      .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/"/g, "'");
    if (Array.from(flat).length <= QUOTED_POINTS && flat.length <= QUOTED_POINTS) return flat;
    let kept = Array.from(flat).slice(0, QUOTED_POINTS - 1);
    while (kept.join("").length + 1 > QUOTED_POINTS && kept.length > 0) kept = kept.slice(0, -1);
    return kept.join("") + "…";
  }

  /**
   * Opens the talk screen for an item's session in the detail pane, its composer holding the item's
   * question or reason quoted as the broker quotes a worker's text, in front of any draft the composer
   * already holds, for the operator to edit; nothing is sent until they send it. A draft that already
   * opens with that quote keeps it once, so a second Discuss on the item does not quote it again.
   */
  function discuss(one) {
    const lineage = txt(one.repo);
    if (lineage === "") return;
    const quote = '"' + quotedText(one.text) + '"';
    const draft = talk.draft.trimStart();
    talk.draft = draft.startsWith(quote) ? draft : quote + " " + draft;
    go(routeTo("talk", { lineage }));
  }

  /** Opens the Answer box under one ask, closing any other, and puts the caret in it. */
  function openCorrect(item) {
    const key = itemKey(item);
    if (needsMe.correct === null || needsMe.correct.key !== key) needsMe.correct = { key, draft: "" };
    redrawNeeds();
    const field = document.getElementById("correct-text");
    if (field !== null) field.focus();
  }

  /** Closes the Answer box and drops its draft. */
  function closeCorrect() {
    needsMe.correct = null;
    redrawNeeds();
  }

  /**
   * Sends the Correct box's words for its ask, with the question, the two times and the recommendation
   * this page drew, the recommendation as the view gave it, null kept as null, which the broker matches
   * before it delivers. The broker builds the line from the ask's id, its question
   * and these words, so the page composes none. A line not delivered keeps the box and the draft, with
   * the caret back in it.
   */
  async function sendCorrect(item) {
    const held = needsMe.correct;
    if (held === null || held.key !== itemKey(item)) return;
    const words = held.draft.trim();
    if (words === "") return;
    const sent = await sendAct(item, "correct", {
      askId: item.askId,
      repo: item.repo,
      words,
      question: txt(item.text),
      openedAt: item.openedAt,
      reraisedAt: item.reraisedAt,
      recommend: item.recommend,
    });
    const field = sent ? null : document.getElementById("correct-text");
    if (field !== null) field.focus();
  }

  /** Agrees to the untouched asks in the order drawn, the first `cap`, and shows the broker's word beside each. */
  async function sendBatch(items, cap) {
    const sent = items.slice(0, cap);
    if (needsMe.acting || sent.length === 0) return;
    for (const item of sent) {
      touch(needsKey(item));
      needsMe.out.add(needsKey(item));
      needsMe.statuses.set(needsKey(item), "sending");
    }
    needsMe.acting = true;
    redrawNeeds();
    // The visit the batch was sent on: once the shell has moved on, the reading held is another screen's.
    const here = visit;
    let changed = false;
    try {
      const answer = await postAgree("agree-batch", { items: sent.map(agreeBody) }, batchTimeoutMs(sent.length));
      const results = list(answer.results);
      sent.forEach((item, at) => {
        const result = results[at];
        const status = result !== null && typeof result === "object" ? txt(result.status) : null;
        if (status === "changed") changed = true;
        if (status === "delivered" && lastView !== null && here === visit) needsMe.delivered.set(needsKey(item), lastView);
        needsMe.statuses.set(needsKey(item), status !== null ? actWords(status, "agree", item) : "no answer for this one, so the Agree is not confirmed");
      });
    } catch (error) {
      for (const item of sent) needsMe.statuses.set(needsKey(item), unconfirmed(error, "agree"));
    } finally {
      needsMe.acting = false;
      for (const item of sent) needsMe.out.delete(needsKey(item));
      if (changed) await refreshView();
      else redrawNeeds();
    }
  }

  /** The ask view a Context reads for an ask: route text plus the encoded repo and id. */
  function contextAskUrl(item) {
    return "/web/ask?repo=" + encodeURIComponent(item.repo) + "&id=" + encodeURIComponent(item.askId);
  }

  /** The talk view a Context reads for any item: route text plus the encoded repo, the whole ring. */
  function contextTalkUrl(item) {
    return "/web/talk?lineage=" + encodeURIComponent(item.repo);
  }

  /** The newest `CONTEXT_LINES` lines of the four conversation kinds, at or after the item opened, or of any time where it names none. */
  function contextLines(view, item) {
    const from = parse(item.openedAt);
    return objects(isObject(view) ? view.lines : null)
      .filter((line) => CONTEXT_KINDS.indexOf(line.kind) >= 0 && (from === null || (num(line.at) !== null && line.at >= from)))
      .slice(-CONTEXT_LINES);
  }

  /**
   * Opens an item's Context, or closes it. Opening reads, once, the ask view where `withAsk` holds for an
   * ask, and the session's talk view, then draws them; a read that fails draws one line for it. Nothing
   * reads them again until the operator closes and opens it, and the poll never does. An answer that
   * lands after the Context closed, or after it was opened again, is dropped.
   */
  async function toggleContext(item, withAsk) {
    const key = itemKey(item);
    if (needsMe.context.has(key)) {
      needsMe.context.delete(key);
      redrawNeeds();
      return;
    }
    const reading = readContext(item, withAsk, needsMe.context);
    redrawNeeds();
    await reading;
  }

  /**
   * Reads an item's Context once and holds it in `into` under the item's key: the ask view where
   * `withAsk` holds for an ask, and the session's talk view. The held entry is set before the first
   * read starts, so a draw made meanwhile shows it reading, and the draw after the reads is made only
   * while the shell is still on the screen visit that started them. An answer that lands after the
   * entry was dropped or read again is dropped. A Context disclosure holds its reads in
   * `needsMe.context`, and the Today detail pane its own in `needsMe.detail`. A read again after a
   * failure passes the failed entry as `prior`, whose ask and lines the new entry keeps while it reads
   * and wherever its own read of either fails, so what was read stays drawn rather than reading again.
   */
  async function readContext(item, withAsk, into, prior = null) {
    const key = itemKey(item);
    const here = visit;
    const held = { loading: true, ask: prior === null ? null : prior.ask, lines: prior === null ? null : prior.lines, failure: null };
    into.set(key, held);
    const reads = await Promise.allSettled([
      withAsk && item.kind === "ask" ? fetchView(contextAskUrl(item)) : Promise.resolve(null),
      fetchView(contextTalkUrl(item)),
    ]);
    if (into.get(key) !== held) return;
    held.loading = false;
    if (reads[0].status === "fulfilled" && isObject(reads[0].value)) held.ask = reads[0].value;
    if (reads[1].status === "fulfilled") held.lines = contextLines(reads[1].value, item);
    const failed = reads.find((read) => read.status === "rejected");
    if (failed !== undefined) held.failure = failed.reason instanceof Unreadable ? failed.reason.message : "the reading could not be fetched";
    if (here === visit) redrawNeeds();
  }

  /** A full-size act button, its words set as text, disabled while any act is out. */
  function actButton(cls, words, key, onClick) {
    const button = h("button", cls, words);
    button.type = "button";
    button.disabled = needsMe.acting;
    button.dataset.key = key;
    listen(button, "click", onClick);
    return button;
  }

  /** The Context disclosure's button, closed by default; whether it is open is read from `needsMe.context`. */
  function contextButton(item, key, withAsk) {
    const open = needsMe.context.has(key);
    const button = h("button", open ? "nm-context on" : "nm-context", "Context");
    button.type = "button";
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.dataset.key = "context|" + key;
    listen(button, "click", () => toggleContext(item, withAsk));
    return button;
  }

  /**
   * An open Context: the whole text where the headline was cut, then for an ask its brief, plan path and
   * thread link, then the session's lines, each under the talk page's own head and then its text. Every
   * string is the view's and goes in as text, and the thread link is drawn only where it is Discord's,
   * the ask page's own rule.
   */
  function contextPanel(item, held, cut, now) {
    const panel = h("div", "nm-context-body", null, "context");
    if (cut) panel.append(md("div", "nm-whole", item.text));
    if (held.loading) {
      panel.append(h("div", "meta", "reading"));
      return panel;
    }
    const ask = held.ask;
    if (ask !== null) {
      if (txt(ask.brief).trim() !== "") panel.append(h("div", "meta", "Brief"), md("div", "ask-brief", ask.brief));
      if (txt(ask.planPath) !== "") panel.append(h("div", "meta", "Plan"), h("div", "mono", txt(ask.planPath)));
      const thread = txt(ask.thread);
      if (thread.indexOf(DISCORD_PREFIX) === 0) panel.append(link("ask-thread", thread, "Open the thread"));
    }
    if (held.lines !== null) {
      if (held.lines.length === 0) panel.append(h("div", "meta", "No lines from the session since this opened."));
      for (const line of held.lines) {
        const row = h("div", "nm-line", null, "line:" + String(line.seq));
        row.append(talkHead(line, txt(item.repo), now), h("div", null, txt(line.text)));
        panel.append(row);
      }
    }
    if (held.failure !== null) panel.append(h("div", "meta nm-context-failed", "The context could not be read: " + held.failure + "."));
    return panel;
  }

  /**
   * The Answer box under an ask: the question quoted as text, a box of three rows bounded at the talk
   * composer's 4000, then Send and Cancel. Enter is a new line, and Ctrl or Cmd with Enter sends. The
   * draft lives in `needsMe.correct`, so a redraw puts the typed text back.
   */
  function correctBox(item, key) {
    const held = needsMe.correct;
    const box = h("div", "nm-correct-box", null, "correct");
    box.append(h("div", "nm-quote", txt(item.text)));
    const caption = h("label", "sr", "Your words to " + txt(item.repo) + " on this ask");
    caption.htmlFor = "correct-text";
    const field = h("textarea", "nm-words");
    field.id = "correct-text";
    field.rows = 3;
    field.maxLength = 4000;
    field.placeholder = "Your words";
    field.value = held.draft;
    field.disabled = needsMe.acting;
    field.dataset.key = "correct-text|" + key;
    const send = actButton("nm-send", "Send", "correct-send|" + key, () => sendCorrect(item));
    send.disabled = needsMe.acting || held.draft.trim() === "";
    // The draft is read from the field the event fired on, and the redraw sets Send's state from it; the
    // patch keeps this field and its caret, since the draft it draws is the field's own value.
    listen(field, "input", (event) => {
      held.draft = event.currentTarget.value;
      redrawNeeds();
    });
    listen(field, "keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
        event.preventDefault();
        sendCorrect(item);
      }
    });
    const row = h("div", "nm-controls");
    row.append(send, actButton("nm-cancel", "Cancel", "correct-cancel|" + key, () => closeCorrect()));
    box.append(caption, field, row, h("div", "meta", "Ctrl or Cmd with Enter sends."));
    return box;
  }

  /** The broker's last word beside an item, read out as a status. */
  function statusLine(words) {
    const status = h("div", "meta nm-status", words, "status");
    status.setAttribute("role", "status");
    return status;
  }

  /** Adds a key's letter to an act button, the hint the desktop layout shows and the phone hides, and names the key to assistive technology. */
  function keyHint(button, letter) {
    const mark = h("kbd", "nm-key", letter);
    mark.setAttribute("aria-hidden", "true");
    button.append(mark);
    button.setAttribute("aria-keyshortcuts", letter);
    return button;
  }

  /** One part of the detail pane under its small uppercase heading, keyed by its name. */
  function detailSection(words, key) {
    const section = h("section", "nm-sec", null, key);
    section.setAttribute("aria-label", words);
    section.append(h("h3", "nm-sec-h", words));
    return section;
  }

  /** The kind tags a row and the detail carry: decision, with blocking where it blocks, for an ask; blocked; review. */
  function kindTags(one) {
    if (one.kind === "blocked") return [h("span", "tag tag-bad", "blocked")];
    if (one.kind === "review") return [h("span", "tag", "review")];
    if (one.kind !== "ask") return [];
    const tags = [h("span", "tag tag-blue", "decision")];
    if (one.blocking === true) tags.push(h("span", "tag tag-bad", "blocking"));
    return tags;
  }

  /** Whether the item reads a Context: an ask or a blocked run naming its session and its id, the items whose session holds the conversation. */
  function contextual(one) {
    if (txt(one.repo) === "") return false;
    if (one.kind === "ask") return txt(one.askId) !== "";
    return one.kind === "blocked" && txt(one.entryId) !== "";
  }

  /**
   * The line under a detail's heading, each part as text, the age alone in a clock span: for an ask
   * the plan title the ask view gives, or the plan path until it arrives, when it was asked, whether it
   * blocks its run, and the session; for a blocked run when it was raised, and for a hands item when
   * it opened, its plan path and the session; for a review when it was marked ready, the session and the pull request number.
   */
  function metaLine(one, held, now) {
    const line = h("div", "nm-meta", null, "meta");
    const at = openedOf(one);
    const parts = [];
    const age = (words) => {
      const part = h("span");
      part.append(words, clockText("span", null, span(now - at)), " ago");
      return part;
    };
    if (one.kind === "review") {
      if (at !== null) parts.push(age("Ready "));
      parts.push(h("span", null, txt(one.repo)));
      const number = reviewNumber(one);
      if (number !== null) parts.push(h("span", null, "pull request " + number));
    } else {
      const title = held !== undefined && isObject(held.ask) ? txt(held.ask.title) : "";
      const plan = title !== "" ? title : txt(one.planPath);
      const planPart = plan === "" ? null : h("span", null, "plan: " + plan);
      if (one.kind === "ask" && planPart !== null) parts.push(planPart);
      if (at !== null) parts.push(age(one.kind === "ask" ? "Asked " : one.kind === "blocked" ? "Blocked " : "Opened "));
      if (one.kind === "ask") parts.push(h("span", null, one.blocking === true ? "Blocks its run" : "Does not block its run"));
      if (one.kind !== "ask" && planPart !== null) parts.push(planPart);
      if (txt(one.repo) !== "") parts.push(h("span", null, txt(one.repo)));
    }
    parts.forEach((part, index) => {
      if (index > 0) line.append(" · ");
      line.append(part);
    });
    return line;
  }

  /**
   * The detail's Conversation: the session's newest lines since the item opened, each under the talk
   * page's own head and then its text, as a Context draws them, or a line while they are first read,
   * where there are none, or where a read failed. Lines kept from an earlier read stay drawn while the
   * read runs again.
   */
  function conversation(item, held, now) {
    const section = detailSection("Conversation", "conversation");
    if (held === undefined || (held.loading && held.lines === null)) {
      section.append(h("p", "meta", "reading"));
      return section;
    }
    if (held.lines !== null) {
      if (held.lines.length === 0) section.append(h("p", "meta", "No lines from the session since this opened."));
      for (const line of held.lines) {
        const row = h("div", "nm-line", null, "line:" + String(line.seq));
        row.append(talkHead(line, txt(item.repo), now), h("div", null, txt(line.text)));
        section.append(row);
      }
    }
    if (held.failure !== null) section.append(h("p", "meta nm-context-failed", "The context could not be read: " + held.failure + "."));
    return section;
  }

  /**
   * One item in the detail pane, in the order the inbox mockup draws it: who, its kind and age; its
   * headline as the heading; the meta line, with the whole text under it where the headline was cut,
   * which an ask draws first under "Why it came up"; for an ask "Why it came up", the ask's brief, and
   * "Options", the recommendation as the one tinted option, since the ledger records no alternatives; "Conversation", the session's newest lines; then
   * the act row with each act's key, the Answer box where open, and the broker's last word. An ask
   * takes Agree where it carries a recommendation, Answer, Discuss and Dismiss. A blocked run takes
   * Discuss and Dismiss, since it carries no recommendation and its session is stopped. Any other kind,
   * a hands item among them, is a reading of a true condition and takes none. The brief, the plan title
   * and the conversation are the item's Context, read once when the detail first shows the item. An
   * item whose Agree is processing reads "processing" with every act disabled.
   */
  function needsItem(item, now) {
    const box = h("div", "nm-item nm-detail", null, itemRowKey(item));
    const anchor = askKey(item);
    if (anchor !== null) box.id = anchor;
    const head = h("div", "nm-head");
    const who = h("span", "nm-who", item.repo ? txt(item.repo) : "Hands");
    const opened = parse(item.openedAt);
    for (const tag of kindTags(item)) who.append(" ", tag);
    head.append(who, clockText("span", "nm-age", opened === null ? "" : span(now - opened)));
    const headline = cutPoints(txt(item.text), HEADLINE_POINTS);
    // An ask's question opens its own page; any other item's text is plain.
    const href = askHrefOf(item);
    const heading = h("h2", "nm-heading", null, "heading");
    heading.append(href !== null ? link("nm-text", href, headline) : h("span", "nm-text", headline));
    box.append(head, heading);
    const key = itemKey(item);
    const held = contextual(item) ? needsMe.detail.get(key) : undefined;
    box.append(metaLine(item, held, now));
    // The whole text where the headline was cut: the first thing under "Why it came up" for an ask that draws it, under the meta line otherwise.
    const whole = headline !== txt(item.text) ? md("div", "nm-whole", item.text, "whole") : null;
    const whyDrawn = item.kind === "ask" && txt(item.repo) !== "";
    if (whole !== null && !whyDrawn) box.append(whole);
    if ((item.kind !== "ask" && item.kind !== "blocked") || txt(item.repo) === "") return box;

    const processing = needsMe.processing.has(key);
    if (needsMe.out.has(key) || processing) box.classList.add("nm-acting");
    if (item.kind === "ask") {
      const why = detailSection("Why it came up", "why");
      if (whole !== null) why.append(whole);
      const brief = held !== undefined && isObject(held.ask) ? txt(held.ask.brief) : "";
      if (brief.trim() !== "") why.append(md("div", "ask-brief", brief));
      else why.append(h("p", "meta", held === undefined || (held.loading && !isObject(held.ask)) ? "reading" : "No brief recorded for this ask."));
      const options = detailSection("Options", "options");
      if (txt(item.recommend).trim() !== "") {
        const option = h("div", "nm-opt rec");
        option.append(h("span", "nm-opt-tag", "RECOMMENDED"), md("div", "nm-opt-text", item.recommend));
        options.append(option);
      } else {
        options.append(h("p", "meta", "No recommendation to agree to."));
      }
      box.append(why, options);
    }
    box.append(conversation(item, held, now));

    // An item's page state is keyed on its id, so an item the view gives no id takes no act.
    const named = contextual(item);
    const acts = [];
    const controls = h("div", "nm-controls nm-acts", null, "controls");
    if (item.kind === "blocked") {
      if (named) {
        acts.push(keyHint(actButton("nm-discuss", "Discuss", "discuss|" + key, () => discuss(item)), "D"));
        acts.push(keyHint(actButton("nm-dismiss", "Dismiss", "dismiss|" + key, () => dismissLater(item)), "X"));
      }
    } else if (named) {
      if (agreeable(item)) acts.push(keyHint(actButton("nm-agree", "Agree", "agree|" + key, () => sendAgree(item)), "A"));
      acts.push(keyHint(actButton("nm-correct", "Answer", "correct|" + key, () => openCorrect(item)), "R"));
      acts.push(keyHint(actButton("nm-discuss", "Discuss", "discuss|" + key, () => discuss(item)), "D"));
      acts.push(keyHint(actButton("nm-dismiss", "Dismiss", "dismiss|" + key, () => dismissLater(item)), "X"));
    }
    for (const button of acts) {
      if (processing) button.disabled = true;
      controls.append(button);
    }
    if (acts.length > 0) controls.append(h("span", "nm-hint", "J / K to move between items", "hint"));
    box.append(controls);
    if (item.kind === "ask" && needsMe.correct !== null && needsMe.correct.key === key) box.append(correctBox(item, key));
    const words = processing ? "processing" : needsMe.statuses.get(key);
    if (words !== undefined) box.append(statusLine(words));
    return box;
  }

  /**
   * A queue entry's pull request in an act row, for a review and a Workers row alike, `one` carrying
   * the store's `pullRequestUrl` and `pullRequest`: Open PR, a link to that URL alone, set only where
   * it is a string on GitHub and opened in a new tab with no opener and no referrer; "PR <number>" as
   * text where there is a number and no link; and null where there is neither, so nothing is drawn.
   * `key` names the item the part is keyed under.
   */
  function pullRequestPart(one, key) {
    const url = txt(one.pullRequestUrl);
    const number = reviewNumber(one);
    // The one link the page draws from a queue entry: the store's URL, admitted by the broker under its pattern, used as a link target alone.
    if (url.indexOf(GITHUB_PREFIX) === 0) {
      const open = link("nm-open-pr", url, "Open PR", "open-pr|" + key);
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      return open;
    }
    return number === null ? null : h("span", "nm-pr", "PR " + number, "pr|" + key);
  }

  /** What stands where a delivered item was until the next reading: the act's word and the session it went to. */
  function deliveredLine(item) {
    const line = h("div", "nm-item nm-sent", needsMe.statuses.get(itemKey(item)) ?? "", itemRowKey(item));
    line.setAttribute("role", "status");
    return line;
  }

  /**
   * Lets a finger dismiss a card on the phone layout: a leftward travel of `SWIPE_PX` or more, further
   * than it travels down, dismisses it with the same toast as Dismiss. A shorter travel snaps the card
   * back and does nothing, and any travel past `TAP_SLOP_PX` is not a tap, so it selects no row. The
   * card takes `touch-action: pan-y` from the stylesheet, so a vertical drag still scrolls the list and
   * the browser cancels the pointer. A mouse takes no swipe. The finger is held in `needsMe.swipe`, not
   * on the node, since a poll's patch can rebind these handlers to the live card mid-swipe.
   */
  function swipeable(row, one) {
    const key = itemRowKey(one);
    listen(row, "pointerdown", (event) => {
      needsMe.swiped = null;
      if (event.pointerType === "mouse" || !window.matchMedia(PHONE_QUERY).matches) return;
      needsMe.swipe = { key, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false, sideways: false };
    });
    listen(row, "pointermove", (event) => {
      const held = needsMe.swipe;
      if (held === null || held.key !== key || held.pointer !== event.pointerId) return;
      const dx = event.clientX - held.x;
      const dy = event.clientY - held.y;
      if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) held.moved = true;
      // The card follows the finger only once the travel is past the tap's slop and more across than down, so a scroll leaves it still.
      if (!held.sideways && Math.abs(dx) > TAP_SLOP_PX && Math.abs(dx) > Math.abs(dy)) held.sideways = true;
      if (held.sideways) event.currentTarget.style.setProperty("transform", "translateX(" + Math.min(0, dx) + "px)");
    });
    const end = (event) => {
      const held = needsMe.swipe;
      if (held === null || held.key !== key || held.pointer !== event.pointerId) return;
      needsMe.swipe = null;
      event.currentTarget.style.removeProperty("transform");
      // A cancelled pointer was the browser's scroll, which ends in no click, so only a lifted finger marks the swipe.
      if (event.type !== "pointerup") return;
      if (held.moved) needsMe.swiped = key;
      const dx = event.clientX - held.x;
      const dy = event.clientY - held.y;
      if (-dx >= SWIPE_PX && Math.abs(dy) < Math.abs(dx)) dismissLater(one);
    };
    listen(row, "pointerup", end);
    listen(row, "pointercancel", end);
    // The tap that ends a swipe is the swipe's, so it moves no address; the shell's link handler skips a prevented click.
    listen(row, "click", (event) => {
      if (needsMe.swiped !== key) return;
      needsMe.swiped = null;
      event.preventDefault();
    });
  }

  /**
   * Each Do first kind's tag on a card and in the detail: the kind word in capitals and its tone. A kind
   * off this table draws its own word in capitals in the plain tone.
   */
  const TODAY_KINDS = {
    unblock: ["UNBLOCK", "tag tag-bad"],
    approve: ["APPROVE", "tag tag-ok"],
    decide: ["DECIDE", "tag tag-blue"],
    answer: ["ANSWER", "tag"],
  };

  /** The line under an approve item's brief, naming the order the ready pull requests land in. */
  const READY_ORDER_WORDS = "Approve items top to bottom; each sits on one above it or on main.";

  /** A Do first item's kind tag, set as text. */
  function todayTag(entry) {
    const kind = txt(entry.kind);
    const [words, cls] = Object.prototype.hasOwnProperty.call(TODAY_KINDS, kind) ? TODAY_KINDS[kind] : [kind.toUpperCase(), "tag"];
    return h("span", cls, words);
  }

  /** The Today reading's Do first items, in the view's order, each carrying the queue item its acts post. */
  function todayItems(view) {
    return objects(view.first).filter((entry) => isObject(entry.item));
  }

  /** The Do first items the list draws as cards: every one less any delivered from this reading and any being dismissed. */
  function openToday(view) {
    return todayItems(view).filter((entry) => !deliveredIn(view, entry.item) && !dismissing(entry.item));
  }

  /** The Do first item the detail shows: the one the address selects, or the first card where it selects none. */
  function chosenToday(view, selectedKey) {
    if (selectedKey === null) return openToday(view)[0];
    return todayItems(view).find((entry) => itemRowKey(entry.item) === selectedKey && !dismissing(entry.item));
  }

  /** The Today query for a selected row key, empty where none is selected. */
  function todayQuery(rowKey) {
    return rowKey === null ? {} : { item: rowKey };
  }

  /** The path that selects an item in the Today list, its row key as the `item` query value, built through the route table. */
  function itemPath(one) {
    return pathOf(routeTo("today", todayQuery(itemRowKey(one))));
  }

  /**
   * One Do first card: the kind tag, the who line and the number, then the title and the effect
   * sentence, as a link that selects the item in the detail pane, marked `sel` where it is the one the
   * detail pane shows and `first` where it is number 1. A card whose Agree is processing carries the
   * word, and a card that takes Dismiss, or Done for an approve item, takes the phone's swipe.
   */
  function todayCard(entry, selectedKey) {
    const one = entry.item;
    const key = itemRowKey(one);
    const number = num(entry.number);
    const row = link("nm-row td-card" + (number === 1 ? " first" : "") + (key === selectedKey ? " sel" : ""), itemPath(one), null, key);
    if (key === selectedKey) row.setAttribute("aria-current", "true");
    const processing = needsMe.processing.has(itemKey(one));
    if (needsMe.out.has(itemKey(one)) || processing) row.classList.add("nm-acting");
    const head = h("div", "td-head");
    head.append(todayTag(entry));
    if (processing) head.append(h("span", "tag tag-blue", "processing"));
    head.append(h("span", "td-who", txt(entry.who)), h("span", "td-num", number === null ? "" : String(number)));
    row.append(head, h("div", "td-title", cutPoints(txt(entry.title), HEADLINE_POINTS)), h("div", "td-effect", txt(entry.effect)));
    if (dismissable(one)) swipeable(row, one);
    return row;
  }

  /** The dot a Running row carries for its worker's state: working green, asking amber, paused hollow. */
  const RUNNING_DOTS = { working: "green", asking: "amber", paused: "hollow" };

  /**
   * One Running row: the worker's state dot, its name and its plan title, then the section it is on and
   * how long since its last turn, as a link to the Workers screen with the worker selected.
   */
  function runningRow(one, now) {
    const name = txt(one.name);
    const row = link("td-row", workerPath(name), null, "running:" + name);
    const left = h("div", "td-l");
    const state = txt(one.state);
    left.append(dot(Object.prototype.hasOwnProperty.call(RUNNING_DOTS, state) ? RUNNING_DOTS[state] : "hollow"), h("b", null, name));
    const title = txt(one.title);
    left.append(" · " + (title !== "" ? title : state));
    if (title !== "" && (state === "asking" || state === "paused")) left.append(" · " + state);
    const right = h("div", "td-r");
    const step = isObject(one.step) && num(one.step.section) !== null && num(one.step.sectionCount) !== null ? one.step : null;
    if (step !== null) right.append(step.section + " of " + step.sectionCount);
    const turn = parse(one.lastTurnAt);
    if (turn !== null) right.append(step !== null ? " · " : "", clockText("span", null, span(now - turn)));
    row.append(left, right);
    return row;
  }

  /** One Finished row: the plan's title, or its file where it has none, and the worker, then the time it finished. */
  function finishedRow(one, now) {
    const row = h("div", "td-row", null, "finished:" + txt(one.name) + ":" + txt(one.plan));
    const left = h("div", "td-l");
    const title = txt(one.title);
    left.append(title !== "" ? title : txt(one.plan), " · ", h("b", null, txt(one.name)));
    const at = parse(one.at);
    row.append(left, h("div", "td-r", at === null ? "" : dayClock(at, now)));
    return row;
  }

  /**
   * The batch Agree row: one button agreeing with every untouched recommendation among the asks, in the
   * list's order, up to the view's cap, naming how many it sends and how many of them block and are
   * refused.
   */
  function batchBar(view) {
    const untouched = todayItems(view)
      .map((entry) => entry.item)
      .filter((item) => agreeable(item) && !needsMe.touched.has(needsKey(item)) && !dismissing(item));
    const bar = h("div", "nm-batch", null, "batch-bar");
    const batch = h("button", "nm-batch-button");
    batch.type = "button";
    batch.disabled = needsMe.acting || untouched.length === 0;
    batch.dataset.key = "batch";
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
    listen(batch, "click", () => sendBatch(untouched, cap));
    bar.append(batch, h("div", "meta nm-batch-note", "Each lands as your word with the time. A blocking ask is refused and stays open for you."));
    return bar;
  }

  /**
   * The Today list pane: the heading with its as-of time, the lede, the numbered Do first cards, the
   * batch Agree row, Running, Finished, the health line linking to the health screen, and the read
   * times. An item whose line was delivered from this reading draws its words in its place, and an item
   * being dismissed is drawn nowhere. The ask screen draws the same list beside its ask.
   */
  function todayList(view, now, selectedKey) {
    const out = h("div", "nm td", null, "today");

    const top = h("div", "top", null, "top");
    const row = h("div", "top-row");
    row.append(h("h1", null, "Today"), stamp(view));
    top.append(row);
    const lede = h("p", "sub td-lede", txt(view.lede), "lede");
    lede.append(h("span", "nm-swipe-hint", " Swipe a card left to dismiss it, or to mark an approve item done."));
    top.append(lede);
    out.append(top);

    const first = h("section", "section", null, "first");
    first.setAttribute("aria-label", "Do first");
    const firstHead = cardHead("Do first", null, "h2");
    firstHead.append(h("div", "meta", "top one unblocks the most"));
    first.append(firstHead);
    const cards = h("div", "td-cards", null, "cards");
    const drawn = todayItems(view).filter((entry) => !dismissing(entry.item));
    if (drawn.length === 0) cards.append(h("div", "nm-none", "Nothing here."));
    for (const entry of drawn) cards.append(deliveredIn(view, entry.item) ? deliveredLine(entry.item) : todayCard(entry, selectedKey));
    first.append(cards);
    out.append(first, batchBar(view));

    const running = objects(view.running);
    const runningBox = h("section", "section", null, "running");
    runningBox.setAttribute("aria-label", "Running");
    runningBox.append(cardHead("Running", running.length, "h2"));
    const runningRows = h("div", "td-rows", null, "running-rows");
    if (running.length === 0) runningRows.append(h("div", "nm-none", "No worker is running."));
    for (const one of running) runningRows.append(runningRow(one, now));
    runningBox.append(runningRows);
    out.append(runningBox);

    const finished = objects(view.finished);
    const finishedBox = h("section", "section", null, "finished");
    finishedBox.setAttribute("aria-label", "Finished");
    const finishedHead = cardHead("Finished", finished.length, "h2");
    finishedHead.append(h("div", "meta", "last 48 hours"));
    finishedBox.append(finishedHead);
    const finishedRows = h("div", "td-rows", null, "finished-rows");
    if (finished.length === 0) finishedRows.append(h("div", "nm-none", "Nothing finished in the last 48 hours."));
    for (const one of finished) finishedRows.append(finishedRow(one, now));
    finishedBox.append(finishedRows);
    out.append(finishedBox);

    const word = txt(view.health);
    const health = link("td-health", SCREEN_PATHS.health, null, "health");
    health.append("Health: ", word === "" ? "no reading yet" : h("span", "badge " + verdictTone(word), word), chevron());
    out.append(health, sources(view, ["roster", "queues", "ledger", "events", "registry", "usage"]));
    return out;
  }

  /**
   * Reads the plan an approve item names, through the plan screen's own reading, into `into` under the
   * item's key as `{ loading, plan, failure }`, and draws again once it lands on the visit it was read
   * on. The plan reading takes the sweep root, the item's `root`, the repository's folder. A read
   * again after a failure passes the failed entry as `prior`, whose failure the new entry keeps while
   * it reads, so the failure line stays drawn rather than reading again. A read that lands clears the
   * failure, and one that fails again replaces it with its own. An item naming no plan or no folder
   * settles with no plan and no failure and reads nothing, so a newer reading, which reads again only
   * after a failure, leaves it settled, and the detail leaves its What it does section out on purpose,
   * since there is no brief to read and no read to fail.
   */
  async function readPlanBrief(entry, into, prior = null) {
    const one = entry.item;
    const key = itemKey(one);
    const here = visit;
    const held = { loading: true, plan: null, failure: prior === null ? null : prior.failure };
    into.set(key, held);
    const root = txt(entry.root);
    if (root === "" || txt(one.planPath) === "") {
      held.loading = false;
      held.failure = null;
      return;
    }
    try {
      const plan = await fetchView(planUrlOf(root, txt(one.planPath)));
      if (into.get(key) !== held) return;
      held.failure = null;
      if (isObject(plan)) held.plan = plan;
    } catch (error) {
      if (into.get(key) !== held) return;
      held.failure = error instanceof Unreadable ? error.message : "the reading could not be fetched";
    }
    held.loading = false;
    if (here === visit) redrawNeeds();
  }

  /**
   * An approve item, a review, in the detail pane: the kind tag and who line with the ready age, the
   * plan title as the heading and the effect under it, the plan's brief under "What it does" where the
   * plan reading carries one, or a line naming why the read failed, which stays drawn while a read
   * again is in flight, else "reading" while the first read is, the ready line naming the order
   * the items land in, then Open PR and Done, Done under X. Open PR is `pullRequestPart`'s checked
   * link. Done writes the review's handled mark through the review Dismiss's post, after the same Undo
   * toast, keyed by the pull request number or, with none, by the queue entry's id. Nothing here
   * merges: the pull request is the operator's to approve on GitHub.
   */
  function approveItem(entry, held, now) {
    const one = entry.item;
    const key = itemKey(one);
    const acts = list(entry.acts);
    const box = h("div", "nm-item nm-detail", null, itemRowKey(one));
    if (needsMe.out.has(key)) box.classList.add("nm-acting");
    const head = h("div", "nm-head");
    const who = h("span", "nm-who");
    who.append(todayTag(entry), " ", txt(entry.who));
    const ready = openedOf(one);
    head.append(who, clockText("span", "nm-age", ready === null ? "" : span(now - ready)));
    box.append(head, h("h2", "nm-heading", txt(one.title), "heading"), h("p", "td-effect", txt(entry.effect), "effect"));
    const brief = held !== undefined && isObject(held.plan) ? briefCard(held.plan.brief) : null;
    const failed = held !== undefined && held.failure !== null;
    if (brief !== null || failed || held === undefined || held.loading) {
      const what = detailSection("What it does", "what");
      if (failed) what.append(h("p", "meta nm-context-failed", "The plan's brief could not be read: " + held.failure + "."));
      else what.append(brief ?? h("p", "meta", "reading"));
      box.append(what);
    }
    const line = h("p", "meta td-ready", null, "ready");
    if (ready !== null) line.append("Ready ", clockText("span", null, span(now - ready)), " ago. ");
    line.append(READY_ORDER_WORDS);
    box.append(line);
    const controls = h("div", "nm-controls nm-acts", null, "controls");
    const pr = acts.includes("open-pr") ? pullRequestPart(one, key) : null;
    if (pr !== null) controls.append(pr);
    if (acts.includes("done") && dismissable(one)) controls.append(keyHint(actButton("nm-done", "Done", "done|" + key, () => dismissLater(one)), "X"));
    controls.append(h("span", "nm-hint", "J / K to move between items", "hint"));
    box.append(controls);
    const words = needsMe.statuses.get(key);
    if (words !== undefined) box.append(statusLine(words));
    return box;
  }

  /**
   * The detail pane's item: the one the address selects, or the first card where it selects none, an
   * approve item drawn by `approveItem` and every other kind as `needsItem` draws it. A selected item
   * the reading no longer holds draws a line saying so, and a reading with no open item draws the
   * list's own empty line.
   */
  function todayDetail(view, now, selectedKey) {
    const chosen = chosenToday(view, selectedKey);
    if (chosen === undefined) return h("div", "nm-none", selectedKey === null ? "Nothing here." : "This item is no longer in the reading.");
    const one = chosen.item;
    if (deliveredIn(view, one)) return deliveredLine(one);
    if (chosen.kind === "approve" && one.kind === "review") return approveItem(chosen, needsMe.detail.get(itemKey(one)), now);
    return needsItem(one, now);
  }

  /**
   * The Today screen: the list pane, and the detail pane holding the item the address selects with its
   * acts, as the sheet on a phone. The detail reads the shown item's Context, or an approve item's plan,
   * the first time it draws the item, and again on a newer reading where that read failed, and drops
   * what it read for any other item.
   */
  function renderToday(view) {
    const now = nowOf(view);
    // A delivered item's hide holds for the reading it was drawn from alone, so a newer reading decides again.
    for (const [key, drawn] of needsMe.delivered) if (drawn !== view) needsMe.delivered.delete(key);
    // An item's words and Context go with the item, so a key no item in this reading holds is dropped.
    const held = new Set(todayItems(view).map((entry) => itemKey(entry.item)));
    for (const key of needsMe.statuses.keys()) if (!held.has(key)) needsMe.statuses.delete(key);
    for (const key of needsMe.context.keys()) if (!held.has(key)) needsMe.context.delete(key);
    // An Agree is processing until a reading no longer carries its item.
    for (const key of needsMe.processing) if (!held.has(key)) needsMe.processing.delete(key);
    const chosen = chosenToday(view, item);
    const one = chosen === undefined ? undefined : chosen.item;
    const shownKey = one === undefined ? null : itemKey(one);
    for (const key of needsMe.detail.keys()) if (key !== shownKey) needsMe.detail.delete(key);
    // A read that failed is read again on a newer reading, once per reading and never while one is loading, so a broker that recovers fills the detail.
    // The failed entry passes to the new read as its prior, so what it had read and the failure line stay drawn while the read is in flight.
    const shownHeld = shownKey === null ? undefined : needsMe.detail.get(shownKey);
    const failed = shownHeld !== undefined && !shownHeld.loading && shownHeld.failure !== null && shownHeld.reading !== view;
    if (failed) needsMe.detail.delete(shownKey);
    if (one !== undefined && contextual(one) && !needsMe.detail.has(shownKey)) {
      readContext(one, true, needsMe.detail, failed ? shownHeld : null);
      needsMe.detail.get(shownKey).reading = view;
    } else if (one !== undefined && chosen.kind === "approve" && one.kind === "review" && !needsMe.detail.has(shownKey)) {
      readPlanBrief(chosen, needsMe.detail, failed ? shownHeld : null);
      needsMe.detail.get(shownKey).reading = view;
    }
    // The card the detail shows is the one marked in the list: the selected item, else the first open card.
    const first = openToday(view)[0];
    const shown = item !== null ? item : first === undefined ? null : itemRowKey(first.item);
    const out = document.createDocumentFragment();
    out.append(pane("list", todayList(view, now, shown)), detailPane(SCREEN_PATHS.today, todayDetail(view, now, item)));
    return out;
  }

  /**
   * The inbox's keys on the Today screen: A agrees, R opens the Answer box, D discusses and X dismisses
   * the item the detail shows, each only where its button is drawn live for that item, and on an
   * approve item X takes Done and D does nothing. J and K move the selection down and up the list, moving the
   * address as a card tap does. A key pressed in a field, the Answer box among them, held with Alt,
   * Ctrl, Meta or Shift, or repeating while held stays the browser's, so typing and its shortcuts never
   * fire an act.
   */
  function inboxKey(event) {
    if (screen !== "today" || lastView === null) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
    if (typedInto(event.target) || typedInto(document.activeElement)) return;
    const letter = typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (letter === "j" || letter === "k") {
      const rows = openToday(lastView);
      if (rows.length === 0) return;
      const at = rows.findIndex((entry) => itemRowKey(entry.item) === (item ?? itemRowKey(rows[0].item)));
      const next = at < 0 ? 0 : letter === "j" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
      event.preventDefault();
      go(routeTo("today", todayQuery(itemRowKey(rows[next].item))));
      return;
    }
    const chosen = chosenToday(lastView, item);
    if (chosen === undefined || deliveredIn(lastView, chosen.item)) return;
    const one = chosen.item;
    // The buttons' own rule: every act waits while one is out, and a processing item takes none.
    if (needsMe.acting || needsMe.processing.has(itemKey(one))) return;
    const done = chosen.kind === "approve" && one.kind === "review" && list(chosen.acts).includes("done");
    let act = null;
    if (letter === "a" && agreeable(one)) act = () => sendAgree(one);
    else if (letter === "r" && one.kind === "ask" && contextual(one)) act = () => openCorrect(one);
    else if (letter === "x" && done && dismissable(one)) act = () => dismissLater(one);
    else if (letter === "d" && contextual(one)) act = () => discuss(one);
    else if (letter === "x" && dismissable(one) && one.kind !== "review") act = () => dismissLater(one);
    if (act === null) return;
    event.preventDefault();
    act();
  }

  /** Whether a node takes typing: a field, a text area, a select or editable content. */
  function typedInto(node) {
    return node instanceof Element && (node.isContentEditable || node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT");
  }

  // ---------------------------------------------------------------------------------------------
  // Workers page
  // ---------------------------------------------------------------------------------------------

  /** The two fixed lines the board's Pause and Resume send, which the persona plugin acts on. Neither carries any page text. */
  const PAUSE_LINE = "[PAUSE] paused from the workers board";
  const RESUME_LINE = "[RESUME] resumed from the workers board";

  /**
   * Each row state's dot, word and tone class: the standup's row marks, a blue dot for working and a
   * hollow one for any other state, beside the standup's state word, and `paused`, the state the
   * Workers view alone gives a row whose entry the operator paused. A state off the table is drawn as
   * its own word beside a hollow dot.
   */
  const WORKER_STATES = {
    asking: ["hollow", "Asking", "wk-wait"],
    blocked: ["hollow", "Blocked", "wk-bad"],
    stalled: ["hollow", "Stalled", "wk-bad"],
    working: ["blue", "Working", "wk-ok"],
    idle: ["hollow", "Idle", "wk-idle"],
    dormant: ["hollow", "Dormant", "wk-idle"],
    paused: ["hollow", "Paused", "wk-wait"],
  };

  /** The four tiles over the rows: the `tiles` count each reads, the words under the count, and the count's tone class. */
  const WORKER_TILES = [
    ["working", "working", ""],
    ["asking", "waiting on you", "wk-wait"],
    ["blocked", "blocked", "wk-bad"],
    ["ready", "PRs ready to review", ""],
  ];

  /**
   * What a timeline line says, by its kind, the kit's closed list of eleven. The kit's detail follows
   * as text: after a space for a closed section, whose detail reads "<n> of <m>", and after a colon
   * for any other kind that carries one. A kind off the list is drawn as its own word.
   */
  const TIMELINE_WORDS = {
    "plan-queued": "Queued a plan",
    "plan-started": "Started the plan",
    "section-closed": "Closed section",
    "goal-complete": "Finished the plan",
    "goal-blocked": "Blocked",
    waiting: "Waiting",
    "ask-opened": "Asked you",
    "ask-closed": "Ask closed",
    "pr-ready": "Pull request ready",
    paused: "Paused",
    resumed: "Resumed",
  };

  /** The timeline kinds whose mark is drawn filled: a step of the plan finished. */
  const TIMELINE_DONE = ["section-closed", "goal-complete", "pr-ready"];

  /**
   * What the Workers screen holds between polls: the persona whose Pause or Resume post is out, or
   * null, and the words under each persona's act row from its last Pause or Resume, dropped once a
   * reading no longer lists that persona.
   */
  const workers = { acting: null, statuses: new Map() };

  /** The rows a Workers reading carries, each an object naming its persona, in the view's own order. */
  function workerRows(view) {
    return objects(view.rows).filter((row) => txt(row.name) !== "");
  }

  /** A row's step where it names a section and a count above zero; null otherwise. */
  function workerStep(row) {
    const step = isObject(row.step) ? row.step : null;
    return step !== null && num(step.section) !== null && num(step.sectionCount) !== null && step.sectionCount > 0 ? step : null;
  }

  /** The path that selects a persona on the Workers screen, its name as the `name` query value, built through the route table. */
  function workerPath(name) {
    return pathOf(routeTo("workers", { name }));
  }

  /** A row's state as its dot and word in the state's tone; `dot` hides the mark from assistive technology. */
  function workerState(row) {
    const state = txt(row.state);
    const known = Object.prototype.hasOwnProperty.call(WORKER_STATES, state) ? WORKER_STATES[state] : null;
    const words = h("span", "wk-state " + (known === null ? "wk-idle" : known[2]));
    words.append(dot(known === null ? "hollow" : known[0]), known === null ? state : known[1]);
    return words;
  }

  /** "<age> ago" from a stamp, the age alone in a clock span so the clock moving it flags nothing; "n/a" where there is no stamp. */
  function agoText(cls, iso, now) {
    const at = parse(iso);
    const box = h("span", cls);
    if (at === null) box.append("n/a");
    else box.append(clockText("span", null, span(now - at)), " ago");
    return box;
  }

  /** A timeline line's words: its kind's phrase, then the kit's detail as text where the line carries one. */
  function timelineWords(line) {
    const kind = txt(line.event);
    const phrase = Object.prototype.hasOwnProperty.call(TIMELINE_WORDS, kind) ? TIMELINE_WORDS[kind] : kind;
    const detail = txt(line.detail);
    if (detail === "") return phrase;
    return phrase + (kind === "section-closed" ? " " : ": ") + detail;
  }

  /** The four tiles: how many rows read working, waiting on you and blocked, and how many personas have a pull request ready to review. */
  function workerTiles(view) {
    const tiles = isObject(view.tiles) ? view.tiles : {};
    const box = h("div", "wk-tiles", null, "tiles");
    for (const [id, words, tone] of WORKER_TILES) {
      const tile = h("div", "wk-tile", null, "tile:" + id);
      tile.append(h("b", ("wk-n " + tone).trim(), String(num(tiles[id]) ?? 0)), h("span", null, words));
      box.append(tile);
    }
    return box;
  }

  /**
   * One persona's row in the Workers list, a link that selects it in the detail pane, marked `sel`
   * where it is the one the detail shows: the name, the state's glyph and word and the last active
   * age, then the plan title or "nothing queued", then the step as "N of M" over a bar or "n/a", and
   * for a paused row the store's reason. The fields the row draws ride in its `data-fields`
   * attribute, so a poll that moves any of them flags the whole row `changed` through the patch.
   */
  function workerRow(row, now, selected) {
    const name = txt(row.name);
    const line = link(selected ? "wk-row sel" : "wk-row", workerPath(name), null, "worker:" + name);
    if (selected) line.setAttribute("aria-current", "true");
    const step = workerStep(row);
    line.dataset.fields = JSON.stringify([txt(row.state), txt(row.title), step === null ? null : [step.section, step.sectionCount], txt(row.lastTurnAt), txt(row.pausedReason)]);
    const head = h("div", "wk-head");
    head.append(h("span", "wk-name", name), workerState(row), agoText("wk-age", row.lastTurnAt, now));
    line.append(head);
    const title = txt(row.title);
    line.append(title === "" ? h("div", "wk-title muted", "nothing queued") : h("div", "wk-title", title));
    const progress = h("div", "wk-step");
    if (step === null) progress.append(h("span", "muted", "n/a"));
    else progress.append(bar((step.section / step.sectionCount) * 100), h("span", "muted", step.section + " of " + step.sectionCount));
    line.append(progress);
    if (txt(row.state) === "paused" && txt(row.pausedReason) !== "") line.append(h("div", "wk-reason", txt(row.pausedReason)));
    return line;
  }

  /** The Workers list pane: the title with the read time, the roster count, the four tiles, the rows in the view's order, and the read times. */
  function workersList(view, now, shownName) {
    const out = h("div", "wk", null, "wk");
    const rows = workerRows(view);
    const top = h("div", "top", null, "top");
    const head = h("div", "top-row");
    head.append(h("h1", null, "Workers"), stamp(view));
    top.append(head, h("p", "sub", rows.length + (rows.length === 1 ? " worker" : " workers") + " on the roster", "sub"));
    out.append(top, workerTiles(view));
    const card = h("div", "card wk-rows", null, "rows");
    card.setAttribute("aria-label", "Workers");
    if (rows.length === 0) card.append(h("div", "nm-none", "No worker is on the roster."));
    for (const row of rows) card.append(workerRow(row, now, txt(row.name) === shownName));
    out.append(card, sources(view, ["roster", "queues", "events", "registry"]));
    return out;
  }

  /**
   * The detail's timeline: the persona's lines oldest first, so the newest is last, each with its age
   * and the final segment of the plan it names, then its words. A line is keyed by its stamp, kind,
   * detail and plan, a repeat of all four by its count, so a line the poll moved up keeps its node.
   */
  function workerTimeline(row, now) {
    const section = detailSection("Timeline", "timeline");
    const lines = objects(row.timeline);
    if (lines.length === 0) {
      section.append(h("p", "meta", "No events yet"));
      return section;
    }
    const steps = h("ol", "wk-tl", null, "tl");
    const seen = new Map();
    for (const line of lines) {
      const base = JSON.stringify([txt(line.ts), txt(line.event), txt(line.detail), txt(line.plan)]);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const step = h("li", TIMELINE_DONE.indexOf(txt(line.event)) >= 0 ? "done" : null, null, count === 0 ? base : base + "#" + count);
      const when = h("div", "wk-when");
      when.append(agoText(null, line.ts, now));
      const plan = txt(line.plan).split("/").pop();
      if (plan !== "") when.append(" · ", h("span", "mono", plan));
      step.append(when, h("div", "wk-what", timelineWords(line)));
      steps.append(step);
    }
    section.append(steps);
    return section;
  }

  /**
   * A persona in the detail pane, in the order the board mockup draws it: the crumb, the plan title
   * as the heading, the meta line with the state, the section, the pull request number and the branch
   * where the store holds them and the last active age, the paused reason where the row reads paused,
   * the timeline, then the act row: Message, which opens the talk screen's composer for the persona;
   * Open PR as `pullRequestPart` draws it; and Pause, or Resume where the row reads paused, each one
   * tap posting its fixed line. The say route's word for the last of those two stands under the row.
   */
  function workerDetail(row, now) {
    const name = txt(row.name);
    const box = h("div", "nm-item nm-detail wk-detail", null, "worker:" + name);
    if (workers.acting === name) box.classList.add("nm-acting");
    const title = txt(row.title);
    box.append(h("div", "nm-meta", "Workers › " + name, "crumb"), h("h2", "nm-heading", title === "" ? "nothing queued" : title, "heading"));
    const meta = h("div", "nm-meta", null, "meta");
    const parts = [workerState(row)];
    const step = workerStep(row);
    if (step !== null) parts.push(h("span", null, "Section " + step.section + " of " + step.sectionCount));
    const number = reviewNumber(row);
    if (number !== null) parts.push(h("span", null, "PR " + number));
    if (txt(row.branch) !== "") parts.push(h("span", "mono", "branch " + txt(row.branch)));
    const active = h("span", null, "last active ");
    active.append(agoText(null, row.lastTurnAt, now));
    parts.push(active);
    parts.forEach((part, index) => {
      if (index > 0) meta.append(" · ");
      meta.append(part);
    });
    box.append(meta);
    const paused = txt(row.state) === "paused";
    if (paused && txt(row.pausedReason) !== "") box.append(h("p", "wk-reason", txt(row.pausedReason), "reason"));
    box.append(workerTimeline(row, now));

    const controls = h("div", "nm-controls nm-acts", null, "controls");
    controls.append(link("wk-act", pathOf(routeTo("talk", { lineage: name })), "Message", "message|" + name));
    const pr = pullRequestPart(row, name);
    if (pr !== null) controls.append(pr);
    const toggle = h("button", "wk-act", paused ? "Resume" : "Pause", (paused ? "resume|" : "pause|") + name);
    toggle.type = "button";
    toggle.disabled = workers.acting !== null;
    listen(toggle, "click", () => sendBoardAct(name, paused ? RESUME_LINE : PAUSE_LINE));
    controls.append(toggle);
    box.append(controls);
    const words = workers.statuses.get(name);
    if (words !== undefined) box.append(statusLine(words));
    return box;
  }

  /** The detail pane's persona: the one the address names, else the first row; a line where the reading holds no such row. */
  function workersDetail(view, now, selectedName) {
    const rows = workerRows(view);
    const chosen = selectedName === null ? rows[0] : rows.find((row) => txt(row.name) === selectedName);
    if (chosen === undefined) return h("div", "nm-none", selectedName === null ? "No worker is on the roster." : "This worker is no longer in the reading.");
    return workerDetail(chosen, now);
  }

  /** Draws the Workers screen again from the last reading, so an act's words show at once; nothing where the shell is on another screen. */
  function redrawWorkers() {
    if (screen === "workers" && lastView !== null) draw(lastView);
  }

  /**
   * Sends a Pause or Resume, one of the two fixed lines, to a persona's session through the say route
   * the talk composer sends by, with no file, and sets the route's word for it under the act row as
   * the talk composer sets its own. One act at a time: every Pause and Resume button is disabled while
   * one is out, and there is no confirm step. A 4xx is the broker refusing the line, so nothing was
   * sent. A timeout, a dropped connection, a 5xx or an unreadable answer leaves the line's fate
   * unknown, and the words say it may still arrive. An answer landing after the shell moved to
   * another screen visit keeps its words and draws nothing.
   */
  async function sendBoardAct(name, text) {
    if (workers.acting !== null || name === "") return;
    workers.acting = name;
    workers.statuses.set(name, "Sending.");
    redrawWorkers();
    const here = visit;
    let words;
    try {
      words = sayWords(await postSay({ lineage: name, text }, sayTimeoutMs(0)));
    } catch (error) {
      const reason = error instanceof Unreadable ? error.message : "the broker did not answer";
      words = refusedSay(error) ? "Could not send: " + reason + "." : "Not confirmed: " + reason + ". The line may still reach the session.";
    } finally {
      workers.acting = null;
    }
    workers.statuses.set(name, words);
    if (here === visit) redrawWorkers();
  }

  /**
   * The Workers screen: the tiles and the rows in the list pane, and the persona the address names,
   * or the first row, in the detail pane, as the sheet on a phone. The rows are drawn in the view's
   * order, which is the standup's state order with a paused row in an idle row's place.
   */
  function renderWorkers(view) {
    const now = nowOf(view);
    const rows = workerRows(view);
    const names = new Set(rows.map((row) => txt(row.name)));
    for (const name of workers.statuses.keys()) if (!names.has(name)) workers.statuses.delete(name);
    const shown = item !== null ? item : rows.length === 0 ? null : txt(rows[0].name);
    const out = document.createDocumentFragment();
    out.append(pane("list", workersList(view, now, shown)), detailPane(SCREEN_PATHS.workers, workersDetail(view, now, item)));
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Ask page
  // ---------------------------------------------------------------------------------------------

  /** The repo and ask id the address names, or null where either is missing. */
  function askParams() {
    const query = new URLSearchParams(location.search);
    const repo = query.get("repo");
    const id = query.get("id");
    return repo && id ? { repo: repo, id: id } : null;
  }

  function askUrl() {
    const params = askParams();
    return params === null ? null : "/web/ask?repo=" + encodeURIComponent(params.repo) + "&id=" + encodeURIComponent(params.id);
  }

  /** The Today reading the ask page steps through, taken once per pass beside the ask's own; null until one arrives. */
  let askToday = null;

  /** The step row's ends and count from the last Today reading that held the ask on this page, by the ask's key. */
  let askStepHeld = null;

  /**
   * The row that steps to the previous and next ask: the asks in the Today list's order,
   * the current ask found by its repo and id, and "n of N" between the two links. An end with nowhere
   * to go is a disabled mark, never a link. Once a reading has held the ask, a later one that does not,
   * as after Agree or Dismiss here, draws the row that reading gave with its count, and an end whose
   * ask the current list no longer holds is a disabled mark. An ask no reading on this page has held,
   * one handled elsewhere before the page opened, reads "not in the open list", with Previous to
   * the list's first ask and Next to its last. Nothing is drawn until a
   * reading has arrived, or where neither the list nor the remembered row has an ask.
   */
  function askStep(item) {
    if (askToday === null) return null;
    const asks = todayItems(askToday)
      .map((entry) => entry.item)
      .filter((one) => askHrefOf(one) !== null);
    const key = itemKey(item);
    const at = asks.findIndex((one) => itemKey(one) === key);
    let place;
    if (at >= 0) {
      place = { key, previous: at > 0 ? asks[at - 1] : null, next: at < asks.length - 1 ? asks[at + 1] : null, count: at + 1 + " of " + asks.length };
      askStepHeld = place;
    } else if (askStepHeld !== null && askStepHeld.key === key) {
      // An end whose ask has left the list since the row was held is disabled; the count stays as held.
      const kept = (other) => (other !== null && asks.some((one) => itemKey(one) === itemKey(other)) ? other : null);
      place = { key, previous: kept(askStepHeld.previous), next: kept(askStepHeld.next), count: askStepHeld.count };
    } else if (asks.length > 0) {
      place = { key, previous: asks[0], next: asks[asks.length - 1], count: "not in the open list" };
    } else {
      return null;
    }
    // Each end is a link to its ask's page through `askHrefOf`, or a disabled mark where there is none.
    const end = (other, words, rel) => {
      if (other === null) {
        const mark = h("span", "ask-step-link off", words);
        mark.setAttribute("aria-disabled", "true");
        return mark;
      }
      const anchor = link("ask-step-link", askHrefOf(other), words);
      anchor.rel = rel;
      return anchor;
    };
    const row = h("nav", "ask-step");
    row.setAttribute("aria-label", "Asks");
    row.append(end(place.previous, "‹ Previous", "prev"), h("span", "ask-step-count", place.count), end(place.next, "Next ›", "next"));
    return row;
  }

  /**
   * Left and Right step the ask page to the previous and next ask, where that link is live. A key
   * pressed in a field, the Answer box among them, or held with Alt, Ctrl, Meta or Shift stays the
   * browser's, so typing and its shortcuts never leave the page.
   */
  function stepKey(event) {
    if (screen !== "ask") return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const active = document.activeElement;
    if (active !== null && (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
    const target = app.querySelector(event.key === "ArrowLeft" ? '.ask-step a[rel="prev"]' : '.ask-step a[rel="next"]');
    const at = target === null ? null : routeOf(target);
    if (at === null) return;
    event.preventDefault();
    go(at);
  }

  /** The ask screen's list pane: the Today list from the reading taken each pass, with this ask's row selected, or a line until one arrives. */
  function askList(selectedKey) {
    return askToday === null ? h("p", "muted", "Reading Today") : todayList(askToday, nowOf(askToday), selectedKey);
  }

  /**
   * One ask: who asked and how long ago, the question, the recommendation, the brief, the plan, the
   * thread, the step to the previous and next ask, then Agree, Answer and Dismiss with a Context of
   * the session's lines. They are the Today page's acts, with the same bodies, words, touched mark
   * and inline Answer box, so the batch there skips an ask answered here. A handled ask, one whose
   * line a page delivered, draws the act and its time in place of the buttons, since every other page
   * hides it until its session closes or raises it. The ask is the detail pane, with the Today
   * list beside it and this ask's row selected there.
   */
  function renderAsk(view) {
    const out = document.createDocumentFragment();
    const now = nowOf(view);
    // The ask in a Today item's shape, raise time included, so the shared acts and the touched mark key it the same way and send the version this page drew.
    const item = { kind: "ask", repo: txt(view.repo), askId: txt(view.askId), text: txt(view.question), recommend: view.recommend, openedAt: view.openedAt, reraisedAt: view.reraisedAt };
    const key = itemKey(item);
    // A delivered ask's hide holds for the reading it was drawn from alone, as on the Today page.
    for (const [held, drawn] of needsMe.delivered) if (drawn !== view) needsMe.delivered.delete(held);

    const top = h("div", "top");
    top.append(back(SCREEN_PATHS.standup, "Standup"));
    const row = h("div", "top-row");
    const who = h("h1", null, item.repo);
    if (view.blocking === true) who.append(" ", h("span", "tag", "blocking"));
    row.append(who, stamp(view));
    top.append(row);
    const opened = parse(view.openedAt);
    if (opened !== null) {
      const asked = h("p", "sub", "asked ");
      asked.append(clockText("span", null, span(now - opened)), " ago");
      top.append(asked);
    }
    out.append(top);

    const ask = h("section", needsMe.out.has(key) ? "card pad section ask-card nm-acting" : "card pad section ask-card");
    ask.setAttribute("aria-label", "Ask");
    ask.append(md("div", "ask-question", item.text));
    if (txt(item.recommend) !== "") ask.append(recRow(txt(item.recommend)));
    out.append(ask);

    if (txt(view.brief).trim() !== "") {
      const brief = h("section", "card pad section");
      brief.setAttribute("aria-label", "Brief");
      brief.append(cardHead("Brief"), md("div", "ask-brief", view.brief));
      out.append(brief);
    }

    const where = h("section", "card pad section ask-where");
    if (txt(view.planPath) !== "") where.append(h("div", "meta", "Plan"), h("div", "mono", txt(view.planPath)));
    // The talk page's rule: the thread link is the one URL the page did not build, so only Discord's is drawn.
    const thread = txt(view.thread);
    if (thread.indexOf(DISCORD_PREFIX) === 0) where.append(link("ask-thread", thread, "Open the thread"));
    if (where.childNodes.length > 0) out.append(where);

    // The step row stands above the acts whichever way the ask reads, so after an act it still offers Next.
    const step = askStep(item);
    if (step !== null) out.append(step);

    const words = needsMe.statuses.get(key);
    if (view.handled === true) {
      // Handled: the other pages hide the ask until the persona closes it or asks again.
      const at = parse(view.handledAt);
      const how = txt(view.how);
      out.append(statusLine((how === "" ? "Handled" : "Handled, " + how) + " from a page" + (at === null ? "" : " at " + dayClock(at, now)) + "."));
    } else if (deliveredIn(view, item)) {
      // Delivered from this reading: the buttons go, and the next reading carries the handled mark.
      out.append(statusLine(words ?? ""));
    } else {
      const acts = h("div", "ask-acts", null, "acts");
      const controls = h("div", "nm-controls ask-controls", null, "controls");
      // An ask's page state is keyed on its id, so a view with none takes no act and no Context, as on Today.
      if (item.askId !== "") {
        if (agreeable(item)) controls.append(actButton("nm-agree", "Agree", "agree|" + key, () => sendAgree(item)));
        controls.append(actButton("nm-correct", "Answer", "answer|" + key, () => openCorrect(item)));
        controls.append(actButton("nm-dismiss", "Dismiss", "dismiss|" + key, () => sendDismiss(item)));
        // The page draws the brief, plan and thread above, so its Context reads the session's lines alone.
        controls.append(contextButton(item, key, false));
      }
      acts.append(controls);
      if (txt(item.recommend).trim() === "") acts.append(h("div", "meta", "no recommendation to agree to"));
      if (needsMe.correct !== null && needsMe.correct.key === key) acts.append(correctBox(item, key));
      if (words !== undefined) acts.append(statusLine(words));
      const context = item.askId !== "" ? needsMe.context.get(key) : undefined;
      if (context !== undefined) acts.append(contextPanel(item, context, false, now));
      out.append(acts);
    }

    out.append(sources(view, ["roster", "ledger", "registry"]));
    const frame = document.createDocumentFragment();
    // The ask's list pane is the Today list, so its sheet closes to that list.
    frame.append(pane("list", askList(itemRowKey(item))), detailPane(SCREEN_PATHS.today, out));
    return frame;
  }

  /** What the ask screen draws where the broker holds no such open ask: a line saying so in the detail pane, and no button to act on it. */
  function askGone() {
    const out = document.createDocumentFragment();
    const top = h("div", "top");
    top.append(back(SCREEN_PATHS.standup, "Standup"));
    const row = h("div", "top-row");
    row.append(h("h1", null, "Ask"));
    top.append(row);
    out.append(top);
    const card = h("section", "card pad section ask-gone");
    card.setAttribute("role", "status");
    card.append(h("p", null, "This ask is not open. The broker's last reading lists no open ask at this address."));
    out.append(card);
    const frame = document.createDocumentFragment();
    frame.append(pane("list", askList(null)), detailPane(SCREEN_PATHS.today, out));
    return frame;
  }

  // ---------------------------------------------------------------------------------------------
  // Patching the live tree
  // ---------------------------------------------------------------------------------------------

  /** How long a node keeps the `changed` class the patch gave it, a little past the stylesheet's fade. */
  const CHANGED_MS = 1600;

  /** The keys two siblings have shared, so each such defect is logged once for the page's life. */
  const warnedKeys = new Set();

  /** An element's key, read from its `data-key` alone; null for an element with none and for a text node. */
  function keyOf(node) {
    return node.nodeType === 1 && typeof node.dataset.key === "string" ? node.dataset.key : null;
  }

  /** Whether an element holds text the clock moves, as `clockText` marks it, so a change in that text is not a data change. */
  function ticks(node) {
    return node.nodeType === 1 && typeof node.dataset.clock === "string";
  }

  /** Whether a built node can be paired with a live one: both text, or both elements of one tag. */
  function sameShape(live, fresh) {
    return live.nodeType === fresh.nodeType && (live.nodeType !== 1 || live.tagName === fresh.tagName);
  }

  /** A class attribute's value without the `changed` token, so the token the patch adds never reads as a change; null where nothing is left. */
  function classWithoutChanged(value) {
    if (value === null) return null;
    const held = value.split(" ").filter((token) => token !== "" && token !== "changed").join(" ");
    return held === "" ? null : held;
  }

  function markChanged(node) {
    const held = classWithoutChanged(node.getAttribute("class"));
    node.setAttribute("class", held === null ? "changed" : held + " changed");
  }

  function unmarkChanged(node) {
    const held = classWithoutChanged(node.getAttribute("class"));
    if (held === null) node.removeAttribute("class");
    else node.setAttribute("class", held);
  }

  /** The timer that takes each flagged node's `changed` class away, by node, so each node's flag runs its own time. */
  const flagTimers = new Map();

  /**
   * Gives a node the `changed` class for `CHANGED_MS`. A node flagged again while its flag is up has
   * its timer cleared and armed again, and its class taken off and put back with a layout read
   * between, so the stylesheet's fade starts over from the top.
   */
  function flagNode(node) {
    const held = flagTimers.get(node);
    if (held !== undefined) {
      clearTimeout(held);
      unmarkChanged(node);
      void node.offsetWidth;
    }
    markChanged(node);
    flagTimers.set(
      node,
      setTimeout(() => {
        flagTimers.delete(node);
        unmarkChanged(node);
      }, CHANGED_MS),
    );
  }

  /**
   * Copies the built element's style properties to the live one through the style object, which the
   * content policy allows where a style attribute set as text is not, and drops the properties the
   * built element lacks. Answers whether any property moved.
   */
  function syncStyle(live, fresh) {
    let changed = false;
    const names = Array.from(fresh.style);
    for (const name of names) {
      const value = fresh.style.getPropertyValue(name);
      if (live.style.getPropertyValue(name) === value) continue;
      live.style.setProperty(name, value);
      changed = true;
    }
    for (const name of Array.from(live.style)) {
      if (names.indexOf(name) >= 0) continue;
      live.style.removeProperty(name);
      changed = true;
    }
    return changed;
  }

  /**
   * Makes the live element's attributes the built one's: a value that differs is set as the builder
   * set it, one the built element lacks is removed, and the style attribute goes through `syncStyle`.
   * Answers whether any attribute changed.
   */
  function syncAttributes(live, fresh) {
    let changed = false;
    const names = fresh.getAttributeNames();
    for (const name of names) {
      if (name === "style") {
        if (syncStyle(live, fresh)) changed = true;
        continue;
      }
      const value = fresh.getAttribute(name);
      const held = name === "class" ? classWithoutChanged(live.getAttribute("class")) : live.getAttribute(name);
      if (held === value) continue;
      live.setAttribute(name, value);
      changed = true;
    }
    for (const name of live.getAttributeNames()) {
      if (names.indexOf(name) >= 0) continue;
      // A class holding the `changed` token alone is the patch's own, and the timer takes it.
      if (name === "class" && classWithoutChanged(live.getAttribute("class")) === null) continue;
      if (name === "style") {
        syncStyle(live, fresh);
        changed = true;
        continue;
      }
      live.removeAttribute(name);
      changed = true;
    }
    return changed;
  }

  /** Drops the handlers a kept live node was built with and binds the ones its built twin carries, as `listen` recorded them. */
  function syncHandlers(live, fresh) {
    const old = handlers.get(live);
    const next = handlers.get(fresh);
    if (old === undefined && next === undefined) return;
    if (old !== undefined) for (const [type, handler] of old) live.removeEventListener(type, handler);
    if (next !== undefined) for (const [type, handler] of next) live.addEventListener(type, handler);
    if (next === undefined) handlers.delete(live);
    else handlers.set(live, next);
  }

  /**
   * A field's value becomes the built one's only where the two differ. A builder draws a field from
   * the draft its input handler keeps, so a field being typed in holds what the builder drew and is
   * left alone, caret and all; a draft the page cleared or rewrote lands.
   */
  function syncValue(live, fresh) {
    if (typeof fresh.value !== "string" || fresh.value === live.value) return;
    live.value = fresh.value;
  }

  /** Makes a kept live element its built twin: attributes, handlers, a field's value, then its children. */
  function syncElement(live, fresh, flagged) {
    if (syncAttributes(live, fresh)) flagged.add(live);
    syncHandlers(live, fresh);
    syncValue(live, fresh);
    syncChildren(live, fresh, flagged);
  }

  /**
   * Pairs the built children with the live ones, a keyed node with the live node of its key
   * wherever it sits among the siblings and an unkeyed one with the first unpaired unkeyed live
   * node of its shape in live order, so one live node whose tag changed is passed over rather than
   * stopping the pairing of every unkeyed sibling after it. A built key already seen among these
   * siblings is a builder's defect: it is logged once and the node is drawn as new.
   *
   * Moves. Every live node left unpaired is removed first. Of the kept nodes, the longest run whose
   * old order already matches the built order stays where it is, and only the kept nodes outside
   * that run are moved, since a browser drops a moved node's focus, selection and scroll. So a kept
   * node moves only where it changed places with the kept nodes around it: one row moved to the end
   * of a list moves alone, and the rows it passed stay. Each kept node is then synced, and a built
   * node with no pair is inserted whole.
   *
   * Flags. A text node whose text changed flags its parent. An inserted element takes the flag
   * itself, and an inserted text node flags its parent. A removed unkeyed node flags its parent,
   * and a removed keyed node flags nothing, so a row leaving a list does not flash the list. Nothing
   * is flagged under a parent that held no child nodes before this patch, so the first draw and a
   * list's first row stay quiet. A text change, or a text node inserted or removed, under a parent
   * marked `data-clock` by `clockText` flags nothing, since the clock moved it and not the data.
   * The flags are collected here, and `patch` decides whether they are shown.
   */
  function syncChildren(live, fresh, flagged) {
    const olds = Array.from(live.childNodes);
    const news = Array.from(fresh.childNodes);
    const byKey = new Map();
    for (const node of olds) {
      const key = keyOf(node);
      if (key !== null && !byKey.has(key)) byKey.set(key, node);
    }
    const paired = new Map();
    const claimed = new Set();
    const seen = new Set();
    for (const node of news) {
      const key = keyOf(node);
      if (key === null) continue;
      if (seen.has(key)) {
        if (!warnedKeys.has(key)) {
          warnedKeys.add(key);
          console.warn("Two siblings under " + String(live.tagName) + " share the key " + JSON.stringify(key) + "; the second is drawn as new.");
        }
        continue;
      }
      seen.add(key);
      const twin = byKey.get(key);
      if (twin !== undefined && !claimed.has(twin) && sameShape(twin, node)) {
        claimed.add(twin);
        paired.set(node, twin);
      }
    }
    // `at` is the first unclaimed unkeyed live node; the look for a node of the built one's shape starts there.
    let at = 0;
    for (const node of news) {
      if (keyOf(node) !== null) continue;
      while (at < olds.length && (claimed.has(olds[at]) || keyOf(olds[at]) !== null)) at += 1;
      let match = at;
      while (match < olds.length && (claimed.has(olds[match]) || keyOf(olds[match]) !== null || !sameShape(olds[match], node))) match += 1;
      if (match < olds.length) {
        claimed.add(olds[match]);
        paired.set(node, olds[match]);
      }
    }
    // A parent that held nothing is being drawn for the first time, so what lands in it is not a change.
    const quiet = olds.length === 0;
    for (const node of olds) {
      if (claimed.has(node)) continue;
      node.remove();
      if (keyOf(node) === null && (node.nodeType === 1 || !ticks(live))) flagged.add(live);
    }
    const position = new Map(olds.map((node, index) => [node, index]));
    const twins = news.filter((node) => paired.has(node));
    const run = steadyRun(twins.map((node) => position.get(paired.get(node))));
    const stays = new Set(twins.filter((node, index) => run.has(index)));
    // From the last built node back, each lands just before the one after it; a twin in the steady run is already there.
    let after = null;
    for (let index = news.length - 1; index >= 0; index -= 1) {
      const node = news[index];
      const twin = paired.get(node);
      if (twin === undefined) {
        live.insertBefore(node, after);
        if (!quiet) {
          if (node.nodeType === 1) flagged.add(node);
          else if (!ticks(live)) flagged.add(live);
        }
        after = node;
        continue;
      }
      if (!stays.has(node)) live.insertBefore(twin, after);
      if (twin.nodeType === 1) syncElement(twin, node, flagged);
      else if (twin.textContent !== node.textContent) {
        twin.textContent = node.textContent;
        if (!ticks(live)) flagged.add(live);
      }
      after = twin;
    }
  }

  /**
   * The longest run of `positions`, read in order, that only increases, as the set of its indexes.
   * The kept twins at those indexes already stand in built order and stay; every other twin moves.
   */
  function steadyRun(positions) {
    const tails = [];
    const before = [];
    positions.forEach((value, index) => {
      let low = 0;
      let high = tails.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (positions[tails[middle]] < value) low = middle + 1;
        else high = middle;
      }
      before[index] = low > 0 ? tails[low - 1] : -1;
      tails[low] = index;
    });
    const run = new Set();
    for (let index = tails.length > 0 ? tails[tails.length - 1] : -1; index >= 0; index = before[index]) run.add(index);
    return run;
  }

  /**
   * The one place the page patches the tree after its first draw: makes the children of
   * `live` the built `fresh`'s, keeping every live node whose key or place persists so the browser
   * keeps its scroll, its selection, its focus and the words typed in it. Where `flag` is true, each
   * node `syncChildren` flags takes the `changed` class through `flagNode`; where it is false the
   * patch changes the tree the same way and flags nothing. `draw` passes true for a poll's reading
   * alone, so only what the broker's data moved is highlighted, never what the operator's own act drew.
   */
  function patch(live, fresh, flag) {
    const flagged = new Set();
    syncChildren(live, fresh, flagged);
    if (flag !== true) return;
    for (const node of flagged) flagNode(node);
  }

  // ---------------------------------------------------------------------------------------------
  // The shell: the rail, the panes, the screen the address names, and the poll
  // ---------------------------------------------------------------------------------------------

  const app = document.getElementById("app");
  const notice = document.getElementById("notice");
  /** The screen drawn, by name and by its `PAGES` entry, and the list row the address selects; null before the first address is read. */
  let screen = null;
  let page = null;
  let item = null;
  /** The path of the screen's reading with no row selected, so a change of row alone redraws instead of reading again. */
  let lastPlace = null;
  /** The screens whose list pane is the standup's repo list. */
  const STANDUP_LISTED = new Set(["standup", "repo"]);
  /** Whether this screen visit's list pane is the list the screen left drew, which keeps its scroll on the visit's first draw. */
  let listKept = false;
  let lastView = null;
  let lastOk = null;
  /** The summary reading beside every screen's own, which the rail's counts read; null before one arrives. */
  let summaryView = null;
  /** The standup reading the shell last drew, which the rail's Workers count reads where no Workers reading is held; null until the standup is drawn. */
  let standupView = null;
  /** The Workers reading this visit took, whose `tiles.working` the rail's Workers count reads; null off the Workers screen. */
  let workersView = null;
  /** Counts each screen entered, so a poll begun on an earlier screen draws nothing once the shell has moved on. */
  let visit = 0;
  /** The timer of the next poll, cleared when the screen changes so one poll loop runs at a time. */
  let pollTimer = null;

  /**
   * The rail's entries, in the mockup's order: the glyph its `.ic` span carries, the word, the screen
   * each opens, and the screens it is marked on. Repos opens the standup and is marked on the repo
   * and plan screens the standup leads to.
   */
  const RAIL = [
    { screen: "today", glyph: "◉", words: "Today", marks: ["today"] },
    { screen: "workers", glyph: "▤", words: "Workers", marks: ["workers"] },
    { screen: "standup", glyph: "⌂", words: "Repos", marks: ["standup", "repo", "plan"] },
    { screen: "changelog", glyph: "≡", words: "Changelog", marks: ["changelog"] },
    { screen: "health", glyph: "♥", words: "Health", marks: ["health"] },
  ];

  /**
   * The count beside a rail entry, or null for none: Today takes the summary's `needsYou`,
   * Workers the Workers reading's `tiles.working` where the shell holds one, else the number of
   * standup repos working from the standup reading it holds, and Health the capacity verdict word.
   * Repos and Changelog carry none.
   */
  function railCount(entry) {
    if (entry.screen === "today") {
      const count = isObject(summaryView) ? num(summaryView.needsYou) : null;
      return count === null ? null : String(count);
    }
    if (entry.screen === "workers") {
      const working = isObject(workersView) && isObject(workersView.tiles) ? num(workersView.tiles.working) : null;
      if (working !== null) return String(working);
      return standupView === null ? null : String(list(standupView.repos).filter((repo) => isObject(repo) && repo.state === "working").length);
    }
    if (entry.screen !== "health") return null;
    const word = isObject(summaryView) && isObject(summaryView.capacity) ? txt(summaryView.capacity.verdict) : "";
    return word === "" ? null : word;
  }

  /** The sandbox's name, from the summary, else the siblings reading, else nothing. */
  function sandboxName() {
    const own = isObject(summaryView) ? txt(summaryView.sandbox) : "";
    return own !== "" ? own : isObject(siblingsView) ? txt(siblingsView.sandbox) : "";
  }

  /**
   * The rail: the brand, a link to the root path and so to Today, the five entries with their counts, the entry of the screen drawn marked,
   * and at the foot the sibling pills above the sandbox's name. On a phone the stylesheet lays it
   * as the bottom tab bar.
   */
  function shellRail() {
    const rail = h("nav", "rail", null, "rail");
    rail.setAttribute("aria-label", "Screens");
    rail.append(link("brand", "/", "Channels", "brand"));
    for (const entry of RAIL) {
      const on = entry.marks.includes(screen);
      const nav = link(on ? "nav on" : "nav", SCREEN_PATHS[entry.screen], null, "nav:" + entry.screen);
      if (on) nav.setAttribute("aria-current", "page");
      nav.append(h("span", "ic", entry.glyph), h("span", "word", entry.words));
      const count = railCount(entry);
      // Health's count is the verdict word, marked `n-word`. The folded rail, too narrow for a word, shows the dot beside it
      // instead, in the verdict's tone, and the entry's title carries the word.
      const kind = entry.screen === "today" && count !== "0" ? "n" : entry.screen === "health" ? "n dim n-word" : "n dim";
      if (count !== null) nav.append(h("span", kind, count));
      if (count !== null && entry.screen === "health") {
        nav.append(h("span", ("dot n-dot " + verdictTone(count)).trim()));
        nav.title = count;
      }
      rail.append(nav);
    }
    const foot = h("div", "foot", null, "foot");
    const pills = sandboxRail(siblingsView);
    if (pills !== null) foot.append(pills);
    const name = sandboxName();
    if (name !== "") foot.append(h("span", "sandbox", name, "sandbox"));
    rail.append(foot);
    return rail;
  }

  /**
   * The sibling pills and the sandbox's name as a row, or null where there is neither. The rail's
   * foot holds them on the desktop; below that width the foot is hidden and this row, at the head of
   * the list pane or of a screen drawn as one, is where they are reached.
   */
  function sandboxRow() {
    const pills = sandboxRail(siblingsView);
    const name = sandboxName();
    if (pills === null && name === "") return null;
    const row = h("div", "sandbox-row", null, "sandbox-row");
    if (pills !== null) row.append(pills);
    if (name !== "") row.append(h("span", "sandbox", name, "sandbox"));
    return row;
  }

  /**
   * One pane of the main area: the list, the detail, or the whole area for a screen drawn as one.
   * The list pane and the whole pane open with the sandbox row.
   */
  function pane(kind, ...parts) {
    const box = h("section", "pane " + kind, null, "pane:" + kind);
    const row = kind === "detail" ? null : sandboxRow();
    if (row !== null) box.append(row);
    box.append(...parts);
    return box;
  }

  /**
   * The detail pane of a screen with a selected row. On a phone it is the sheet over the list, and
   * its head, a grab bar and a Close link to `listPath`, is drawn there; the wide layouts hide it.
   * `listPath` is a route-table path: the list the sheet is drawn over with no row selected, or Today
   * for an ask or a plan and Health for talk, whose Close steps back to the screen it was opened from
   * instead where `closesBack` says so.
   */
  function detailPane(listPath, ...parts) {
    const head = h("div", "sheet-head", null, "sheet-head");
    head.append(h("span", "grab"), link("close", listPath, "Close", "close"));
    return pane("detail", head, ...parts);
  }

  /**
   * The classes on the shell's root the stylesheet lays the phone out by: `sheet` where a row is
   * selected and the detail slides up over the list, which an ask, a repo, a plan and a talk
   * address each name, as a Today or Workers address naming a row does, and `stacked` where the screen has no selection and the two panes flow as
   * one column. The standup screen has neither, so a phone shows its list alone.
   */
  function frameClasses() {
    const named = screen === "ask" || screen === "repo" || screen === "plan" || screen === "talk";
    app.classList.toggle("sheet", named || ((screen === "today" || screen === "workers") && item !== null));
    app.classList.toggle("stacked", screen === "health");
  }

  /** Whether a pane is scrolled to its foot, within a line or two; a missing pane counts as at the foot. */
  function atFoot(box) {
    return box === null || box.scrollTop + box.clientHeight >= box.scrollHeight - 80;
  }

  /** Scrolls each pane the selector names to its top. */
  function toTop(selector) {
    for (const box of app.querySelectorAll(selector)) box.scrollTo(0, 0);
  }

  /** Draws the rail and one line in the main area, where no reading is drawn: before the first arrives, or on an address naming nothing. */
  function drawLine(words) {
    const fresh = document.createDocumentFragment();
    fresh.append(shellRail(), pane("whole", h("p", "muted", words)));
    // The line has no detail pane to slide up or flow beside, so no phone layout class dims or hides it.
    app.classList.remove("sheet", "stacked");
    patch(app, fresh, false);
    toTop(".pane");
  }

  /** A failed read, with the HTTP status where the broker answered one, so the ask page can tell a closed ask from an outage. */
  class Unreadable extends Error {
    constructor(message, status) {
      super(message);
      this.status = typeof status === "number" ? status : null;
    }
  }

  function setNotice(message) {
    notice.textContent = message;
    notice.hidden = false;
  }

  /**
   * Builds `view` whole off to the side, then patches it into the page, so a live node whose key
   * persists keeps its scroll, its selection, its focus and the words typed in it. A builder that
   * throws does so before the patch starts and leaves the last page untouched; a throw inside the
   * patch stops it where it is and can leave the page part patched, until the next draw patches the
   * rest. Only a draw from the poll, `fromPoll`, flags what changed: a redraw the operator's own act
   * caused, such as opening a Correct box or a Context, flags nothing.
   */
  function draw(view, fromPoll) {
    // A screen that follows its newest content keeps its detail pane at the foot when the reader was there, and starts there.
    const follow = page.follow === true && (lastView === null || atFoot(app.querySelector(".pane.detail")));
    const drawn = page.render(view);
    // The rail, then the screen's own two panes, the list and the detail.
    const fresh = document.createDocumentFragment();
    fresh.append(shellRail(), drawn);
    frameClasses();
    patch(app, fresh, fromPoll === true);
    // The first reading a screen visit draws starts its panes at the top, the detail alone where the
    // list is the one the screen left drew; a following screen then goes to its foot.
    if (lastView === null) toTop(listKept ? ".pane.detail" : ".pane");
    goneDrawn = false;
    const detail = follow ? app.querySelector(".pane.detail") : null;
    if (detail !== null) detail.scrollTo(0, detail.scrollHeight);
  }

  /** Whether the not-open line is what the page shows, so a later failed poll leaves it in place. */
  let goneDrawn = false;

  /** A failed read the page draws as gone: a 404 on a page that has a gone draw, the ask page alone. */
  function isGone(error) {
    return page.gone !== undefined && error instanceof Unreadable && error.status === 404;
  }

  /** Draws the page's not-open line from this answer alone; nothing is kept, so a later 200 draws the thing again. */
  function drawGone() {
    const drawn = page.gone();
    // The rail, then the gone draw's own panes, so it reaches the patch in the shape a screen's draw does.
    const fresh = document.createDocumentFragment();
    fresh.append(shellRail(), drawn);
    frameClasses();
    patch(app, fresh, false);
    // The line's first draw starts the panes at the top; a later poll's leaves the list where the reader scrolled it.
    if (!goneDrawn) toTop(".pane");
    lastView = null;
    goneDrawn = true;
    notice.hidden = true;
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
    if (!response.ok) throw new Unreadable("the broker answered HTTP " + response.status, response.status);
    try {
      return await response.json();
    } catch (error) {
      throw new Unreadable("the broker's answer was not JSON");
    }
  }

  let seenSent = false;

  /**
   * Marks the plan seen: once per open, after the plan has been drawn once, never on a poll. A plan
   * that could not be read is never drawn, so a link to one that does not exist marks nothing. The seen
   * route marks only a plan a sweep holds, so the post for a branch read whose address no sweep holds
   * marks nothing. The answer is ignored; the mark only moves what the standup page counts as unseen.
   */
  function sendSeen() {
    if (seenSent || screen !== "plan") return;
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
   * drawn repo reading `drawn` carries, so the broker stamps the mark with what the operator saw. The
   * time is left out when neither reading carries one.
   */
  function drawnAtOf(name, drawn) {
    const asOf = isObject(drawn) && isObject(drawn.asOf) ? drawn.asOf : {};
    const times = [asOf.plans, asOf.ledger].filter((value) => parse(value) !== null);
    const body = { repo: name };
    if (times.length > 0) body.drawnAt = times.reduce((a, b) => (parse(a) <= parse(b) ? a : b));
    return body;
  }

  /**
   * Posts the caught-up mark for a repo once per tap, stamped from `drawn`, the repo reading the tapped
   * button was drawn from, then draws the screen again so it shows the result. Once the shell has
   * moved to another screen visit, the screen is not read or drawn again.
   */
  async function sendCaughtUp(name, drawn) {
    if (caughtUpSending) return;
    caughtUpSending = true;
    const here = visit;
    try {
      const response = await fetch("/web/caught-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(drawnAtOf(name, drawn)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Unreadable("the broker answered HTTP " + response.status);
      if (here !== visit) return;
      const [read] = await Promise.all([fetchView(page.url()), fetchBeside()]);
      if (here !== visit) return;
      const view = await acceptView(read, here);
      if (view === null || here !== visit) return;
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

  /**
   * The siblings reading beside the page's own, once per pass. A failure here is not the page's:
   * the last reading stays drawn, and the page's own fetch decides what the notice says.
   */
  async function fetchSiblings() {
    try {
      siblingsView = await fetchView("/web/siblings");
    } catch (error) {
      // Kept as it was: a rail that cannot refresh shows the last poll rather than vanishing.
    }
  }

  /**
   * The ask page's Today reading beside its own, once per pass, which its step row orders by. A
   * failure here is not the page's: the last reading stays, and the ask's own fetch decides the notice.
   */
  async function fetchToday() {
    if (screen !== "ask") return;
    try {
      askToday = await fetchView("/web/today");
    } catch (error) {
      // Kept as it was: a step row that cannot refresh keeps the last order rather than vanishing.
    }
  }

  /**
   * The summary reading beside the screen's own, once per pass, which the rail's counts read. A
   * failure here is not the screen's: the last reading stays, and the screen's own fetch decides the notice.
   */
  async function fetchSummary() {
    try {
      summaryView = await fetchView("/web/summary");
    } catch (error) {
      // Kept as it was: a rail that cannot refresh its counts shows the last poll rather than none.
    }
  }

  /**
   * The repo screen's standup reading beside its own, once per pass, which its list pane draws. A
   * failure here is not the screen's: the last reading stays, and the repo's own fetch decides the notice.
   */
  async function fetchStandup() {
    if (screen !== "repo") return;
    const here = visit;
    try {
      const view = await fetchView("/web/standup");
      if (here === visit) standupView = view;
    } catch (error) {
      // Kept as it was: a list that cannot refresh shows the last poll rather than vanishing.
    }
  }

  /**
   * The readings a screen draws beside its own view that are fetched with it, the ask's Today
   * list and the repo screen's standup, so the poll and an act's refresh read the same set. The
   * repos beside the standup and the plan are read after their view, by the screen's `accept`.
   */
  function fetchBeside() {
    return Promise.all([fetchToday(), fetchStandup()]);
  }

  /**
   * Takes a reading of the screen's own view through the screen's `accept`, which reads the repo
   * drawn beside the standup and the plan, and holds a standup reading for the rail's count and the
   * repo screen's list, and a Workers reading for the rail's count. Returns the reading to draw, or null for an answer the screen has moved past.
   * `here` is the visit the reading was fetched on; a later visit's readings are not touched.
   */
  async function acceptView(view, here) {
    const shown = page.accept ? await page.accept(view) : view;
    if (here === visit && shown !== null && screen === "standup") standupView = shown;
    if (here === visit && shown !== null && screen === "workers") workersView = shown;
    return shown;
  }

  async function poll() {
    // The screen this poll reads for; once the shell has moved on, what comes back is dropped undrawn.
    const here = visit;
    let failure = null;
    try {
      const url = page.url();
      const [view] = await Promise.all([fetchView(url), fetchSiblings(), fetchSummary(), fetchBeside()]);
      if (here !== visit) return;
      try {
        const shown = await acceptView(view, here);
        if (here !== visit) return;
        if (shown === null || (screen === "changelog" && url !== changelogUrl())) {
          // An answer the page has moved past, a Changelog answer for a count or filter it no longer
          // asks for among them: nothing is drawn and the last good view stays.
          pollTimer = setTimeout(poll, POLL_MS);
          return;
        }
        // The patch keeps a selection inside unchanged text and the field being typed in, so every
        // reading is drawn as it arrives. The first draw of a screen visit flags nothing, since no
        // earlier reading of this screen is on the page to have changed; each later poll's draw flags.
        draw(shown, lastView !== null);
        sendSeen();
        lastView = shown;
        lastOk = Date.now();
        notice.hidden = true;
      } catch (error) {
        failure = "the reading could not be drawn";
      }
    } catch (error) {
      if (here !== visit) return;
      if (isGone(error)) {
        drawGone();
        pollTimer = setTimeout(poll, POLL_MS);
        return;
      }
      failure = error instanceof Unreadable ? error.message : "the reading could not be fetched";
    }
    if (failure !== null) {
      if (lastView === null && goneDrawn) {
        // The not-open line stays: an outage after it says only that the page could not refresh.
        setNotice("Could not refresh: " + failure + ".");
      } else if (lastView === null) {
        setNotice("Could not load: " + failure + ". Trying again every " + POLL_MS / 1000 + " seconds.");
        drawLine("No reading yet.");
      } else {
        setNotice("Could not refresh: " + failure + ". Showing the last reading, " + span(Date.now() - lastOk) + " old.");
      }
    }
    pollTimer = setTimeout(poll, POLL_MS);
  }

  /** What the main area says on a screen whose address names no object to read. */
  const EMPTY_WORDS = { plan: "Open a plan from a repo page.", talk: "No session named in the address.", ask: "Open an ask from the Today or Repos page." };

  /**
   * Opens the screen a route names. Where only the selected row differs from the screen drawn, the
   * last reading is drawn again with the new row, its detail at the top. Otherwise the poll loop of
   * the screen left is stopped, what it held is forgotten, and the new screen's loop starts now; the
   * screen left stays on the page, scrolled where it was and with no sheet, until the new screen draws
   * at its top. A move between the standup and a repo, whose list pane is the same standup list, keeps
   * that list where the reader scrolled it, and only the detail starts at its top.
   */
  function enter(at) {
    const place = placeOf(at);
    const moved = at.item !== item;
    item = at.item;
    if (place === lastPlace) {
      // draw and drawGone set the frame classes. Before the first reading the page still shows the
      // screen left, so the classes are left alone and the sheet stays down until that draw.
      if (lastView !== null) draw(lastView);
      else if (goneDrawn) drawGone();
      // Another row's detail starts at its top, not where the last row's was scrolled to.
      if (moved) toTop(".pane.detail");
      return;
    }
    visit += 1;
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = null;
    lastPlace = place;
    listKept = STANDUP_LISTED.has(screen) && STANDUP_LISTED.has(at.screen);
    // A move between two plans keeps the repo reading, which their list draws where it is the same repo's.
    const planToPlan = screen === "plan" && at.screen === "plan";
    screen = at.screen;
    page = PAGES[screen];
    lastView = null;
    lastOk = null;
    goneDrawn = false;
    seenSent = false;
    // The readings a screen takes beside its own are held for the visit that took them: the ask's
    // Today list, the standup the standup and repo screens draw and the rail's Workers count reads,
    // the repo whose detail the standup screen draws and whose plans the plan screen lists, and the
    // Workers reading the rail's count reads. The standup is kept where the list it draws stays on the
    // page, so the list is drawn from it at once.
    askToday = null;
    changelogHeld.count = CHANGELOG_STEP;
    changelogHeld.open.clear();
    if (!listKept) standupView = null;
    workersView = null;
    if (!planToPlan) repoBeside = null;
    notice.hidden = true;
    // The screen left stays drawn until the new screen's first reading is, with its detail hidden
    // meanwhile: that draw sets the new screen's classes, so no detail but its own rises as the sheet.
    app.classList.remove("sheet");
    // The talk screen's held lines are one lineage's: a different lineage in the address starts afresh.
    if (screen === "talk" && talkLineage() !== talk.lineage) resetTalk(talkLineage());
    const url = page.url();
    if (url === null) {
      drawLine(Object.prototype.hasOwnProperty.call(EMPTY_WORDS, screen) ? EMPTY_WORDS[screen] : "No repo named in the address.");
      return;
    }
    if (screen === "talk") loadTalkPlan();
    poll();
  }

  /**
   * Moves the address to a route and draws its screen: the one place `pushState` is called, over a path `pathOf` builds.
   * A tap on the address already shown replaces the entry rather than adding one, so Back never stalls on a repeat tap, and a
   * caller passing `replace` as true replaces it too: a dismissed item leaving the address, or one whose Dismiss failed coming back to it.
   * Every entry added carries the state `{ shell: true }`, so the entry behind it is one of the shell's screens, and a replaced entry keeps its state.
   */
  function go(at, replace) {
    const path = pathOf(at);
    const here = routeOf(window.location);
    if (replace === true || (here !== null && pathOf(here) === path)) history.replaceState(history.state, "", path);
    else history.pushState({ shell: true }, "", path);
    enter(at);
  }

  /**
   * Whether the sheet's Close steps back one history entry instead of following its link: on an ask,
   * a plan or a talk sheet, which other screens link to, where `go` added the entry shown, so the entry
   * behind it is the shell's screen the sheet was opened from, which may be another ask, plan or talk.
   * An entry a load opened carries no such state, and Close follows its own link: Today for an ask or a
   * plan, Health for talk.
   */
  function closesBack() {
    return (screen === "ask" || screen === "plan" || screen === "talk") && isObject(history.state) && history.state.shell === true;
  }

  /**
   * A tap on a link to one of the shell's own screens draws that screen here, with no page load. A
   * link to another origin, to a file, or to any path the route table has no screen for is left to
   * the browser, as is a tap with a modifier key or a button other than the main one, so a middle
   * click, a long press and a sibling pill keep their meaning. The sheet's Close link steps back
   * where `closesBack` says so. On the phone layout a tap on the dim layer under the sheet, which is
   * the root's own `::before` and so targets the root itself, taps Close; a tap anywhere in the sheet
   * targets a node inside it and closes nothing. The press must start on the dim layer too, since a
   * press inside the sheet released over the list, as a text selection drags, also clicks the root.
   */
  function followLink(event) {
    if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const pressed = pressedOn;
    pressedOn = null;
    if (event.target === app && pressed === app && app.classList.contains("sheet") && window.matchMedia(PHONE_QUERY).matches) {
      const close = app.querySelector(".pane.detail .sheet-head .close");
      if (close !== null) close.click();
      return;
    }
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (anchor === null || anchor.target !== "" || anchor.origin !== window.location.origin) return;
    const at = routeOf(anchor);
    if (at === null) return;
    event.preventDefault();
    if (anchor.classList.contains("close") && closesBack()) history.back();
    else go(at);
  }

  /** The node the press inside the shell's root started on, which a tap on the dim layer must be; each click reads it once and clears it. */
  let pressedOn = null;

  /** The screen the address names now, after the back or forward button moved it. */
  function returned() {
    const at = routeOf(window.location);
    if (at !== null) enter(at);
  }

  function start() {
    // A load with no address at all is a node test's, which reads the patch and the router and draws nothing.
    if (window.location === undefined) return;
    const at = routeOf(window.location);
    if (at === null) {
      drawLine("No screen at this address.");
      return;
    }
    // The toast's live region joins the page empty, before any message, so a screen reader announces the first one.
    document.body.append(toastBox);
    document.addEventListener("click", followLink);
    app.addEventListener("pointerdown", (event) => {
      pressedOn = event.target;
    });
    document.addEventListener("keydown", stepKey);
    document.addEventListener("keydown", inboxKey);
    window.addEventListener("popstate", returned);
    enter(at);
  }

  // The patch and the router are the two members the script exposes, so a node test drives each
  // on its own, as `markdown.js` exposes its renderer; the page itself reads nothing off them.
  window.patch = patch;
  window.route = routeOf;

  start();
})();
