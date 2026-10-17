import { createHash } from "node:crypto";
import {
  canonicalJournalJson,
  type JournalEntry,
  type JournalHeader,
} from "@riftbound/protocol";
import {
  concede,
  createMatch,
  type Match,
  type MatchOptions,
} from "../../../engine-core/dist/game/lifecycle.js";
import {
  projectFor,
  type ProjectionStateInput,
  type ProjectionV2,
  type ProjectionViewer,
} from "../../../engine-core/dist/projection/v2/index.js";
import { JournalReplayError } from "./errors.js";
import { readJournal } from "./journal.js";
import { publicReplayProjection } from "./projection.js";

export interface ReplayMatchSetup {
  /** Resolve and verify trusted deck/catalog digests before returning these inputs. */
  readonly options: Omit<MatchOptions, "seed" | "rulesetVersion">;
  /** Include pending choices and active visibility grants from the state owner. */
  readonly readState: (match: Match) => ProjectionStateInput;
}

export type AdaptedJournalEntry = JournalEntry & {
  readonly command: Extract<JournalEntry["command"], { type: "play-card" | "respond-to-prompt" }>;
};

export interface JournalReplayOptions {
  /** Current engine package version plus build commit; supplied by the build owner. */
  readonly engineVersion: string;
  readonly viewer: ProjectionViewer;
  /** Must allocate a fresh state owner for each replay. Never reuse a live match. */
  readonly resolveSetup: (header: JournalHeader) => ReplayMatchSetup;
  /**
   * Bridge the legacy journal command to the current trusted program/choice
   * adapter. Pass and concede always go directly through the current engine.
   * Unsupported semantics must throw or return a blocked/rejected outcome.
   */
  readonly executeCommand?: (match: Match, entry: AdaptedJournalEntry) => {
    readonly status: "accepted" | "rejected" | "blocked";
    readonly reason?: string;
  };
}

export interface JournalReplayStep {
  readonly seq: number;
  readonly kind: "initial" | "command" | "duplicate" | "operation";
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly projection: ProjectionV2;
  readonly projectionDigest: string;
}

export interface JournalReplaySummary {
  readonly winner: string | null;
  readonly turnNumber: number;
  readonly phase: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly scores: Readonly<Record<string, number>>;
  readonly appliedCommands: number;
  readonly duplicates: number;
  readonly operations: number;
  readonly projectionDigest: string;
}

/** Only a single viewer's projections and public summary leave the replayer. */
export interface JournalReplayResult {
  readonly matchId: string;
  readonly viewer: ProjectionViewer;
  readonly engineVersion: string;
  readonly recordedEngineVersion: string;
  readonly engineMismatch: boolean;
  readonly steps: readonly JournalReplayStep[];
  readonly summary: JournalReplaySummary;
}

export function replayProjectionDigest(projection: ProjectionV2): string {
  return createHash("sha256").update(canonicalJournalJson(projection)).digest("hex");
}

