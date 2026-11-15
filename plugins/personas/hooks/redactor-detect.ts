// Detector for the transcript redactor.
// Source: https://github.com/ray-amjad/claude-code-mods, commit b75f32f,
// path plugins/transcript-redactor/hooks/detect.ts.
// Licence: MIT. Copyright (c) 2026 Ray Amjad.
// The licence text is in plugins/personas/THIRD-PARTY-NOTICES.md.
//
// Local deviations from commit b75f32f:
//   - CLI_USERPASS, MYSQL_P and CMD_PW bound the span between the command
//     word and its password flag at 500 characters (`[^\n|;&]{0,500}?`) where
//     the source leaves it open (`[^\n|;&]*?`). The open span is quadratic in
//     a line that repeats the command word with a password the pattern
//     refuses, such as `curl -u a:$x ` over 1 MB, and the hook pays it
//     inside its 10 s budget. A password flag more than 500 characters after
//     its command word on one line is not hidden by these three patterns.
//     test-personas/redactor-detect-test.mjs pins each over 1 MB against a
//     linear reference regex timed beside it, and first over 200 KB against
//     that reference under a ratio limit of its own, so a quadratic span
//     fails fast.
//   - GH_SECRET and SMB_USER take the same 500-character bound on the span
//     between their command word and the flag (`[^\n;&|]{0,500}?` and
//     `[^\n|;&]{0,500}?`) where the source leaves it open, for the same
//     reason: a line repeating `gh secret set` or `smbclient` with a value
//     the pattern refuses walks the open span out from every start. The same
//     test pins each the same way.

// The pure half of transcript-redactor: the config, the vault, the detectors,
// and the walkers. Nothing in here touches `$` or registers a hook, so another
// mod can vendor this file as it is and the tests can run it under plain node.
//
// Two classes of value are kept out of the transcript: secrets and email
// addresses. IP addresses are left alone on purpose: they are not worth the
// noise.
//
// The value is not deleted. It is put in a vault that lives in this module,
// in memory, for the session, and the transcript gets a placeholder in its
// place: `[REDACTED-SECRET-1a2b3c4d]`. Within one session the same value always
// mints the same placeholder, so the model can still tell one customer from
// another, and the placeholder is swapped back for the real value on the way
// into a local restore tool or an MCP tool the host's redactorRestoreTools
// setting names, so a `Bash` command or a `Write` still carries the real
// key.
//
// Nothing is written to disk. The vault dies with the session.

export type Kind = 'SECRET' | 'EMAIL' | 'LITERAL'

export type Config = {
  secrets: boolean
  pii: boolean
  restore: boolean
  restoreTools: ReadonlySet<string>
  notify: boolean
  minEntropy: number
  minLength: number
  contextMinEntropy: number
  allow: ReadonlySet<string>
  allowEmails: readonly string[]
  allowPrefix: readonly string[]
  denyPrefix: readonly string[]
}

// The tools that run on this machine. A placeholder is only swapped back for
// its real value in these: a tool that hands its input to another model or to
// the network (Agent, WebFetch, WebSearch, SendMessage, an MCP tool) gets the
// placeholder as written.
export const DEFAULT_RESTORE_TOOLS = 'Bash,Write,Edit,MultiEdit,NotebookEdit'

// ---------------------------------------------------------------- the vault

const byValue = new Map<string, string>()
const byTag = new Map<string, string>()
let hidden = 0
let minted: Set<string> | null = null

const TAG = /\[REDACTED-(?:SECRET|EMAIL|LITERAL)-[0-9a-f]{8}\]/g
const WHOLE_TAG = /^\[REDACTED-(?:SECRET|EMAIL|LITERAL)-[0-9a-f]{8}\]$/
// A placeholder's body with no bracket: the word, the kind and the hash, which
// withFixedHashes reads. An encoder that re-spells only the brackets leaves the
// body as written.
const TAG_BODY = /(REDACTED-(?:SECRET|EMAIL|LITERAL)-)[0-9a-f]{8}/g

// The session's own id, trimmed and lowercased, which the vault never keeps
// however a value equal to it arrives: the harness prints that id on every
// transcript line, and every registry entry a seat reads carries one. It is
// undefined until index.ts hands it in at the session-start seed, and where
// the session has none. The first value refused for being the id leaves one
// note; this module has no log handle, so index.ts drains the note after a
// scrub and logs it, and the line appears once per seeded id.
let ownSessionId: string | undefined
let ownIdNoted = false
let ownIdNote: string | null = null
const OWN_ID_NOTE = 'redactor: the detector met the session id, which is not kept'

// Seeding an id starts its note afresh: the flag and any pending note reset,
// so the first refusal under the new id leaves its own note.
export function setOwnSessionId(id: string | undefined): void {
  const own = id?.trim().toLowerCase()
  ownSessionId = own === undefined || own === '' ? undefined : own
  ownIdNoted = false
  ownIdNote = null
}

// True where `value` is the session's own id, compared trimmed and in any
// case, as seedVault in redactor.ts compares a seed against the same id, and
// the caller then refuses it. The first refusal records the note.
function refuseOwnId(value: string): boolean {
  if (ownSessionId === undefined || value.trim().toLowerCase() !== ownSessionId) return false
  if (!ownIdNoted) {
    ownIdNoted = true
    ownIdNote = OWN_ID_NOTE
  }
  return true
}

// The note the first own-id refusal left, handed over once: the note, then
// null until the session ends.
export function drainOwnIdNote(): string | null {
  const note = ownIdNote
  ownIdNote = null
  return note
}

// The tag is a keyed hash, and the key is drawn fresh for every session. So
// nobody can work out a value from its tag, and a crafted token cannot be
// aimed at a placeholder that is already on screen.
const KEY = sessionKey()

function sessionKey(): [number, number] {
  const words = new Uint32Array(2)
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto
  if (c?.getRandomValues) c.getRandomValues(words)
  else for (let i = 0; i < 2; i++) words[i] = Math.floor(Math.random() * 2 ** 32)
  return [words[0]!, words[1]!]
}

const encoder = new TextEncoder()

function rotl(x: number, b: number): number {
  return ((x << b) | (x >>> (32 - b))) >>> 0
}

