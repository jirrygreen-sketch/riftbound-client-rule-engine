# Full Product Vertical Slice

Status date: 2026-10-12

This document defines the two-client acceptance procedure and records the current gaps against [PROJECT.md](../../PROJECT.md). Persistence design and evidence boundaries are tracked separately in [persistence.md](persistence.md). Neither document certifies the current runtime as official Riftbound.

## 1. Purpose and Non-Goal

The vertical slice proves that two real desktop clients can connect to one authoritative server, create or join the same room, submit legal decks, start and progress a match, preserve private information, and recover from disconnect/reconnect through a deterministic event stream.

It does not prove official Riftbound gameplay. The full-product engine in `packages/engine-core/src/full-product/runtime.ts` is an experimental life/health/attack template, and its server adapter states that it is not the official runtime. Until replaced, this slice can only test networking, authority, projection, privacy, and orchestration behavior.

## 2. Preconditions

1. Fresh checkout installs from the lockfile and builds the server.
2. Desktop client builds successfully.
3. The authoritative game server is started on a known local address.
4. Two separate desktop client processes are launched with distinct player identities and resume-token storage.
5. Each client has a legal Constructed deck generated from the server card catalog.
6. A reviewer can inspect server logs and both clients without changing source.

## 3. Two-Client Acceptance Workflow

### 3.1 Reproducible Local Run

This is the current manual reproduction procedure. Recording these commands in
this document does not mean that a GUI acceptance run has passed.

From the repository root, install from the lockfile in a fresh checkout and
start the authoritative server in one terminal:

```powershell
pnpm install --frozen-lockfile
pnpm start:server
```

`pnpm dev:server` is equivalent for a development session. With the default
environment, verify:

- Health: `http://127.0.0.1:8787/health`
- Card catalog: `http://127.0.0.1:8787/api/cards`
- Game WebSocket: `ws://127.0.0.1:8787/ws`

The server reads `HOST`, `PORT`, and `RIFTBOUND_STORAGE_DIRECTORY`; the
defaults are `127.0.0.1`, `8787`, and in-memory room storage. When a storage
directory is configured, startup creates/checks the directory, probes write
permission, restores persisted rooms, and only then starts listening. A
persistence review may start it with an explicit disposable directory, for
example:

```powershell
$env:RIFTBOUND_STORAGE_DIRECTORY = "C:\temp\riftbound-rooms"
pnpm start:server
```

This configuration path and startup ordering are present in source, but
recording them here does not mean a two-client restart/resume acceptance run has
passed.

If they are changed, both client fields must be updated: the WebSocket server
URL and the HTTP catalog server URL.

Start the browser-served desktop client in a second terminal:

```powershell
pnpm dev
```

Open the served desktop client twice in two isolated browser profiles. Profiles
are preferable to two tabs because each profile keeps a separate saved deck;
the session resume token is stored per tab in `sessionStorage`. `pnpm dev`
normally targets `http://127.0.0.1:5173/` with a strict port. If another local
application already uses 5173, start the browser-served client explicitly on a
free port, for example:

```powershell
pnpm --filter @riftbound/desktop-client exec vite --host 127.0.0.1 --port 5174 --strictPort
```

The parent mainline observed a two-browser lobby smoke check at
`http://127.0.0.1:5174/` and `http://localhost:5174/`, using separate origins
for saved decks. Both clients connected to the same server and room; see the
record below. That check did not exercise a complete match and does not close
two-desktop-client acceptance.

`pnpm desktop:dev` starts the Tauri shell, but two independent Tauri windows
have not been verified. The browser-profile procedure is the reproducible
local path until that desktop-specific run is recorded.

### 3.2 GUI Flow

1. Start the game server and record its URL and process startup logs.
2. Launch desktop client A and desktop client B as separate processes.
3. Client A sends `hello`, receives `welcome`, and creates a room.
4. Client B sends `hello`, receives `welcome`, joins the room with the returned room ID.
5. Verify both clients see the same room version, seat list, ready state, and deck-submitted state.
6. Client A submits a legal deck; verify the server accepts it and neither client sees the private deck contents.
7. Client B submits a legal deck; verify the same server-side validation path.
8. Attempt ready before deck submission for at least one seat; it must be rejected without changing room state.
9. Submit a stale room version; it must be rejected as `stale-version` without changing state.
10. Set both seats ready; the server must start the match only after both decks are accepted and both seats are ready.
11. Verify each client receives a private projection: its own hidden cards are visible to it and not to the opponent.
12. Verify the server is the only source of legal actions and both clients render the same public version.
13. Exercise one server-legal action or prompt from the active/prompt owner.
14. Verify the command returns a versioned receipt and both clients receive the corresponding event sequence.
15. Send the same command ID and payload again; it must replay the receipt without applying effects again.
16. Send the same command ID with a different payload; it must be rejected as `idempotency-conflict`.
17. Send a stale game version; it must be rejected as `stale-version`.
18. Disconnect client A. Client B must remain able to act where the rules allow, and the server must emit disconnect state.
19. Reconnect client A with its resume token. The server must invalidate the old socket, accept the replacement connection, and replay missed room/game events.
20. Verify replay filters private hand and prompt data by viewer.
21. Continue the match to a natural result or concession.
22. Verify both clients receive the same terminal result, the terminal room event is emitted once, and event logs remain ordered and complete.
23. Restart or re-open the review replay path where available and verify projections and event cursors remain monotonic without duplicating or leaking state.

