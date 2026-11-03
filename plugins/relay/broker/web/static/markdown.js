// The page's markdown renderer: `markdownBlocks(text, make)` draws a persona's text as a tree of
// nodes built through the factory `make`, which is `document` on the page and a stub in the test.
// It is loaded by every page shell before `app.js`, and defines that one global and nothing else.
//
// Render rule: every string in a view was written by a session or a person and is hostile to the
// page. Text reaches a node only through `createTextNode`, the tag of every element is one of the
// fixed names below, and the one class set is a fixed name too. No attribute is set from the text,
// so no byte of the text becomes markup, a link or a handler. Nothing here builds HTML.
//
// The closed set of forms. Blocks: `#`, `##` and `###` headings as h3, h4 and h5, which sit under a
// card's own h2; paragraphs split on blank lines, keeping their line breaks; `-` and `*` bullet lists
// as ul, an indented bullet a bullet of the same list and any other indented line part of the item
// above it; `1.` to `99.` numbered lists as ol, numbered by the browser from 1; a fenced block as
// pre, its language word dropped and an unclosed fence running to the end; the relay's `-# ` line
// as a p of class md-subtext. Inline: `**bold**` as strong, `*italic*` as em and backtick code as
// code, an unclosed marker staying literal. Everything else is text: an
// angle bracket is a character, a URL is a string, a backslash is a character like any other.
"use strict";