// HalfSipHash-2-4: a small keyed hash with a 32-bit answer, which is the
// 8 hex characters the placeholder shows.
function keyedHash(text: string): string {
  const bytes = encoder.encode(text)
  let v0 = KEY[0]
  let v1 = KEY[1]
  let v2 = (0x6c796765 ^ KEY[0]) >>> 0
  let v3 = (0x74656462 ^ KEY[1]) >>> 0
  const round = (): void => {
    v0 = (v0 + v1) >>> 0; v1 = rotl(v1, 5); v1 = (v1 ^ v0) >>> 0; v0 = rotl(v0, 16)
    v2 = (v2 + v3) >>> 0; v3 = rotl(v3, 8); v3 = (v3 ^ v2) >>> 0
    v0 = (v0 + v3) >>> 0; v3 = rotl(v3, 7); v3 = (v3 ^ v0) >>> 0
    v2 = (v2 + v1) >>> 0; v1 = rotl(v1, 13); v1 = (v1 ^ v2) >>> 0; v2 = rotl(v2, 16)
  }
  const whole = bytes.length - (bytes.length % 4)
  for (let i = 0; i < whole; i += 4) {
    const m = (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0
    v3 = (v3 ^ m) >>> 0; round(); round(); v0 = (v0 ^ m) >>> 0
  }
  let last = (bytes.length & 0xff) << 24
  for (let i = whole, s = 0; i < bytes.length; i++, s += 8) last |= bytes[i]! << s
  last >>>= 0
  v3 = (v3 ^ last) >>> 0; round(); round(); v0 = (v0 ^ last) >>> 0
  v2 = (v2 ^ 0xff) >>> 0
  round(); round(); round(); round()
  return ((v1 ^ v3) >>> 0).toString(16).padStart(8, '0')
}

// Swaps a value for its placeholder and remembers both. A value that already
// holds a placeholder from an earlier pass (a key inside a URL password) is
// stored with that placeholder put back, so one restore gives the real text.
// Two different values never share a placeholder: on a clash the hash is
// taken again with a counter until the tag is free. A secret equal to the
// session's own id comes back as it is: no placeholder, no echo, not counted.
// `evidence` says what a SECRET hide rests on, and the value is marked with
// it at a first sight and at every later one. The default is `named`, so a
// caller that says nothing marks its value as one never spared. The mark
// lands only where a named site mints, so a value first hidden by its shape
// alone and met only in a later scan in a run that holds a key's name, as
// NAMED reads one, or a URL's credential part on either side of it,
// as scanEvidence reads the run, stays spareable:
// the first re-hide pass has swapped it for its placeholder by then, and
// a named site that meets a placeholder and mints it again marks nothing.
// A value that only an earlier hide's placeholder carried to this mint is
// marked nothing either, so it is never spared, since no hide judged it
// whole on its own evidence.
// A `token` mint is the one widenKnown makes for the token or slash run
// around a known value. It counts the hide and collects the placeholder as
// any mint does, and it marks nothing and joins neither the session-wide
// search nor the same-text list: the known part is already in the search, so
// every later spot of the same key is found through it. A value the vault
// holds only from such a mint stays out of both under a `known` mint too,
// and under a mint that only its own placeholder carried the value to. It
// joins once a detector mints the value itself on evidence of its own.
// Text that is exactly one scan-private placeholder of the scan in hand, as
// scanMark writes one, is handled as the vault's placeholder of the same
// value is, and comes back as it was handed: the hide is counted and
// collected under the vault's placeholder, and the text keeps the record
// that a re-hide pass made the hide.
// In a scan's second reading, as scrubSecrets runs one, a value the vault
// held when the reading began is held, the values the first reading added
// among them. A mint of a held value marks nothing, takes no mark away and
// joins the value to no session-wide search, so the session's record of what
// it already held stays as the first reading left it. The value still joins
// the reading's own same-text list wherever a mint outside a second reading
// would remember it. A value new to the vault in that reading is recorded as
// in any scan, at its first mint and at each later one.
export function mint(kind: Kind, raw: string, evidence: Evidence = 'named'): string {
  if (kind === 'SECRET' && refuseOwnId(raw)) return raw
  const marked = kind === 'SECRET' && marks !== null && marks.vault.has(raw)
  hidden++
  const unparked = kind === 'LITERAL' ? raw : unpark(raw, false)
  const value = kind === 'LITERAL' ? raw : restore(unparked)
  const seen = byValue.get(value)
  const held = gained !== null && seen !== undefined && !gained.has(value)
  // True where a detector mints the value as written on evidence of its own.
  const own = kind === 'SECRET' && evidence !== 'known' && evidence !== 'token' && value === unparked
  if (own && !held) (evidence === 'shape' ? shapeOnly : namedHide).add(value)
  if (kind === 'SECRET' && evidence === 'token' && seen === undefined) tokenOnly.add(value)
  if (own && !held) tokenOnly.delete(value)
  const joins = kind === 'SECRET' && evidence !== 'token' && (own || !tokenOnly.has(value))
  if (seen) {
    if (joins) remember(value, held)
    minted?.add(seen)
    return marked ? raw : seen
  }
  let tag = ''
  for (let i = 0; ; i++) {
    tag = `[REDACTED-${kind}-${keyedHash(`${kind}\u0000${i}\u0000${value}`)}]`
    if (!byTag.has(tag)) break
  }
  byValue.set(value, tag)
  byTag.set(tag, value)
  gained?.add(value)
  if (joins) remember(value)
  minted?.add(tag)
  return tag
}

// A secret is hidden again wherever it turns up later: across the session
// when it is distinctive enough (echoable), and within the text being
// scanned right now when it is shorter but still not a plain word. A value
// that is `held`, as mint reads it in a second reading, joins the same-text
// list by the same test and stays out of the session-wide search.
function remember(value: string, held = false): void {
  const echoes = echoable(value)
  if (echoes && !held && !echo.has(value)) {
    echo.add(value)
    echoIndex = null
  }
  if (local && (echoes || localWorthy(value))) local.add(value)
}

// One pass, on purpose: a LITERAL placeholder gives back the placeholder text
// it stands for, and that text must not then turn into the secret.
export function restore(text: string): string {
  if (byTag.size === 0 || !text.includes('[REDACTED-')) return text
  return text.replace(TAG, (tag) => byTag.get(tag) ?? tag)
}

// Hides a value the caller knows is secret wherever it turns up for the rest
// of the session, even one too short or too plain for the echo rule (a word
// password from .env). Values under PREFIX characters can't be indexed. The
// value is recorded as seeded, so it stays hidden where it opens a token that
// is a record id. The session's own id comes back as it is and joins nothing.
export function keepSecret(value: string): string {
  if (refuseOwnId(value)) return value
  seeded.add(value)
  const tag = mint('SECRET', value)
  if (value.length >= PREFIX && !echo.has(value)) {
    echo.add(value)
    echoIndex = null
  }
  return tag
}

// How many times a value has been hidden this session. A hook reads it before
// and after a scrub to learn whether anything changed.
export function hiddenCount(): number {
  return hidden
}

// Runs `fn` and hands back every placeholder it minted or reused, so a hook
// can count the values it hid without counting one value twice.
export function collect<T>(fn: () => T): { value: T; tags: Set<string> } {
  const outer = minted
  const tags = new Set<string>()
  minted = tags
  try {
    return { value: fn(), tags }
  } finally {
    minted = outer
    if (outer) for (const t of tags) outer.add(t)
  }
}

// A placeholder read back from a file or a log is quoted text, not a handle.
// Left alone it would turn into the real secret the next time the model
// copied that text into a command. So a live placeholder found in a tool's
// output is swapped for a LITERAL one, which restores to the placeholder text
// and nothing more. Run this before the detectors, so a key the tool printed
// still comes back as its live placeholder.
export function escapeLiteralTags(text: string): string {
  if (byTag.size === 0 || !text.includes('[REDACTED-')) return text
  return text.replace(TAG, (t) => (byTag.has(t) && !t.startsWith('[REDACTED-LITERAL-') ? mint('LITERAL', t) : t))
}

// ------------------------------------------------------- known value echoes

// A value hidden once because of where it sat (after `API_KEY=`, inside a
// URL) is hidden again wherever it turns up, even bare, where no detector
// would fire on it: a tool that echoes a restored key must not print it.
const echo = new Set<string>()
let echoIndex: EchoIndex | null = null
// The values keepSecret was handed, each a real secret on the caller's word.
// The passes that hide a known value again read this set before they spare
// one: a seeded value is hidden whatever it opens, and a value both seeded
// and detected counts as seeded. Like `echo`, it is never cleared.
const seeded = new Set<string>()
// What a SECRET hide rests on, as mint is told it. `shape` records a hide
// the generic scan made on the token's shape alone: scanEvidence found no
// key's name, as NAMED reads one, and no URL credential part in the
// unbroken run the token stands in, read on both sides of it, and the run
// is shorter than 512 characters, measured on the text the scan reads,
// after earlier hides and parking. `named` records a hide on any other
// evidence, a key's name, a
// pair, a URL part and a vendor shape among such evidence, and is what a
// caller that passes nothing records. `known` records nothing: its caller
// hides again a value the vault already holds, as the re-hide passes here
// and rehideHanded in redactor.ts do. `token` records nothing either:
// widenKnown hides with it the token or slash run around a distinctive
// known value, and that text joins no search, as mint states.
type Evidence = 'named' | 'shape' | 'known' | 'token'
// The values hidden by their shape alone, and the values hidden on any other
// evidence. A value may be in both, and no mark is ever removed. The passes
// that hide a known value again spare one only where it is in the first set
// and not in the second, so a value with no mark at all is never spared.
const shapeOnly = new Set<string>()
const namedHide = new Set<string>()
// The values the vault holds only because widenKnown hid them as the token
// or slash run around a known value. None is in the session-wide search,
// and a value leaves the set when a detector mints it as written.
const tokenOnly = new Set<string>()
// The values minted during the current scan, to hide at their other spots.
let local: Set<string> | null = null
// The values the vault gained during the second reading in hand, and null
// outside one. A value the vault holds that is not in the set was held when
// the reading began, which is how mint tells a held value without a copy of
// the vault. Saved and restored with `local`.
let gained: Set<string> | null = null

// The scan-private placeholders of the scan in hand, and null outside a
// scan. A re-hide pass writes each hide it makes as one, so the placeholder
// is the record of the hide and moves with it when a later pass rewrites the
// text around it. `of` gives the scan-private placeholder for a vault
// placeholder and `vault` the reverse, `text` is the text the scan was
// handed, and `held` is every hash a placeholder body in that text shows,
// read at the first hide. readText saves and restores the record as it
// does `local`, so a reading that runs inside another keeps its own, and
// takes every scan-private placeholder out of the vault on each path out.
type Marks = { text: string; held: Set<string> | null; of: Map<string, string>; vault: Map<string, string> }
let marks: Marks | null = null

// The scan-private placeholder for the hide a re-hide pass makes under the
// vault placeholder `tag`, or `tag` itself outside a scan and where mint
// handed back the session's own id. It has a vault placeholder's form, so
// every detector reads it as one. Its hash is one no placeholder of the
// vault carries and no placeholder body in the scanned text shows, so no
// text the scan was handed can pass for it. One scan uses one for each
// value, at every spot of the value. While the scan runs the vault restores
// it to the value, so a later pass that takes it inside a hide of its own
// stores the real text.
function scanMark(tag: string): string {
  const m = marks
  const value = byTag.get(tag)
  if (m === null || value === undefined) return tag
  let mark = m.of.get(tag)
  if (mark !== undefined) return mark
  if (m.held === null) {
    m.held = new Set()
    if (m.text.includes('REDACTED-')) for (const body of clocked(m.text).matchAll(TAG_BODY)) m.held.add(body[0].slice(-8))
  }
  for (let i = 0; ; i++) {
    const hash = keyedHash(`MARK\u0000${i}\u0000${tag}`)
    mark = `[REDACTED-SECRET-${hash}]`
    if (!m.held.has(hash) && !byTag.has(mark) && !byTag.has(`[REDACTED-EMAIL-${hash}]`) && !byTag.has(`[REDACTED-LITERAL-${hash}]`)) break
  }
  m.of.set(tag, mark)
  m.vault.set(mark, tag)
  byTag.set(mark, value)
  return mark
}

// The clock check the current scan runs before each whole-text pass, the
// tick scrubSecrets was handed, and null where no caller set one. It throws
// once the caller's deadline has passed, so a scan ends between two passes
// rather than running on past the hook's budget. Saved and restored by
// scrubSecrets, as readText saves and restores `parked` and `local`, so a
// nested scan never leaves the outer scan holding its tick.
type Tick = () => void
let clockTick: Tick | null = null

// Reads the clock where the current scan holds a tick, and throws through
// it once the deadline has passed. Called before every whole-text pass by
// clocked, and once per blob by parkMedia's BLOB replacer.
function tickNow(): void {
  if (clockTick !== null) clockTick()
}

// Reads the clock before a whole-text pass and hands the text back, so a
// pass is written `clocked(out).replace(...)` and the check runs before the
// regex starts, never while one is mid-match. A pass is one call that reads
// the whole text: a replace, a matchAll, a split, a rolling-hash walk over
// it, or the whole-value base64 check, whose test, decode and scan run under
// one read. The hint probes that decide whether a pass runs, an `includes`
// or a gate `.test` over the text, are linear reads and are not clocked.
// Work inside a callback, a replace over one match or mint putting the
// parked spans back into the value it hides, is not clocked either, with
// one exception: parkMedia's BLOB replacer reads the clock through tickNow
// before each blob's decode, the one callback that does. A function
// replacer runs once its regex has found every match, so a throw there
// aborts the replace with no regex mid-match, as a throw before a pass
// does. So a scan ends past its deadline by the pass or the blob decode in
// flight plus the probes after it.
function clocked(text: string): string {
  tickNow()
  return text
}

// Short or all-letter values (`postgres`) are left out: hiding every later
// `postgres` in unrelated output would make the session unreadable.
function echoable(value: string): boolean {
  if (countsUp(value)) return false
  // A slug or a dated name hidden once beside a key name is not worth hiding
  // everywhere: it would turn every path that holds it into a placeholder.
  if (value.split(/[^A-Za-z0-9]+/).every((p) => p === '' || isSlugPart(p))) return false
  if (value.includes('\n')) return value.length >= 40
  return value.length >= 20 || (value.length >= 10 && /[0-9]/.test(value) && /[A-Za-z]/.test(value))
}

// A value too short to hide across the session is still hidden at its other
// spots in the same text, unless it is a plain word or slug (`postgres`
// hidden once in a URL must not turn every `postgres://` into a placeholder).
function localWorthy(value: string): boolean {
  if (value.length < PREFIX || value.length > 400 || value.includes('\n') || countsUp(value)) return false
  if (value.split(/[^A-Za-z0-9]+/).every((p) => p === '' || isSlugPart(p))) return false
  return /[0-9]/.test(value) || /[^A-Za-z0-9]/.test(value) || value.length >= 12
}

// The known values are found with a rolling hash over their first PREFIX
// characters, so the cost of the scan does not grow with the vault. A regex
// of every value joined by `|` took 40 s on 200 KB once a long session had
// hidden a few thousand values.
const PREFIX = 8
// Under each prefix the values are kept by length, longest first, so a
// prefix that thousands of values share costs one set lookup per length,
// not a walk of the whole list.
type ByLength = { lengths: number[]; values: Set<string> }
type EchoIndex = { hashes: Set<number>; byPrefix: Map<string, ByLength>; top: number }

function prefixHash(text: string, at: number): number {
  let h = 0
  for (let i = 0; i < PREFIX; i++) h = (Math.imul(h, 31) + text.charCodeAt(at + i)) >>> 0
  return h
}

function buildEchoIndex(values: Iterable<string>): EchoIndex {
  const byPrefix = new Map<string, ByLength>()
  for (const v of values) {
    const p = v.slice(0, PREFIX)
    let entry = byPrefix.get(p)
    if (!entry) byPrefix.set(p, (entry = { lengths: [], values: new Set() }))
    if (!entry.lengths.includes(v.length)) entry.lengths.push(v.length)
    entry.values.add(v)
  }
  for (const entry of byPrefix.values()) entry.lengths.sort((a, b) => b - a)
  const hashes = new Set<number>()
  for (const p of byPrefix.keys()) hashes.add(prefixHash(p, 0))
  // 31 to the power PREFIX - 1, to take the oldest character out of the hash.
  let top = 1
  for (let i = 0; i < PREFIX - 1; i++) top = Math.imul(top, 31) >>> 0
  return { hashes, byPrefix, top }
}

// Hides every value of the session-wide search found in the text, each
// alone, before every detector, so each detector reads the text with no
// more than the known value taken out of it. Each hide is written as the
// scan-private placeholder scanMark gives, and widenKnown widens it once
// the scan's last pass has run. A placeholder written here breaks every
// pattern that would have read across the value, so a scan in which this
// pass hid a value takes a second reading of the text as written, as
// scrubSecrets states, and hides what either reading hides.
function rehideKnown(text: string): string {
  if (echo.size === 0 || text.length < PREFIX) return text
  return rehideWith(clocked(text), (echoIndex ??= buildEchoIndex(echo)))
}

// The values minted in one scan, hidden at their other spots in it, each
// alone, as rehideKnown hides one, and each hide written as a scan-private
// placeholder. A few values are found faster one by one than by the rolling
// hash. Each spot is judged on the text as the longer values' hides left
// it, so a value glued after a placeholder's closing bracket opens a token
// of its own.
function rehideLocal(text: string, values: Set<string>): string {
  if (values.size > 64) return rehideWith(clocked(text), buildEchoIndex(values))
  let out = text
  for (const v of [...values].sort((a, b) => b.length - a.length)) if (out.includes(v)) out = rehideOne(clocked(out), v)
  return out
}

// Hides one value at each of its spots in the text that opensRecordId does
// not spare, under one placeholder minted once, and only where a spot is
// hidden. The value is hidden alone: the text glued to it stays as written.
// Each hide is written as the value's scan-private placeholder, as scanMark
// gives it. After a spared spot the search goes on from the next character.
function rehideOne(text: string, value: string): string {
  const parts: string[] = []
  let last = 0
  for (let at = text.indexOf(value); at !== -1; ) {
    if (opensRecordId(text, at, value)) {
      at = text.indexOf(value, at + 1)
      continue
    }
    parts.push(text.slice(last, at))
    last = at + value.length
    at = text.indexOf(value, last)
  }
  if (last === 0) return text
  parts.push(text.slice(last))
  return parts.join(scanMark(mint('SECRET', value, 'known')))
}

// Hides every indexed value found in the text, each alone: the text glued
// to a value stays as written. Where several match at one
// position the longest that opensRecordId does not spare is hidden, so a
// seeded value that shares its opening with a longer spared one is still
// hidden. Where every match is spared the walk goes on from the next
// character, so a known value further into the same token is still found.
// Each hide is written as the value's scan-private placeholder, as scanMark
// gives it.
function rehideWith(text: string, ix: EchoIndex): string {
  if (text.length < PREFIX) return text
  const parts: string[] = []
  let last = 0
  let h = prefixHash(text, 0)
  for (let i = 0; i + PREFIX <= text.length; ) {
    if (ix.hashes.has(h)) {
      const entry = ix.byPrefix.get(text.slice(i, i + PREFIX))
      let found: string | undefined
      if (entry) {
        for (const n of entry.lengths) {
          const v = text.slice(i, i + n)
          if (v.length === n && entry.values.has(v) && !opensRecordId(text, i, v)) {
            found = v
            break
          }
        }
      }
      if (found) {
        parts.push(text.slice(last, i), scanMark(mint('SECRET', found, 'known')))
        i += found.length
        last = i
        if (i + PREFIX <= text.length) h = prefixHash(text, i)
        continue
      }
    }
    if (i + PREFIX >= text.length) break
    h = (Math.imul((h - Math.imul(text.charCodeAt(i), ix.top)) >>> 0, 31) + text.charCodeAt(i + PREFIX)) >>> 0
    i++
  }
  if (last === 0) return text
  parts.push(text.slice(last))
  return parts.join('')
}

// A placeholder of the finished text that restores to a distinctive known
// value: where it starts and ends, the value, the end of the placeholder
// before it and the start of the one after it, of any kind, or the text's
// own start and end. `act` is true where the placeholder is scan-private,
// the record that a re-hide pass of this scan made the hide, so widenKnown
// acts there, and false where the fixed-format step only reads through the
// placeholder. `open` is false where neither side
// holds text that could be hidden with the value. `run` is the stretch of
// text the fixed-format step read the spot in and `r` where the value
// starts in it. `fixed` is the fixed-format match the value stands inside
// or overlaps, as its start and end in the run's text, and whether it is a
// whole match.
type Spot = { at: number; end: number; value: string; prev: number; next: number; act: boolean; open: boolean; r: number; run?: Run; fixed?: [from: number, to: number, whole: boolean] }

// The text the fixed-format step reads for the spots `first` to `last`,
// which stand with no other placeholder between them: the text from `base`
// on with each of those spots' values put back.
type Run = { text: string; base: number; first: number; last: number }

// The widening pass, run on the finished text after the scan's last pass
// and after unpark. A session that holds part of a key, as one does after a
// display cut the key to a fixed width, must show no more of the key than a
// session that holds none. The second reading scrubSecrets takes of a text
// in which rehideKnown hid a value is what holds that for every detector:
// this pass repairs the vendor formats, the JWT, the slash run and the
// token, and the second reading hides whatever else a session that holds
// none hides. The passes before this one hide a known value
// alone, so every detector has read the text as it would with that value
// hidden and nothing else. This pass acts only at the hides the two re-hide
// passes made of a distinctive known value in this scan. Those passes write
// each hide as a scan-private placeholder, and a spot is one that stands
// whole in the text, so no text is lined up against another to find a hide.
// A placeholder a detector minted, one the scanned text already held, and a
// hide a later pass took inside a hide of its own or cut are no spot, so a
// scan in which no known value was hidden again
// comes back as its passes left it. At a spot the pass reads the text with
// the value put back and swaps the placeholder and the text beside it that
// makes one key with the value for one placeholder. This pass only swaps a
// spot's placeholder and unhidden text beside it for one placeholder, so it
// hides every character the passes before it hid.
//
// The fixed-format step comes first, and readFixed asks it. It reads the
// spots that stand with no other placeholder between them as one text with
// every one of their values put back, so a key that an earlier scan hid as
// two known values is read whole. It reads through a placeholder the pass
// does not act at as well, where that placeholder restores to a distinctive
// known value whose whole length stands within FIXED_REACH characters of a
// spot's value. Over one scan the values put back for such placeholders
// total no more than twice the length of the text the scan was handed,
// `scanned`, counted in the order the pass reads them and once for each
// time a value is put back, so the text the step reads is never more than
// a fixed multiple of the scanned text, whatever its placeholders stand
// for. A spot's own value always goes back, since the scanned text held it
// there. In a text whose placeholders stand for more than that total, the
// step stops reading through the placeholders the pass does not act at,
// and a key beside one of them is hidden by the slash run and the token
// alone. Any other placeholder ends that text, one that would pass the
// total among them, and so does a gap of
// more than FIXED_REACH characters. A match counts for a spot whose value
// it holds or shares a character with. It is hidden for the first such
// spot, from FIXED_REACH characters before that spot's value to FIXED_REACH
// after it at most, and a spot a hidden match covers is not acted at again.
// A whole match that holds the value is minted as scrubVendors and
// scrubJwtChain mint one, so it joins the search as it does on a session
// that holds no part of it. A match the reach cut, or one that starts or
// ends inside the spot's value or inside the value of a placeholder the
// step read through, is hidden with each such whole placeholder under one
// placeholder that joins no search. Each match is judged by itself, and one
// that a spot's value holds whole gives the step nothing more to hide.
//
// A spot at which the step hides nothing, whether it stands in no
// fixed-format match or holds one whole, takes the slash run or the token
// knownSpan
// reads, under a placeholder that restores to that text and joins no search.
// Every neighbouring placeholder ends a run and a token, and so does the end
// of the hide before the spot.
//
// A placeholder the pass took into a wider one, and that the text no longer
// holds, leaves the scan's collected set, so a hook counts one hidden value
// where one placeholder shows.
//
// The pass hands the text back with its scan-private placeholders still in
// it, where it hid nothing more. readText swaps each for the vault's
// placeholder of its value.
function widenKnown(text: string, cfg: Config, scanned: number): string {
  const vault = marks!.vault
  let spots: Spot[] = []
  const distinctive = new Map<string, boolean>()
  // How many times each placeholder stands in the text, kept where a caller
  // collects the scan's placeholders. A scan-private placeholder is counted
  // as the vault's placeholder of its value, which the caller collected.
  const shown = minted === null ? null : new Map<string, number>()
  const count = (tag: string, by: number): void => {
    const held = vault.get(tag) ?? tag
    if (shown !== null) shown.set(held, (shown.get(held) ?? 0) + by)
  }
  // The length of the values put back so far for placeholders the pass does
  // not act at.
  let putBack = 0
  let open: Spot | undefined
  let prev = 0
  // TAG is shared, and the walk ends with it back at its start.
  TAG.lastIndex = 0
  for (let m = TAG.exec(clocked(text)); m !== null; m = TAG.exec(text)) {
    if (open !== undefined) open.next = m.index
    open = undefined
    count(m[0], 1)
    const value = byTag.get(m[0])
    const act = vault.has(m[0])
    // A value longer than the step's reach is read through nowhere.
    if (value !== undefined && (act || value.length <= FIXED_REACH)) {
      let wide = distinctive.get(value)
      if (wide === undefined) distinctive.set(value, (wide = echo.has(value) && echoable(value)))
      if (wide) spots.push((open = { at: m.index, end: m.index + m[0].length, value, prev, next: text.length, act, open: true, r: 0 }))
    }
    prev = m.index + m[0].length
  }
  // A placeholder the pass does not act at is read through only where its
  // whole value stands within FIXED_REACH characters of a spot's value, with
  // every value between them put back and no other placeholder between.
  const near = new Uint8Array(spots.length)
  for (const step of [1, -1]) {
    let reach = Infinity
    for (let k = step === 1 ? 0 : spots.length - 1; k >= 0 && k < spots.length; k += step) {
      const spot = spots[k]!
      const from = spots[k - step]
      if (spot.act) reach = 0
      else {
        const joined = from !== undefined && (step === 1 ? from.next === spot.at : spot.next === from.at)
        reach = joined ? reach + (step === 1 ? spot.at - from!.end : from!.at - spot.end) + spot.value.length : Infinity
        if (reach <= FIXED_REACH) near[k] = 1
      }
    }
  }
  spots = spots.filter((spot, k) => spot.act || near[k] === 1)
  // A placeholder the pass does not act at is read through only while its
  // value fits in the scan's total, and ends the text like any other
  // placeholder once it does not.
  const fits = (spot: Spot): boolean => {
    if (spot.act) return true
    if (putBack + spot.value.length > 2 * scanned) return false
    putBack += spot.value.length
    return true
  }
  for (let first = 0; first < spots.length; ) {
    tickNow()
    const head = spots[first]!
    if (!fits(head)) {
      first++
      continue
    }
    let last = first
    while (last + 1 < spots.length && spots[last]!.next === spots[last + 1]!.at && spots[last + 1]!.at - spots[last]!.end <= FIXED_REACH && fits(spots[last + 1]!)) last++
    const tail = spots[last]!
    // A spot with a stretch end, a placeholder of another kind or the text's
    // edge on both sides has no text beside it to hide.
    if (first === last && (head.at === head.prev || fixedEdge(text.charCodeAt(head.at - 1))) && (head.end === head.next || fixedEdge(text.charCodeAt(head.end)))) {
      head.open = false
      first++
      continue
    }
    const from = Math.max(head.prev, head.at - FIXED_REACH)
    const base = Math.max(0, from - FIXED_LOOK_BACK)
    const lo = from - base
    const pieces = [text.slice(base, head.at)]
    const run: Run = { text: '', base, first, last }
    let n = head.at - base
    for (let k = first; k <= last; k++) {
      const spot = spots[k]!
      const gap = text.slice(spot.end, k < last ? spots[k + 1]!.at : Math.min(tail.next, tail.end + FIXED_REACH))
      spot.r = n
      spot.run = run
      pieces.push(spot.value, gap)
      n += spot.value.length + gap.length
    }
    const whole = (run.text = pieces.join(''))
    // A stretch that ends at the reach's edge, and not at a placeholder or
    // the text's own edge, may hold a match the reach cut.
    const cutLo = head.at - FIXED_REACH > head.prev && !fixedEdge(whole.charCodeAt(lo - 1))
    const cutHi = tail.end + FIXED_REACH < tail.next
    for (let k = first; k <= last; ) {
      tickNow()
      let s = spots[k]!.r
      while (s > lo && !fixedEdge(whole.charCodeAt(s - 1))) s--
      // The stretch from `s` to `e` ends at a stretch end or the text's edge,
      // and holds whole the value of every spot whose value starts in it, so
      // a stretch end inside a value does not end it. Spots `k` to `m - 1`
      // are those spots, and `acts` says whether the pass acts at any.
      let e = spots[k]!.r + spots[k]!.value.length
      let m = k + 1
      for (;;) {
        while (e < whole.length && !fixedEdge(whole.charCodeAt(e))) e++
        let far = e
        for (; m <= last && spots[m]!.r < e; m++) far = Math.max(far, spots[m]!.r + spots[m]!.value.length)
        if (far === e) break
        e = far
      }
      let acts = false
      for (let a = k; a < m && !acts; a++) acts = spots[a]!.act
      const cut = (s === lo && cutLo) || (e === whole.length && cutHi)
      if (acts) {
        readFixed(whole, s, e, cfg, (at, end) => {
          // The first spot of the run whose value ends past `at`.
          let a = first
          for (let b = m; a < b; ) {
            const mid = (a + b) >> 1
            if (spots[mid]!.r + spots[mid]!.value.length <= at) a = mid + 1
            else b = mid
          }
          for (; a < m && spots[a]!.r < end; a++) {
            const spot = spots[a]!
            if (!spot.act) continue
            const stop = spot.r + spot.value.length
            // A match the value holds whole leaves the step nothing to hide.
            if (spot.r <= at && end <= stop) continue
            if (spot.fixed !== undefined) continue
            const f = Math.max(at, spot.r - FIXED_REACH)
            const t = Math.min(end, stop + FIXED_REACH)
            spot.fixed = [f, t, !cut && f === at && t === end]
          }
        })
      }
      k = m
    }
    first = last + 1
  }
  // Where the character at `p` of a run's text stands in `text`, and the
  // spot whose value holds it.
  const where = (run: Run, p: number): [number, Spot | undefined] => {
    let a = run.first
    for (let b = run.last + 1; a < b; ) {
      const mid = (a + b) >> 1
      if (spots[mid]!.r <= p) a = mid + 1
      else b = mid
    }
    if (a === run.first) return [run.base + p, undefined]
    const spot = spots[a - 1]!
    const stop = spot.r + spot.value.length
    return p < stop ? [spot.at, spot] : [spot.end + p - stop, undefined]
  }
  // The text around a spot with the value put back: the text itself, where
  // the value starts in it, and where the text that may be hidden starts.
  // The characters before that are there to be read only: as many as a
  // slash run's body may hold before the value, the FIXED_LOOK_BACK a key's
  // name is read in before the run, and one for the run's look-behind.
  const around = (spot: Spot, floor: number): [string, number, number] => {
    const lo = Math.max(floor, spot.at - FIXED_REACH)
    const base = Math.max(0, lo - SLASHED_BODY_MAX - FIXED_LOOK_BACK - 1)
    return [text.slice(base, spot.at) + spot.value + text.slice(spot.end, Math.min(spot.next, spot.end + FIXED_REACH)), spot.at - base, lo - base]
  }
  const parts: string[] = []
  let last = 0
  for (const spot of spots) {
    tickNow()
    if (!spot.act || !spot.open || spot.at < last) continue
    if (spot.fixed !== undefined) {
      const run = spot.run!
      const [f, t, whole] = spot.fixed
      // A match that starts or ends inside a value, the spot's own or
      // another placeholder's, is hidden with that whole placeholder.
      const s = Math.max(where(run, f)[0], last)
      const [before, inside] = where(run, t - 1)
      const e = inside === undefined ? before + 1 : inside.end
      // Where what is left of the match to hide is the spot alone, the step
      // hides nothing more there, and the spot takes the slash run or the
      // token below.
      if (s !== spot.at || e !== spot.end) {
        const taken: string[] = []
        const span = text.slice(s, e).replace(TAG, (tag) => (taken.push(tag), byTag.get(tag) ?? tag))
        if (ownSessionId !== undefined && span.toLowerCase() === ownSessionId) continue
        const tag = whole && span === run.text.slice(f, t) ? mint('SECRET', span) : mint('SECRET', span, 'token')
        parts.push(text.slice(last, s), tag)
        for (const inner of taken) count(inner, -1)
        count(tag, 1)
        last = e
        continue
      }
    }
    const [part, at, lo] = around(spot, Math.max(last, spot.prev))
    const from = at
    const value = spot.value
    const [s, e] = knownSpan(part, from, value, lo, cfg)
    const before = at - s
    const after = e - at - spot.value.length
    if (before === 0 && after === 0) continue
    const span = part.slice(s, e)
    const tag = mint('SECRET', span, span === value ? 'known' : 'token')
    parts.push(text.slice(last, spot.at - before), tag)
    count(text.slice(spot.at, spot.end), -1)
    count(tag, 1)
    last = spot.end + after
  }
  if (last === 0) return text
  if (shown !== null) for (const [tag, n] of shown) if (n === 0) minted!.delete(tag)
  parts.push(text.slice(last))
  return parts.join('')
}

// ------------------------------------------------------------------ parking

// Some spans are known not to be secrets and are big enough to drown the
// transcript in placeholders: an image in a data: URI, a lockfile hash, a
// thinking-block signature, a base64 attachment. They are parked behind a
// marker for the scan and put back after it. The marker is a character the
// text does not contain; if every candidate is taken, nothing is parked and
// the scan simply hides more.
type Parked = { mark: string; spans: string[]; re: RegExp }
let parked: Parked | null = null
const MARKS = ['\u0000', '\uE000', '\uE001', '\uFDD0']

function startParking(text: string): Parked | null {
  const mark = MARKS.find((m) => !text.includes(m))
  return mark ? { mark, spans: [], re: new RegExp(`${mark}(\\d+)${mark}`, 'g') } : null
}

function park(span: string): string {
  if (!parked) return span
  parked.spans.push(span)
  return `${parked.mark}${parked.spans.length - 1}${parked.mark}`
}

// Puts the parked spans back. `clock` is false where the text is one value
// inside a pass, as mint's is, so the clock is read only before a whole-text
// unpark and never while a regex is mid-match.
function unpark(text: string, clock = true): string {
  const p = parked
  if (!p || !text.includes(p.mark)) return text
  let out = text
  for (let i = 0; i < 3 && out.includes(p.mark); i++) out = (clock ? clocked(out) : out).replace(p.re, (_m, n: string) => p.spans[Number(n)] ?? '')
  return out
}

// ------------------------------------------------------------- small tools

// Bits per character. Counted in a reused array for plain ASCII, since the
// scan calls this for every candidate token.
const COUNTS = new Int32Array(128)

function entropy(text: string): number {
  let ascii = true
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 128) {
      ascii = false
      break
    }
  }
  if (!ascii) {
    const counts = new Map<string, number>()
    for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1)
    let h = 0
    for (const n of counts.values()) h -= (n / text.length) * Math.log2(n / text.length)
    return h
  }
  COUNTS.fill(0)
  for (let i = 0; i < text.length; i++) COUNTS[text.charCodeAt(i)]!++
  let h = 0
  for (let c = 0; c < 128; c++) {
    const n = COUNTS[c]!
    if (n > 0) h -= (n / text.length) * Math.log2(n / text.length)
  }
  return h
}