/** Recompute from setup + accepted commands. Recorded receipts are never applied. */
export function replayJournal(input: unknown, options: JournalReplayOptions): JournalReplayResult {
  const journal = readJournal(input);
  if (!options.engineVersion || options.engineVersion.trim() !== options.engineVersion) {
    throw new JournalReplayError("SETUP_REQUIRED", "options.engineVersion", "Current engine version is required");
  }
  const { header } = journal;
  const viewer = options.viewer;
  if (viewer !== null && viewer !== "spectator" && viewer !== "replay" &&
      !header.seats.some(seat => seat.playerId === viewer)) {
    throw new JournalReplayError("INVALID_VIEWER", "options.viewer", "Viewer must be a journal seat or a public viewer");
  }
  // createMatch currently fixes its seats to A/B. Do not silently reinterpret a
  // journal with different identities or deck ordering as another match.
  if (header.seats.length !== 2 || header.seats[0]?.playerId !== "A" || header.seats[1]?.playerId !== "B") {
    throw new JournalReplayError("SETUP_REQUIRED", "$.header.seats", "Current createMatch requires ordered seats A and B");
  }
  const engineMismatch = header.engineVersion !== options.engineVersion;
  let setup: ReplayMatchSetup;
  let match: Match;
  try {
    // The resolver receives its own copy so it cannot change validated commands.
    setup = options.resolveSetup(structuredClone(header));
    if (!setup || typeof setup.readState !== "function") {
      throw new JournalReplayError("SETUP_REQUIRED", "options.resolveSetup", "Trusted setup and state reader are required");
    }
    match = createMatch({ ...setup.options, seed: header.seed, rulesetVersion: header.rulesetVersion });
  } catch (cause) {
    if (cause instanceof JournalReplayError) throw cause;
    throw new JournalReplayError("ENGINE_SETUP_FAILED", "$.header", "Current engine could not create the match", { cause });
  }

  let stateVersion = 0;
  let duplicates = 0;
  let operations = 0;
  const steps: JournalReplayStep[] = [];
  const snapshot = (seq: number, kind: JournalReplayStep["kind"]) => {
    const eventSeq = match.events().length;
    const engineProjection = projectFor({
      ...setup.readState(match), stateVersion, eventSeq,
    }, viewer);
    const sourceProjectionDigest = replayProjectionDigest(engineProjection);
    const projection = structuredClone(publicReplayProjection(engineProjection));
    const step = { seq, kind, stateVersion, eventSeq, projection, projectionDigest: replayProjectionDigest(projection) };
    steps.push(step);
    return { step, sourceProjectionDigest };
  };
  snapshot(0, "initial");

  for (const record of journal.entries) {
    const path = `$.entries[${record.seq - 1}]`;
    if (record.kind === "operation") {
      // Operations are integrity-protected evidence, never a state patch.
      operations += 1;
      snapshot(record.seq, "operation");
      continue;
    }
    if (record.duplicate) {
      duplicates += 1;
    } else {
      if (!engineMismatch && record.expectedStateVersion !== stateVersion) {
        throw new JournalReplayError("REPLAY_MISMATCH", `${path}.expectedStateVersion`, "Recorded command version differs from recomputed state");
      }
      if (match.result().winner !== null) {
        throw new JournalReplayError("COMMAND_REJECTED", path, "A command follows the end of the match");
      }
      try {
        switch (record.command.type) {
          case "pass": match.flow.pass(record.playerId); break;
          case "concede": concede(match, record.playerId); break;
          case "play-card":
          case "respond-to-prompt": {
            if (!options.executeCommand) {
              throw new JournalReplayError("UNSUPPORTED_COMMAND", `${path}.command`, "A trusted current-engine program/choice adapter is required");
            }
            const outcome = options.executeCommand(match, structuredClone(record) as AdaptedJournalEntry);
            if (outcome.status !== "accepted") {
              throw new JournalReplayError("COMMAND_REJECTED", `${path}.command`, outcome.reason ?? "Current engine rejected or blocked the command");
            }
            break;
          }
        }
      } catch (cause) {
        if (cause instanceof JournalReplayError) throw cause;
        throw new JournalReplayError("COMMAND_REJECTED", `${path}.command`, "Current engine could not apply the accepted command", { cause });
      }
      stateVersion += 1;
    }
    const { step, sourceProjectionDigest } = snapshot(record.seq, record.duplicate ? "duplicate" : "command");
    if (!engineMismatch) {
      if (record.appliedStateVersion !== stateVersion || record.eventSeq !== step.eventSeq) {
        throw new JournalReplayError("REPLAY_MISMATCH", path, "Recorded versions differ from current-engine replay");
      }
      // ProjectionV2 preserves the viewer value, so null and "spectator"
      // have different serialized digests even though both are public views.
      const viewerKey = String(viewer);
      const expectedDigest = record.projectionDigestByViewer[viewerKey];
      if (expectedDigest !== undefined && expectedDigest !== sourceProjectionDigest) {
        throw new JournalReplayError("REPLAY_MISMATCH", `${path}.projectionDigestByViewer`, "Viewer projection differs from current-engine replay");
      }
    }
  }
  const final = steps.at(-1)!;
  if (!engineMismatch && (journal.head.stateVersion !== stateVersion || journal.head.eventSeq !== final.eventSeq)) {
    throw new JournalReplayError("REPLAY_MISMATCH", "$.head", "Recorded head differs from current-engine replay");
  }
  return {
    matchId: header.matchId, viewer, engineVersion: options.engineVersion,
    recordedEngineVersion: header.engineVersion, engineMismatch, steps,
    summary: {
      ...match.result(), phase: match.flow.phase, stateVersion, eventSeq: final.eventSeq,
      scores: Object.fromEntries(header.seats.map(seat => [seat.playerId, setup.options.host.player(seat.playerId).score])),
      appliedCommands: stateVersion, duplicates, operations, projectionDigest: final.projectionDigest,
    },
  };
}