var markdownBlocks = (function () {
  /** The heading tags in order, `#` first; each sits under the h2 a card's label draws. */
  var HEADINGS = ["h3", "h4", "h5"];

  function element(make, tag, cls) {
    var node = make.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  function appendAll(node, children) {
    for (var i = 0; i < children.length; i++) node.append(children[i]);
  }

  /**
   * The inline nodes of one run of text. A scan from the left: a marker with a closer ahead becomes
   * its element over the text between, and one without stays a character. Once a closer is missing
   * for a marker it is missing for the rest of the run, so each marker is searched for once and the
   * scan is linear in the text.
   */
  function inline(make, text) {
    var out = [];
    var plain = "";
    var noMoreCode = false;
    var noMoreStrong = false;
    var noMoreEm = false;
    // The last italic closer found. Openers are met left to right, so a closer ahead of the current
    // opener is still the first one after it, and the search resumes past it rather than rescanning.
    var emCloser = -1;
    var i = 0;
    function flush() {
      if (plain !== "") out.push(make.createTextNode(plain));
      plain = "";
    }
    /** The first lone `*` after `from`, one that is not half of a `**`, else -1. */
    function emCloserAfter(from) {
      if (emCloser > from) return emCloser;
      for (var j = from + 1; j < text.length; j++) {
        if (text.charAt(j) === "*" && text.charAt(j - 1) !== "*" && text.charAt(j + 1) !== "*") {
          emCloser = j;
          return j;
        }
      }
      return -1;
    }
    while (i < text.length) {
      var c = text.charAt(i);
      if (c === "`" && !noMoreCode) {
        var closeCode = text.indexOf("`", i + 1);
        if (closeCode === -1) noMoreCode = true;
        else if (closeCode > i + 1) {
          flush();
          var code = element(make, "code");
          code.append(make.createTextNode(text.slice(i + 1, closeCode)));
          out.push(code);
          i = closeCode + 1;
          continue;
        }
      } else if (c === "*" && text.charAt(i + 1) === "*" && !noMoreStrong) {
        var closeStrong = text.indexOf("**", i + 2);
        if (closeStrong === -1) noMoreStrong = true;
        else if (closeStrong > i + 2) {
          flush();
          var strong = element(make, "strong");
          appendAll(strong, inline(make, text.slice(i + 2, closeStrong)));
          out.push(strong);
          i = closeStrong + 2;
          continue;
        }
      } else if (c === "*" && !noMoreEm) {
        var closeEm = emCloserAfter(i);
        if (closeEm === -1) noMoreEm = true;
        else if (closeEm > i + 1 && text.charAt(i + 1) !== " " && text.charAt(closeEm - 1) !== " ") {
          flush();
          var em = element(make, "em");
          appendAll(em, inline(make, text.slice(i + 1, closeEm)));
          out.push(em);
          i = closeEm + 1;
          continue;
        }
      }
      plain += c;
      i += 1;
    }
    flush();
    return out;
  }

  /** The count of leading `#` where a heading marker opens the line, else 0. */
  function headingLevel(line) {
    var n = 0;
    while (n < line.length && line.charAt(n) === "#") n += 1;
    return n >= 1 && n <= HEADINGS.length && line.charAt(n) === " " && line.slice(n + 1).trim() !== "" ? n : 0;
  }

  /** The text after a `- ` or `* ` bullet marker, else null. */
  function bulletText(line) {
    var c = line.charAt(0);
    return (c === "-" || c === "*") && line.charAt(1) === " " ? line.slice(2).trim() : null;
  }

  /**
   * The text after a numbered marker of one or two digits, else null. A longer run is no marker, so a
   * line opening on a year, such as `2026. The year`, stays a paragraph.
   */
  function numberedText(line) {
    var n = 0;
    while (n < line.length && line.charAt(n) >= "0" && line.charAt(n) <= "9") n += 1;
    return n >= 1 && n <= 2 && line.charAt(n) === "." && line.charAt(n + 1) === " " ? line.slice(n + 2).trim() : null;
  }

  function isFence(line) {
    return line.slice(0, 3) === "```";
  }

  function blocks(make, text) {
    var lines = text.split("\n");
    var out = [];
    var paragraph = [];
    // The open list's tag and its items' text, drawn when the list closes, so a continuation line can
    // still join the last item.
    var listTag = null;
    var items = [];

    function closeParagraph() {
      if (paragraph.length === 0) return;
      var p = element(make, "p");
      appendAll(p, inline(make, paragraph.join("\n")));
      out.push(p);
      paragraph = [];
    }
    function closeList() {
      if (listTag === null) return;
      var list = element(make, listTag);
      for (var k = 0; k < items.length; k++) {
        var li = element(make, "li");
        appendAll(li, inline(make, items[k]));
        list.append(li);
      }
      out.push(list);
      listTag = null;
      items = [];
    }
    function listItem(tag, itemText) {
      closeParagraph();
      if (listTag !== tag) {
        closeList();
        listTag = tag;
      }
      items.push(itemText);
    }

    for (var at = 0; at < lines.length; at++) {
      var raw = lines[at].replace(/\r$/, "");
      var line = raw.trim();
      if (line === "") {
        closeParagraph();
        closeList();
        continue;
      }
      if (isFence(line)) {
        closeParagraph();
        closeList();
        var body = [];
        at += 1;
        while (at < lines.length && !isFence(lines[at].trim())) {
          body.push(lines[at].replace(/\r$/, ""));
          at += 1;
        }
        var pre = element(make, "pre");
        pre.append(make.createTextNode(body.join("\n")));
        out.push(pre);
        continue;
      }
      var level = headingLevel(line);
      if (level > 0) {
        closeParagraph();
        closeList();
        var heading = element(make, HEADINGS[level - 1]);
        appendAll(heading, inline(make, line.slice(level + 1).trim()));
        out.push(heading);
        continue;
      }
      if (line.slice(0, 3) === "-# " && line.slice(3).trim() !== "") {
        closeParagraph();
        closeList();
        var sub = element(make, "p", "md-subtext");
        appendAll(sub, inline(make, line.slice(3).trim()));
        out.push(sub);
        continue;
      }
      var bullet = bulletText(line);
      if (bullet !== null) {
        listItem("ul", bullet);
        continue;
      }
      var numbered = numberedText(line);
      if (numbered !== null) {
        listItem("ol", numbered);
        continue;
      }
      // An indented line under an open list continues its last item, on a line of its own.
      if (listTag !== null && raw.charAt(0).trim() === "") {
        items[items.length - 1] += "\n" + line;
        continue;
      }
      closeList();
      paragraph.push(line);
    }
    closeParagraph();
    closeList();
    return out;
  }

  /**
   * The block nodes of `text`, in order, as an array the caller appends into its own container. A
   * value that is not a string draws nothing. The renderer never throws: should a step fail, the
   * whole text is returned as one text node, which is what the page drew before it had a renderer.
   */
  function markdownBlocks(text, make) {
    if (typeof text !== "string") return [];
    try {
      return blocks(make, text);
    } catch {
      return [make.createTextNode(text)];
    }
  }

  return markdownBlocks;
})();
