// The authorization server's state: the registered clients, the sign-ins waiting for the operator's
// approval, the authorization codes and the tokens. Every secret a client or the public page holds,
// an authorization code, an access or refresh token, and the request id the page polls with, is
// held here as its SHA-256 hash alone, and the plaintext exists only in the response that handed it
// out. The approval code a waiting sign-in shows is held in plain, since the public page shows it
// and the operator types it into the approval page, and it is gone with the sign-in. The file is
// written whole after every change, through the broker's own snapshot writer, so a crash leaves the
// previous state rather than a torn file. Expiry is read from an injected clock, so a test moves ten
// minutes without waiting them out.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeSnapshot } from "../broker/persistence.ts";

/** How long a sign-in waits for the operator before it is gone. */
export const PENDING_TTL_MS = 10 * 60_000;
/** How long an authorization code may be exchanged after the browser is sent back with it. */
export const CODE_TTL_MS = 5 * 60_000;
/** How long past its ten minutes an approved sign-in the page has not yet polled still holds its slot. */
export const APPROVED_GRACE_MS = 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
/**
 * The most registrations held. Past it the oldest never used to sign in is dropped, a client holding
 * a live refresh token is never dropped, and with every client holding one a new registration is refused.
 */
export const MAX_CLIENTS = 32;
/** The most sign-ins waiting at once; a further one is refused rather than evicting an earlier one. */
export const MAX_PENDING = 4;
/** Letters and digits with the four a reader confuses left out, so a code read off a phone types right. */
const APPROVAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const APPROVAL_CODE_LENGTH = 6;
/** A token or an authorization code is this many random bytes, sent base64url. */
const TOKEN_BYTES = 32;
/** The request id the public page polls with: 128 bits, sent as hex. */
const REQUEST_ID_BYTES = 16;
const FORMAT_VERSION = 1;

export type Client = {
  id: string;
  /** The name the registration gave, cut to `MAX_CLIENT_NAME`, or null; drawn escaped and never trusted. */
  name: string | null;
  redirectUris: readonly string[];
  createdAt: number;
  /** When a sign-in last began, a code was exchanged or a token refreshed under this client, or null for none. */
  lastUsedAt: number | null;
};

/** The longest client name kept, since the page draws it in one line. */
export const MAX_CLIENT_NAME = 64;

type Pending = {
  /** SHA-256 of the request id the page holds, hex. */
  requestHash: string;
  approvalCode: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope: string;
  createdAt: number;
  approvedAt: number | null;
};

type Code = {
  hash: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  expiresAt: number;
};

type Token = {
  hash: string;
  clientId: string;
  scope: string;
  expiresAt: number;
};

type Snapshot = {
  version: number;
  clients: Client[];
  pending: Pending[];
  codes: Code[];
  access: Token[];
  refresh: Token[];
};

/** One pending sign-in as the approval page lists it: nothing a holder of the list could redeem. */
export type PendingView = {
  approvalCode: string;
  clientId: string;
  clientName: string | null;
  redirectHost: string;
  scope: string;
  /** How long the request has waited. */
  ageMs: number;
  approved: boolean;
};

/** What a poll from the public page learns; a waiting answer carries what the page redraws. */
export type PollResult =
  | { status: "unknown" }
  | { status: "waiting"; pending: PendingView }
  | { status: "approved"; code: string; redirectUri: string; state: string };

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  scope: string;
  /** The access token's life in seconds, as the token response states it. */
  expiresIn: number;
};

export type StoreOptions = {
  /** Absolute path of the state file; read at creation and written after every change. */
  file: string;
  /** Drives every expiry. Injected so a test moves time without sleeping. */
  now?: () => number;
};

export type DuetStore = {
  /** The new client, or null where all `MAX_CLIENTS` held clients hold a live refresh token. */
  registerClient(redirectUris: readonly string[], name: string | null): Client | null;
  client(id: string): Client | null;
  /**
   * Holds a sign-in and hands back the request id for the page and the approval code for the
   * operator, or null where `MAX_PENDING` live requests are already waiting.
   */
  addPending(request: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state: string;
    scope: string;
  }): { requestId: string; approvalCode: string } | null;
  /** The live requests, oldest first, as the approval page draws them. */
  pendingList(): PendingView[];
  /** Marks the live request carrying this code approved; false where none does. */
  approve(approvalCode: string): boolean;
  /**
   * What the page's poll learns. An approved request yields its authorization code on this one call
   * and is gone after it, so a second poll with the same id learns `unknown` and no second code exists.
   */
  poll(requestId: string): PollResult;
  /**
   * The code exchanged once: the client, the redirect URI and the PKCE verifier must all match what
   * the code was minted for, and the code is deleted whether or not they do, so a wrong verifier
   * cannot be tried again against the same code.
   */
  redeemCode(code: string, clientId: string, redirectUri: string, verifier: string): { scope: string } | null;
  issueTokens(clientId: string, scope: string): IssuedTokens;
  /** New tokens for a live refresh token under its client, the old one deleted first; null for any other. */
  refresh(refreshToken: string, clientId: string): IssuedTokens | null;
  /** The client and scope a live access token carries, or null for one the store does not hold. */
  bearer(accessToken: string): { clientId: string; scope: string } | null;
};

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The PKCE S256 transform: base64url of the verifier's SHA-256, as RFC 7636 states it. */
export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** Equal length and equal bytes, read in constant time, so a comparison leaks nothing by its duration. */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function emptySnapshot(): Snapshot {
  return { version: FORMAT_VERSION, clients: [], pending: [], codes: [], access: [], refresh: [] };
}