const B64_TABLE = (() => {
  const t = new Int16Array(128).fill(-1)
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  for (let i = 0; i < abc.length; i++) t[abc.charCodeAt(i)] = i
  t['-'.charCodeAt(0)] = 62
  t['_'.charCodeAt(0)] = 63
  return t
})()

// Decodes the start of a base64 text into one character per byte. The hooks
// run with no Buffer and no atob, so this is done by hand.
function decodeBase64Head(text: string, max = 8192): string {
  let out = ''
  let acc = 0
  let bits = 0
  for (let i = 0; i < text.length && out.length < max; i++) {
    const c = text.charCodeAt(i)
    if (c === 61) break
    const v = c < 128 ? B64_TABLE[c]! : -1
    if (v < 0) continue
    acc = ((acc << 6) | v) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((acc >> bits) & 0xff)
    }
  }
  return out
}

// Ranges of the text that the token scan skips. A `soft` range is skipped
// only when no key name stands in front of the token.
type Span = [start: number, end: number, soft: boolean]

class Spans {
  private list: Span[] = []
  private i = 0
  add(start: number, end: number, soft = false): void {
    if (end > start) this.list.push([start, end, soft])
  }
  seal(): this {
    this.list.sort((a, b) => a[0] - b[0])
    return this
  }
  // Offsets are asked in ascending order, so a cursor keeps this linear.
  at(offset: number): 'hard' | 'soft' | null {
    const l = this.list
    while (this.i < l.length && l[this.i]![1] <= offset) this.i++
    let found: 'hard' | 'soft' | null = null
    for (let j = this.i; j < l.length && l[j]![0] <= offset; j++) {
      if (l[j]![1] > offset) {
        if (!l[j]![2]) return 'hard'
        found = 'soft'
      }
    }
    return found
  }
}

// ------------------------------------------------------------ secret tests

// Escapes that end in a letter or digit and may sit right before a key:
// quoted-printable `=3D`, URL `%3D`, and the `\n` or `"` of escaped JSON.
const ESC = String.raw`[%=]3D|\\[nrtfbv]|\\u[0-9A-Fa-f]{4}`
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// A vendor prefix only counts at the start of a word, or right after one of
// those escapes. Without this, `task-runner-for-the-build` reads as `sk-`.
// The prefix is written first and the boundary checked behind it, so the
// regex engine can jump between occurrences of the prefix instead of
// testing the boundary at every character of the text.
function word(prefix: string, body: string, edge = 'A-Za-z0-9'): string {
  return String.raw`${prefix}(?<=(?:^|[^${edge}]|${ESC})${prefix})${body}`
}

// Shapes that belong to one vendor and mean one thing. These are hidden on
// sight, whatever their entropy. Each has a hint, a cheap test that the text
// could hold one, so a 10 MB log pays only for the shapes it might contain.
// Every quantifier is bounded: an open `{n,}` over a run of millions of
// characters overflows the regex stack.
type Shape = { hint: string | RegExp; re: string }
const VENDOR_SHAPES: readonly Shape[] = [
  { hint: 'sk-ant-', re: word('sk-ant-', '[A-Za-z0-9_-]{16,4096}') },
  // A real OpenAI key has a digit or a capital early on; a kebab word does not.
  { hint: 'sk-', re: word('sk-', '(?=[a-z_-]{0,200}[0-9A-Z])[A-Za-z0-9_-]{20,4096}') },
  { hint: /gh[pousr]_/, re: word('gh[pousr]_', '[A-Za-z0-9]{20,4096}') },
  { hint: 'github_pat_', re: word('github_pat_', '[A-Za-z0-9_]{20,4096}') },
  { hint: 'xox', re: word('xox[baprse]-', '[A-Za-z0-9-]{10,4096}') },
  { hint: 'xapp-', re: word('xapp-', '[0-9]-[A-Za-z0-9-]{10,4096}') },
  { hint: /A[KS]IA/, re: word('A(?:KIA|SIA)', '[0-9A-Z]{16}(?![A-Za-z0-9])') },
  { hint: /[sr]k_(?:live|test)_/, re: word('[sr]k_(?:live|test)_', '[A-Za-z0-9]{16,4096}') },
  { hint: 'whsec_', re: word('whsec_', '[A-Za-z0-9]{16,4096}') },
  { hint: 'AIza', re: word('AIza', '[0-9A-Za-z_-]{30,4096}') },
  { hint: 'ya29.', re: word(String.raw`ya29\.`, '[A-Za-z0-9_-]{20,4096}') },
  { hint: 'npm_', re: word('npm_', '[A-Za-z0-9]{30,4096}') },
  { hint: 'dop_v1_', re: word('dop_v1_', '[a-f0-9]{40,4096}') },
  { hint: 'glpat-', re: word('glpat-', '[A-Za-z0-9_-]{16,4096}') },
  { hint: 'shpat_', re: word('shpat_', '[a-f0-9]{32,4096}') },
  { hint: 'SG.', re: word(String.raw`SG\.`, String.raw`[A-Za-z0-9_-]{16,4096}\.[A-Za-z0-9_-]{16,4096}`) },
  { hint: 'hooks.slack.com', re: String.raw`https://hooks\.slack\.com/services/[A-Za-z0-9/+_-]{16,4096}` },
  { hint: '/api/webhooks/', re: String.raw`https://discord(?:app)?\.com/api/webhooks/[0-9]{1,30}/[A-Za-z0-9_-]{16,4096}` },
  // Prefixes built from words, which the name test would otherwise excuse.
  { hint: 'vercel_blob_rw_', re: word('vercel_blob_rw_', '[A-Za-z0-9]{16}_[A-Za-z0-9]{30}') },
  { hint: 'tskey-', re: word('tskey-', '[a-z]{1,20}-[A-Za-z0-9_-]{20,4096}') },
  { hint: 'pscale_', re: word('pscale_', '(?:tkn|pw|oauth)_[A-Za-z0-9_-]{32,4096}') },
  { hint: 'pdl_', re: word('pdl_', '(?:live|sdbx)_apikey_[A-Za-z0-9_-]{20,4096}') },
  { hint: 'pypi-AgE', re: word('pypi-AgE', '[A-Za-z0-9_-]{50,4096}') },
  { hint: 'sntrys_eyJ', re: word('sntrys_eyJ', '[A-Za-z0-9+/=_-]{50,4096}') },
  { hint: 'pcsk_', re: word('pcsk_', '[A-Za-z0-9_-]{40,4096}') },
  { hint: 'HRKU-AA', re: word('HRKU-AA', '[A-Za-z0-9_-]{40,4096}') },
  { hint: 'dckr_', re: word('dckr_', '(?:pat|oat)_[A-Za-z0-9_-]{20,4096}') },
  { hint: 'figd_', re: word('figd_', '[A-Za-z0-9_-]{30,4096}') },
  { hint: 'GOCSPX-', re: word('GOCSPX-', '[A-Za-z0-9_-]{20,4096}') },
  { hint: /gl(?:rt|dt|ptt|cbt|imt|ft|soat|oas|agent)-/, re: word('gl(?:rt|dt|ptt|cbt|imt|ft|soat|oas|agent)-', '[A-Za-z0-9_-]{20,4096}') },
  { hint: 'bb_live_', re: word('bb_live_', '[A-Za-z0-9_-]{20,4096}') },
  { hint: 'sb_secret_', re: word('sb_secret_', '[A-Za-z0-9_-]{20,4096}') },
  { hint: 'ATATT3', re: word('ATATT3', '[A-Za-z0-9_=-]{100,4096}') },
  // Keys whose secret half sits after a `.`, `:` or `/`.
  { hint: 'pat', re: word('pat', String.raw`[A-Za-z0-9]{14}\.[a-f0-9]{64}`) },
  { hint: /[st]k\.eyJ/, re: word(String.raw`[st]k\.eyJ`, String.raw`[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{20,4096}`) },
  { hint: 'st.', re: word(String.raw`st\.`, String.raw`(?:[0-9a-f]{24}|${UUID})\.[0-9a-f]{32}\.[0-9a-f]{32}`) },
  { hint: /\/[0-9]{8}[0-9/]*:[0-9a-f]{32}/, re: String.raw`(?<![0-9])[0-9]/[0-9]{8,30}(?:/[0-9]{8,30})?:[0-9a-f]{32}` },
  { hint: /-[0-9a-f]{12}:[0-9a-f]{32}/, re: String.raw`(?<![0-9A-Fa-f])${UUID}:[0-9a-f]{32}` },
  // Hugging Face tokens are letters only, so no entropy rule can see them.
  { hint: /(?:hf|api_org)_/, re: word('(?:hf|api_org)_', '[A-Za-z0-9]{34}(?![A-Za-z0-9_])') },
  { hint: 'ops_eyJ', re: word('ops_eyJ', '[A-Za-z0-9+/=_-]{50,4096}') },
  { hint: /fm[12][ar]?_/, re: word('fm[12][ar]?_', '[A-Za-z0-9+/=,_-]{50,4096}') },
  { hint: 'sig=', re: String.raw`(?<=[?&]sig=)[A-Za-z0-9%+/]{30,4096}` },
  { hint: 'AAAAAAAAAAAAAAAAAAAAA', re: word('AAAAAAAAAAAAAAAAAAAAA', '[A-Za-z0-9]{0,200}%[A-Za-z0-9%]{30,4096}') },
  { hint: 'Q~', re: String.raw`[A-Za-z0-9_~.-]{3}[0-9][A-Za-z0-9_~.-]Q~[A-Za-z0-9_~.-]{31,34}` },
  // Lowercase and hex shapes that one vendor owns.
  { hint: 'e2b_', re: word('e2b_', String.raw`[a-f0-9]{40}(?![\w-])`) },
  { hint: 'lsv2_', re: word('lsv2_', String.raw`(?:pt|sk)_[a-f0-9]{32}_[a-f0-9]{10}(?![\w-])`) },
  { hint: /[0-9a-f]-us[0-9]/, re: String.raw`(?:(?<=${ESC})|(?<![A-Za-z0-9]))[a-f0-9]{32}-us[0-9]{1,2}(?![\w-])` },
  { hint: /-[a-f0-9]{8}-[a-f0-9]{8}(?![\w-])/, re: String.raw`(?:(?<=${ESC})|(?<![A-Za-z0-9]))[a-f0-9]{32}-[a-f0-9]{8}-[a-f0-9]{8}(?![\w-])` },
  { hint: /xa[ap]t-/, re: word('xa[ap]t-', String.raw`${UUID}(?![\w-])`) },
  { hint: 'SK', re: word('SK', String.raw`[0-9a-f]{32}(?![\w-])`) },
  { hint: 'tvly-', re: word('tvly-', '(?:dev-|prod-)?[A-Za-z0-9]{32,4096}') },
  { hint: 'tr_', re: word('tr_', '(?:dev|prod|stg|pat)_[A-Za-z0-9]{20,4096}', 'A-Za-z0-9_') },
  { hint: ':AA', re: String.raw`(?<![0-9])[0-9]{8,10}:AA[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])` },
  { hint: /a[ks]-/, re: word('a[ks]-', '[A-Za-z0-9]{22}(?![A-Za-z0-9_-])', 'A-Za-z0-9_-') },
  // Keys that reuse a Stripe id prefix: Resend `re_`, Stripe client secrets.
  { hint: 're_', re: word('re_', '[A-Za-z0-9]{8}_[A-Za-z0-9]{24}(?![A-Za-z0-9_])', 'A-Za-z0-9_') },
  { hint: '_secret_', re: word('(?:pi|seti)_', '[A-Za-z0-9]{14,64}_secret_[A-Za-z0-9]{16,4096}', 'A-Za-z0-9_') },
  // A Klaviyo private key is `pk_` and 34 alnum. Stripe and Clerk publishable
  // keys always carry `live_` or `test_` after `pk_`, so they do not match.
  { hint: 'pk_', re: word('pk_', '[A-Za-z0-9]{34}(?![A-Za-z0-9_])', 'A-Za-z0-9_') },
  // An age identity (SOPS reads it from keys.txt) is upper case and digits.
  { hint: 'AGE-SECRET-KEY-1', re: word('AGE-SECRET-KEY-1', '[0-9A-Z]{58}') },
  { hint: 'AGE-PLUGIN-', re: word('AGE-PLUGIN-[A-Z0-9]{1,40}-1', '[0-9A-Z]{20,4096}') },
  // Tokens that are not mixed case, so no entropy rule sees them alone.
  { hint: /NR(?:AK|II|JS|AA|RA)-/, re: word('NR(?:AK|II|JS|AA|RA)-', '[A-Za-z0-9_-]{27,40}') },
  { hint: 'dt0c01.', re: word(String.raw`dt0c01\.`, String.raw`[A-Z0-9]{24}\.[A-Z0-9]{64}`) },
  { hint: /pat-(?:na|eu|ap)[0-9]-/, re: word('pat-(?:na|eu|ap)[0-9]-', String.raw`${UUID}(?![\w-])`) },
  { hint: /(?:sdk|api)-[0-9a-f]{8}-/, re: word('(?:sdk|api)-', String.raw`${UUID}(?![\w-])`) },
  { hint: 'lin_oauth_', re: word('lin_oauth_', '[a-f0-9]{64}') },
  { hint: 'shippo_', re: word('shippo_(?:live|test)_', '[a-f0-9]{40}') },
  { hint: 'dapi', re: word('dapi', String.raw`[a-f0-9]{32}(?:-[0-9]{1,2})?(?![\w-])`) },
  { hint: ':fx', re: String.raw`(?<![0-9a-f-])${UUID}:fx(?!\w)` },
  { hint: 'access_token$', re: String.raw`access_token\$(?:production|sandbox)\$[a-z0-9]{16}\$[a-f0-9]{32}` },
  // A Twilio auth token is plain hex; it is known by the account SID beside it.
  { hint: /AC[0-9a-f]{32}["']?[ \t]*[,:]/, re: String.raw`(?<=\bAC[0-9a-f]{32}["']?[ \t]*[,:][ \t]*["']?)[0-9a-f]{32}(?![0-9A-Za-z])` },
]

// Each shape also takes in the rest of its token, so a match that stops at a
// `-` or `_` inside a key cannot leave the tail of the key on screen.
const VENDOR = VENDOR_SHAPES.map((s) => ({ hint: s.hint, re: new RegExp(`(?:${s.re})[A-Za-z0-9_-]{0,4096}`, 'g') }))

// True where scrubVendors leaves a vendor pattern's match as written: the
// allow list holds it, or it holds a placeholder.
function keptByVendors(m: string, cfg: Config): boolean {
  return cfg.allow.has(m) || m.includes('[REDACTED-')
}

function scrubVendors(text: string, cfg: Config): string {
  let out = text
  for (const { hint, re } of VENDOR) {
    if (typeof hint === 'string' ? !out.includes(hint) : !hint.test(out)) continue
    out = clocked(out).replace(re, (m) => (keptByVendors(m, cfg) ? m : mint('SECRET', m)))
  }
  return out
}

// A private key block, up to its END line (never past the next BEGIN, so a
// file of BEGIN lines is not scanned again for each one). When the END line
// is missing (`head key.pem`), the base64 lines that follow the BEGIN line
// are still taken, and only those.
const PRIVATE_KEY =
  /-----BEGIN[^\n-]{0,40}PRIVATE KEY(?: BLOCK)?-----(?:(?:(?!-----BEGIN)[\s\S]){0,65536}?-----END[^\n-]{0,40}PRIVATE KEY(?: BLOCK)?-----|(?:\r?\n(?:[A-Za-z][A-Za-z-]{0,40}: [^\n]*|[ \t]*))*(?:\r?\n[A-Za-z0-9+/=]{4}[A-Za-z0-9+/=]*(?=\r?\n|$))+)/g
const PUTTY_PRIVATE = /(Private-Lines: \d+\r?\n)((?:[A-Za-z0-9+/=]{1,80}(?:\r?\n|$))+)/g

// A run of dot-separated parts, where a JWT may hide. It has one starting
// point per run, so a long run is scanned once. A JWT regex of its own went
// quadratic on base64 JSON, where every row starts with `eyJ`.
const DOTTED = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)(?:\.[A-Za-z0-9_-]+)+/g

// The password inside a connection string: postgres://user:PASSWORD@host.
// The user may be empty (redis://:pw@host), and the password may hold `/` or
// `@`: it ends at the `@` that is followed by a host.
const URL_PASSWORD =
  /\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s/@:[\]]{0,80}):(?!\d{1,5}(?:[/?#]|$))([^\s"'`<>]{3,200}?)@(?=[A-Za-z0-9.-]{1,253}(?::\d{1,5})?(?:[/?#\s"'`<>]|$))/gi

// A token used alone as the userinfo: `https://<token>@dev.azure.com/...`,
// the documented clone form for Azure DevOps, GitHub and Bitbucket tokens.
const URL_USERINFO = /\b([a-z][a-z0-9+.-]{1,20}:\/\/)([A-Za-z0-9_-]{20,200})@(?=[A-Za-z0-9.-]{1,253}(?::\d{1,5})?[/:])/g
// A URL's credential positions are its user part and its password, the
// text between `://` and the `@` before the host. A token stands in one
// where it is the whole user part or the whole password, so both halves
// hold. The text before it ends in a scheme and `://`,
// or in those, a user part and `:`. The text after it reaches `@` at once,
// or through `:` and a password. Either neighbour may already be a
// placeholder. The generic scan reads this to record what a hide rests on
// where the two patterns above do not take the token: a host with no path
// after it, a host before `)` or `,`, and a user part before a password
// among such cases. It hides nothing itself. Each read is bounded: the
// longest text the first half takes, and one character more so its word
// boundary is read from the text, and the longest the second half takes.
// The second half is read first, since it fails at its first character
// on most tokens. It is one of the tests scanEvidence runs, and the only
// one that reads past a quote inside the credential itself, which a user
// part or a password may hold. A token that follows such a quote inside the
// user part or password is neither the whole of one, so this test does not
// mark it.
const URL_CRED_BEFORE = /\b[a-z][a-z0-9+.-]{1,20}:\/\/(?:[^\s/@:]{0,80}:)?$/i
const URL_CRED_AFTER = /^(?::[^\s/@]{0,200})?@/
const URL_CRED_BEFORE_MAX = 106
const URL_CRED_AFTER_MAX = 202
function inUrlCredential(whole: string, offset: number, end: number): boolean {
  return URL_CRED_AFTER.test(whole.slice(end, end + URL_CRED_AFTER_MAX)) && URL_CRED_BEFORE.test(whole.slice(Math.max(0, offset - URL_CRED_BEFORE_MAX), offset))
}

// A credential in a URL query: ?api_key=, &sig=, ?accessToken=. The value may
// be percent-encoded, so it is decoded before it is judged.
const URL_KEYWORD =
  '(?:[Aa]pi[_-]?[Kk]ey|API[_-]?KEY|[Aa]pikey|[Kk]ey|KEY|[Tt]oken|TOKEN|[Ss]ecret|SECRET|[Ss]ig|SIG|[Ss]ignature|SIGNATURE|[Pp]assword|PASSWORD|[Pp]asswd|[Pp]wd|PWD|[Aa]uth|AUTH|[Cc]redential|CREDENTIAL)'
const URL_PARAM = new RegExp(
  String.raw`([?&;](?:[A-Za-z0-9._-]*[_.-]|[a-z0-9]+(?=[A-Z]))?${URL_KEYWORD}=)((?:[A-Za-z0-9+_~-]|%[0-9A-Fa-f]{2}){8,400}={0,2})(?=[&#\s"'<>)\]]|$)`,
  'g',
)

// Values after a password-like key, judged by the key and not by entropy:
// a human password (`Summer2024!`, `hunter2hunter2`) has too little.
const PW_WORD = String.raw`(?:password|passwd|passphrase|secret|secret[_-]?key|client[_-]?secret|api[_-]?key|apikey|private[_-]?key|secret[_-]?access[_-]?key|access[_-]?key|auth[_-]?token)`
// Short password names (`pass`, `pw`, `pwd`, `passcode`). They count only as
// the whole key or after a separator, so `compass` and `bypass` are left.
const SHORT_PW = String.raw`(?:pass(?:[_-]?code)?|pwd?)`
const SHORT_KEY = new RegExp(String.raw`(?:^|[_.-])${SHORT_PW}$`, 'i')
// A short key (`pass:`) with a number, a lowercase word or an all-caps word
// of up to eight letters after it is a count, a status or a constant, not a
// password. A mixed-case word (`Summer`) or a longer caps run is hidden.
const shortKeyStatus = (key: string, v: string): boolean => SHORT_KEY.test(key) && (/^[0-9]+$/.test(v) || /^[a-z]{1,8}$/.test(v) || /^[A-Z]{1,8}$/.test(v))
// The value ends at its own quote, an empty value included, so the pair after
// it is read on its own. The callers decide what a short value does.
const STRONG_QUOTED = new RegExp(
  String.raw`((?:^|[\s{,;(\[])(\\?["']?)((?:[A-Za-z0-9._-]*[_.-]|pg)?${PW_WORD}|(?:[A-Za-z0-9._-]*[_.-])?${SHORT_PW})\2[ \t]*[:=][ \t]*)(\\?["'])((?:(?!\4)[^\n]){0,200})\4`,
  'gim',
)
// A strong quoted pair as both callers read it, with the span it covers.
type StrongPair = { head: string; key: string; quote: string; v: string; start: number; end: number }
// What follows a short capture's closing quote when the value is a real
// short value: a separator, a closing bracket, whitespace, or the end.
const SHORT_CLOSE = /^[\s,;\])}]/
// The pairs STRONG_QUOTED finds in a text, each with the value the callers
// act on. A capture under three characters is a short value where its
// closing quote is followed by a separator or the end: it is left as written
// and its pair is consumed. A capture ending in an odd run of backslashes is
// never short, since the regex stopped at an escaped quote. Any other short
// capture is read as the base read it, which covers a value opening with its
// own quote type, such as an escaped quote or a triple quote. Its value then
// runs to the first opening quote string at least three characters in, with
// no newline and at most two hundred characters. Where no such close exists the text is left as written.
// Values of three characters or more end where the regex ended them.
function strongQuotedPairs(text: string): StrongPair[] {
  const pairs: StrongPair[] = []
  STRONG_QUOTED.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = STRONG_QUOTED.exec(text)) !== null) {
    const [whole, head, , key, quote, v] = m as unknown as string[]
    const start = m.index
    let end = start + whole!.length
    let value = v!
    if (value.length < 3) {
      // A capture ending in an odd run of backslashes stopped at an escaped
      // quote, not its own closing quote, so it is never a short value.
      let slashes = 0
      while (slashes < value.length && value[value.length - 1 - slashes] === '\\') slashes++
      if (slashes % 2 === 0 && (end >= text.length || SHORT_CLOSE.test(text[end]!))) continue
      const from = start + head!.length + quote!.length
      const close = text.indexOf(quote!, from + 3)
      if (close < 0) continue
      value = text.slice(from, close)
      if (value.length > 200 || value.includes('\n')) continue
      end = close + quote!.length
      STRONG_QUOTED.lastIndex = end
    }
    pairs.push({ head: head!, key: key!, quote: quote!, v: value, start, end })
  }
  STRONG_QUOTED.lastIndex = 0
  return pairs
}
// A YAML list item (`- password: x`, compose `- DB_PASS=x`) counts too. The line
// ends after the value and any spaces and tabs. Those are read and not
// taken into the match, so they stay in the text.
const STRONG_LINE = new RegExp(
  String.raw`^([ \t]*(?:-[ \t]+)?(?:export[ \t]+)?([A-Za-z0-9._-]*${PW_WORD}|(?:[A-Za-z0-9._-]*[_.-])?${SHORT_PW})[ \t]*[:=][ \t]*)([^\s"'#;][^\s"';]{2,199})(?=[ \t]*$)`,
  'gim',
)
// `DB_PASS=`: upper case with a separator only, so prose `Pass:` is left.
// The spaces and tabs before the line's end are read and not taken.
const ENV_PASS = /^([ \t]*(?:-[ \t]+)?(?:export[ \t]+)?()[A-Z0-9_]*_PASS[ \t]*[:=][ \t]*)([^\s"'#;][^\s"';]{2,199})(?=[ \t]*$)/gm
// A Gmail app password written unquoted: four groups of four letters. The
// spaces and tabs before the line's end are read and not taken.
const APP_PASSWORD = new RegExp(
  String.raw`^([ \t]*(?:-[ \t]+)?(?:export[ \t]+)?[A-Za-z0-9._-]*${PW_WORD}[ \t]*[:=][ \t]*)([a-z]{4}(?: [a-z]{4}){3})(?=[ \t]*$)`,
  'gim',
)
// The line after a YAML block indicator: `password: |` then the value. The
// spaces and tabs between the value and the line's end are read and not
// taken.
const BLOCK_PASSWORD = new RegExp(
  String.raw`^([ \t]*(?:-[ \t]+)?["']?[A-Za-z0-9._-]*${PW_WORD}["']?[ \t]*:[ \t]*[|>][-+]?[0-9]?[ \t]*\r?\n[ \t]+)(\S[^\n]{2,199}?)(?=[ \t]*\r?$)`,
  'gim',
)
// SQL: `CREATE USER x WITH PASSWORD '...'`, MySQL `IDENTIFIED BY '...'`.
const SQL_PASSWORD =
  /(\b(?:(?:with|encrypted|unencrypted)[ \t]+password|identified[ \t]+(?:with[ \t]+\S+[ \t]+)?by(?:[ \t]+password)?)[ \t]+)'([^'\n]{3,200})'/gi
