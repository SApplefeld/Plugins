---
name: explainers
description: "Rules for an explainer video or a diagram made for the operator: what a plain request means, the machine check, the brief the session writes, the builder it dispatches, and the review before delivery. Use when the operator asks for an explainer video, a narrated or animated video showing how something works, or a diagram, in plain words or as a rough draft or a sketch."
---

# Explainers

The session writes what an explainer must show and say, a builder agent draws it, and the session reviews it before the operator sees it. The `explainer-builder` charter holds the builder's part, and `references/builder-brief.md` is the form of the brief. Below, `<plugin-root>` is the kit plugin root, two folders above this skill's folder.

## What a Request Means

A plain request for an explainer video means a drawn, narrated video whose screen keeps moving, and never narrated still slides. Motion carries the explanation, and a still slide leaves the watcher reading while the words run on.

## Machine Check

For a video, run the preflight first:

```
node <plugin-root>/scripts/explainer-preflight.js [--browser <path>] [--ffmpeg <path>] [--settings <path>]
```

It prints a line for each piece, `found`, with a path where the piece has one, or `missing` with what to do. It exits 0 where every piece is found, 1 where any is missing, and 2 for a refused argument. On 1, stop and tell the operator each missing piece. A build missing a piece fails partway, after the narration has gone to the outside voice service.

The settings file is the Channels broker's settings file, which names the voice key file and the voice. Where ffmpeg sits in a place the preflight does not know, or the settings file is not at its default place, pass its absolute path with `--ffmpeg` or `--settings`, and give the builder the same path in the brief. The scripts never search PATH.

A diagram needs no preflight, since `render-html.js` names a missing browser itself.

## Who Builds

The session writes the concept, the storyboard and the exact narration, and a builder builds. Dispatch `grimoire:explainer-builder` with the Agent tool at dispatch table row "Explainer builder" on executing-work's `references/review.md`, where a row gives the model and the effort, with the filled brief as its prompt. The session does not build on its own model, ask which model builds or offer a cheaper build. The charter pins the model, and the session's context is for the writing and the review.

A Sonnet build happens only where the operator's own words in the request ask for a rough draft or a sketch. Dispatch it at dispatch table row "Explainer draft", passing the model that row names. A draft says `draft` in its file name and in the message that delivers it, so it never passes for the finished video.

## Writing the Brief

Make a new, empty build folder under the project's `.kit/scratch/` folder, and fill a copy of the form there. The builder starts with no session context, so the brief is all it knows. Put the absolute path of `<plugin-root>` in the form's Kit Root field, since the builder runs every script from it.

- **The storyboard opens on the watcher's own problem and closes by returning to it, solved.** A watcher follows an answer to a question already held.
- **One scene carries one idea, under a title of a few words.** Two ideas leave the watcher unsure which one the picture shows.
- **The narration is written for the ear and to the watcher.** It is heard once and never reread.
- **A picture note says what must be seen and never how it moves.** It names what arrives, travels or changes, and the motion is the builder's design.
- **The brief fixes the invented names.** The picture and the narration then call each made-up thing the same.
- **A video of something not built says so in its last line and its last frame.** A watcher who misses it takes a design for a product.

The narration holds no customer's name, no person's name and no path from the machine. The narration script, `explainer-voice.js`, sends each scene to an outside voice service and has that service's recognizer read the audio back. It refuses a path but cannot tell which words are names.

## Spellings and Read-Back

Approved spellings come from the operator-tier memory record `explainer-voice-spellings`, read with `memq get explainer-voice-spellings --operator`. Each line holds a name as shown, then as sent to the voice. The brief carries each spelling the video needs, in both forms. A name the record does not hold is new to the voice, and the brief marks it new. Where the command finds no record, every name is new and goes as written, and the delivery message says so.

The narration script prints a line for each scene with the words the recognizer missed and added. The builder reads that line for each new name, tries another spelling where the name was misheard, and reports what it settled on. The session reads the final listing itself: the line the builder reports for each new name, against that scene's `heard` text in the build folder's `timeline.json`. A recognizer also mishears a name said right, so a mismatch prompts another spelling, never a verdict.

A video whose timeline reads `not checked` for a scene holding a new name is not delivered until the read-back has run, and the session tells the operator why it waits. The session sends the builder back to re-run the narration script, which reads that scene back again. No session can hear, so the read-back is the one check a new name gets.

A spelling joins the record only on the operator's word, given after hearing it, since a spelling the recognizer accepts can still sound wrong.

## Review Before Delivery

The session reviews the build before the operator sees it. Run the check with a sheets folder in the build folder, and read every contact sheet:

```
node <plugin-root>/scripts/explainer-check.js <video> [--max-mb <n>] [--still <seconds>] [--sheets <folder>] [--ffmpeg <path>]
```

It exits 0 on a `passed:` line, 1 naming each fault, and 2 for a refusal. A sheet holds six frames, one every 3 seconds. Send the builder each fault by name, and review again after its fix.

Two neighbouring frames on a sheet that show the same picture are a fault. The check script catches only a frozen screen, so a picture that barely changes is caught by reading or not at all.

A builder's own check does not replace this review, since a builder grading its own work sees what it meant.

## Delivery

The delivered file is at most 8 MB, the check's default bound, since a larger file may not reach the operator's phone. A file over the bound goes back to the builder to be made smaller, never sent. The video goes attached to the channel message, by the reply tool's file argument. The message names each name the operator's ear has not yet approved, since no session can hear.

## Diagrams

A diagram takes the same split. The session writes what must be seen. The builder is dispatched at dispatch table row "Explainer builder", or at "Explainer draft" only on the same rough-draft words, and draws one self-contained page, renders it and reads the image:

```
node <plugin-root>/scripts/render-html.js <html path> <png path> [--width <n>] [--height <n>] [--browser <path>]
```

The session reads the image again before sending it, since the builder's reading grades its own work. The look comes from the operator-tier records `scott-diagram-style` and `scott-labels-title-case`, which the session reads with `memq get <name> --operator` and puts in the brief.
