// The web surface's pages: one script for all seven, loaded after markdown.js, whose renderer it
// calls. Each page names itself in `<body data-page>`, fetches its view and the siblings reading
// from the broker every five seconds and draws them again.
// The page holds no state the broker does not, apart from which session list is expanded.
//
// Render rule: every string in a view was written by a session or a person and is hostile to the
// page. View text goes in through `textContent`, `append` of a string, or the text nodes
// `markdown.js`'s renderer builds inside its fixed elements, never as markup, and a link is fixed
// route text plus `encodeURIComponent` of a view value. Nothing here builds HTML.
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
    ask: { render: renderAsk, url: askUrl, gone: askGone },
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

  /**
   * An element with fixed classes holding a persona's text drawn as markdown blocks, through
   * `markdown.js`'s renderer over `document`, so every byte of the text reaches the page as a text
   * node and never as markup.
   */
  function md(tag, cls, text) {
    const element = h(tag, cls);
    element.append(...window.markdownBlocks(txt(text), document));
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

  /**
   * A section's header on the overview, Needs me, worker, plan and ask pages: the name, then " · " and the
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
      const button = held ? app.querySelector('[data-focus-key="steer"]') : null;
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
    const box = h("div", "steer-composer");
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
    input.dataset.focusKey = "steer-text";
    input.addEventListener("input", () => {
      steer.draft = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        sendSteer();
      }
    });
    const send = h("button", "send", "Send");
    send.type = "button";
    send.disabled = steer.sending;
    send.dataset.focusKey = "steer-send";
    send.addEventListener("click", () => sendSteer());
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
    const card = h("section", "card pad heading-card");
    card.setAttribute("aria-labelledby", "direction-heading");
    const head = cardHead("Heading · " + txt(onRepo ? view.name : view.sandbox), null, "h2", "direction-heading");
    const date = txt(heading.date) === "" ? null : tagDay(heading.date);
    if (onRepo) {
      if (date !== null) head.append(h("div", "heading-by", "set by you · " + date));
    } else {
      const button = h("button", "steer", steer.open ? "Cancel" : "Steer");
      button.type = "button";
      button.disabled = steer.sending;
      button.setAttribute("aria-expanded", steer.open ? "true" : "false");
      if (steer.open) button.setAttribute("aria-controls", "steer-composer");
      button.dataset.focusKey = "steer";
      button.addEventListener("click", toggleSteer);
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
    button.dataset.focusKey = "publish|" + rolloutKey(row);
    button.addEventListener("click", () => sendPublish(row));
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
    const card = h("section", "card ro-card panel");
    card.dataset.panel = "rollout";
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
      const line = h("div", "ro-line");
      const text = h("span");
      const since = tagDay(row.lastTagDate) === "" ? ", no rollout tag yet" : " since " + tagDay(row.lastTagDate);
      text.append(h("b", null, rolloutClient(row)), " · " + num(row.toRollOut) + " merged" + since);
      line.append(text, h("span", "ro-day", dayOf(row.oldestAt, now) ?? ""));
      full.append(line);
    }
    for (const row of publishing) {
      const line = h("div", "ro-line");
      const text = h("span");
      text.append(h("b", null, txt(row.repo)), " · " + publishSince(row, now));
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
    for (const row of publishing) {
      const line = h("div", "ro-flow");
      line.append(h("b", null, txt(row.repo)), " ", h("span", "muted", "· " + publishSince(row, now)));
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
    const counted = publishing.length === 0 ? "commits on each branch past its last rollout tag" : "commits past each branch's last rollout tag or the trunk's last publish tag";
    card.append(rolloutFooter(counted, summary.readAt));
    return card;
  }

  /** The repo page's card for the client branch the persona's checkout is on, or nothing where the slot is null. */
  function rolloutRepoCard(view) {
    const row = view.rollout;
    if (!isObject(row)) return null;
    const now = nowOf(view);
    const card = h("section", "card pad attn ro-repo");
    card.setAttribute("aria-labelledby", "rollout-heading");
    const head = cardHead("Rollout", null, "h2", "rollout-heading");
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

  /** The repo page's card for the repository the persona's checkout reads where it ships by publish tags, or nothing where the slot is null. */
  function publishRepoCard(view) {
    const row = view.publish;
    if (!isObject(row)) return null;
    const now = nowOf(view);
    const card = h("section", "card pad attn ro-repo");
    card.setAttribute("aria-labelledby", "rollout-heading");
    const head = cardHead("Rollout", null, "h2", "rollout-heading");
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
      for (const commit of commits) {
        const mark = h("span", "ro-check", "✓");
        mark.setAttribute("aria-hidden", "true");
        grid.append(mark, h("span", null, txt(commit.title)), h("span", "ro-day", dayOf(commit.at, now) ?? ""));
      }
      card.append(grid);
    }
    if (toPublish > commits.length) card.append(h("div", "ro-more", "and " + (toPublish - commits.length) + " more"));
    if (publishRowOf(row)) {
      const action = h("div", "ro-action");
      action.append(publishButton(row, "ro-button-repo"));
      card.append(action);
    }
    card.append(rolloutFooter("tags the trunk head; the tag starts the publish workflow", null));
    return card;
  }

  /**
   * The Needs-me page's Roll out group, one row and one button per client branch and per publish repository with something
   * waiting, or nothing where the slot is null.
   */
  function rolloutGroup(view) {
    if (!Array.isArray(view.rollout)) return null;
    const now = nowOf(view);
    const rows = objects(view.rollout);
    const publishing = objects(view.publish);
    const held = rolloutHeld(view);
    if (!held && rows.length === 0 && publishing.length === 0) return null;
    const section = h("section", "section");
    section.setAttribute("aria-label", "Roll out");
    const count = publishing.length === 0 ? plural(rows.length, "client", "clients") : rows.length + publishing.length + " waiting";
    section.append(cardHead("Roll out", held ? "tags unread" : count, "h2"));
    const card = h("div", "card panel");
    card.dataset.panel = "rollout";
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
      for (const row of publishing) {
        const line = h("div", "ro-need");
        const text = h("div");
        text.append(h("b", null, txt(row.repo)), " · " + publishSince(row, now) + " ");
        const oldest = dayOf(row.oldestAt, now);
        if (oldest !== null) text.append(h("span", "muted", "· oldest " + oldest));
        // The head the tap ships, by its title, and what the tag starts; no title where the row carries no commits.
        const newest = objects(row.commits)[0];
        if (newest !== undefined && txt(newest.title) !== "") text.append(h("div", "muted", "newest: " + txt(newest.title)));
        text.append(h("div", "muted", "the tag starts the publish workflow"));
        line.append(text);
        if (publishRowOf(row)) line.append(publishButton(row, "ro-button-need"));
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

  /** An ask's id on the Needs me page: its repo, a colon and its ask id, unencoded, or null for any other item. */
  function askKey(item) {
    return item.kind === "ask" && txt(item.askId) !== "" ? txt(item.repo) + ":" + txt(item.askId) : null;
  }

  /** The ask page of an item that is an ask naming its repo and id, or null for any other item. */
  function askHrefOf(item) {
    return item.kind === "ask" && txt(item.repo) !== "" && txt(item.askId) !== ""
      ? "/ask?repo=" + encodeURIComponent(item.repo) + "&id=" + encodeURIComponent(item.askId)
      : null;
  }

  function needRow(item, now) {
    const href = askHrefOf(item);
    const row = href !== null ? link("need-row", href) : item.repo ? link("need-row", repoHref(item.repo)) : h("div", "need-row");
    row.append(h("span", "who", item.repo ? item.repo : "Hands"));
    const middle = h("div");
    if (item.kind === "blocked") middle.append(h("span", "tag", "blocked"));
    else if (item.kind === "ask" && item.blocking) middle.append(h("span", "tag", "blocking"));
    middle.append(txt(item.text));
    if (item.recommend) middle.append(recRow(item.recommend));
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

  // The band draws a need whole, so the repo card's need line is a pointer cut at this many code points.
  const NEED_POINTER_POINTS = 80;

  /** `text` cut to its first `points` code points, an ellipsis marking a cut. */
  function cutPoints(text, points) {
    const characters = Array.from(text);
    return characters.length <= points ? text : characters.slice(0, points).join("") + "…";
  }

  /**
   * A repo that needs the operator, as a card: its head links to the repo page and its need line, one
   * line, to the ask page for an ask and to the repo page otherwise, so the card holds two links side by
   * side rather than one inside the other.
   */
  function repoCard(repo, needs, now) {
    const card = h("div", "card repo-card attn");
    const head = link("repo-head", repoHref(repo.name));
    const name = h("div", "repo-name");
    name.append(txt(repo.name), chevron());
    head.append(name);
    const opened = parse(repo.oldestOpenAt);
    const item = needs.find((candidate) => candidate.repo === repo.name && candidate.kind !== "hands");
    // The badge names the repo's own state where it is one a need explains, else the kind of need it holds.
    const word = CARD_STATES.indexOf(repo.state) >= 0 ? repo.state : item && item.kind === "ask" ? "asking" : "blocked";
    head.append(
      h("span", repo.state === "stalled" ? "badge red" : "badge", word + (opened === null ? "" : " · " + span(now - opened))),
    );
    card.append(head);
    if (item) card.append(link("need-line", askHrefOf(item) ?? repoHref(repo.name), cutPoints(txt(item.text), NEED_POINTER_POINTS)));
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
    // A stalled repo with nothing to answer is a row carrying the stalled word. The view holds no time it stalled.
    if (repo.state === "stalled") name.append(h("span", "badge red", "stalled"));
    row.append(name);
    const turn = parse(repo.worker ? repo.worker.lastTurnAt : null);
    const step = repo.step && num(repo.step.section) !== null && num(repo.step.sectionCount) !== null ? repo.step : null;
    const meta = h(
      "div",
      "meta",
      "queue " + (num(repo.queueDepth) ?? 0) + (step === null ? "" : " · section " + step.section + " of " + step.sectionCount) + (turn === null ? "" : " · last turn " + span(now - turn) + " ago"),
    );
    if (num(repo.unseen) > 0) meta.append(" · ", h("span", "alert", repo.unseen + " unseen"));
    row.append(meta);
    if (step !== null && txt(step.next) !== "") row.append(h("div", "meta next", "Next: " + step.next));
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
      link("alert", "/needs-me", "Needs me · " + needs.length + (needs.length === 1 ? " item" : " items")),
      link("", "/health", num(health.expected) === null ? "All sessions" : "All " + health.expected + " sessions"),
    );
    top.append(nav);
    out.append(top);

    // On a wide screen the needs and the direction take the left column and the workers the right, so the
    // standup fits one screen; on a phone neither column draws a box, and the sections stack as one.
    const cols = h("div", "standup-cols");
    const main = h("div", "standup-main");
    const side = h("div", "standup-side");
    cols.append(main, side);
    out.append(cols);

    const band = h("section", "card attn panel");
    band.dataset.panel = "needs";
    band.id = "needs";
    band.setAttribute("aria-labelledby", "needs-heading");
    const head = cardHead("Needs you", needs.length + (needs.length === 1 ? " item" : " items"), "h2", "needs-heading");
    head.classList.add("band-head");
    head.prepend(dot("amber"));
    band.append(head);
    if (needs.length === 0) band.append(h("div", "empty", "Nothing needs you right now."));
    else {
      const rows = h("div", "need-list");
      for (const item of needs) rows.append(needRow(item, now));
      band.append(rows);
    }
    main.append(band);
    const headingBand = headingCard(view, false);
    if (headingBand !== null) main.append(headingBand);
    const rolloutBand = rolloutCard(view);
    if (rolloutBand !== null) main.append(rolloutBand);

    // The rollup counts workers, so each chip names its unit, as "2 workers asking" or "1 worker idle".
    const counts = h("div", "rollup");
    for (const state of ["asking", "blocked", "stalled", "working", "idle", "dormant"]) {
      const n = repos.filter((repo) => repo.state === state).length;
      if (n === 0) continue;
      const item = h("span");
      item.append(h("b", CARD_STATES.indexOf(state) >= 0 ? "alert" : "", String(n)), (n === 1 ? " worker " : " workers ") + state);
      counts.append(item);
    }
    if (counts.firstChild !== null) side.append(cardHead("Workers", null, "h2"));
    side.append(counts);

    const stack = h("section", "repos");
    stack.setAttribute("aria-label", "Repos");
    // A repo with an ask or a blocked item in the band needs the operator and draws as a card; every other
    // repo draws as a row, or as a chip in the dormant box.
    const needy = new Set(needs.filter((item) => item.kind === "ask" || item.kind === "blocked").map((item) => item.repo));
    // The cards and rows share one wrapper, a bounded panel on a wide screen and no box of its own on a phone.
    const repoList = h("div", "repo-list panel");
    repoList.dataset.panel = "repos";
    for (const repo of repos.filter((candidate) => needy.has(candidate.name))) {
      repoList.append(repoCard(repo, needs, now));
    }
    const active = repos.filter((candidate) => !needy.has(candidate.name) && candidate.state !== "dormant");
    if (active.length > 0) {
      const group = h("div", "card");
      const rows = h("div", "rows");
      for (const repo of active) rows.append(repoRow(repo, now));
      group.append(rows);
      repoList.append(group);
    }
    if (repoList.firstChild !== null) stack.append(repoList);
    const dormant = repos.filter((candidate) => !needy.has(candidate.name) && candidate.state === "dormant");
    if (dormant.length > 0) {
      const box = h("section", "card dormant");
      const top2 = cardHead("Dormant", dormant.length, "h2");
      top2.append(h("div", "meta", "tap to open"));
      const chips = h("div", "chips panel");
      chips.dataset.panel = "dormant";
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
    side.append(stack);

    const band2 = link("card health-band", "/health");
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

    const queued = list(view.upNext);
    const nextSection = h("section", "section");
    nextSection.append(cardHead("Up next", queued.length));
    if (queued.length === 0) nextSection.append(h("div", "card pad muted", "Nothing is queued."));
    else {
      const card = h("div", "card");
      for (const plan of queued) card.append(planRow(plan, now, true));
      nextSection.append(card);
    }
    left.append(nextSection);

    const changed = list(view.changed);
    const changedSection = h("section", "section");
    changedSection.append(
      cardHead(since === null ? "Changed in the last 24 hours" : "Changed since " + dayClock(since, now), view.changed === null ? null : changed.length),
    );
    if (view.changed === null) changedSection.append(h("div", "card pad muted", "No plans were swept for this repo."));
    else if (changed.length === 0) changedSection.append(h("div", "card pad muted", "Nothing has changed."));
    else {
      const card = h("div", "card");
      for (const plan of changed) card.append(planRow(plan, now, false));
      changedSection.append(card);
    }
    left.append(changedSection);

    // The worker page leads with what is queued, then what changed, then the Heading and Rollout cards.
    // A repository ships one way, so at most one of the two slots holds a row.
    const headingBox = headingCard(view, true);
    if (headingBox !== null) left.append(headingBox);
    const rolloutBox = rolloutRepoCard(view) ?? publishRepoCard(view);
    if (rolloutBox !== null) left.append(rolloutBox);

    const worker = view.worker || {};
    const box = h("section", "card pad worker");
    const head = cardHead(txt(worker.lineage || view.name) + ": Worker", null, "h2");
    head.prepend(dot(worker.surfaceState === "working" ? "blue" : "hollow"));
    head.append(h("div", "meta", (worker.surfaceState || "no session") + " · " + leaseWords(worker)));
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
    );
    const serves = txt(view.serves);
    if (serves !== "") chips.append(h("span", serves.toLowerCase() === "none" ? "badge serves" : "badge plain serves", "serves " + serves));
    chips.append(h("span", "meta mono", txt(view.path)));
    top.append(chips);
    out.append(top);

    const brief = briefCard(view.brief);
    if (brief !== null) out.append(brief);
    else {
      const goal = h("section", "card pad section");
      goal.append(cardHead("Goal"), md("div", "goal", txt(view.goal).trim() !== "" ? view.goal : "This plan has no Goal section."));
      out.append(goal);
    }

    const asks = list(view.openAsks);
    if (asks.length > 0) {
      const box = h("section", "section");
      box.append(cardHead("Open asks", asks.length));
      const card = h("div", "card");
      for (const ask of asks) {
        const item = h("div", "ask");
        const text = h("div");
        if (ask.blocking) text.append(h("span", "tag", "blocking"));
        text.append(txt(ask.text));
        item.append(text);
        if (ask.recommend) item.append(recRow(ask.recommend));
        const opened = parse(ask.openedAt);
        if (opened !== null) item.append(h("div", "meta", "asked " + span(now - opened) + " ago"));
        card.append(item);
      }
      box.append(card);
      out.append(box);
    }

    const progress = h("section", "card pad section");
    progress.append(cardHead("Progress"));
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
      progress.append(cardHead("Chapters", chapters.length, "h3"));
      const steps = h("ul", "steps");
      for (const chapter of chapters) {
        const item = h("li");
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
  const UNKNOWN_REASONS = {
    "no-accounts": "no account reporting a weekly window",
    "no-completed-plans": "no plan finished in the last 7 days",
    "no-queue": "the queue has not been read yet",
  };
  const SESSION_ORDER = { "needs you": 0, blocked: 0, working: 1, idle: 2, exited: 3 };
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

  /**
   * One account's card: the binding window's name and percentage as the headline, the account and its
   * projection under it, and every window's bar at the foot, an untouched account's at 0% included.
   */
  function accountRow(account, now) {
    const box = h("div", "card account");
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

    // The windows close the card, so the bars of cards side by side end level.
    if (lines.length > 0) {
      const grid = h("div", "windows");
      for (const line of lines) {
        const pct = num(line.window.pct) ?? 0;
        const reset = parse(line.window.resetsAt);
        grid.append(h("span", "muted", line.name), h("span", null, pct + "%"), h("span", "muted reset", reset === null ? "" : until(reset - now)), bar(pct, pct >= 80));
      }
      box.append(grid);
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
    const line = h("div", "kit-line", published === null ? "Release time unknown." : "Published " + span(now - published) + " ago");
    if (kit.sha) line.append(" ", h("span", "muted mono", txt(kit.sha)));
    card.append(line);
    if (behind.length > 0) card.append(h("div", "meta", "Restart to take it: " + behind.map((session) => txt(session.name)).join(", ")));
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

  // ---------------------------------------------------------------------------------------------
  // Sibling sandboxes: the rail on every page and the health page's card
  // ---------------------------------------------------------------------------------------------

  /**
   * The path a sibling pill opens on the sibling, by this page's name: the pages that name no object
   * of this sandbox open the same page there, and the others open the sibling's standup. The href is
   * the sibling's origin, from this broker's own configuration, plus one of these fixed paths.
   */
  const RAIL_PATHS = { standup: "/", "needs-me": "/needs-me", health: "/health" };

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
    const rail = h("nav", "rail");
    rail.setAttribute("aria-label", "Sandboxes");
    rail.append(h("span", "pill active", txt(view.sandbox)));
    const path = Object.prototype.hasOwnProperty.call(RAIL_PATHS, document.body.dataset.page) ? RAIL_PATHS[document.body.dataset.page] : "";
    for (const sibling of siblings) {
      if (!isObject(sibling)) continue;
      const origin = txt(sibling.origin);
      const pill = SIBLING_ORIGIN.test(origin) ? link("pill", origin + path, null) : h("span", "pill");
      siblingWords(pill, sibling, now);
      rail.append(pill);
    }
    return rail;
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
      const row = h("div", "row");
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
    card.append(h("div", "note", "counts only, polled over the tailnet · " + (read === null ? "no poll yet" : "as of " + dayClock(read, now))));
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
    const hands = handsSection(view, now);
    // Under the hands, where the mockup places it: the other sandboxes are the operator's, not a session's.
    const others = otherSandboxes(siblingsView);
    if (others !== null) hands.append(others);
    cols.append(sessionsSection(view), capacitySection(view, now), hands);
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

  /** The key the Needs-me page keeps the touched asks under. */
  const TOUCHED_KEY = "channels.needs-me.touched";

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
    talk.echoes = [];
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
   * The line's words draw as an echo marked sending once its files are up, and a poll that
   * carries the ring's own copy replaces it. The broker's readable answer that nothing was sent, and its refusal with an
   * HTTP 4xx, take the echo away. A request that ends any other way once it is out, by a timeout, a
   * dropped connection, an HTTP 5xx or an unreadable body, keeps it, marked not yet confirmed, since
   * the broker may still deliver the line; `echoMark` reads it may not have sent once the timer set
   * at that end, `UNSENT_MARK_MS` long, flags it, and the timer draws the page then, since a broker
   * that is down answers no poll. A selection or a line being typed holds that draw as it holds a
   * poll, for at most as many tries of `POLL_MS` as the poll's hold allows, after which the timer
   * draws over it. A refusal of a send whose echo already took a landing, while an
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
    let refused = false;
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
      const response = await fetch("/web/say", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answering ? { lineage, text, answers: true } : { lineage, text, files: ids }),
        signal: AbortSignal.timeout(sayTimeoutMs(ids.length)),
      });
      if (!response.ok) {
        // A 4xx is the broker refusing the line, so nothing was sent. A 5xx may come after the
        // broker read it, so its state is unknown.
        refused = response.status >= 400 && response.status < 500;
        throw new Unreadable("the broker answered HTTP " + response.status);
      }
      const answer = await response.json();
      const status = txt(answer.status);
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
        talk.status = status === "answered" ? "Answered." : "Sent.";
        if (echo !== null) echo.settled = true;
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
        if (echo !== null && echo.landed && !(refused && moveLanding(echo))) {
          // Settled at its landing.
        } else if (posted && !refused) {
          if (echo !== null) {
            echo.mark = "not yet confirmed";
            // The mark `echoMark` draws changes `UNSENT_MARK_MS` after this end, on the timer's own
            // clock, which flags the echo unsent at that moment and draws it. A broker that is down
            // fails every poll, which draws nothing, so no poll's draw can be relied on to carry the
            // mark: a selection or a line being typed holds the draw as it holds a poll, and the
            // timer tries again every `POLL_MS`, skipping at most `HOLD_POLLS` times before it draws
            // over the hold, as the poll does. An echo landed or cleared by then is off the list and
            // draws nothing. The end is set once per send, so an echo gets one timer.
            const drawUnsent = (skipped) => {
              if (lastView === null || talk.echoes.indexOf(echo) < 0) return;
              if ((selected() === null && !composing()) || skipped >= HOLD_POLLS) draw(lastView);
              else setTimeout(() => drawUnsent(skipped + 1), POLL_MS);
            };
            setTimeout(() => {
              echo.unsent = true;
              drawUnsent(0);
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

  function talkLine(line, lineage, now) {
    const mine = line.kind === "inbound" && line.senderClass === "operator";
    const box = h("div", "msg" + (mine ? " mine" : ""));
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
    const shown = talk.echoes.filter((echo) => echo.shown);
    if (lines.length === 0 && shown.length === 0) transcript.append(h("div", "muted talk-empty", "No lines yet."));
    for (const line of lines) transcript.append(talkLine(line, lineage, now));
    // Sent lines the ring has not carried back yet, in the operator's own style.
    for (const echo of shown) transcript.append(talkLine({ kind: "inbound", senderClass: "operator", author: echo.author, text: echo.text, at: echo.at, echo: echoMark(echo) }, lineage, now));
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
    "already-acted": "already acted on from a page",
    "no-recommendation": "no recommendation to agree to",
    changed: "the recommendation changed since you read it, read it again",
    "refused: blocking": "refused: blocking, answer this one yourself",
  };

  /** The word a delivered line reads, by the act that sent it. */
  const DELIVERED_WORDS = { agree: "agreed", correct: "corrected", dismiss: "dismissed" };

  /** Each act's name, for the words beside an item whose answer could not be read. */
  const ACT_NAMES = { agree: "Agree", correct: "Correct", dismiss: "Dismiss" };

  /** A blocked run's `changed`: the reason the page drew is no longer the block's. */
  const BLOCK_CHANGED_WORDS = "the block's reason changed since you read it, read it again";

  /**
   * A Needs me headline is cut at this many code points, an ellipsis marking the cut, and the whole
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

  /** The batch cap the needs-me view carries, or the default where it is absent. */
  function batchCap(view) {
    const cap = num(view.maxBatch);
    return cap !== null && cap >= 1 ? Math.floor(cap) : DEFAULT_MAX_BATCH;
  }

  /**
   * What the Needs-me and ask pages hold between polls: the order chosen; the asks the operator acted
   * on in this tab, kept in its session storage, which the batch leaves alone; the words beside each
   * item from its last act; whether an act is out, and the items it is out for; each item whose line
   * was delivered, with the reading it was drawn from, which a newer reading replaces; the Correct box
   * open, by its item's key, with its draft; and each open Context, by its item's key.
   */
  const needsMe = {
    sort: "kind",
    touched: loadTouched(),
    statuses: new Map(),
    acting: false,
    out: new Set(),
    delivered: new Map(),
    correct: null,
    context: new Map(),
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

  /** The key any item's page state is held under: an ask's `needsKey`, a blocked run's lineage and queue entry. */
  function itemKey(item) {
    return item.kind === "blocked" ? JSON.stringify([item.repo, "blocked", txt(item.entryId)]) : needsKey(item);
  }

  /** The words beside an item once its act is answered; a status the table lacks is named as the broker said it. */
  function actWords(status, act, item) {
    if (status === "delivered") return DELIVERED_WORDS[act] + ", sent to " + txt(item.repo);
    if (status === "changed" && item.kind === "blocked") return BLOCK_CHANGED_WORDS;
    return Object.prototype.hasOwnProperty.call(ACT_WORDS, status) ? ACT_WORDS[status] : "the broker answered " + status + ", left open";
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
      if (isGone(error)) drawGone();
      else redrawNeeds();
    }
  }

  /** The body an Agree sends: the ask, its lineage and the recommendation this page drew, which the broker matches before it delivers. */
  function agreeBody(item) {
    return { askId: item.askId, repo: item.repo, recommend: txt(item.recommend) };
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
   * the view again, so the item shows the text the broker now holds. Answers whether it was delivered.
   */
  async function sendAct(item, act, body) {
    if (needsMe.acting) return false;
    const key = itemKey(item);
    if (item.kind === "ask") touch(key);
    needsMe.acting = true;
    needsMe.out.add(key);
    needsMe.statuses.set(key, "sending");
    redrawNeeds();
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
      if (status === "delivered") {
        if (lastView !== null) needsMe.delivered.set(key, lastView);
        if (needsMe.correct !== null && needsMe.correct.key === key) needsMe.correct = null;
      }
      if (status === "changed") await refreshView();
      else redrawNeeds();
    }
    return status === "delivered";
  }

  /** Agrees to one ask on the recommendation this page drew. */
  function sendAgree(item) {
    return sendAct(item, "agree", agreeBody(item));
  }

  /** Dismisses one item: an ask by its id, a blocked run by its queue entry and the text the view gave it, which the broker matches byte for byte. */
  function sendDismiss(item) {
    const body =
      item.kind === "blocked"
        ? { kind: "blocked", repo: item.repo, entryId: item.entryId, reason: txt(item.text) }
        : { kind: "ask", askId: item.askId, repo: item.repo };
    return sendAct(item, "dismiss", body);
  }

  /** Opens the Correct box under one ask, closing any other, and puts the caret in it. */
  function openCorrect(item) {
    const key = itemKey(item);
    if (needsMe.correct === null || needsMe.correct.key !== key) needsMe.correct = { key, draft: "" };
    redrawNeeds();
    const field = document.getElementById("correct-text");
    if (field !== null) field.focus();
  }

  /** Closes the Correct box and drops its draft. */
  function closeCorrect() {
    needsMe.correct = null;
    redrawNeeds();
  }

  /**
   * Sends the Correct box's words for its ask. The broker builds the line from the ask's id, its
   * question and these words, so the page composes none. A line not delivered keeps the box and the
   * draft, with the caret back in it.
   */
  async function sendCorrect(item) {
    const held = needsMe.correct;
    if (held === null || held.key !== itemKey(item)) return;
    const words = held.draft.trim();
    if (words === "") return;
    const sent = await sendAct(item, "correct", { askId: item.askId, repo: item.repo, words });
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
    let changed = false;
    try {
      const answer = await postAgree("agree-batch", { items: sent.map(agreeBody) }, batchTimeoutMs(sent.length));
      const results = list(answer.results);
      sent.forEach((item, at) => {
        const result = results[at];
        const status = result !== null && typeof result === "object" ? txt(result.status) : null;
        if (status === "changed") changed = true;
        if (status === "delivered" && lastView !== null) needsMe.delivered.set(needsKey(item), lastView);
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
    const held = { loading: true, ask: null, lines: null, failure: null };
    needsMe.context.set(key, held);
    redrawNeeds();
    const reads = await Promise.allSettled([
      withAsk && item.kind === "ask" ? fetchView(contextAskUrl(item)) : Promise.resolve(null),
      fetchView(contextTalkUrl(item)),
    ]);
    if (needsMe.context.get(key) !== held) return;
    held.loading = false;
    if (reads[0].status === "fulfilled" && isObject(reads[0].value)) held.ask = reads[0].value;
    if (reads[1].status === "fulfilled") held.lines = contextLines(reads[1].value, item);
    const failed = reads.find((read) => read.status === "rejected");
    if (failed !== undefined) held.failure = failed.reason instanceof Unreadable ? failed.reason.message : "the reading could not be fetched";
    redrawNeeds();
  }

  /** A full-size act button, its words set as text, disabled while any act is out. */
  function actButton(cls, words, focusKey, onClick) {
    const button = h("button", cls, words);
    button.type = "button";
    button.disabled = needsMe.acting;
    button.dataset.focusKey = focusKey;
    button.addEventListener("click", onClick);
    return button;
  }

  /** The Context disclosure's button, closed by default; whether it is open is read from `needsMe.context`. */
  function contextButton(item, key, withAsk) {
    const open = needsMe.context.has(key);
    const button = h("button", open ? "nm-context on" : "nm-context", "Context");
    button.type = "button";
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.dataset.focusKey = "context|" + key;
    button.addEventListener("click", () => toggleContext(item, withAsk));
    return button;
  }

  /**
   * An open Context: the whole text where the headline was cut, then for an ask its brief, plan path and
   * thread link, then the session's lines, each under the talk page's own head and then its text. Every
   * string is the view's and goes in as text, and the thread link is drawn only where it is Discord's,
   * the ask page's own rule.
   */
  function contextPanel(item, held, cut, now) {
    const panel = h("div", "nm-context-body");
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
        const row = h("div", "nm-line");
        row.append(talkHead(line, txt(item.repo), now), h("div", null, txt(line.text)));
        panel.append(row);
      }
    }
    if (held.failure !== null) panel.append(h("div", "meta nm-context-failed", "The context could not be read: " + held.failure + "."));
    return panel;
  }

  /**
   * The Correct box under an ask: the question quoted as text, a box of three rows bounded at the talk
   * composer's 4000, then Send and Cancel. Enter is a new line, and Ctrl or Cmd with Enter sends. The
   * draft lives in `needsMe.correct`, so a redraw puts the typed text back.
   */
  function correctBox(item, key) {
    const held = needsMe.correct;
    const box = h("div", "nm-correct-box");
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
    field.dataset.focusKey = "correct-text|" + key;
    const send = actButton("nm-send", "Send", "correct-send|" + key, () => sendCorrect(item));
    send.disabled = needsMe.acting || held.draft.trim() === "";
    field.addEventListener("input", () => {
      held.draft = field.value;
      send.disabled = needsMe.acting || field.value.trim() === "";
    });
    field.addEventListener("keydown", (event) => {
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
    const status = h("div", "meta nm-status", words);
    status.setAttribute("role", "status");
    return status;
  }

  /**
   * One item: who and how long, its headline, what is recommended, then the acts its kind can take with
   * the broker's last word and, where open, the Correct box and the Context. An ask takes Agree where it
   * carries a recommendation, Correct and Dismiss. A blocked run takes Dismiss alone, since it carries no
   * recommendation and its session is stopped. Any other kind, a hands item among them, is a reading of
   * a true condition and takes none.
   */
  function needsItem(item, now) {
    const box = h("div", "nm-item");
    const anchor = askKey(item);
    if (anchor !== null) box.id = anchor;
    const head = h("div", "nm-head");
    const who = h("span", "nm-who", item.repo ? txt(item.repo) : "Hands");
    const opened = parse(item.openedAt);
    if (item.kind === "blocked") who.append(" ", h("span", "tag", "blocked"));
    else if (item.kind === "ask" && item.blocking === true) who.append(" ", h("span", "tag", "blocking"));
    head.append(who, h("span", "nm-age", opened === null ? "" : span(now - opened)));
    const headline = cutPoints(txt(item.text), HEADLINE_POINTS);
    // An ask's question opens its own page; any other item's text is plain.
    const href = askHrefOf(item);
    box.append(head, href !== null ? link("nm-text", href, headline) : h("div", "nm-text", headline));
    if (txt(item.recommend) !== "") box.append(recRow(txt(item.recommend)));
    if ((item.kind !== "ask" && item.kind !== "blocked") || txt(item.repo) === "") return box;

    const key = itemKey(item);
    if (needsMe.out.has(key)) box.classList.add("nm-acting");
    // An item's page state is keyed on its id, so an item the view gives no id takes no act and no Context.
    const named = txt(item.kind === "blocked" ? item.entryId : item.askId) !== "";
    const controls = h("div", "nm-controls");
    if (item.kind === "blocked") {
      if (named) controls.append(actButton("nm-dismiss", "Dismiss", "dismiss|" + key, () => sendDismiss(item)));
    } else if (named) {
      if (agreeable(item)) controls.append(actButton("nm-agree", "Agree", "agree|" + key, () => sendAgree(item)));
      controls.append(actButton("nm-correct", "Correct", "correct|" + key, () => openCorrect(item)));
      controls.append(actButton("nm-dismiss", "Dismiss", "dismiss|" + key, () => sendDismiss(item)));
      if (txt(item.recommend).trim() === "") controls.append(h("span", "meta", "no recommendation to agree to"));
    }
    if (named) controls.append(contextButton(item, key, true));
    box.append(controls);
    if (item.kind === "ask" && needsMe.correct !== null && needsMe.correct.key === key) box.append(correctBox(item, key));
    const words = needsMe.statuses.get(key);
    if (words !== undefined) box.append(statusLine(words));
    const context = named ? needsMe.context.get(key) : undefined;
    if (context !== undefined) box.append(contextPanel(item, context, headline !== txt(item.text), now));
    return box;
  }

  /** What stands where a delivered item was until the next reading: the act's word and the session it went to. */
  function deliveredLine(item) {
    const line = h("div", "nm-item nm-sent", needsMe.statuses.get(itemKey(item)) ?? "");
    line.setAttribute("role", "status");
    return line;
  }

  /**
   * One group: its label with a count and an optional note, then its items in the chosen order, or a
   * line saying there are none. An item whose line was delivered from this reading is out of the count,
   * and its words stand in its place.
   */
  function needsGroup(view, name, words, note, now, attn) {
    const items = sortedItems(groupItems(view, name));
    const open = items.filter((item) => !deliveredIn(view, item));
    const section = h("section", "section");
    section.setAttribute("aria-label", words);
    const head = cardHead(words, open.length, "h2");
    if (note) head.append(h("div", "meta", note));
    section.append(head);
    const card = h("div", attn && open.length > 0 ? "card attn panel" : "card panel");
    card.dataset.panel = name;
    if (items.length === 0) card.append(h("div", "nm-none", "Nothing here."));
    for (const item of items) card.append(deliveredIn(view, item) ? deliveredLine(item) : needsItem(item, now));
    section.append(card);
    return section;
  }

  function renderNeedsMe(view) {
    const out = h("div", "nm");
    const now = nowOf(view);
    // A delivered item's hide holds for the reading it was drawn from alone, so a newer reading decides again.
    for (const [key, drawn] of needsMe.delivered) if (drawn !== view) needsMe.delivered.delete(key);
    // An item's words and Context go with the item, so a key no item in this reading holds is dropped.
    const held = new Set(["blocked", "ask", "hands"].flatMap((name) => groupItems(view, name)).map(itemKey));
    for (const key of needsMe.statuses.keys()) if (!held.has(key)) needsMe.statuses.delete(key);
    for (const key of needsMe.context.keys()) if (!held.has(key)) needsMe.context.delete(key);
    const all = ["blocked", "ask", "hands"].flatMap((name) => groupItems(view, name)).filter((item) => !deliveredIn(view, item));
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

    // On a wide screen the groups sit side by side, each scrolling in its own panel, so the page fits one
    // screen; on a phone the wrapper draws no box and the groups stack.
    const rolloutNeeds = rolloutGroup(view);
    const groups = h("div", "nm-groups");
    groups.append(
      needsGroup(view, "blocked", "Blocked on you", null, now, true),
      needsGroup(view, "ask", "Asks", "each proceeds on its recommendation", now, false),
      ...(rolloutNeeds === null ? [] : [rolloutNeeds]),
      needsGroup(view, "hands", "Your hands", null, now, false),
    );
    out.append(
      groups,
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

  /** The Needs me reading the ask page steps through, taken once per pass beside the ask's own; null until one arrives. */
  let askNeeds = null;

  /** The step row's ends and count from the last Needs me reading that held the ask on this page, by the ask's key. */
  let askStepHeld = null;

  /**
   * The row that steps to the previous and next ask: the Needs me page's Asks in its default order,
   * the current ask found by its repo and id, and "n of N" between the two links. An end with nowhere
   * to go is a disabled mark, never a link. Once a reading has held the ask, a later one that does not,
   * as after Agree or Dismiss here, draws the row that reading gave with its count, and an end whose
   * ask the current list no longer holds is a disabled mark. An ask no reading on this page has held,
   * one handled elsewhere before the page opened, reads "not in the open list", with Previous to
   * the list's first ask and Next to its last. Nothing is drawn until a
   * reading has arrived, or where neither the list nor the remembered row has an ask.
   */
  function askStep(item) {
    if (askNeeds === null) return null;
    const asks = sortedItems(groupItems(askNeeds, "ask")).filter((one) => askHrefOf(one) !== null);
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
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const active = document.activeElement;
    if (active !== null && (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
    const target = app.querySelector(event.key === "ArrowLeft" ? '.ask-step a[rel="prev"]' : '.ask-step a[rel="next"]');
    if (target === null) return;
    event.preventDefault();
    location.assign(target.href);
  }

  /**
   * One ask: who asked and how long ago, the question, the recommendation, the brief, the plan, the
   * thread, the step to the previous and next ask, then Agree, Answer and Dismiss with a Context of
   * the session's lines. They are the Needs me page's acts, with the same bodies, words, touched mark
   * and inline Correct box, so the batch there skips an ask answered here. A handled ask, one whose
   * line a page delivered, draws the act and its time in place of the buttons, since every other page
   * hides it until its session closes or raises it.
   */
  function renderAsk(view) {
    const out = document.createDocumentFragment();
    const now = nowOf(view);
    // The ask in the Needs me item's shape, so the shared acts and the touched mark key it the same way.
    const item = { kind: "ask", repo: txt(view.repo), askId: txt(view.askId), text: txt(view.question), recommend: view.recommend, openedAt: view.openedAt };
    const key = itemKey(item);
    // A delivered ask's hide holds for the reading it was drawn from alone, as on the Needs me page.
    for (const [held, drawn] of needsMe.delivered) if (drawn !== view) needsMe.delivered.delete(held);

    const top = h("div", "top");
    top.append(back("/", "Standup"));
    const row = h("div", "top-row");
    const who = h("h1", null, item.repo);
    if (view.blocking === true) who.append(" ", h("span", "tag", "blocking"));
    row.append(who, stamp(view));
    top.append(row);
    const opened = parse(view.openedAt);
    if (opened !== null) top.append(h("p", "sub", "asked " + span(now - opened) + " ago"));
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
      const acts = h("div", "ask-acts");
      const controls = h("div", "nm-controls ask-controls");
      // An ask's page state is keyed on its id, so a view with none takes no act and no Context, as on Needs me.
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
    return out;
  }

  /** What the ask page draws where the broker holds no such open ask: a line saying so, and no button to act on it. */
  function askGone() {
    const out = document.createDocumentFragment();
    const top = h("div", "top");
    top.append(back("/", "Standup"));
    const row = h("div", "top-row");
    row.append(h("h1", null, "Ask"));
    top.append(row);
    out.append(top);
    const card = h("section", "card pad section ask-gone");
    card.setAttribute("role", "status");
    card.append(h("p", null, "This ask is not open. The broker's last reading lists no open ask at this address."));
    out.append(card);
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

  /** Draws `view` whole off to the side and swaps it in, so a draw that throws leaves the last one. */
  function draw(view) {
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : undefined;
    // A page that follows its newest content stays at the foot when the reader was there, and starts there.
    const follow = page.follow === true && (lastView === null || window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80);
    const drawn = page.render(view);
    // A bounded panel scrolls inside itself and a redraw builds it new, so each panel's place is read by its key
    // before the swap and set again after.
    const scrolled = new Map(Array.from(app.querySelectorAll("[data-panel]"), (panel) => [panel.dataset.panel, panel.scrollTop]));
    // The sibling rail sits above every page's own top bar, from the broker's last poll of the siblings.
    const rail = sandboxRail(siblingsView);
    if (rail !== null) drawn.prepend(rail);
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
    goneDrawn = false;
    for (const panel of app.querySelectorAll("[data-panel]")) panel.scrollTop = scrolled.get(panel.dataset.panel) ?? 0;
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

  /** A line being typed in the talk, the Steer or the Correct box: a redraw would move the caret to its end mid-word. */
  function composing() {
    const active = document.activeElement;
    return active !== null && (active.id === "talk-compose" || active.id === "steer-text" || active.id === "correct-text") && active.value !== "";
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
    const rail = sandboxRail(siblingsView);
    if (rail !== null) drawn.prepend(rail);
    app.replaceChildren(drawn);
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
   * The ask page's Needs me reading beside its own, once per pass, which its step row orders by. A
   * failure here is not the page's: the last reading stays, and the ask's own fetch decides the notice.
   */
  async function fetchNeeds() {
    if (document.body.dataset.page !== "ask") return;
    try {
      askNeeds = await fetchView("/web/needs-me");
    } catch (error) {
      // Kept as it was: a step row that cannot refresh keeps the last order rather than vanishing.
    }
  }

  async function poll() {
    let failure = null;
    try {
      const [view] = await Promise.all([fetchView(page.url()), fetchSiblings(), fetchNeeds()]);
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
      if (isGone(error)) {
        drawGone();
        setTimeout(poll, POLL_MS);
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
      const empty = { plan: "Open a plan from a repo page.", talk: "No session named in the address.", ask: "Open an ask from the standup or Needs me page." };
      app.replaceChildren(h("p", "muted", empty[document.body.dataset.page] ?? "No repo named in the address."));
      return;
    }
    if (document.body.dataset.page === "talk") loadTalkPlan();
    if (document.body.dataset.page === "ask") document.addEventListener("keydown", stepKey);
    poll();
  }

  start();
})();