// Terraform: the default of a variable whose name says it is a password.
const HCL_DEFAULT = new RegExp(String.raw`(\bvariable[ \t]+"[\w-]*${PW_WORD}"[ \t]*\{[^{}]{0,400}?\bdefault[ \t]*=[ \t]*")([^"\n]{3,200})"`, 'gi')
// Terraform state: the result of a random_password (usually a database
// master password), and an output that sits under a password-like name.
const TF_RESULT = /("result"\s*:\s*")((?:[^"\\\n]|\\.){3,400})"/g
const TF_OUTPUT = new RegExp(
  String.raw`("([\w.-]{1,100})"\s*:\s*\{\s*(?:"(?:sensitive|type)"\s*:\s*[^,{}]{1,40},\s*){0,4}"value"\s*:\s*")((?:[^"\\\n]|\\.){3,400})"`,
  'g',
)
// A name and its value as sibling fields: a HAR header or form field, a
// Kubernetes env entry. The name decides; the value sits apart from it.
const JSON_NAME_VALUE = /("name"\s*:\s*"([^"\n]{1,100})"\s*,\s*"value"\s*:\s*")((?:[^"\\\n]|\\.){3,400})"/g
const JSON_VALUE_NAME = /("value"\s*:\s*")((?:[^"\\\n]|\\.){3,400})("\s*,\s*"name"\s*:\s*"([^"\n]{1,100})")/g
// The YAML form of the same pair: a list entry's `name:` line, then its
// `value:` line. The spaces and tabs after the value and its closing quote
// are read and not taken.
const YAML_NAME_VALUE =
  /^([ \t]*)(-[ \t]+name:[ \t]*["']?([\w.-]{1,100})["']?[ \t]*\r?\n\1[ \t]+value:[ \t]*(["']?))([^\n"']{3,200}?)\4(?=[ \t]*\r?$)/gm
const PW_NAME = new RegExp(String.raw`^[\w.-]*${PW_WORD}$|^(?:[\w.-]*[_.-])?${SHORT_PW}$`, 'i')
// SQL: an INSERT whose column list names a key or a password.
const SQL_INSERT = /\bINSERT[ \t]+INTO[ \t]+[\w."`[\]]{1,100}[ \t]*\(([^()\n]{1,1000})\)\s*VALUES\s*/gi
// `PGPASSWORD=x psql` is the one common env name with no separator.
const KV_PASSWORD = /((?:^|[\s;&?,])-{0,2}(?:[A-Za-z0-9._-]*[_.-]|pg)?(?:password|passwd)=|[;&?]pwd=)([^\s"'&;,]{3,200})/gim

// A generated password in quotes, with no name beside it: upper, lower,
// digit and a symbol from the Terraform and password-manager sets, no space,
// no path or regex characters. The token scan cuts such a value at each
// symbol, so it is judged whole here.
// The opening quote must follow a space, `=`, `:`, `(`, `,`, `[` or `{`, so
// the text between two strings (`"0"=20cellpadding=3D"`) is not taken.
// A value can hold a placeholder from an earlier pass. A placeholder's hash
// is random per session, so it is read as one fixed spelling: the same text
// is judged the same way in every session. Any text shaped like a
// placeholder is read that way, whether or not this session minted it.
const QUOTED_VALUE = /(?<=^|[\s:=(,[{])(["'])([^\s"'\\/.,;`]{12,128})\1/gm
const PW_SYMBOL = /[!#$%&*()=+[\]{}<>:?@^~]/

// The spelling every placeholder's hash is read as: a lowercase letter and a
// digit, as most hashes hold, and no run of digits or letters that a rule of
// looksGenerated turns on. Holding both, it reads to looksLikeName, which
// looksSecret, urlParamSecret and cookieSecret ask, as most hashes do.
const HASH_AS_READ = '1a2b3c4d'

// A copy of `v` for the five checks that judge a value's shape where the
// value can hold a placeholder: looksGenerated on a quoted value, looksSecret
// in the sibling test and in the SQL insert's key column, the class count,
// name test and entropy test of urlParamSecret, and the name, digit, letter
// and entropy tests of cookieSecret. The copy reads a placeholder's hash as
// HASH_AS_READ however its brackets are spelled: it finds the placeholder by
// its body and asks for no bracket on either side. The value as written is
// what is kept, minted and tested everywhere else.
function withFixedHashes(v: string): string {
  return v.replace(TAG_BODY, (_m, prefix: string) => prefix + HASH_AS_READ)
}

function looksGenerated(v: string): boolean {
  if (!/[A-Z]/.test(v) || !/[a-z]/.test(v) || !/[0-9]/.test(v) || !PW_SYMBOL.test(v)) return false
  if (/\$\{|\{\{|%\(|^\^|\$$|[A-Za-z]-[A-Za-z]\]|=>|::|\(\)|<\/?[a-z]|=[0-9A-F]{2}|[0-9]{6}/.test(v)) return false
  // Real words in it: code, a format, a shortcut (`Ctrl+Alt+F12`), a payee
  // with an order number (`Merchant#a12345`).
  const words = v.match(/[A-Za-z]{4,}/g)?.filter((w) => WORDY.test(w)) ?? []
  if (words.length >= 2 || words.some((w) => w.length >= 6)) return false
  // Mostly letters and digits: a run of symbols is binary or markup.
  if ((v.match(/[A-Za-z0-9]/g)?.length ?? 0) * 5 < v.length * 3) return false
  return entropy(v) >= 3.5
}

// Things that stand in for a value without being one: a variable, a call, a
// template, a placeholder, a type, the key's own name, a path. A path is
// told by its opening: POSIX (`/x`, `~x`, `./x`, `../x`) or a Windows drive
// (`C:\x`, `C:/x`), one letter, a colon, then a slash or a backslash.
// A call has to close (`getSecret("x")`), and a YAML tag is a word
// (`!Ref DbPassword`), so a generated password that starts `ab(` or `!` is
// not taken for one.
const REFERENCE =
  /^[A-Za-z_$][\w$.]*\(.*\)[,;]?$|^\$|^\{\{|^<.*>$|^%\(|^!!?[A-Za-z][\w:]*(?:[ \t]|$)|^\*+$|^(?:true|false|null|none|nil|undefined|required|optional|string|str|bool|int|number)$|^(?:process\.env|os\.environ|env\.|config\.|settings\.)|^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/i
const SELF_REF =
  /^[{`(]?(?:[a-z][A-Za-z0-9]*)?(?:Password|Passwd|Secret|Key|Token|Pwd)[A-Za-z0-9]*[)},`]*$|^(?:password|passwd|secret|apikey|api_key|pwd|token)[),}]*,?$/
const PLACEHOLDER = /^(?:x{3,}|\.{3,}|…|(?:your|my|<)[_ -]?[a-z_ -]*(?:key|password|secret|token)[a-z_ -]*>?)$/i

function isStandIn(v: string): boolean {
  return (
    REFERENCE.test(v) ||
    SELF_REF.test(v) ||
    PLACEHOLDER.test(v) ||
    /^(?:[/~]|\.\.?\/|[A-Za-z]:[\\/])/.test(v) ||
    /^\{[\w$.]+\}$/.test(v) ||
    // A test fixture made of words: `test-internal-key`, `fake_secret`.
    (/^(?:[a-z]+[_-])*(?:test|fake|dummy|mock|sample|example|placeholder|changeme)(?:[_-][a-z]+)*$/.test(v) && /[_-]/.test(v)) ||
    // `password: pw,` in an object literal is code, not a value.
    /^[A-Za-z_$][\w$]*,$/.test(v)
  )
}

// Credentials on a command line: `--password x`, `curl -u user:pw`,
// `mysql -pPW`, a .pgpass line, a .netrc entry, `gh secret set --body`.
const CLI_FLAG =
  /((?:^|\s)--?(?:password|passwd|pass|api-key|apikey|api_key|token|client-secret|auth-token|access-token)(?:=|[ \t]+)(["']?))(?![$<{%])([^\s"'=-][^\s"']{2,200})\2/g
const CLI_USERPASS =
  /(\b(?:curl|wget|http|https|xh|httpie|lftp|ftp)\b[^\n|;&]{0,500}?\s(?:-u|-U|--user|--proxy-user)(?:[ \t]+|=)["']?[^\s:"'$]+:)(?!\$)([^\s"'`]{3,200})/g
const MYSQL_P =
  /(\b(?:mysql(?:dump|admin|import|sh|check|slap|binlog)?|mariadb(?:-dump|-admin)?)\b[^\n|;&]{0,500}?\s-p)(?!\$)([^\s`-][^\s`]{2,200})/g
const PGPASS =
  /^((?:\*|[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\]):(?:\d{1,5}|\*):(?![0-9]+:)[A-Za-z0-9_$*.-]+:[A-Za-z0-9_$*.@-]+:)(?!\/\/)(\S{3,200})$/gm
const NETRC =
  /((?:^|\n)[ \t]*(?:machine[ \t]+\S+|default)(?:\s+(?:login|account|port)[ \t]+\S+)*\s+password[ \t]+)(\S{3,200})(?=[ \t]*(?:\r?\n|$)|\s+(?:machine|default|login|account|macdef)\b)/g
const GH_SECRET = /(\bgh[ \t]+secret[ \t]+set\b[^\n;&|]{0,500}?[ \t](?:-b|--body)(?:[ \t]+|=)(["']?))([^\s"']{3,400})(?=\2)/g
// Short password flags that only mean a password for one command:
// `sshpass -p`, `docker login -p`, `mongosh -p`, `7z -pPW`, `sqlcmd -P`,
// `zip -P`, `redis-cli -a`, `ldapsearch -w`. Each is anchored at its command.
const CMD_PW_TOOLS: [cmd: string, flag: string][] = [
  [String.raw`sshpass|(?:docker|podman|nerdctl|helm[ \t]+registry)[ \t]+login|mongo(?:sh|dump|restore|import|export)?`, String.raw`-p[ \t]*`],
  [String.raw`7za?|7zz`, '-p'],
  [String.raw`sqlcmd|zip`, String.raw`-P[ \t]+`],
  [String.raw`redis-cli|valkey-cli`, String.raw`-a[ \t]+`],
  [String.raw`ldap[a-z]+`, String.raw`-w[ \t]+`],
]
const CMD_PW = CMD_PW_TOOLS.map(
  ([cmd, flag]) => new RegExp(String.raw`(\b(?:${cmd})\b[^\n|;&]{0,500}?[ \t]${flag}(["']?))(?![$-])([^\s"']{3,200})\2`, 'g'),
)
const CMD_PW_GATE = /sshpass|login|mongo|7z|sqlcmd|zip|redis-cli|valkey-cli|ldap/
// `openssl ... -passout pass:PW`, `smbclient -U user%PW`, `htpasswd -b file
// user PW`, `rabbitmqctl add_user user PW`.
const OPENSSL_PASS = /(-pass(?:in|out)?[ \t]+pass:)([^\s"']{3,200})/g
const SMB_USER = /(\bsmbclient\b[^\n|;&]{0,500}?[ \t]-U[ \t]+["']?[^\s%"']+%)([^\s"']{3,200})/g
const HTPASSWD = /(\bhtpasswd[ \t]+-[a-zA-Z]*b[a-zA-Z]*[ \t]+(?:-[a-zA-Z]+[ \t]+)*\S+[ \t]+\S+[ \t]+)(["']?)([^\s"']{3,200})\2/g
const NET_USER = /(\bnet[ \t]+user[ \t]+(?:"[^"\n]{1,64}"|\S+)[ \t]+)(["']?)((?!\/)[^\s"'*]{3,200})\2/gi
const RABBIT_USER = /(\brabbitmqctl[ \t]+(?:add_user|change_password)[ \t]+\S+[ \t]+)(["']?)([^\s"']{3,200})\2/g

// Cookies: every value in a Cookie header, curl -b, or cookies.txt.
const COOKIE = /((?:^|["'\s])(?:(?:set-)?cookie["']?[ \t]*:|-b|--cookie)[ \t]*["']?)([^"'\n]*)/gim
const COOKIE_PAIR = /(^|;[ \t]*)([^=;\s]+=)([^;\s]{16}[^;\s]*)/g
const COOKIE_ATTR = /^(?:path|domain|expires|max-age|samesite|priority)=$/i
const COOKIE_VALUE = /^(?:s%3A)?([A-Za-z0-9_+%-]{16}[A-Za-z0-9_+%-]*)(?:\.[A-Za-z0-9_+%/-]{16}[A-Za-z0-9_+%/-]*)?={0,2}$/i
const COOKIES_TXT =
  /^((?:#HttpOnly_)?\.?[\w.-]+\t(?:TRUE|FALSE)\t\S+\t(?:TRUE|FALSE)\t\d+\t[^\t\n]+\t)([^\t\r\n]{16}[^\t\r\n]*)$/gm
const HAR_COOKIE = /("name"\s*:\s*"[^"]*(?:sess|sid|token|auth)[^"]*"\s*,\s*"value"\s*:\s*")([^"]{16}[^"]*)"/gi

// Basic auth and Docker `auth`: base64 of `user:password`, often short.
const BASIC_AUTH = /((?:["']auth["'][ \t]*:[ \t]*["']|\b[Bb]asic[ \t]+))([A-Za-z0-9+/]{8,200}={0,2})(?![A-Za-z0-9+/=])/g
// A Kubernetes bootstrap token: `abcdef.0123456789abcdef`.
const BOOTSTRAP = /\b([a-z0-9]{6})\.([a-z0-9]{16})\b/g

// Inline media in a data: URI. Only media types: a key put in a JSON or text
// data URI is still scanned. The length floor stops a short key placed after
// a fake image prefix from being excused.
const DATA_URI =
  /data:(?:(?:image|font|audio|video)\/[\w.+-]+|application\/(?:x-)?font-[\w.+-]+|application\/vnd\.ms-fontobject)(?:;[\w-]+=[\w.-]+)*;base64,[A-Za-z0-9+/]{64}[A-Za-z0-9+/]*={0,2}/g

// A base64 blob: one long run, or three or more wrapped lines (a PEM bundle,
// a MIME part). A trailing short line is only taken when a blank line, a
// `--boundary` or the end of the text follows it.
const B64_LINE = String.raw`[A-Za-z0-9+/]{40}[A-Za-z0-9+/]*={0,2}\r?\n`
const BLOB = new RegExp(
  String.raw`(?<![A-Za-z0-9+/=])(?:(?:${B64_LINE}){3}(?:${B64_LINE})*(?:[A-Za-z0-9+/]+={0,2}(?=\r?\n[\r\n-]|\r?\n?$))?|[A-Za-z0-9+/]{256}[A-Za-z0-9+/]*={0,2})`,
  'g',
)
const BLOB_NAME =
  /(?:key|token|secret|password|passwd|credential|auth|private|signature|session|cookie|dsn|cert[_-]?key)[\w.-]*["'\]\s]{0,4}[:=]{1,2}\s*["'`]?\s*$/i
const BLOB_INNER = /PRIVATE KEY|OPENSSH|"private_key"|"client_secret"|"refresh_token"|"password"|"auths"/

// A Claude thinking-block signature, and a redacted thinking block: opaque
// to everyone and useless as a credential. Only the value is parked; the
// thinking text beside it is still scanned.
const THINKING_SIG =
  /("type"\s*:\s*"thinking"\s*,\s*"thinking"\s*:\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*,\s*"signature"\s*:\s*")([A-Za-z0-9+/]{200}[A-Za-z0-9+/]*={0,2})(?=")/g
const REDACTED_THINKING = /("type"\s*:\s*"redacted_thinking"\s*,\s*"data"\s*:\s*")([A-Za-z0-9+/]{100}[A-Za-z0-9+/]*={0,2})(?=")/g

// A lockfile or SRI integrity hash: exact digest lengths only, so a key
// glued after `sha256-` is still judged.
const SRI = /\bsha(?:1-[A-Za-z0-9+/]{27}=|256-[A-Za-z0-9+/]{43}=|384-[A-Za-z0-9+/]{64}|512-[A-Za-z0-9+/]{86}==)(?![A-Za-z0-9+/=])/g

// Public font files: the file name is a hash, not a secret. Path characters
// only, so a query string on the same URL is still scanned.
const PUBLIC_URL = /https:\/\/fonts\.gstatic\.com\/[A-Za-z0-9_/.-]+/g

// Mail: an optional `cat -n`, Read or `grep -n` prefix on each line.
const PFX = String.raw`(?:[ \t]*\d+\t|[^\s:]+:\d+[:-])?`
const PFX_RE = new RegExp(`^${PFX}`)
const CTE = new RegExp(String.raw`^${PFX}Content-Transfer-Encoding:[ \t]*base64[ \t]*\r?$`, 'gim')
const CONTENT_TYPE = new RegExp(String.raw`^${PFX}Content-Type:[ \t]*(?:\r?\n${PFX}[ \t]+)?([^;\s]+)`, 'im')
const MAIL_HEADER_NAMES =
  'DKIM-Signature|X-Google-DKIM-Signature|ARC-Seal|ARC-Message-Signature|ARC-Authentication-Results|Authentication-Results|Message-I[Dd]|References|In-Reply-To|Feedback-ID|X-SG-EID|X-SG-ID|X-MSFBL|X-Gm-Message-State|X-Google-Smtp-Source|X-Gm-Gg|X-Gm-Features|X-Received|Received-SPF|Return-Path|Received'
const MAIL_HEADER = new RegExp(String.raw`^${PFX}(?:${MAIL_HEADER_NAMES}):[^\n]*(?:\r?\n${PFX}[ \t][^\n]*){0,12}`, 'gm')
const HEADER_LINE = new RegExp(String.raw`^${PFX}[A-Z][A-Za-z0-9-]*:`)
const ENCODED_WORD = /=\?[\w-]+\?[Bb]\?[A-Za-z0-9+/=]{4}[A-Za-z0-9+/=]*\?=/g
const BOUNDARY = /Content-Type:[ \t]*multipart\/[^\n]*?(?:\r?\n[ \t][^\n]*?)?\bboundary="?([^"\s;]+)"?/gi

// The generic scan. A slash-bearing base64 run (an AWS secret, `openssl rand
// -base64`) is judged whole first; anything else is cut into candidate
// tokens. `/` and `.` are left out of a candidate on purpose: with them in,
// every long file path becomes one. A token never starts inside a `%XX`
// escape, and `=` only counts as padding when nothing follows it.
const CAND_CHAR = '[A-Za-z0-9+_-]'
const CAND_MAX = 200
const CAND_BODY = String.raw`${CAND_CHAR}{12,${CAND_MAX}}(?:={1,2}(?![A-Za-z0-9=]))?`
const CANDIDATE_SRC = String.raw`(?<=%[0-9A-Fa-f]{2})(?<!%25)${CAND_BODY}|(?<=%25[0-9A-Fa-f]{2})${CAND_BODY}|(?<!%[0-9A-Fa-f]?|%25[0-9A-Fa-f]?)${CAND_BODY}`
const SLASHED_SRC = String.raw`(?<![A-Za-z0-9+/_.%~-])[A-Za-z0-9+/]{20,300}={0,2}(?![A-Za-z0-9+/=_.%~-])`
const CANDIDATE = new RegExp(CANDIDATE_SRC, 'g')
const SCAN = new RegExp(`(${SLASHED_SRC})|${CANDIDATE_SRC}`, 'g')

// A name to the left of the candidate that says the candidate is a key:
// `API_KEY=`, `"token":`, an escaped `\"token\":`, `&quot;token&quot;:`,
// `Authorization: Bearer `, `Authorization: <any scheme> `, `--api-key `, a
// table cell, a YAML block, a Go header map `X-Api-Key:[`, a Python header
// tuple `('X-Api-Key', '`. `PAT` is a personal access token, not `PATH`.
const NAME_WORDS =
  'key|token|secret|password|passwd|pwd|credential|auth|bearer|private|signature|session|cookie|dsn|salt|nonce|otp|sess(?:ion)?[_-]?id|(?<![A-Za-z])sid|(?<![A-Za-z])sig|(?<![A-Za-z])pat(?![a-z])'
const Q = String.raw`(?:\\{0,3}["'${'`'}]|&(?:quot|apos|#0*3[49]|#x0*2[27]);|\\u00(?:22|27))`
const NAMED = new RegExp(
  '(?:' +
    String.raw`(?:${NAME_WORDS})(?:(?<=key)[_-]?id)?(?:${Q}|\]|\s){0,6}[:=]{1,2}(?:${Q}|\s){0,4}\[?` +
    String.raw`|(?:${NAME_WORDS})[\w-]{0,20}${Q}[ \t]*,[ \t]*${Q}` +
    String.raw`|\bbearer[ \t]+["']?` +
    String.raw`|authorization["']?[ \t]*[:=][ \t]*["']?(?:[A-Za-z][\w-]{0,31}[ \t]+)?` +
    String.raw`|(?:^|\s)--?(?![a-z_-]*(?:public|pub|cache|idempotency|signing|recv)[_-]?key)[a-z_-]*(?:key|token|secret|password|passwd|pw|auth)[ \t]+["']?` +
    String.raw`|\|[ \t]*[\w.-]*(?:key|token|secret|password)[ \t]*\|[ \t]*` +
    String.raw`|(?:key|token|secret|password|passwd|pwd|credential|auth)[\w-]*["']?[ \t]*:[ \t]*[>|][-+1-9]{0,2}[ \t]*\r?\n[ \t]+` +
    ')$',
  'i',
)

// What a hide by the generic scan rests on. The scan cuts a token at `.`,
// `%XX`, `:` and `/`, so a token may be one fragment of a credential, and
// what stands right beside a fragment says nothing of its place. So the
// evidence is read over the unbroken run the token stands in, on both sides
// of it. A run ends at whitespace, a quote character, a backtick, `<` or
// `>`, the characters URL_PASSWORD refuses inside a password. The run is
// the back run, the token and the forward run, and each side is read no
// further than RUN_MAX characters. The hide is `named` where any of these
// holds, and `shape` otherwise:
//   1. A key's name stands right before the token, as NAMED reads it in
//      the 64 characters before the token.
//   2. The whole run is RUN_MAX characters long or longer, measured on the
//      text the scan reads, after earlier hides and after parkOpaque and
//      parkMedia park their spans as short markers, a side read to its
//      bound without a break among such runs, so what stands past it is
//      unread.
//   3. A key's name, as NAMED reads one, stands right before the
//      run or inside it on either side of the token. NAMED_IN_RUN is NAMED
//      with the rest of the back run let through after the name, read from
//      64 characters before the back run. NAMED_AHEAD is NAMED's body
//      starting inside the forward run, read up to 64 characters past the
//      run so a name's own quote and separator are taken. A name in the
//      text before the back run that the back run does not follow at once
//      is not read: `token=abc see <token>` stays `shape`.
//   4. The run holds `://` with an `@` after it, on either side of the
//      token or one on each side.
//   5. The token fills a URL's credential position, as inUrlCredential
//      reads one.
// The rule errs toward `named`, so a token that shares one unbroken run
// with a key's name, or with `://` and an `@` after it, is marked though it
// is no credential: `https://host/p/<token>@v2`, `?token=abc&ref=<token>`
// and `key: https://host/a/<token>` are such texts. Eight forms stay `shape`
// though a key's name or a URL credential stands near the token:
//   a. A token after whitespace inside a quoted value under a key's name,
//      which stands in a run of its own.
//   b. A token in a URL's user part or password where that part holds a
//      run-ending character and that character is whitespace, or the
//      token is not the whole part, or the user part before it is over 80
//      characters, or the password after it is over 200 characters or
//      holds a slash, or the URL's scheme is one inUrlCredential does not
//      read.
//   c. A token in an XML element named for a key, or in an attribute whose
//      sibling attribute names one, as `<entry name="token" value="...">`.
//   d. A token inside a URL written without a scheme, starting at `//`.
//   e. A token beside a key's name in a form NAMED does not read, where
//      passphrase, pass, passcode and pw mid-line, a camelCase URL
//      parameter, a percent-encoded name, and a name that starts inside
//      the token are among them.
//   f. A token beside a key's name that padding puts out of reach: the
//      name starts more than 64 characters before the run, or what NAMED
//      reads after a name that follows the token ends more than 64
//      characters past the run's end.
//   g. A token in a run whose `://` an earlier hide took, as the hide of
//      a whole Slack or Discord webhook URL takes it.
//   h. A token in a run that holds parked text, where the parked text held
//      the key's name or carried the run to RUN_MAX characters.
// This changes only what a hide records, never what is hidden.
const RUN_MAX = 512
const RUN_BREAK = /[\s"'`<>]/
const NAMED_IN_RUN = new RegExp(`${NAMED.source.slice(0, -1)}[^${RUN_BREAK.source.slice(1)}{0,${RUN_MAX}}$`, 'i')
const NAMED_AHEAD = new RegExp(`^[^${RUN_BREAK.source.slice(1)}{0,${RUN_MAX}}?(?=[^${RUN_BREAK.source.slice(1)})${NAMED.source.slice(0, -1)}`, 'i')
function scanEvidence(whole: string, offset: number, end: number): Evidence {
  if (NAMED.test(whole.slice(Math.max(0, offset - 64), offset))) return 'named'
  let start = offset
  const floor = Math.max(0, offset - RUN_MAX)
  while (start > floor && !RUN_BREAK.test(whole[start - 1]!)) start--
  const ahead = whole.slice(end, end + RUN_MAX)
  const stop = ahead.search(RUN_BREAK)
  const runEnd = end + (stop === -1 ? ahead.length : stop)
  if (runEnd - start >= RUN_MAX) return 'named'
  const run = whole.slice(start, runEnd)
  const scheme = run.indexOf('://')
  if (scheme !== -1 && run.includes('@', scheme + 3)) return 'named'
  if (inUrlCredential(whole, offset, end)) return 'named'
  if (NAMED_IN_RUN.test(whole.slice(Math.max(0, start - 64), offset))) return 'named'
  if (NAMED_AHEAD.test(whole.slice(end, runEnd + 64))) return 'named'
  return 'shape'
}

// A sibling field name that makes its value a key: the value is then
// judged as if the name stood right before it.
const KEY_NAME = new RegExp(String.raw`(?:${NAME_WORDS}|authorization)`, 'i')

const HEX_ONLY = /^[0-9a-f]+$/i
const PREFIXED_KEY = /^[a-z]{2,12}(?:_v[0-9])?[_-]([a-z0-9]{32,})$/
const DIGITS_ONLY = /^[0-9]+$/
const LETTERS_ONLY = /^[A-Za-z]+$/

// Public ids with a shape rather than a prefix: a YouTube channel or
// playlist, a Monzo transaction, a Vercel deployment, team or project, an
// OpenAI org, a Claude Code session, environment or server tool call. Exact
// lengths only, and the Anthropic ids start `01`, so any other token after
// the same prefix is still judged.
const PUBLIC_SHAPE =
  /^(?:UC[A-Za-z0-9_-]{22}|PL[A-Za-z0-9_-]{16,32}|(?:tx|mm|acc|pot|merch|user)_0000[A-Za-z0-9]{18}|dpl_[A-Za-z0-9]{24,32}|org-[A-Za-z0-9]{24}|team_[A-Za-z0-9]{24}|prj_[A-Za-z0-9]{28}|(?:session|env|srvtoolu)_01[A-Za-z0-9]{22})$/

// Prefixes that name a PUBLIC object id, not a key. Stripe hands these out in
// dashboards, invoices and source code; hiding them makes a session useless
// and protects nothing. `pk_live_` is Stripe's publishable key, also public.
// The vendors write these prefixes in lowercase, so the list matches by case
// and an uppercase one, such as `PROD_`, names no public id. The detect
// suite's public-prefix check holds its own copy of this list, so a prefix
// added here is added there too.
const PUBLIC_PREFIX =
  /^(?:price|prod|cus|sub|sched|in|ch|pi|cs|py|re|txn|il|si|seti|evt|acct|promo|coupon|plan|card|ba|src|dp|du|iv|ii|rcpt|file|link|pm|tok|pk|test|toolu|msg|req|run|wf)_/
// A public id is the prefix, maybe `live_` or `test_`, then one alnum body.
// `prod_api_key_<random>` is not that shape, so it is judged like any token.
const PUBLIC_ID_BODY = /^(?:(?:live|test)_)?[A-Za-z0-9]+$/
// A WooCommerce consumer secret reuses Stripe's `cs_`; Stripe's never is
// 40 lowercase hex.
// A Klaviyo private key reuses `pk_`, with no `live_` or `test_` after it.
const NOT_PUBLIC = /^cs_[a-f0-9]{40}$|^pk_(?!live_|test_)[A-Za-z0-9]{34}$/
// Generic prefixes a key name in front may override (`API_KEY=test_...`).
const SOFT_PUBLIC = /^(?:test|tok)_/i

// A name written in code (`archived-modules-marker`, `handleCheckoutSession`,
// `lesson_article_outline_open_v1`) reads as high entropy but is a word list.
// A key is not built out of words.
const WORD_PART = /^(?:[a-z]+[0-9]{0,3}|[A-Z][a-z]+[0-9]{0,3}|[A-Z]{2,})$/
const ALNUM_ONLY = /^[A-Za-z0-9]+$/
const SEGMENTS = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g
const WORDY = /^[A-Za-z]?[a-z]{2,}$/
const SLASH_WORD = /^(?:[a-z]+[0-9]{0,3}|[A-Z][a-z]+[0-9]{0,3})$/
const STRICT_CAMEL = /^(?:[a-z]{2,}|[A-Z][a-z]{2,})(?:[A-Z][a-z]{2,})+[0-9]{0,3}$/

// `playerEventBatchV1Schema` splits into six segments of which four are
// words; a random key splits into many segments of which almost none are.
// A camel name has a capital in it: an all-lowercase token with a digit run
// in the middle is a random value more often than a name.
function isCamelName(token: string): boolean {
  if (!ALNUM_ONLY.test(token) || !/[A-Z]/.test(token)) return false
  const segs = token.match(SEGMENTS)
  if (!segs || segs.join('') !== token) return false
  const words = segs.filter((seg) => WORDY.test(seg)).length
  return words >= 2 && words >= segs.length - 2
}

// Every character used once AND mostly in alphabet order: a charset constant.
// The order test matters: a random 24-character key has all distinct
// characters about 1% of the time.
function isAlphabet(token: string): boolean {
  if (token.length < 20) return false
  let runs = 0
  for (let i = 1; i < token.length; i++) if (token.charCodeAt(i) === token.charCodeAt(i - 1) + 1) runs++
  return runs * 2 >= token.length && new Set(token).size === token.length
}

// Half or more of the characters follow the one before in code order:
// `0123456789abcdef`, the base64 alphabet. A sample in docs, never a key.
function countsUp(s: string): boolean {
  let runs = 0
  for (let i = 1; i < s.length; i++) if (s.charCodeAt(i) === s.charCodeAt(i - 1) + 1) runs++
  return runs * 2 >= s.length
}

function isMixed(s: string): boolean {
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s)
}

// One word, or a number of up to four digits (a year, a month, a day).
function isSlugPart(part: string): boolean {
  return WORD_PART.test(part) || /^[0-9]{1,4}$/.test(part)
}

// A part made only of words, short acronyms and short numbers: `expenseID`,
// `2026`, `v2Final`. It names something; it is not a random remainder.
function isWordish(part: string): boolean {
  const segs = part.match(SEGMENTS)
  if (!segs || segs.join('') !== part) return false
  return segs.every((seg) => WORDY.test(seg) || /^[A-Z]{2,4}$/.test(seg) || /^[0-9]{1,4}$/.test(seg))
}

function looksLikeName(token: string, named: boolean): boolean {
  if (isCamelName(token)) return true
  // A name beside the token outweighs the alphabet rule.
  if (!named && isAlphabet(token)) return true
  const parts = token.split(/[_-]/)
  if (parts.length < 2) return false
  // Beside a key's name, one key-like part makes the whole token a key:
  // `django-insecure-<random>`, `live-secret-<random>`.
  if (named && parts.some((p) => p.length >= 16 && /[0-9]/.test(p) && /[A-Za-z]/.test(p) && entropy(p) >= 3.0)) return false
  // A long random remainder outweighs any words in front of it
  // (`vercel_blob_rw_<random>`, `dckr_pat_<random>`). Mixed case is asked
  // for, so a hex cache key or a timestamp is not a remainder.
  const residue = parts.filter((p) => !WORD_PART.test(p) && !isCamelName(p) && !isWordish(p)).join('')
  // Words plus one long number (a LinkedIn post slug, a Zoom recording, an
  // Amazon ref tag): the number is an id, not part of a random remainder.
  // Only the parts that are neither words, numbers nor date stamps count,
  // and camel parts are not excused here, since a random string can pass
  // the camel test.
  const longNumber = !named && parts.some((p) => /^[A-Z]{0,4}[0-9]{6,}$/.test(p))
  const randomPart = longNumber ? parts.filter((p) => !WORD_PART.test(p) && !/^[0-9]{1,4}$/.test(p) && !DIGITS_ONLY.test(p) && !DATE_STAMP.test(p)).join('') : ''
  if ((longNumber ? (randomPart.length >= 8 ? 16 : 0) : residue.length) >= 16 && isMixed(residue)) return false
  // Words, dates and short numbers only (`2025-08-26-lesson`): a slug.
  if (parts.every(isSlugPart)) return true
  // Three or more separated parts, two of them plain words: a naming
  // convention (`META_Conv_Lookalike-Customers_FreeTrial_2024Q1`), not a key.
  if (parts.length >= 3 && parts.filter((p) => /^[A-Za-z]{4,}$/.test(p)).length >= 2) return true
  return longNumber && randomPart.length < 8
}
const DATE_STAMP = /^[A-Z]{0,4}(?:19|20)[0-9]{6}$/

function isPublicId(token: string, named: boolean, cfg: Config): boolean {
  if (PUBLIC_SHAPE.test(token)) return true
  if (cfg.allowPrefix.some((p) => token.startsWith(p))) return true
  if (!PUBLIC_PREFIX.test(token) || NOT_PUBLIC.test(token)) return false
  if (cfg.denyPrefix.some((p) => token.startsWith(p))) return false
  if (named && SOFT_PUBLIC.test(token)) return false
  return PUBLIC_ID_BODY.test(token.replace(PUBLIC_PREFIX, ''))
}

// A letters-only key (no digit at all) splits into many short camel
// segments; a camel name of the same length splits into a few long ones.
function lettersLookRandom(token: string, named: boolean, h: number): boolean {
  if (!LETTERS_ONLY.test(token) || !/[a-z]/.test(token) || !/[A-Z]/.test(token)) return false
  const segs = token.match(SEGMENTS) ?? []
  if (named && token.length >= 20 && h >= 3.6 && segs.length * 4 >= token.length) return true
  return token.length >= 24 && h >= 4.0 && segs.length * 3 >= token.length
}

// Claude Code transcripts and most analytics put a `sessionId` UUID on every
// line, and a persona registry entry puts one after `Session:`. A UUID beside
// a session name is an identifier, not a credential; a real session cookie is
// random text, and the cookie rules hide it on their own. A name ending in
// `id` (`sessionId`, `session_id`, `X-Session-Id`, `sessid`) counts wherever
// it stands. The bare `session`, `sess` or `sid` counts only where no letter,
// digit, `_` or `-` stands before it, so `Session:`, `session=` and `sid=`
// pass while `X-Session:`, `client_session=`, `account_sid=` and `assess:`
// are judged as any other named token, as is a UUID after a key, token,
// secret or password name.
const SESSION_UUID = new RegExp(`^${UUID}$`, 'i')
const SESSION_ID_NAME = new RegExp(String.raw`(?:sess(?:ion)?[_-]?id|(?<![A-Za-z0-9_-])sess(?:ion)?|(?<![A-Za-z0-9_-])sid)(?:${Q}|\s){0,6}[:=]{1,2}(?:${Q}|\s){0,4}$`, 'i')

// A persona record id has the shape of the id operator.ts mints for an inbox
// record: `<persona>-<session uuid>-<seq>`, a name, a lowercase session UUID
// and a decimal sequence, and nothing else. Each part of the name, split on
// `_` and `-`, is a word, a short acronym, a short number, an all-caps word
// with up to three digits, or a single letter. An uppercase persona name would
// otherwise read as a mixed-case key. A record id right after a key's name is
// judged as before. So is a persona name outside those forms, such as one that
// opens with a digit or holds a dot or a non-ASCII letter, and a UUID with no
// numeric tail. The passes that hide a known value again leave one as written
// where it was hidden by its shape alone and only opens a longer token that
// is a whole record id, as opensRecordId states. A known value hidden on any
// other evidence, a key's name beside it among such evidence, is hidden
// whatever it opens. That evidence is recorded only where a named site
// mints, so a value first hidden by its shape alone and met only in a later
// scan in a run that holds a key's name, as NAMED reads one, or a
// URL's credential part on either side of it is still left as written
// there.
const RECORD_ID = new RegExp(`^([A-Za-z][A-Za-z0-9_-]*)-${UUID}-[0-9]+$`)
const CAPS_OR_LETTER_PART = /^[A-Za-z]$|^[A-Z]{2,}[0-9]{0,3}$/

function isRecordId(token: string): boolean {
  const m = RECORD_ID.exec(token)
  return m !== null && m[1].split(/[_-]/).every((part) => isSlugPart(part) || isWordish(part) || CAPS_OR_LETTER_PART.test(part))
}

const CAND_CHAR_ONLY = new RegExp(`^${CAND_CHAR}$`)
const CAND_RUN = new RegExp(`^${CAND_CHAR}*`)
const LOWER_NAME_UUID = new RegExp(`^[a-z0-9_-]+-${UUID}$`)

// True where the known value found at `at` in `text` only opens a token that
// is a whole record id. The two passes that hide a known value again,
// rehideKnown and rehideLocal, ask before they hide a match and leave a
// spared one as written. A title or a detail line cut to a fixed width
// through a record id leaves an uppercase name and part of a UUID, which is
// hidden as a key and remembered. Without this that piece would rewrite the
// opening of every id that starts the same way, and a store surface would
// refuse the id as a secret. A match is spared where all five hold:
//   1. No candidate character stands right before it, so it opens a token. A
//      known value found further in is hidden: a UUID the vault holds as a
//      key is still a key inside an id.
//   2. The token, which is the match and the run of candidate characters
//      after it, is longer than the value and is a record id. A value that
//      is the whole token was hidden on evidence of its own, such as a key's
//      name beside it, and that evidence stands. The run is read no further
//      than CAND_MAX characters past the match's start, the longest
//      candidate the scan takes, and a token that passes it is not spared.
//   3. The value was not seeded. A seeded value is a real secret on the
//      caller's word, and is hidden whatever it opens.
//   4. The value is not a lowercase name, a dash and a whole UUID. That is
//      the shape of a vendor key, whose prefix is lowercase, and a real key
//      followed by a dash and digits must stay hidden.
//   5. The value was hidden by its shape alone: the generic scan passed it,
//      scanEvidence found no key's name, as NAMED reads one, and no URL
//      credential part in the unbroken run it stood in, read on both sides
//      of it, the value was neither the whole user part nor the whole
//      password of a URL, the run was shorter than 512 characters, measured
//      on the text the scan read, after earlier hides and parking, and no
//      other hide ever took it. Eight forms can each pass that test though a
//      key's name or a URL credential stands near, as scanEvidence lists
//      them: a value after whitespace inside a quoted value under a key's
//      name; a value in a URL's user part or password where that part holds
//      a run-ending character and that character is whitespace, or the
//      value is not the whole part, or the user part before it is over 80
//      characters, or the password after it is over 200 characters or holds
//      a slash, or the URL's scheme is one inUrlCredential does not read; a
//      value in an XML element named for a key or in an attribute whose
//      sibling attribute names one; a value inside a URL written without a
//      scheme, starting at `//`; a value beside a key's name in a form NAMED
//      does not read, where passphrase, pass, passcode and pw mid-line, a
//      camelCase URL parameter, a percent-encoded name, and a name that
//      starts inside the value are among them; a value beside a key's name
//      that padding puts out of reach, where the name starts more than 64
//      characters before the run or what NAMED reads after a name that
//      follows the value ends more than 64 characters past the run's end; a
//      value in a run whose `://` an earlier hide took; and a value in a run
//      that holds parked text, where the parked text held the key's name or
//      carried the run to 512 characters. A value hidden on any other
//      evidence is a secret on that evidence, whatever it opens. The mark
//      lands only where a named site mints, so a value first hidden by its
//      shape alone and met in such a run only in a later scan stays
//      spareable. A value that carries no mark is read as one hidden on
//      other evidence, so a hide that
//      marks nothing fails closed. The passes that hide a known value again
//      mark nothing, or a cut hidden again where it stands cut would stop
//      being spared.
// A spared token reaches the later passes and is judged there as it would be
// on a vault that never held the value, and no placeholder stands there for
// widenKnown to widen. A match that is not spared is hidden alone, and
// widenKnown then hides with it the fixed-format match, slash run or token
// it stands in where the value is distinctive, as knownSpan states. A slash
// run or token so hidden joins no search: a longer token that opens with a
// cut would carry no mark there and hide every later id it opens.
function opensRecordId(text: string, at: number, value: string): boolean {
  if (at > 0 && CAND_CHAR_ONLY.test(text[at - 1]!)) return false
  if (seeded.has(value) || !shapeOnly.has(value) || namedHide.has(value)) return false
  const end = at + value.length
  // Read one character past the longest candidate, so a run that passes it
  // is told from one that ends on it.
  const tail = CAND_RUN.exec(text.slice(end, at + CAND_MAX + 1))![0].length
  if (tail === 0 || value.length + tail > CAND_MAX) return false
  if (LOWER_NAME_UUID.test(value)) return false
  return isRecordId(text.slice(at, end + tail))
}

// SLASHED_SRC read from one position, with the character its body takes and
// the longest body it takes, both read from the pattern's own source so they
// cannot part from it.
const SLASHED_AT = new RegExp(SLASHED_SRC, 'y')
const SLASHED_BODY = /(\[[^\]]+\])\{\d+,(\d+)\}/.exec(SLASHED_SRC)!
const SLASHED_CHAR_ONLY = new RegExp(`^${SLASHED_BODY[1]}$`)
const SLASHED_BODY_MAX = Number(SLASHED_BODY[2])

// The start and end of the text widenKnown hides for the distinctive known
// value that stands at `at` in `text`, the text around its placeholder with
// the value put back, where the value stands inside no fixed-format match.
// widenKnown hides a value with the text that makes one key with it, found
// in three steps:
//   1. The fixed format. Where the value stands inside a match of a vendor
//      pattern, or inside a JWT the chain walk finds, the whole match is
//      hidden, as readFixed reads it and widenKnown hides it. Where the
//      value only shares characters with the match, the match and the
//      value's placeholder are hidden as one. A fresh
//      session hides such a key whole across a character outside the token
//      set, the dot in a `pat` key among them, and the token alone stops at
//      that character.
//   2. The slash run. Where the value stands inside a run SLASHED_SRC
//      matches, the run holds a slash and slashedSecret passes it, the whole
//      run is hidden. The key's name is read from the 64 characters before
//      the run through NAMED, as the generic scan reads it, and the scan's
//      protected spans are not read.
//   3. The token. Otherwise the value is hidden with every candidate
//      character that touches it on either side. A token of more than
//      CAND_MAX characters hides the value alone. The token ends before a
//      key's name, as nameStop reads one.
// This function reads steps 2 and 3. The span never starts before `floor`,
// the end of the text that may not be hidden again, though the slash step
// still judges the whole run. A value whose span is exactly the session's
// own id, which mint hands back as written, is hidden alone.
function knownSpan(text: string, at: number, value: string, floor: number, cfg: Config): [number, number] {
  const end = at + value.length
  let from = at
  let to = end
  let slashed = false
  // No slash within a body's length of the value means no run that holds
  // both. A run starts where the body characters before the value start.
  if (text.slice(Math.max(0, at - SLASHED_BODY_MAX), end + SLASHED_BODY_MAX).includes('/')) {
    let s = at
    while (s > 0 && at - s <= SLASHED_BODY_MAX && SLASHED_CHAR_ONLY.test(text[s - 1]!)) s--
    SLASHED_AT.lastIndex = s
    const run = SLASHED_AT.exec(text)?.[0]
    if (run !== undefined && s + run.length >= end && run.includes('/') && slashedSecret(run, NAMED.test(text.slice(Math.max(0, s - 64), s)), cfg)) {
      from = s
      to = s + run.length
      slashed = true
    }
  }
  if (!slashed) {
    // Read one character past the longest candidate, as opensRecordId does.
    to += CAND_RUN.exec(text.slice(end, at + CAND_MAX + 1))![0].length
    while (from > 0 && to - from <= CAND_MAX && CAND_CHAR_ONLY.test(text[from - 1]!)) from--
    if (to - from > CAND_MAX) return [at, end]
    to = nameStop(text, end, to)
  }
  from = Math.max(from, floor)
  if (ownSessionId !== undefined && text.slice(from, to).toLowerCase() === ownSessionId) return [at, end]
  return [from, to]
}

// The first character after a token's run that can open what a name stands
// before: a candidate character or a slash.
const NAME_NEXT = new RegExp(`${CAND_CHAR}|/`)
// A name word with its colon or equals sign: the word, then at most a
// closing quote and spaces or tabs, then the sign. Read from the position
// NAMED found a name at.
const NAME_SIGN = new RegExp(String.raw`(?:${NAME_WORDS})(?:(?<=key)[_-]?id)?(?:${Q})?[ \t]*[:=]`, 'iy')

// Where the token's text after the known value, which ends at `end`, holds
// the start of a key's name that NAMED reads for what follows the token,
// and that name is a name word right before a colon or an equals sign, as
// NAME_SIGN reads one, the token ends at the name's first character, so
// the name stays on screen beside the value the detectors hid after it.
// A name word that stands before no such sign, inside a list item or before
// a space among such spots, ends no token, since a key's own rest may hold
// one. NAMED reads from `end` up to the first candidate or slash character
// after the token, and no further back than 64 characters before that
// character, the reach the generic scan gives it. Returns `to` where no
// such name starts in the token.
function nameStop(text: string, end: number, to: number): number {
  if (to === end) return to
  let next = to
  while (next < text.length && next - to < 64 && !NAME_NEXT.test(text[next]!)) next++
  const base = Math.max(end, next - 64)
  if (base >= to) return to
  const read = text.slice(base, next)
  const name = NAMED.exec(read)
  if (name === null || base + name.index >= to) return to
  NAME_SIGN.lastIndex = name.index
  return NAME_SIGN.test(read) ? base + name.index : to
}

// How far before and after a known value's placeholder widenKnown reads,
// and how far before a stretch a pattern's look-behind may read, the reach
// the generic scan gives NAMED.
const FIXED_REACH = 4096
const FIXED_LOOK_BACK = 64
// One test for the JWT walk's hint and every vendor pattern's, read from
// the hints themselves, so a stretch that holds none costs one read.
const FIXED_HINT = new RegExp(['eyJ', ...VENDOR.map((v) => v.hint)].map((h) => (typeof h === 'string' ? h.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&') : h.source)).join('|'))
// The characters that end a stretch: a space, a control character, a
// character past ASCII, and the quotes, brackets and backslash below. No
// vendor pattern or DOTTED run takes one into its match, though a pattern's
// look-behind may read one, so a pattern searched from the character after
// one finds the matches a scan of the whole text finds there. A JSON or
// markup line so falls into one stretch per value.
const FIXED_EDGE = new Uint8Array(127)
for (let c = 0; c <= 32; c++) FIXED_EDGE[c] = 1
for (const c of `"'\`<>{}()\\`) FIXED_EDGE[c.charCodeAt(0)] = 1
function fixedEdge(c: number): boolean {
  return c >= 127 || FIXED_EDGE[c] === 1
}

// The fixed-format step for the stretch of `text` from `s` to `e`, which
// holds a stretch end only inside a put-back value. `found` is told the start and end
// of every fixed-format match that starts in the stretch: each JWT the
// chain walk finds, then each vendor pattern's matches, in the order a scan
// asks the patterns, so the first match told that holds a value is the one
// a scan would hide it under. The JWT walk and the vendor patterns are asked
// as scrubSecrets asks them: the walk over each DOTTED run, each pattern
// behind its hint, with the FIXED_LOOK_BACK characters before the stretch
// for a pattern's look-behind, and a match scrubVendors or the walk leaves
// as written, for the allow list, is no match here.
function readFixed(text: string, s: number, e: number, cfg: Config, found: (from: number, to: number) => void): void {
  const base = Math.max(0, s - FIXED_LOOK_BACK)
  const part = text.slice(base, e)
  if (!FIXED_HINT.test(part)) return
  // Every match of `re` from the stretch's start. The patterns are shared,
  // so the search leaves each at its start.
  const each = (re: RegExp, match: (m: RegExpExecArray) => void): void => {
    re.lastIndex = s - base
    for (let m = re.exec(part); m !== null; m = re.exec(part)) match(m)
    re.lastIndex = 0
  }
  if (part.includes('eyJ')) {
    each(DOTTED, (run) => {
      scrubJwtChain(run[0], cfg, (jwt, o) => {
        found(base + run.index + o, base + run.index + o + jwt.length)
        return jwt
      })
    })
  }
  for (const { hint, re } of VENDOR) {
    if (typeof hint === 'string' ? !part.includes(hint) : !hint.test(part)) continue
    each(re, (m) => {
      if (!keptByVendors(m[0], cfg)) found(base + m.index, base + m.index + m[0].length)
    })
  }
}

// A wiki fed name has the shape the wiki feeder writes into an inbox:
// `<source>--<path>--<hash7>.<ext>`, the feed source's name, the upstream
// path with each slash turned into two dashes and its extension dropped, the
// first seven hex characters of the blob sha, and the extension. The generic
// scan's token ends at the dot, so the extension is outside the token this
// check receives. The optional extension group, of one to ten letters or
// digits, only admits a dotted name a caller might pass whole. The source is
// the first two-dash segment and the hash the last, so the path may hold
// two-dash joins of its own. The two-dash joins are matched first and each
// run of letters and digits is split on single dashes after, so no part is
// empty: a triple dash, a leading or trailing dash, or a hash of any other
// length or case leaves the token judged as before. Each part of the source
// is a word or a short number, and each part of the path is a word, a short
// acronym, a short number, an all-caps word with up to three digits, or a
// single letter. A fed name right after a key's name is judged as before.
const FED_NAME = /^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)--([A-Za-z0-9]+(?:-{1,2}[A-Za-z0-9]+)*)--([0-9a-f]{7})(?:\.[A-Za-z0-9]{1,10})?$/

function isFedName(token: string): boolean {
  const m = FED_NAME.exec(token)
  return (
    m !== null &&
    m[1]!.split('-').every(isSlugPart) &&
    m[2]!.split(/-+/).every((part) => isSlugPart(part) || isWordish(part) || CAPS_OR_LETTER_PART.test(part))
  )
}

// A GitHub node id is the id the host's GraphQL interface prints for a
// record such as a pull request, an issue, a comment or a branch. Its shape,
// whole: one to six uppercase letters, an underscore, an opening, and a body
// of 4 to 100 characters, each a letter, a digit, `_` or `-`. The text after
// the underscore is base64 with no padding, and it encodes a short list. The
// list's first byte is 0x92, 0x93 or 0x94, for a list of two, three or four
// items. A zero and a 32-bit number follow, which gives the three openings
// `kgDO`, `kwDO` and `lADO`. Up to two more items follow, each under one of
// four marks: 0xce, a 32-bit number; 0xcf, a 64-bit number; 0xa0 to 0xbf, a
// string under 32 bytes; 0xda, a string with a 16-bit length. The list ends
// where the text ends. A token is a node id only where its text decodes as
// that list, whole: a decode that runs short, any other mark, or a list that
// ends before or after the text leaves the token judged as any other. So a
// key joined onto an id by a hyphen or an underscore is judged as any other
// token, and so is a random body behind a real opening unless it happens to
// decode as such a list. One letter, digit, `_` or `-` joined after an id
// whose text length divides by 4 adds no byte, so that token still reads as a
// node id. Capital letters joined before an id read as part of its prefix
// while the prefix stays six letters or fewer, so that token reads as a node
// id too. A token with a lowercase prefix, a prefix of seven letters, no
// underscore, any other opening or a character outside the body's set is
// judged as any other token. So is a node id right after a key's name.
const NODE_ID = /^[A-Z]{1,6}_((?:kg|kw|lA)DO[A-Za-z0-9_-]{4,100})$/

function isNodeId(token: string): boolean {
  const m = NODE_ID.exec(token)
  if (m === null) return false
  const bytes = decodeBase64Head(m[1]!)
  // The opening is the list's first byte, the zero and the mark of the
  // 32-bit number, so the read starts at that mark.
  let at = 2
  for (let left = bytes.charCodeAt(0) - 0x91; left > 0; left--) {
    if (at >= bytes.length) return false
    const mark = bytes.charCodeAt(at)
    if (mark === 0xce) at += 5
    else if (mark === 0xcf) at += 9
    else if (mark >= 0xa0 && mark <= 0xbf) at += mark - 0x9f
    else if (mark === 0xda && at + 2 < bytes.length) at += 3 + bytes.charCodeAt(at + 1) * 256 + bytes.charCodeAt(at + 2)
    else return false
  }
  return at === bytes.length
}

function looksSecret(token: string, before: string, cfg: Config): boolean {
  if (token.startsWith('REDACTED-')) return false
  if (cfg.allow.has(token) || DIGITS_ONLY.test(token)) return false
  const named = NAMED.test(before)
  if (isPublicId(token, named, cfg)) return false
  // `invoice+statements+acct_<id>`: a mail sender address made of words and
  // a public id. Each `+` part has to be one, so base64 is still judged.
  if (token.includes('+') && token.split('+').every((p) => p === '' || WORD_PART.test(p) || isPublicId(p, named, cfg))) return false
  if (named && SESSION_UUID.test(token) && SESSION_ID_NAME.test(before)) return false
  if (!named && isRecordId(token)) return false
  if (!named && isFedName(token)) return false
  if (!named && isNodeId(token)) return false
  if (looksLikeName(token, named)) return false

  const h = entropy(token)

  // A bare hex run is a git SHA or a checksum far more often than it is a
  // key, so hex needs a name beside it before it is hidden.
  if (HEX_ONLY.test(token)) return named && token.length >= 24 && h >= cfg.contextMinEntropy

  // A short lowercase prefix and a long random body (imp_ and 40 hex): a
  // vendor key no rule names. A git SHA has no prefix, so it is not caught here.
  const prefixed = token.match(PREFIXED_KEY)
  if (prefixed && /[0-9]/.test(prefixed[1]!) && /[a-z]/.test(prefixed[1]!) && entropy(prefixed[1]!) >= cfg.contextMinEntropy) return true

  if (isMixed(token) && token.length >= cfg.minLength && h >= cfg.minEntropy) return true
  if (lettersLookRandom(token, named, h)) return true
  // Next to a key's name the bar is lower, but the token still has to look
  // like a key: letters and digits together, not a word.
  const alnum = /[0-9]/.test(token) && /[A-Za-z]/.test(token)
  return named && alnum && token.length >= 16 && h >= cfg.contextMinEntropy
}

// A slash-bearing base64 run, judged on the parts that are not words, so a
// path like `uploads/2026/10/12/Report2Final` stays a path.
function slashedSecret(run: string, named: boolean, cfg: Config): boolean {
  if (cfg.allow.has(run)) return false
  const body = run.replace(/=+$/, '').replace(/^\/+/, '')
  if (!body.includes('/') || !isMixed(body) || countsUp(body)) return false
  const parts = body.split('/').filter(Boolean)
  const isWord = (p: string): boolean => SLASH_WORD.test(p) || STRICT_CAMEL.test(p) || DIGITS_ONLY.test(p)
  const words = parts.filter(isWord).length
  if (words * 2 >= parts.length) return false
  if (!isMixed(parts.filter((p) => !isWord(p)).join(''))) return false
  const h = entropy(body)
  return (body.length >= 32 && h >= 4.3) || (named && body.length >= 16 && h >= 3.6)
}

// -------------------------------------------------------------- the passes

// The longest text TAG matches, a LITERAL placeholder, and TAG read at one
// position.
const TAG_MAX = 27
const TAG_AT = new RegExp(TAG.source, 'y')

// Mints `value`, and hides no part of a placeholder that is already in the
// text. A rule whose pattern can end a value at its length bound, with
// nothing after the value that has to match, can end the value inside a run
// TAG matches, whether the vault holds that placeholder or not. `end` is
// where `value` ends in `whole`, the text the rule's pattern reads. Where
// `end` stands inside such a run, the minted value ends at the character
// before the run's opening bracket, and the part of the run the value took is
// written back after the new placeholder, so every character of the run
// stands in the output as it stood in the text. A run holds one opening
// bracket, its first character, so the nearest one before `end` is the only
// place a run that holds `end` can start. The search goes back no further
// than a run's length or the value's first character. Where the run opens
// at the value's first character, the whole value is the front of a
// placeholder already in the text, and it is returned as it stands,
// unminted. Any other value is minted as it is.
function mintBeforeTag(whole: string, end: number, value: string): string {
  const floor = Math.max(0, end - Math.min(TAG_MAX, value.length))
  let open = end - 1
  while (open >= floor && whole.charCodeAt(open) !== 91) open--
  if (open < floor) return mint('SECRET', value)
  TAG_AT.lastIndex = open
  const run = TAG_AT.exec(whole)
  if (run === null || open + run[0].length <= end) return mint('SECRET', value)
  const taken = end - open
  if (taken === value.length) return value
  return mint('SECRET', value.slice(0, -taken)) + value.slice(-taken)
}

// Mints `value` unless it is already a placeholder, allowed, or a stand-in.
// The value is judged as the rule read it. A rule whose value can end at its
// length bound with nothing after it that has to match hands in `whole`, the
// text its pattern reads, and `end`, where the value ends in that text, and
// the value is then minted by mintBeforeTag.
function pairOut(cfg: Config, head: string, value: string, tail = '', whole?: string, end = 0): string {
  if (WHOLE_TAG.test(value) || cfg.allow.has(value) || isStandIn(value)) return head + value + tail
  return head + (whole === undefined ? mint('SECRET', value) : mintBeforeTag(whole, end, value)) + tail
}

function parkOpaque(text: string): string {
  let out = text
  if (out.includes('"signature"')) out = clocked(out).replace(THINKING_SIG, (_m, head: string, sig: string) => head + park(sig))
  if (out.includes('redacted_thinking')) out = clocked(out).replace(REDACTED_THINKING, (_m, head: string, data: string) => head + park(data))
  if (out.includes('sha')) out = clocked(out).replace(SRI, (m) => park(m))
  return out
}

function scrubKeyBlocks(text: string, cfg: Config): string {
  let out = text
  if (out.includes('PRIVATE KEY')) out = clocked(out).replace(PRIVATE_KEY, (m) => (cfg.allow.has(m) ? m : mint('SECRET', m)))
  if (out.includes('Private-Lines:')) out = clocked(out).replace(PUTTY_PRIVATE, (_m, head: string, body: string) => head + mint('SECRET', body))
  return out
}

// Walks the dot-separated parts of a run: a part holding `eyJ` and the two
// parts after it are a JWT, when each is long enough. Each JWT the allow list
// does not hold is swapped for what `hide` returns for it, its placeholder
// unless the caller says otherwise. `hide` is also told where the JWT starts
// in the run, so readFixed can ask the walk where a JWT stands and hide none.
function scrubJwtChain(chain: string, cfg: Config, hide: (jwt: string, at: number) => string = (jwt) => mint('SECRET', jwt)): string {
  if (!chain.includes('eyJ')) return chain
  const segs = chain.split('.')
  const out: string[] = []
  let k = 0
  // Where segs[k] starts in the run.
  let start = 0
  while (k < segs.length) {
    const i = k + 2 < segs.length ? segs[k]!.indexOf('eyJ') : -1
    if (i >= 0 && segs[k]!.length - i >= 11 && segs[k + 1]!.length >= 8 && segs[k + 2]!.length >= 8) {
      const jwt = `${segs[k]!.slice(i)}.${segs[k + 1]}.${segs[k + 2]}`
      out.push(segs[k]!.slice(0, i) + (cfg.allow.has(jwt) ? jwt : hide(jwt, start + i)))
      start += i + jwt.length + 1
      k += 3
    } else {
      out.push(segs[k]!)
      start += segs[k]!.length + 1
      k += 1
    }
  }
  return out.join('.')
}

// `postgres://user:PASSWORD@host` in docs: the word itself stands in for one.
const URL_PASSWORD_WORD = /^(?:password|passwd|pass|pw|pwd|secret|<[^>]*>)$/i

function scrubUrls(text: string, cfg: Config): string {
  let out = text
  if (out.includes('://')) {
    out = clocked(out).replace(URL_PASSWORD, (m, head: string, password: string) =>
      WHOLE_TAG.test(password) || cfg.allow.has(password) || URL_PASSWORD_WORD.test(password) ? m : `${head}:${mint('SECRET', password)}@`,
    )
    out = clocked(out).replace(URL_USERINFO, (m, head: string, user: string) => {
      if (cfg.allow.has(user) || !/[0-9]/.test(user) || !/[A-Za-z]/.test(user) || looksLikeName(user, true)) return m
      return entropy(user) >= cfg.contextMinEntropy ? `${head}${mint('SECRET', user)}@` : m
    })
  }
  if (out.includes('=')) {
    out = clocked(out).replace(URL_PARAM, (m, head: string, value: string) => (urlParamSecret(value, cfg) ? head + mint('SECRET', value) : m))
  }
  return out
}

function urlParamSecret(raw: string, cfg: Config): boolean {
  if (cfg.allow.has(raw)) return false
  let v = raw
  try {
    v = decodeURIComponent(raw)
  } catch {
    // A broken escape: judge it as it stands.
  }
  if (cfg.allow.has(v) || v.length < 12) return false
  // The checks below judge a copy in which a placeholder's hash reads as one fixed spelling.
  const read = withFixedHashes(v)
  if ([/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(read)).length < 2) return false
  if (looksLikeName(read, true)) return false
  return entropy(read) >= cfg.contextMinEntropy
}

function scrubCommandLines(text: string, cfg: Config): string {
  let out = text
  if (/-(?:pass|api|token|client|auth|access)/.test(out)) {
    out = clocked(out).replace(CLI_FLAG, (m, head: string, quote: string, v: string, at: number, whole: string) => {
      if (/^[A-Z][A-Z0-9_]*$/.test(v) || /^[A-Za-z_]+=/.test(v) || /^[A-Za-z]+(?:[-_][A-Za-z]+)+$/.test(v)) return m
      return pairOut(cfg, head, v, quote, whole, at + m.length - quote.length)
    })
  }
  if (/\s-(?:u|U|-user|-proxy-user)\b/.test(out)) {
    out = clocked(out).replace(CLI_USERPASS, (m, head: string, v: string, at: number, whole: string) => (DIGITS_ONLY.test(v) ? m : pairOut(cfg, head, v, '', whole, at + m.length)))
  }
  if (/mysql|mariadb/.test(out)) out = clocked(out).replace(MYSQL_P, (m, head: string, v: string, at: number, whole: string) => pairOut(cfg, head, v, '', whole, at + m.length))
  if (out.includes(':')) out = clocked(out).replace(PGPASS, (_m, head: string, v: string) => pairOut(cfg, head, v))
  if (out.includes('password')) out = clocked(out).replace(NETRC, (_m, head: string, v: string) => pairOut(cfg, head, v))
  if (out.includes('gh')) out = clocked(out).replace(GH_SECRET, (m, head: string, _q: string, v: string, at: number, whole: string) => pairOut(cfg, head, v, '', whole, at + m.length))
  if (CMD_PW_GATE.test(out)) {
    for (const re of CMD_PW) out = clocked(out).replace(re, (m, head: string, q: string, v: string, at: number, whole: string) => pairOut(cfg, head, v, q, whole, at + m.length - q.length))
  }
  if (out.includes('pass:')) out = clocked(out).replace(OPENSSL_PASS, (m, head: string, v: string, at: number, whole: string) => pairOut(cfg, head, v, '', whole, at + m.length))
  if (out.includes('smbclient')) out = clocked(out).replace(SMB_USER, (m, head: string, v: string, at: number, whole: string) => pairOut(cfg, head, v, '', whole, at + m.length))
  if (out.includes('htpasswd')) out = clocked(out).replace(HTPASSWD, (m, head: string, q: string, v: string, at: number, whole: string) => pairOut(cfg, head, v, q, whole, at + m.length - q.length))
  if (/net[ \t]+user/i.test(out)) out = clocked(out).replace(NET_USER, (m, head: string, q: string, v: string, at: number, whole: string) => pairOut(cfg, head, v, q, whole, at + m.length - q.length))
  if (out.includes('rabbitmqctl')) out = clocked(out).replace(RABBIT_USER, (m, head: string, q: string, v: string, at: number, whole: string) => pairOut(cfg, head, v, q, whole, at + m.length - q.length))
  return out
}

function scrubAssignments(text: string, cfg: Config): string {
  let out = text
  // A value under a key that says it is public is left: a publishable key.
  const value = (head: string, key: string, v: string, tail = ''): string => {
    if (/public|publishable/i.test(key)) return head + v + tail
    if (PUBLIC_PREFIX.test(v) && !/secret|private/i.test(key) && isPublicId(v, false, cfg)) return head + v + tail
    if (shortKeyStatus(key, v)) return head + v + tail
    return pairOut(cfg, head, v, tail)
  }
  // A value whose name sits in a sibling field.
  const sibling = (head: string, name: string, v: string, tail = ''): string => {
    if (PW_NAME.test(name)) return value(head, name, v, tail)
    if (KEY_NAME.test(name) && !/public|publishable/i.test(name) && !cfg.allow.has(v) && looksSecret(withFixedHashes(v), 'key=', cfg)) return head + mint('SECRET', v) + tail
    return head + v + tail
  }
  if (/pass|secret|key|token|pw/i.test(out)) {
    // Each pair strongQuotedPairs reads is hidden in place; a short value
    // yields no pair and stays as written. The pairs are collected before any
    // value is minted, so the shared regex is never read mid-scan.
    out = clocked(out)
    let at = 0
    let built = ''
    for (const p of strongQuotedPairs(out)) {
      built += out.slice(at, p.start) + value(p.head + p.quote, p.key, p.v, p.quote)
      at = p.end
    }
    out = built + out.slice(at)
    out = clocked(out).replace(APP_PASSWORD, (_m, head: string, v: string) => pairOut(cfg, head, v))
    out = clocked(out).replace(STRONG_LINE, (_m, head: string, key: string, v: string) => value(head, key, v))
    out = clocked(out).replace(ENV_PASS, (_m, head: string, _k: string, v: string) => value(head, '', v))
    out = clocked(out).replace(BLOCK_PASSWORD, (_m, head: string, v: string) => pairOut(cfg, head, v))
    out = clocked(out).replace(KV_PASSWORD, (m, head: string, v: string, at: number, whole: string) => pairOut(cfg, head, v, '', whole, at + m.length))
  }
  if (PW_SYMBOL.test(out)) {
    out = clocked(out).replace(QUOTED_VALUE, (m, q: string, v: string, offset: number, whole: string) => {
      if (!looksGenerated(withFixedHashes(v)) || isStandIn(v) || cfg.allow.has(v)) return m
      // A MIME boundary is random by design and public.
      if (/boundary=$/i.test(whole.slice(Math.max(0, offset - 9), offset))) return m
      return q + mint('SECRET', v) + q
    })
  }
  if (/password|identified/i.test(out)) out = clocked(out).replace(SQL_PASSWORD, (_m, head: string, v: string) => pairOut(cfg, head + "'", v, "'"))
  if (out.includes('variable')) out = clocked(out).replace(HCL_DEFAULT, (_m, head: string, v: string) => pairOut(cfg, head, v, '"'))
  if (out.includes('"value"')) {
    out = clocked(out).replace(JSON_NAME_VALUE, (_m, head: string, name: string, v: string) => sibling(head, name, v, '"'))
    out = clocked(out).replace(JSON_VALUE_NAME, (_m, head: string, v: string, tail: string, name: string) => sibling(head, name, v, tail))
    out = clocked(out).replace(TF_OUTPUT, (_m, head: string, name: string, v: string) => (PW_NAME.test(name) ? value(head, name, v, '"') : _m))
  }
  if (/"random_(?:password|string)"/.test(out)) {
    out = clocked(out).replace(TF_RESULT, (m, head: string, v: string) => (WHOLE_TAG.test(v) || cfg.allow.has(v) ? m : `${head}${mint('SECRET', v)}"`))
  }
  if (/-[ \t]+name:/.test(out)) {
    out = clocked(out).replace(YAML_NAME_VALUE, (_m, indent: string, head: string, name: string, q: string, v: string) => sibling(indent + head, name, v, q))
  }
  if (/INSERT[ \t]+INTO/i.test(out)) out = scrubSqlInserts(out, cfg)
  return out
}

// The VALUES rows after an INSERT whose columns name a key or a password:
// the value in that column is hidden. Bounded to 100 rows and 20,000
// characters per INSERT. Quoted values only; a number is never a key. A
// quoted value still open at the 20,000-character limit ends there, so each
// value is minted by mintBeforeTag.
function scrubSqlInserts(text: string, cfg: Config): string {
  const ranges: [number, number][] = []
  for (const m of clocked(text).matchAll(SQL_INSERT)) {
    const names = m[1]!.split(',').map((c) => c.trim().replace(/^[`"[]|[`"\]]$/g, ''))
    const kinds = names.map((n) => (PW_NAME.test(n) ? 'pw' : KEY_NAME.test(n) && !/(?:^|_)id$|public/i.test(n) ? 'key' : ''))
    if (!kinds.some(Boolean)) continue
    const limit = Math.min(text.length, m.index! + m[0].length + 20_000)
    let i = m.index! + m[0].length
    const skipSpace = (): void => {
      while (i < limit && /\s/.test(text[i]!)) i++
    }
    for (let row = 0; row < 100 && text[i] === '('; row++) {
      i++
      for (let col = 0; i < limit && text[i] !== ')'; col++) {
        skipSpace()
        if (text[i] === "'") {
          const from = ++i
          while (i < limit && !(text[i] === "'" && text[i + 1] !== "'")) i += text[i] === "'" ? 2 : 1
          const v = text.slice(from, i)
          i++
          const kind = kinds[col]
          if (kind && v.length >= 3 && !cfg.allow.has(v) && (kind === 'pw' ? !isStandIn(v) : looksSecret(withFixedHashes(v), 'key=', cfg))) ranges.push([from, from + v.length])
        } else {
          while (i < limit && text[i] !== ',' && text[i] !== ')') i++
        }
        skipSpace()
        if (text[i] === ',') i++
        else break
      }
      if (text[i] !== ')') break
      i++
      skipSpace()
      if (text[i] !== ',') break
      i++
      skipSpace()
    }
  }
  if (ranges.length === 0) return text
  const parts: string[] = []
  let last = 0
  for (const [from, to] of ranges) {
    if (from < last) continue
    parts.push(text.slice(last, from), mintBeforeTag(text, to, text.slice(from, to)))
    last = to
  }
  parts.push(text.slice(last))
  return parts.join('')
}

function cookieSecret(raw: string, cfg: Config): boolean {
  if (cfg.allow.has(raw) || raw.includes('[REDACTED-')) return false
  const m = raw.match(COOKIE_VALUE)
  if (!m) return false
  const body = withFixedHashes(m[1]!)
  if (looksLikeName(body, true)) return false
  return /[0-9]/.test(body) && /[A-Za-z]/.test(body) && entropy(body) >= cfg.contextMinEntropy
}

function scrubCookies(text: string, cfg: Config): string {
  let out = text
  if (/cookie|-b\s/i.test(out)) {
    out = clocked(out).replace(COOKIE, (_m, head: string, header: string) =>
      head +
      header.replace(COOKIE_PAIR, (pair, sep: string, name: string, v: string) =>
        !COOKIE_ATTR.test(name) && cookieSecret(v, cfg) ? sep + name + mint('SECRET', v) : pair,
      ),
    )
  }
  if (out.includes('\t')) out = clocked(out).replace(COOKIES_TXT, (m, head: string, v: string) => (cookieSecret(v, cfg) ? head + mint('SECRET', v) : m))
  if (out.includes('"value"')) out = clocked(out).replace(HAR_COOKIE, (m, head: string, v: string) => (cookieSecret(v, cfg) ? `${head}${mint('SECRET', v)}"` : m))
  return out
}

function scrubAuthBlobs(text: string, cfg: Config): string {
  let out = text
  if (/asic|"auth"|'auth'/.test(out)) {
    out = clocked(out).replace(BASIC_AUTH, (m, head: string, v: string) => {
      if (v.length % 4 !== 0 || cfg.allow.has(v)) return m
      return /^[\x21-\x7e]+:[\x20-\x7e]+$/.test(decodeBase64Head(v)) ? head + mint('SECRET', v) : m
    })
  }
  if (out.includes('.')) {
    out = clocked(out).replace(BOOTSTRAP, (m, id: string, secret: string, offset: number, whole: string) => {
      if (!/[0-9]/.test(secret) || !/[a-z]/.test(secret) || countsUp(secret)) return m
      return NAMED.test(whole.slice(Math.max(0, offset - 64), offset)) ? `${id}.${mint('SECRET', secret)}` : m
    })
  }
  return out
}

// The decoded start of a base64 text is text, not media: almost no control
// bytes. An image or random bytes fail this at once, and a PDF or a zip
// (docx, xlsx) is known by its first bytes, so the full decode below only
// runs on encoded text.
function decodesToText(b64: string): boolean {
  const head = decodeBase64Head(b64, 512)
  if (head.length < 8 || head.startsWith('%PDF') || head.startsWith('PK\x03\x04')) return false
  let control = 0
  for (let i = 0; i < head.length; i++) {
    const c = head.charCodeAt(i)
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) control++
  }
  return control * 50 <= head.length
}

const firstHit = (re: RegExp, text: string): RegExpExecArray | null => {
  re.lastIndex = 0
  const m = re.exec(text)
  re.lastIndex = 0
  return m
}

// Decoded text that holds a secret by the hard rules: a vendor shape, a
// private key, a credentials file, a password-like key with a real value,
// or a URL password. These need no entropy, so they stay quiet on mail.
function decodedHoldsSecret(d: string): boolean {
  if (BLOB_INNER.test(d) || d.includes('PRIVATE KEY')) return true
  for (const { hint, re } of VENDOR) {
    if (typeof hint === 'string' ? !d.includes(hint) : !hint.test(d)) continue
    if (firstHit(re, d)) return true
  }
  if (/pass|secret|key|token/i.test(d)) {
    for (const m of d.matchAll(STRONG_LINE)) if (!isStandIn(m[3]!) && !WHOLE_TAG.test(m[3]!) && !shortKeyStatus(m[2]!, m[3]!)) return true
    for (const p of strongQuotedPairs(d)) if (!isStandIn(p.v) && !WHOLE_TAG.test(p.v) && !shortKeyStatus(p.key, p.v)) return true
  }
  if (d.includes('://')) for (const m of d.matchAll(URL_PASSWORD)) if (!URL_PASSWORD_WORD.test(m[2]!)) return true
  return false
}

// A base64 text that decodes to text holding a secret. Up to 1 MB of it is
// decoded; the model could decode it as easily.
function base64HoldsSecret(b64: string): boolean {
  if (!decodesToText(b64)) return false
  return decodedHoldsSecret(decodeBase64Head(b64, 1 << 20))
}

// Data URIs are parked whole. A blob is hidden as ONE placeholder when a key
// name stands in front of it, or it decodes to text that holds a key or a
// credentials file; otherwise it is parked, never shredded into thousands.
// Each blob reads the clock first, an allowed one included, since its decode
// of up to 1 MB is the one step inside a pass that takes real time: a text
// dense with blobs ends between two of them once the deadline has passed,
// the throw aborting the replace and reaching the caller as one between
// passes does.
function parkMedia(text: string, cfg: Config): string {
  let out = text
  if (out.includes(';base64,')) out = clocked(out).replace(DATA_URI, (m) => park(m))
  if (/Content-Transfer-Encoding/i.test(out)) out = mintMimeSecrets(out, cfg)
  out = clocked(out).replace(BLOB, (m, offset: number, whole: string) => {
    tickNow()
    if (cfg.allow.has(m)) return m
    if (m.includes('\n') && !evenlyWrapped(m)) return m
    // The text before it on the same line, at most 120 characters.
    const near = whole.slice(Math.max(0, offset - 120), offset)
    const before = near.slice(near.lastIndexOf('\n') + 1)
    if (BLOB_NAME.test(before) || BLOB_INNER.test(decodeBase64Head(m)) || base64HoldsSecret(m)) return mint('SECRET', m)
    return park(m)
  })
  return out
}

// A base64 MIME body of any type (a text part, an attachment) that decodes
// to a secret is hidden whole. The width test of a blob does not apply, so
// a narrow attachment is caught too.
function mintMimeSecrets(text: string, cfg: Config): string {
  const ranges: [number, number][] = []
  for (const body of mimeBodies(text)) {
    const b64 = clocked(text.slice(body.start, body.end)).split(/\r?\n/).map(stripPfx).join('')
    if (base64HoldsSecret(b64)) ranges.push([body.start, body.end])
  }
  if (ranges.length === 0) return text
  const parts: string[] = []
  let last = 0
  for (const [from, to] of ranges) {
    const raw = text.slice(from, to)
    parts.push(text.slice(last, from), cfg.allow.has(raw) ? raw : mint('SECRET', raw))
    last = to
  }
  parts.push(text.slice(last))
  return parts.join('')
}

// Wrapped base64 (PEM, MIME, `base64` output) has one line width, 60 or
// more, on every line but the last. A list of keys one per line is not
// excused as a blob unless it looks exactly like that.
function evenlyWrapped(blob: string): boolean {
  const lines = blob.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length < 3) return false
  const width = lines[0]!.length
  if (width < 60) return false
  for (let i = 0; i < lines.length - 1; i++) if (lines[i]!.length !== width) return false
  return lines[lines.length - 1]!.length <= width
}

function lineAt(text: string, start: number): [string, number] {
  const nl = text.indexOf('\n', start)
  const end = nl < 0 ? text.length : nl
  return [text.slice(start, end).replace(/\r$/, ''), end]
}

const stripPfx = (line: string): string => line.replace(PFX_RE, '')

type MimeBody = { start: number; end: number; lines: [number, number][]; text: boolean }

// The base64 body of every MIME part, found from its
// Content-Transfer-Encoding header, with or without a line prefix. Each line
// is a [start, end] range; a last short line counts only when a blank line
// or a boundary follows it.
function mimeBodies(text: string): MimeBody[] {
  const found: MimeBody[] = []
  if (!/Content-Transfer-Encoding/i.test(text)) return found
  for (const m of clocked(text).matchAll(CTE)) {
    const at = m.index!
    // The header block ends at the next blank line; a part's headers are
    // short, so a block that runs on for 20 lines is not a MIME part.
    let pos = text.indexOf('\n', at) + 1
    let bodyStart = -1
    for (let n = 0; pos > 0 && pos < text.length && n < 20; n++) {
      const [line, end] = lineAt(text, pos)
      if (stripPfx(line) === '') {
        bodyStart = end + 1
        break
      }
      pos = end + 1
    }
    if (bodyStart < 0) continue
    // It starts after a blank line or a `--boundary` line.
    let start = text.lastIndexOf('\n', at - 1) + 1
    for (let n = 0; start > 0 && n < 20; n++) {
      const prev = text.lastIndexOf('\n', start - 2) + 1
      const line = stripPfx(text.slice(prev, start - 1).replace(/\r$/, ''))
      if (line === '' || line.startsWith('--')) break
      start = prev
    }
    const type = text.slice(start, bodyStart).match(CONTENT_TYPE)
    const isText = !type || /^(?:text|message|multipart)\//i.test(type[1]!)
    const lines: [number, number][] = []
    let width = 0
    for (let p = bodyStart; p < text.length; ) {
      const [line, end] = lineAt(text, p)
      const body = stripPfx(line)
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) break
      if (width === 0) {
        width = body.length
        if (width < 40) break
      }
      if (body.length === width && !body.endsWith('=')) {
        lines.push([p, end])
        p = end + 1
        continue
      }
      const next = end < text.length ? stripPfx(lineAt(text, end + 1)[0]) : ''
      if (next === '' || next.startsWith('--')) lines.push([p, end])
      break
    }
    if (lines.length > 0) found.push({ start: lines[0]![0], end: lines[lines.length - 1]![1], lines, text: isText })
  }
  return found
}

// The body lines of a non-text base64 MIME part (an attachment) are skipped
// by the token scan. A body that held a secret was already hidden whole.
function mimeBodySpans(text: string, spans: Spans): void {
  for (const body of mimeBodies(text)) if (!body.text) for (const [from, to] of body.lines) spans.add(from, to)
}

// Mail transport headers (DKIM, ARC, Message-ID, Received ...) inside a real
// header block, encoded-word subjects, and multipart boundaries. These are
// soft: a token after `token=` inside one is still judged.
function mailSpans(text: string, spans: Spans, boundaries: Set<string>): void {
  if (/(?:Signature|Seal|Message-I[Dd]|References|Received|Feedback-ID|X-SG-|X-MSFBL|X-Gm-|X-Google-)/.test(text)) {
    for (const m of clocked(text).matchAll(MAIL_HEADER)) {
      const at = m.index!
      const end = at + m[0].length
      const prevStart = text.lastIndexOf('\n', at - 2) + 1
      const prev = at > 0 ? text.slice(prevStart, at - 1).replace(/\r$/, '') : ''
      const next = end < text.length ? lineAt(text, end + 1)[0] : ''
      const inBlock = HEADER_LINE.test(prev) || /^[ \t]/.test(stripPfx(prev)) || HEADER_LINE.test(next)
      if (inBlock) spans.add(at, end, true)
    }
  }
  if (text.includes('=?')) for (const m of clocked(text).matchAll(ENCODED_WORD)) spans.add(m.index!, m.index! + m[0].length, true)
  if (/multipart\//i.test(text)) for (const m of clocked(text).matchAll(BOUNDARY)) boundaries.add(m[1]!.replace(/^-+|[-=]+$/g, ''))
}

function protectedSpans(text: string, boundaries: Set<string>): Spans {
  const spans = new Spans()
  mimeBodySpans(text, spans)
  mailSpans(text, spans, boundaries)
  if (text.includes('fonts.gstatic.com')) for (const m of clocked(text).matchAll(PUBLIC_URL)) spans.add(m.index!, m.index! + m[0].length)
  // The Cloudflare Web Analytics beacon token is public, on every page.
  if (text.includes('data-cf-beacon')) for (const m of clocked(text).matchAll(CF_BEACON)) spans.add(m.index!, m.index! + m[0].length)
  return spans.seal()
}

const CF_BEACON = /data-cf-beacon=(?:3D)?'[^'<>]{0,800}'/g
// A content-hashed asset name: words, then a hex hash, then a file type.
const ASSET_EXT = /^\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp3|mp4|m4a|wav|webm|mov|js|mjs|cjs|css|map|woff2?|ttf|otf)(?![A-Za-z0-9])/i
const HASHED_ASSET = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*[-_][0-9a-f]{8,64}$/

// A hashed class name in a <style> block: `.rio-card-header-<hash> {`. It
// has to be kebab case with two lowercase words before the hash, so a key
// built from words and `_` (`acme_live_<random>`) is still judged there.
const CSS_HASHED = /^[a-z]{2,}(?:-[a-z]{2,})+-[A-Za-z0-9]{6,}$/

function cssClass(token: string, offset: number, whole: string, after: string): boolean {
  if (!CSS_HASHED.test(token) || !/^[ \t]*(?:\{|,|\.[A-Za-z])/.test(after)) return false
  if (!/[{},\n]\.$/.test(whole.slice(Math.max(0, offset - 64), offset))) return false
  return whole.lastIndexOf('<style', offset) > whole.lastIndexOf('</style', offset)
}

function scrubTokens(text: string, cfg: Config): string {
  const boundaries = new Set<string>()
  const spans = protectedSpans(text, boundaries)
  const beforeAt = (whole: string, offset: number): string => whole.slice(Math.max(0, offset - 64), offset)
  const isBoundary = (t: string): boolean => {
    const core = t.replace(/^-+|[-=]+$/g, '')
    for (const b of boundaries) if (core.length >= 8 && b.includes(core)) return true
    return false
  }
  const judge = (token: string, offset: number, whole: string): string => {
    const span = spans.at(offset)
    if (span === 'hard') return token
    const after = whole.slice(offset + token.length, offset + token.length + 8)
    if (ASSET_EXT.test(after) && HASHED_ASSET.test(token) && !NAMED.test(beforeAt(whole, offset))) return token
    if (cssClass(token, offset, whole, after)) return token
    if (span === 'soft' || (boundaries.size > 0 && isBoundary(token))) {
      if (!NAMED.test(beforeAt(whole, offset))) return token
    }
    const before = beforeAt(whole, offset)
    return looksSecret(token, before, cfg) ? mint('SECRET', token, scanEvidence(whole, offset, offset + token.length)) : token
  }
  return clocked(text).replace(SCAN, (m: string, slashed: string | undefined, offset: number, whole: string) => {
    if (slashed === undefined) return judge(m, offset, whole)
    if (m.includes('/')) {
      const span = spans.at(offset)
      const named = NAMED.test(beforeAt(whole, offset))
      if (span !== 'hard' && (span !== 'soft' || named) && slashedSecret(m, named, cfg)) return mint('SECRET', m)
    }
    return m.replace(CANDIDATE, (t: string, o: number) => judge(t, offset + o, whole))
  })
}

// One reading of the text a scan was handed: the output, and whether
// rehideKnown hid a value in it. The first reading is the whole scan of a
// session that holds no part of the text's secrets, with rehideKnown run
// first. A reading `asWritten` is the second: the passes from the one after
// rehideKnown on, over the text as it was handed, which is how a session
// that holds none of its values reads it. So its rehideLocal step runs, and
// its widenKnown step runs where rehideLocal wrote a scan-private
// placeholder. Each reading is a scan of its own: it holds its own parking,
// same-text list and scan-private placeholders, and takes every scan-private
// placeholder out of the vault on each path out. The second also holds its
// own collected set, joined to the scan's set when it ends, so its
// widenKnown takes out no placeholder the first reading collected. The
// first collects straight into the scan's set, which is empty when it
// starts. A reading runs under the tick of the scan in hand, and a deadline
// the tick throws ends the reading there and leaves it as any throw does.
// One thrown in the first reading reaches the caller. One thrown in the
// second is caught by scrubSecrets, where the scan was handed the tick,
// which returns the first reading's output, as it states. During the second, mint records a held value as
// nothing new, as mint states.
function readText(text: string, cfg: Config, asWritten: boolean): [out: string, known: boolean] {
  const outer = parked
  const outerLocal = local
  const outerGained = gained
  const outerMinted = minted
  const outerMarks = marks
  const own: Marks = { text, held: null, of: new Map(), vault: new Map() }
  parked = startParking(text)
  local = new Set()
  gained = asWritten ? new Set() : null
  marks = own
  if (asWritten && outerMinted !== null) minted = new Set()
  try {
    let out = text
    let known = false
    if (!asWritten) {
      // A whole value that is base64 (or base64url) of text holding a secret.
      if (text.length >= 256 && BASE64_VALUE.test(clocked(text)) && !cfg.allow.has(text) && base64HoldsSecret(text)) return [mint('SECRET', text), false]
      out = rehideKnown(text)
      // Read once, here: a scan-private placeholder rehideLocal writes later
      // starts no second reading.
      known = own.vault.size > 0
    }
    out = parkOpaque(out)
    out = scrubKeyBlocks(out, cfg)
    if (out.includes('eyJ')) out = clocked(out).replace(DOTTED, (m) => scrubJwtChain(m, cfg))
    out = scrubVendors(out, cfg)
    out = scrubUrls(out, cfg)
    out = scrubCommandLines(out, cfg)
    out = scrubAssignments(out, cfg)
    out = scrubCookies(out, cfg)
    out = scrubAuthBlobs(out, cfg)
    out = parkMedia(out, cfg)
    out = scrubTokens(out, cfg)
    // A value hidden at one spot in this text is hidden at its other spots
    // too: a HAR repeats each query parameter in `url` and `queryString`.
    if (local.size > 0) out = rehideLocal(out, local)
    const done = unpark(out)
    // A reading in which no known value was hidden again ends here.
    if (own.vault.size === 0) return [done, known]
    // A distinctive known value's placeholder takes in the rest of its key.
    // Each scan-private placeholder that still stands whole is then swapped
    // for the vault's placeholder of its value, so none is handed back.
    return [clocked(widenKnown(done, cfg, text.length)).replace(TAG, (tag) => own.vault.get(tag) ?? tag), known]
  } finally {
    parked = outer
    local = outerLocal
    gained = outerGained
    // No scan-private placeholder outlives its reading, a reading a thrown
    // deadline ends among them.
    for (const mark of own.vault.keys()) byTag.delete(mark)
    marks = outerMarks
    if (minted !== outerMinted) {
      for (const tag of minted!) outerMinted!.add(tag)
      minted = outerMinted
    }
  }
}

// A hide of one reading, laid over the scanned text: where it starts and
// ends there, and the placeholder the reading wrote for it.
type Hide = { at: number; end: number; tag: string }

// Lays a reading's output over the text the scan was handed and gives the
// reading's hides in order, or null where the output cannot be laid. The
// output is walked from its start. The text between two placeholders must
// equal the scanned text at the same place. A placeholder the scanned text
// holds as written at that place is carried, and is no hide. Any other
// placeholder must restore, through the vault, to the scanned text at that
// place, and is a hide of that length.
function layOver(text: string, out: string): Hide[] | null {
  const hides: Hide[] = []
  let p = 0
  let q = 0
  // TAG is shared, and every path out leaves it back at its start.
  TAG.lastIndex = 0
  for (let m = TAG.exec(clocked(out)); m !== null; m = TAG.exec(out)) {
    const tag = m[0]
    const same = m.index === q || text.startsWith(out.slice(q, m.index), p)
    p += m.index - q
    q = m.index + tag.length
    if (same && text.startsWith(tag, p)) {
      p += tag.length
      continue
    }
    const value = same ? byTag.get(tag) : undefined
    if (value === undefined || !text.startsWith(value, p)) {
      TAG.lastIndex = 0
      return null
    }
    hides.push({ at: p, end: p + value.length, tag })
    p += value.length
  }
  return out.length - q === text.length - p && text.startsWith(out.slice(q), p) ? hides : null
}

// The scan's output from its two readings' hides, or null where a joined
// range cannot be written as one placeholder that restores to its text. Two
// hides that share one or more characters join into one range, and hides
// that only touch stay apart. Each range is written as one placeholder, and
// the text outside every range is the text as scanned, so the output hides
// every character either reading hides. The placeholder is the first
// reading's where one hide of the first reading has the range's extent, and
// the second reading's where one of its hides has that extent and none of
// the first has. Any other range is minted over its text with the evidence
// `token`, so it joins no search, as widenKnown mints a wider hide.
function joinReadings(text: string, first: Hide[], second: Hide[]): string | null {
  const parts: string[] = []
  let last = 0
  for (let i = 0, j = 0; i < first.length || j < second.length; ) {
    let at = -1
    let end = 0
    // The longest hide of each reading that starts where the range starts.
    let one: Hide | undefined
    let two: Hide | undefined
    for (;;) {
      const a = first[i]
      const b = second[j]
      const fromFirst = a !== undefined && (b === undefined || a.at <= b.at)
      const hide = fromFirst ? a : b
      if (hide === undefined || (at !== -1 && hide.at >= end)) break
      if (at === -1) at = hide.at
      end = Math.max(end, hide.end)
      if (fromFirst) {
        if (hide.at === at && (one === undefined || hide.end > one.end)) one = hide
        i++
      } else {
        if (hide.at === at && (two === undefined || hide.end > two.end)) two = hide
        j++
      }
    }
    let tag = one !== undefined && one.end === end ? one.tag : two !== undefined && two.end === end ? two.tag : undefined
    if (tag === undefined) {
      const span = text.slice(at, end)
      tag = mint('SECRET', span, 'token')
      // The session's own id, which mint hands back as written, and a span
      // whose own text holds a placeholder the vault restores cannot stand
      // under one placeholder.
      if (byTag.get(tag) !== span) return null
    }
    parts.push(text.slice(last, at), tag)
    last = end
  }
  parts.push(text.slice(last))
  return parts.join('')
}

// `tick`, where given, is called before every whole-text pass and before
// each blob decode in parkMedia, and may throw to end the scan there. A call
// made with none runs under the tick of the scan it is nested in, so the
// outer deadline bounds its passes too.
//
// The scan reads its text once where rehideKnown hid no value in it, and
// its output is that reading's. Where rehideKnown hid one, its placeholder
// has broken every pattern that would have read across the value, so the
// scan reads the text a second time as written, once the first reading has
// finished, and hides every character either reading hides. A session that
// holds part of a secret then shows no character of the text that a session
// holding none would hide, and none that the first reading hides. `again`,
// where given, is asked once before the second reading, and the scan keeps
// its first reading alone where it answers false: a hook charges the text a
// second time there. A call made with none takes the second reading
// unasked. Each reading's output is laid over the text, as layOver states,
// and the output is written from the two readings' hides, as joinReadings
// states. Where either cannot be done the scan returns the first reading's
// output. The range placeholders are minted after the second reading has
// ended, and nothing the second reading recorded is taken back on any path
// out.
//
// The second reading and the join run under the first reading's tick. A
// deadline the scan's own tick throws once the first reading has returned,
// in the second reading or in the join after it, ends the second reading,
// and the scan returns the first reading's output, so this scan never
// withholds a text whose first reading finished in time. The caller's
// deadline has then passed, so a later string of the same call still
// throws at its first tick, and the caller withholds the whole call. The tick is
// wrapped to record what it throws, and only that very throw is caught: any
// other throw reaches the caller, as every throw in the first reading does.
// A scan handed no tick wraps none and catches nothing, so a deadline it
// meets under an outer scan's tick is that scan's to catch.
//
// The placeholders the scan mints are collected apart from the caller's
// set and joined to it once the scan ends, so widenKnown can take out one
// its wider placeholder replaced. After a second reading the scan's set
// keeps only the placeholders its output shows, so a hook counts one hidden
// value where one placeholder stands. That holds for a second reading the
// deadline cut short too: the placeholders it minted leave the set, which is
// read against the first reading's output with no read of the clock.
export function scrubSecrets(text: string, cfg: Config, tick?: Tick, again?: () => boolean): string {
  if (text.length < 8) return text
  const outerTick = clockTick
  const outerMinted = minted
  // What this scan's own tick last threw, held so the catch below can tell
  // that throw from every other.
  const cut: { hit: boolean; thrown: unknown } = { hit: false, thrown: undefined }
  clockTick =
    tick === undefined
      ? outerTick
      : () => {
          try {
            tick()
          } catch (thrown) {
            cut.hit = true
            cut.thrown = thrown
            throw thrown
          }
        }
  if (outerMinted !== null) minted = new Set()
  try {
    const [first, known] = readText(text, cfg, false)
    if (!known || (again !== undefined && !again())) return first
    let out = first
    try {
      const [second] = readText(text, cfg, true)
      const hides = layOver(text, first)
      const more = hides === null ? null : layOver(text, second)
      out = (hides === null || more === null ? null : joinReadings(text, hides, more)) ?? first
    } catch (thrown) {
      if (!cut.hit || cut.thrown !== thrown) throw thrown
      out = first
    }
    if (minted !== null) {
      const shown = new Set<string>(out.match(TAG) ?? [])
      for (const tag of minted) if (!shown.has(tag)) minted.delete(tag)
    }
    return out
  } finally {
    clockTick = outerTick
    if (outerMinted !== null) {
      for (const tag of minted!) outerMinted.add(tag)
      minted = outerMinted
    }
  }
}

// --------------------------------------------------------------- PII tests

// The local part may not start in the middle of a run: without that the
// scan restarts at every character of a long run and goes quadratic.
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g

// Addresses that only ever stand in for a real one: form placeholders, docs
// and test fixtures. Hiding them is noise.
const EXAMPLE_DOMAIN =
  /@(?:example\.(?:com|org|net)|examples?\.[a-z]+|test|invalid|localhost|acme\.com|(?:your)?domain\.com|company\.com|email\.com|mail\.com|foo\.com|bar\.com|sample\.com|placeholder\.[a-z]+)$/i
const EXAMPLE_LOCAL =
  /^(?:you|your|user|username|name|email|someone|test|example|placeholder|first\.last|jane|john|alice|bob|teammate|colleague|member|admin)(?:[.+_-]?[a-z0-9]{0,12})?@/i

function allowedEmail(address: string, cfg: Config): boolean {
  const low = address.toLowerCase()
  if (low.endsWith('@users.noreply.github.com')) return true
  if (low.startsWith('noreply@') || low.startsWith('no-reply@')) return true
  if (EXAMPLE_DOMAIN.test(low) || EXAMPLE_LOCAL.test(low)) return true
  return cfg.allowEmails.some((a) => {
    const rule = a.toLowerCase().trim()
    return rule.startsWith('@') ? low.endsWith(rule) : low === rule
  })
}

export function scrubPii(text: string, cfg: Config): string {
  if (!text.includes('@')) return text
  return text.replace(EMAIL, (m) => (allowedEmail(m, cfg) || cfg.allow.has(m) ? m : mint('EMAIL', m)))
}

// ------------------------------------------------------------- the walkers

// A string under one of these keys is media (an image, a file body) when it
// is one long base64 run; then it is passed through untouched. Anything else
// under the same key is text and is scanned, and so is a run that decodes to
// text holding a secret (a Gmail API `body.data`): scrubSecrets then hides it
// whole.
const MEDIA_KEYS = new Set(['data', 'base64', 'b64_json', 'imageData', 'thumbnail', 'blob'])
const BASE64_VALUE = /^[A-Za-z0-9+/_-]{256}[A-Za-z0-9+/_-]*={0,2}$/
export const MAX_DEPTH = 64

// `incomplete` is set when the walk met a part it could not rewrite: deeper
// than MAX_DEPTH, or an object that is not plain data. A hook that finds a
// secret elsewhere in the same result then withholds it rather than hand the
// part on raw. `tick`, where the caller holds a budget, is its clock check,
// read before each media value's decode, the one step the walk takes itself
// outside `fn`, so a crossed deadline throws to the caller's catch before
// the decoder runs. The one state object is shared down the recursion.
export type WalkState = { incomplete: boolean; tick?: Tick }

export function walk(value: unknown, fn: (s: string) => string, st: WalkState = { incomplete: false }, depth = 0, key = ''): unknown {
  if (typeof value === 'string') {
    if (!MEDIA_KEYS.has(key) || !BASE64_VALUE.test(value)) return fn(value)
    st.tick?.()
    return base64HoldsSecret(value) ? fn(value) : value
  }
  if (value === null || typeof value !== 'object') return value
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value
  if (depth >= MAX_DEPTH) {
    st.incomplete = true
    return value
  }
  // Array items inherit the key, so `data: [<base64>, ...]` stays media.
  if (Array.isArray(value)) return value.map((v) => walk(v, fn, st, depth + 1, key))
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    st.incomplete = true
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v, fn, st, depth + 1, k)
  return out
}

// ------------------------------------------------------------------ config

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback
}

function num(v: unknown, fallback: number): number {
  const n = Number(v)
  return v !== '' && v !== null && v !== undefined && Number.isFinite(n) ? n : fallback
}

function strings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}

export function makeConfig(options: Record<string, unknown>): Config {
  const tools = options.restoreTools === undefined ? DEFAULT_RESTORE_TOOLS : options.restoreTools
  return {
    secrets: bool(options.secrets, true),
    pii: bool(options.pii, false),
    restore: bool(options.restoreInToolInputs, true),
    restoreTools: new Set(strings(tools)),
    notify: bool(options.notify, true),
    minEntropy: num(options.minEntropy, 3.6),
    minLength: Math.max(8, num(options.minLength, 24)),
    contextMinEntropy: num(options.contextMinEntropy, 3.0),
    allow: new Set(strings(options.allow)),
    allowEmails: strings(options.allowEmails),
    allowPrefix: strings(options.allowPrefixes),
    denyPrefix: strings(options.denyPrefixes),
  }
}