### 3.3 Observed Browser Smoke Check

On 2026-10-12, two rendered browser clients used the existing server at
`http://127.0.0.1:8787` and foundation room `986d7f78`.

| Interaction | Observed result |
| --- | --- |
| Alice created a room; Bob joined by room ID | Both clients displayed the same room ID; Alice saw Bob and Bob saw GUI Alice |
| Search using the localized full card title | The search returned the intended canonical card group with ordinary and alternate printings |
| Add one `ven-021-166` and two `ven-021a-166` printings | The shared group count reached 3/3 with zero remaining; both Add buttons were disabled |
| Submit Alice's incomplete three-card deck | The server rejected the deck; the client remained unsubmitted and Ready stayed disabled |
| Reload Bob, then press Connect | Bob resumed the original room without joining again and still saw GUI Alice |
| Inspect the filtered catalog images | Both ordinary and alternate images loaded successfully in the rendered page |

Local screenshots are saved under `outputs/verification/` as
`canonical-art-limit.png`, `two-client-alice-invalid-deck.png`, and
`two-client-bob-resumed.png`. These machine-local artifacts are excluded from
Git.

No match was started in this run. It did not verify two Tauri processes,
mid-game private projections, a server restart, or a natural match result.
The nickname input reset to its default after Bob reloaded while the existing
server seat was restored. This observation concerns reconnect behavior only.

## 4. Automated Evidence Currently Available

| Area | Evidence |
| --- | --- |
| Two protocol WebSocket clients | `packages/integration-tests/src/game-server.websocket.test.ts` |
| Room create/join, deck submission, ready gating, automatic start | `packages/integration-tests/src/multiplayer-flow.integration.test.ts` |
| Stale room/game versions | `multiplayer-flow.integration.test.ts`; full-product orchestration tests |
| Command idempotency and command-ID payload conflicts | `multiplayer-flow.integration.test.ts`; full-product orchestration tests |
| Disconnect, reconnect, replacement socket, event replay | `game-server.websocket.test.ts`; `multiplayer-flow.integration.test.ts`; `match-orchestration.test.ts` |
| Private hand and prompt filtering | `multiplayer-flow.integration.test.ts`; desktop full-product tests |
| Server-derived actions and prompt ownership | full-product room/orchestration and desktop tests |
| Natural result and concession plumbing | full-product orchestrator tests |
| Desktop board/status/prompt/command component behavior | `apps/desktop-client/tests/full-product/` |
| Durable room archive/file store helpers | Covered by passing `@riftbound/game-server` and integration suites recorded by the parent mainline |

The parent mainline recorded these ordinary executions as passing on 2026-10-12:

| Command | Recorded result |
| --- | --- |
| `pnpm --filter @riftbound/game-server exec vitest run --config vitest.config.ts` | 18 files / 139 tests passed |
| `pnpm --filter @riftbound/integration-tests exec vitest run --config vitest.config.ts` | 6 files / 37 tests passed |
| `pnpm --filter @riftbound/desktop-client exec vitest run --config vitest.config.ts` | 12 files / 98 tests passed |
| `pnpm run typecheck` | Exit code 0 |
| `pnpm run build` | Exit code 0 |

The two-browser smoke check also exercised a shared lobby, canonical copy
limits, invalid-deck rejection, and reload/resume. It did not complete a match.

The public server room still constructs only the existing synthetic/foundation room boundary: `apps/game-server/src/room.ts` accepts only those ruleset IDs, and `apps/game-server/src/server.ts` validates against that public ruleset list. A repository-wide search finds `FullProductRoomOrchestrator` and `FullProductEngineRuntimeAdapter` only in their modules, the full-product export barrel, and focused tests, not in `room.ts`, `server.ts`, or the public WebSocket path.