/**
 * The file's contents, an empty state for a file that is not there, and a thrown refusal for one
 * that is there and is not a snapshot: a file that cannot be read whole is not silently replaced
 * with nothing, since every registered client would then be gone with no line saying so.
 */
function loadSnapshot(file: string): Snapshot {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptySnapshot();
    throw new Error(`the Duet state file could not be read: ${(error as NodeJS.ErrnoException).code ?? "error"}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("the Duet state file is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || (parsed as Snapshot).version !== FORMAT_VERSION) {
    throw new Error("the Duet state file is not a snapshot this server reads");
  }
  const snapshot = parsed as Partial<Snapshot>;
  const rows = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);
  return {
    version: FORMAT_VERSION,
    clients: rows(snapshot.clients),
    pending: rows(snapshot.pending),
    codes: rows(snapshot.codes),
    access: rows(snapshot.access),
    refresh: rows(snapshot.refresh),
  };
}

export function createStore(options: StoreOptions): DuetStore {
  const now = options.now ?? Date.now;
  const state = loadSnapshot(options.file);

  function persist(): void {
    writeSnapshot(options.file, JSON.stringify(state, null, 2));
  }

  /** Drops what has run out, so no list is read with an expired row in it. */
  function prune(): void {
    const at = now();
    // A waiting request has its ten minutes. An approved one has a code's life from its approval,
    // cut at one grace minute past its ten, so an approval near the end of the ten minutes still
    // reaches the page's next poll and no approval holds a slot much past them.
    state.pending = state.pending.filter((row) =>
      row.approvedAt === null
        ? at - row.createdAt < PENDING_TTL_MS
        : at < Math.min(row.approvedAt + CODE_TTL_MS, row.createdAt + PENDING_TTL_MS + APPROVED_GRACE_MS),
    );
    state.codes = state.codes.filter((row) => at < row.expiresAt);
    state.access = state.access.filter((row) => at < row.expiresAt);
    state.refresh = state.refresh.filter((row) => at < row.expiresAt);
  }

  function freshApprovalCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < APPROVAL_CODE_LENGTH; i += 1) {
        code += APPROVAL_ALPHABET[randomInt(APPROVAL_ALPHABET.length)];
      }
      if (!state.pending.some((row) => row.approvalCode === code)) return code;
    }
  }

  /** One pending row as a page draws it: the code and the names, never the challenge or the state. */
  function view(row: Pending): PendingView {
    return {
      approvalCode: row.approvalCode,
      clientId: row.clientId,
      clientName: state.clients.find((client) => client.id === row.clientId)?.name ?? null,
      redirectHost: new URL(row.redirectUri).host,
      scope: row.scope,
      ageMs: now() - row.createdAt,
      approved: row.approvedAt !== null,
    };
  }

  /** Marks the client used now, which keeps it ahead of a newer unused one at the registration cap. */
  function touch(clientId: string): void {
    const client = state.clients.find((row) => row.id === clientId);
    if (client !== undefined) client.lastUsedAt = now();
  }

  function mintTokens(clientId: string, scope: string): IssuedTokens {
    const at = now();
    const accessToken = randomBytes(TOKEN_BYTES).toString("base64url");
    const refreshToken = randomBytes(TOKEN_BYTES).toString("base64url");
    state.access.push({ hash: sha256Hex(accessToken), clientId, scope, expiresAt: at + ACCESS_TTL_MS });
    state.refresh.push({ hash: sha256Hex(refreshToken), clientId, scope, expiresAt: at + REFRESH_TTL_MS });
    return { accessToken, refreshToken, scope, expiresIn: ACCESS_TTL_MS / 1000 };
  }

  return {
    registerClient(redirectUris, name) {
      prune();
      const at = now();
      const client: Client = {
        id: randomBytes(16).toString("hex"),
        name: name === null ? null : name.slice(0, MAX_CLIENT_NAME),
        redirectUris: [...redirectUris],
        createdAt: at,
        lastUsedAt: null,
      };
      // A client holding a live refresh token is never dropped, since dropping it would end a
      // working connection; prune has already removed the expired ones.
      const holders = new Set(state.refresh.map((row) => row.clientId));
      while (state.clients.length >= MAX_CLIENTS) {
        const droppable = state.clients.filter((row) => !holders.has(row.id));
        if (droppable.length === 0) return null;
        // The oldest never used goes first; with every one used, the one used longest ago.
        const unused = droppable.filter((row) => row.lastUsedAt === null);
        const pool = unused.length > 0 ? unused : droppable;
        const victim = pool.reduce((oldest, row) =>
          (row.lastUsedAt ?? row.createdAt) < (oldest.lastUsedAt ?? oldest.createdAt) ? row : oldest,
        );
        // Its token rows go with it, so no access token outlives the client it was issued to.
        state.clients = state.clients.filter((row) => row !== victim);
        state.access = state.access.filter((row) => row.clientId !== victim.id);
        state.refresh = state.refresh.filter((row) => row.clientId !== victim.id);
      }
      state.clients.push(client);
      persist();
      return client;
    },

    client(id) {
      return state.clients.find((row) => row.id === id) ?? null;
    },

    addPending(request) {
      prune();
      if (state.pending.length >= MAX_PENDING) return null;
      touch(request.clientId);
      const requestId = randomBytes(REQUEST_ID_BYTES).toString("hex");
      const approvalCode = freshApprovalCode();
      state.pending.push({
        requestHash: sha256Hex(requestId),
        approvalCode,
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        state: request.state,
        scope: request.scope,
        createdAt: now(),
        approvedAt: null,
      });
      persist();
      return { requestId, approvalCode };
    },

    pendingList() {
      prune();
      return state.pending.map(view);
    },

    approve(approvalCode) {
      prune();
      const wanted = approvalCode.trim().toUpperCase();
      const row = state.pending.find((candidate) => candidate.approvalCode === wanted && candidate.approvedAt === null);
      if (row === undefined) return false;
      row.approvedAt = now();
      persist();
      return true;
    },

    poll(requestId) {
      prune();
      const hash = sha256Hex(requestId);
      const row = state.pending.find((candidate) => candidate.requestHash === hash);
      if (row === undefined) return { status: "unknown" };
      if (row.approvedAt === null) return { status: "waiting", pending: view(row) };
      // The request leaves the pending list as its code is minted, so the one code is all there is.
      state.pending = state.pending.filter((candidate) => candidate !== row);
      const code = randomBytes(TOKEN_BYTES).toString("base64url");
      state.codes.push({
        hash: sha256Hex(code),
        clientId: row.clientId,
        redirectUri: row.redirectUri,
        codeChallenge: row.codeChallenge,
        scope: row.scope,
        expiresAt: now() + CODE_TTL_MS,
      });
      persist();
      return { status: "approved", code, redirectUri: row.redirectUri, state: row.state };
    },

    redeemCode(code, clientId, redirectUri, verifier) {
      prune();
      const hash = sha256Hex(code);
      const row = state.codes.find((candidate) => candidate.hash === hash);
      if (row === undefined) return null;
      // The code leaves the state in the one write either outcome makes, so a refused exchange has
      // used it up as durably as a granted one.
      state.codes = state.codes.filter((candidate) => candidate !== row);
      const matches =
        row.clientId === clientId &&
        row.redirectUri === redirectUri &&
        sameSecret(s256Challenge(verifier), row.codeChallenge);
      if (matches) touch(clientId);
      persist();
      return matches ? { scope: row.scope } : null;
    },

    issueTokens(clientId, scope) {
      prune();
      const issued = mintTokens(clientId, scope);
      persist();
      return issued;
    },

    refresh(refreshToken, clientId) {
      prune();
      const hash = sha256Hex(refreshToken);
      const row = state.refresh.find((candidate) => candidate.hash === hash);
      if (row === undefined || row.clientId !== clientId) return null;
      // Deleted before the new pair is minted, in the same write, so the old token is dead the
      // moment the new one exists and a replay of it finds nothing.
      state.refresh = state.refresh.filter((candidate) => candidate !== row);
      const issued = mintTokens(clientId, row.scope);
      touch(clientId);
      persist();
      return issued;
    },

    bearer(accessToken) {
      prune();
      const hash = sha256Hex(accessToken);
      const row = state.access.find((candidate) => candidate.hash === hash);
      return row === undefined ? null : { clientId: row.clientId, scope: row.scope };
    },
  };
}