Relevant full-product orchestration tests include:

- `apps/game-server/tests/full-product/orchestrator.test.ts`
- `apps/game-server/tests/full-product/match-orchestration.test.ts`

The assumed path `packages/integration-tests/src/full-product/` does not exist. The actual integration tests also include `packages/integration-tests/test/full-product/two-client-foundation.test.ts`, which exercises the public foundation path with two protocol clients rather than two GUI clients, alongside `packages/integration-tests/src/multiplayer-flow.integration.test.ts` and `packages/integration-tests/src/game-server.websocket.test.ts`.

## 5. Current Gaps

### 5.1 Release Blockers

| Gap | Consequence |
| --- | --- |
| No verified complete match with two real GUI desktop clients | Two browser clients passed a lobby/reconnect smoke check; neither a complete GUI match nor the two-window Tauri journey is verified |
| Current engine is life/health/attack, not official Riftbound | A passing vertical slice cannot demonstrate official setup, scoring, Showdown, Combat, Deathknell, or victory |
| Full official action loop is incomplete | UI cannot support the full phase, legal-action, target, prompt, chain, and result loop required by PROJECT.md |
| Official card-pool EffectIR execution is zero | Unsupported card effects remain judge-required |
| `FullProductRoomOrchestrator` and `FullProductEngineRuntimeAdapter` are not wired into public `GameRoom`/WebSocket lifecycle | The new orchestrator is not yet the real user-facing room path |
| Full Combat, Showdown, Cleanup, and Deathknell are missing | Official match progression is impossible |
| Install, upgrade, rollback, and complete product gate are unverified | PROJECT.md gates cannot be closed |

### 5.2 Evidence Boundaries

- Most current tests are in-memory, protocol-level, or component-level; they do not establish a production persistence guarantee or a complete two-GUI product run.
- Server-private room archive export/restore, a file room store, storage-root write preflight, command and lobby request idempotency, cursor-before-bind resume, per-mutation durable saves with rollback, startup recovery, and shutdown close exist in source. Focused game-server and integration suites passed, but a real two-client restart/privacy run and production recovery procedure remain open; see [persistence.md](persistence.md).
- A translated full-product event still reports `rulesetId: "riftbound-foundation"`, and `FULL_PRODUCT_RULESET_ID` is aliased to the foundation identifier; identifiers must not be treated as proof of official rule support.
- Desktop tests validate component behavior, not two independently rendered clients observing the same server stream.
- Existing natural-result tests operate through the experimental life-based runtime; they do not verify official scoring victory.

### 5.3 Required Manual E2E Evidence

The release review needs artifacts from one clean run:

- Server startup log and build versions.
- Two client screenshots or recorded sessions at lobby, post-start, mid-action, disconnected, reconnected, and result states.
- Room ID, player IDs, and redacted resume-token usage.
- Server event log with monotonic sequence numbers.
- Client projections showing private data visible only to the owner.
- Duplicate command, conflicting command, stale command, disconnect, reconnect, and replay results.
- Natural result or concession and terminal room event.
- Any judge-required interruption with the exact blocked card/effect.

## 6. PROJECT.md Gate Status

| Gate | Current status |
| --- | --- |
| Fresh checkout installs and starts server | Not verified in this documentation pass |
| Two desktop clients create/join and see only their own private information | Two-browser create/join smoke passed; in-game privacy and two-Tauri acceptance remain unverified |
| Legal submitted deck starts a deterministic match event log | Partially automated; official rules engine missing |
| Every client action is server-validated and versioned | Protocol/orchestration tests exist; full official action surface missing |
| Disconnect, reconnect, duplicate commands, and missed events recover without duplication or leakage | Automated at protocol/orchestration/component level; real-client persistence review pending |
| UI exposes phase, legal actions, prompts, targets, zones, chain, and result | Partially implemented/tested; full official loop missing |
| Tests cover the complete vertical slice and unsupported official rules have explicit status | Automated slices exist, but complete two-GUI E2E and official-rule tests are missing |

## 7. Acceptance Decision

**Current state: not accepted.**

The repository has useful authoritative-room and reconnect primitives, but the vertical slice does not yet satisfy PROJECT.md. The immediate path is:

1. Wire or replace the room boundary deliberately; do not silently alias foundation and full-product ruleset IDs.
2. Replace the experimental life runtime with a Core Rules v1.4 state model or keep it quarantined behind a clearly experimental flag.
3. Add one real two-GUI E2E run using the accepted workflow above.
4. Add restart-safe replay review and persistence tests.
5. Keep every unverified official effect judge-required.
