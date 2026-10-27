import { spawn, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import { availableParallelism, cpus, freemem, loadavg, totalmem } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { WebSocket } from "ws";

import type { RoomDeckSubmission } from "../../../packages/protocol/src/index.js";
import type {
  V2ChooseCommand,
  V2Command,
  V2CommandReceipt,
  V2Projection
} from "../../../packages/protocol/src/v2/index.js";
import {
  PROTOCOL_V2_VERSION,
  isV2Projection
} from "../../../packages/protocol/src/v2/index.js";
import {
  botCommand,
  projectedCombatDamagePlayer
} from "../../../packages/integration-tests/src/v2-duel/bot.js";
import { V2_M1_PRECONS } from "../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { auditProjectionPrivacy } from "../../../packages/integration-tests/src/v2-duel/privacy.js";
import { cardProgramsById } from "../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../packages/card-dsl/dist/ir/index.js";

interface CliOptions {
  readonly modes: readonly RunMode[];
  readonly levels: readonly number[];
  readonly outputDirectory: string;
  readonly storageRoot: string;
  readonly portBase: number;
  readonly portSpan: number;
  readonly maxCommandsPerGame: number;
  readonly maxTurnsPerGame: number;
  readonly commandTimeoutMs: number;
  readonly gameTimeoutMs: number;
  readonly startupTimeoutMs: number;
  readonly deterministicSeed: string | null;
}

type RunMode = "file" | "memory";
type Side = "first" | "second";
type GameTermination = "winner" | "blocked" | "timeout";

interface Packet {
  readonly type: string;
  readonly [key: string]: unknown;
}

interface ClientSnapshot {
  readonly session: {
    readonly roomId: string;
    readonly playerId: string;
    readonly resumeToken: string;
  };
  readonly roomVersion: number;
  readonly projection: V2Projection | null;
}

interface CardFact {
  readonly energy: number | null;
  readonly power: number | null;
  readonly status: string;
  readonly kind: "unit" | "gear" | "spell";
}

interface RequestReceipt {
  readonly type: "request-result";
  readonly requestId: string;
  readonly ok: boolean;
  readonly roomVersion?: number;
}

interface ProjectionObservation {
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly pendingChoice: V2Projection["pendingChoice"];
}

interface CommandTiming {
  readonly latencyMs: number;
  readonly accepted: boolean;
  readonly type: V2Command["type"];
  readonly commandId: string;
  readonly stateVersion: number;
  readonly phase: V2Projection["phase"];
  readonly turnNumber: number;
  readonly cardObjectId: string | null;
  readonly actorPlayerId: string;
}

interface CommandResult {
  readonly type: V2Command["type"];
  readonly accepted: boolean;
  readonly latencyMs: number;
  readonly commandId: string;
  readonly stateVersion: number;
  readonly phase: V2Projection["phase"];
  readonly turnNumber: number;
  readonly cardObjectId: string | null;
  readonly actorPlayerId: string;
}

interface GameFailure {
  readonly kind: "error" | "rejection" | "disconnect" | "timeout" | "privacy";
  readonly message: string;
  readonly commandId?: string;
  readonly phase?: V2Projection["phase"];
  readonly stateVersion?: number;
  readonly cardName?: string | null;
}

interface GameResult {
  readonly room: number;
  readonly seed: string;
  readonly roomId?: string;
  readonly termination: GameTermination;
  readonly winnerPlayerId: string | null;
  readonly turns: number;
  readonly commands: number;
  readonly elapsedMs: number;
  readonly latenciesMs: readonly number[];
  readonly rejectedCommands: number;
  readonly errors: number;
  readonly disconnects: number;
  readonly timeouts: number;
  readonly failures: readonly GameFailure[];
  readonly checkedProjections: number;
  readonly commandResults?: readonly CommandResult[];
  /** Retained only for blocked-game diagnosis; both sides remain private projections. */
  readonly diagnosticProjections?: readonly V2Projection[];
}

interface ProcessSample {
  readonly atMs: number;
  readonly rssBytes: number;
  readonly cpuPercent: number;
  readonly loadAverage: readonly [number, number, number];
}

interface ProcessUsage {
  readonly ticks: number;
  readonly rssBytes: number;
}

interface DirectorySize {
  readonly bytes: number;
  readonly files: number;
}

interface LevelResult {
  readonly mode: RunMode;
  readonly rooms: number;
  readonly port: number;
  readonly storageDirectory: string | null;
  readonly storageReused: boolean;
  readonly serverStartupMs: number;
  readonly gameExecutionMs: number;
  readonly averageGameMs: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly host: Readonly<Record<string, unknown>>;
  readonly server: {
    readonly pid: number;
    readonly rssPeakBytes: number;
    readonly rssAverageBytes: number;
    readonly cpuAveragePercent: number;
    readonly cpuPeakPercent: number;
    readonly exitedUnexpectedly: boolean;
    readonly rssSamples: number;
    readonly cpuSamples: number;
  };
  readonly aggregate: {
    readonly completedGames: number;
    readonly wonGames: number;
    readonly blockedGames: number;
    readonly timedOutGames: number;
    readonly totalCommands: number;
    readonly commandsPerSecond: number;
    readonly latencyP50Ms: number;
    readonly latencyP95Ms: number;
    readonly latencyP99Ms: number;
    readonly latencyMaxMs: number;
    readonly averageGameMs: number;
    readonly rejectedCommands: number;
    readonly errors: number;
    readonly disconnects: number;
    readonly timeouts: number;
    readonly checkedProjections: number;
  };
  readonly storage: {
    readonly initialBytes: number;
    readonly finalBytes: number;
    readonly growthBytes: number;
    readonly files: number;
    readonly bytesPerGame: number;
  };
  readonly loadAverageStart: readonly [number, number, number];
  readonly loadAverageEnd: readonly [number, number, number];
  readonly loadAveragePeak1m: number;
  readonly hostCpuAveragePercent: number;
  readonly hostCpuPeakPercent: number;
  readonly games: readonly GameResult[];
  readonly failureCategoryCounts: Readonly<Record<string, number>>;
  readonly perGameAverage: {
    readonly commandLatencyP50Ms: number;
    readonly commandLatencyP95Ms: number;
    readonly commandLatencyP99Ms: number;
    readonly commandLatencyMaxMs: number;
    readonly rssPeakBytes: number;
    readonly rssAverageBytes: number;
    readonly cpuAveragePercent: number;
    readonly cpuPeakPercent: number;
    readonly storageGrowthBytes: number;
    readonly commandsPerSecond: number;
  };
  readonly samples: readonly ProcessSample[];
  readonly limitBreached: boolean;
  readonly possiblePortConflict: boolean;
  readonly measuredAt: string;
  readonly cleanup: {
    readonly serverExited: boolean;
    readonly socketsClosed: boolean;
    readonly portsReleased: boolean;
    readonly cleanupProblems: readonly string[];
  };
}

interface LoadTestReport {
  readonly schema: "riftbound.server-load-test.v1";
  readonly generatedAt: string;
  readonly command: readonly string[];
  readonly git: {
    readonly commit: string;
    readonly branch: string;
    readonly dirty: boolean;
  };
  readonly environment: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Record<string, unknown>>;
  readonly results: readonly LevelResult[];
  readonly stoppedAfter: number | null;
  readonly stopReason: string | null;
  /** Why the final level ended; null only when no level completed. */
  readonly terminalOutcome: "natural-win" | "coverage-blocked" | "product-blocked" |
    "timeout-blocked" | "transport-blocked" | null;
  readonly cleanup: {
    readonly serverExited: boolean;
    readonly socketsClosed: boolean;
    readonly portsReleased: boolean;
  };
  readonly cleanupProblems: readonly string[];
  readonly complete: boolean;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const packageRoot = path.resolve(scriptDirectory, "..");
const serverEntry = path.join(packageRoot, "src/index.ts");
const tsxLoader = path.join(packageRoot, "node_modules/tsx/dist/loader.mjs");
const taskName = process.env.SWARM_TASK ?? "RIFT-1082-server-load-test";
let activeChild: ChildProcess | null = null;
let activePortLease: PortLease | null = null;
const portAcceptsConnectionsCache = new Map<number, boolean>();
const scriptEntry = process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

async function cleanupActive(): Promise<void> {
  const child = activeChild;
  if (child !== null) {
    activeChild = null;
    await stopChild(child).catch(() => undefined);
  }
  const lease = activePortLease;
  if (lease !== null) {
    activePortLease = null;
    await lease.release().catch(() => undefined);
  }
}

if (scriptEntry) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void cleanupActive().finally(() => process.exit(128 + (signal === "SIGINT" ? 2 : 15)));
    });
  }
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function integerOption(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`--${name} must be an integer in ${minimum}..${maximum}`);
  }
  return value;
}

export function deterministicLoadCommandId(
  seed: string,
  side: "first" | "second",
  action: number
): string {
  if (seed.length === 0 || (side !== "first" && side !== "second") ||
      !Number.isSafeInteger(action) || action < 0) {
    throw new RangeError("deterministic load command identity is invalid");
  }
  return `load-${seed}-${side}-${action}`;
}

function parseOptions(): CliOptions {
  if (process.env.SWARM_TASK === undefined) {
    throw new Error("SWARM_TASK is required so owned server PIDs are recorded exactly");
  }
  const requiredPortBase = Number(process.env.SWARM_PORT_BASE);
  if (!Number.isSafeInteger(requiredPortBase) || requiredPortBase < 1 || requiredPortBase > 65_535) {
    throw new RangeError("SWARM_PORT_BASE must be a valid TCP port");
  }
  const requiredPortSpan = Number(process.env.SWARM_PORT_SPAN);
  if (!Number.isSafeInteger(requiredPortSpan) || requiredPortSpan < 1 || requiredPortSpan > 100 ||
      requiredPortBase + requiredPortSpan - 1 > 65_535) {
    throw new RangeError("SWARM_PORT_SPAN must describe an owned TCP port range");
  }
  const modesRaw = option("modes") ?? "file";
  const modes = modesRaw.split(",");
  if (modes.length === 0 || modes.some(mode => mode !== "file" && mode !== "memory")) {
    throw new RangeError("--modes must be a comma-separated subset of file,memory");
  }
  const levels = (option("levels") ?? "1,5,10,20,40")
    .split(",")
    .map(Number);
  if (levels.length === 0 || levels.some(level => !Number.isSafeInteger(level) || level < 1 || level > 100)) {
    throw new RangeError("--levels must contain integers in 1..100");
  }
  const portBase = integerOption("port-base", Number(process.env.SWARM_PORT_BASE ?? "35680"), 1, 65_535);
  const portSpan = integerOption("port-span", Number(process.env.SWARM_PORT_SPAN ?? "20"), 1, 100);
  if (portBase !== requiredPortBase || portSpan !== requiredPortSpan) {
    throw new RangeError("load-test port options must stay inside the task-owned SWARM port range");
  }
  if (portBase + portSpan - 1 > 65_535) throw new RangeError("The selected port range exceeds 65535");
  const outputDirectory = path.resolve(option("output-dir") ??
    "/root/swarm-rift/shared/RIFT-1082-server-load-test");
  const storageRoot = path.resolve(option("storage-dir") ??
    "/root/swarm-rift/shared/RIFT-1082-server-load-test");
  const deterministicSeed = option("deterministic-seed") ?? null;
  if (deterministicSeed !== null && deterministicSeed.length === 0) {
    throw new Error("--deterministic-seed must be non-empty when provided");
  }
  return {
    modes: [...new Set(modes)] as RunMode[],
    levels: [...new Set(levels)].sort((left, right) => left - right),
    outputDirectory,
    storageRoot,
    portBase,
    portSpan,
    maxCommandsPerGame: integerOption("max-commands", 500, 1, 10_000),
    maxTurnsPerGame: integerOption("max-turns", 40, 1, 500),
    commandTimeoutMs: integerOption("command-timeout-ms", 30_000, 1_000, 300_000),
    gameTimeoutMs: integerOption("game-timeout-ms", 900_000, 10_000, 3_600_000),
    startupTimeoutMs: integerOption("startup-timeout-ms", 180_000, 1_000, 300_000),
    deterministicSeed
  };
}

function sleep(durationMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, durationMs)));
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]!;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function packet(value: unknown): Packet | null {
  return record(value) && typeof value.type === "string" ? value as Packet : null;
}

function commandReceipt(value: unknown): V2CommandReceipt | null {
  if (!record(value) || value.type !== "command-receipt" ||
      value.protocolVersion !== PROTOCOL_V2_VERSION || typeof value.commandId !== "string" ||
      typeof value.accepted !== "boolean" || typeof value.stateVersion !== "number" ||
      typeof value.eventSeq !== "number") return null;
  return value as unknown as V2CommandReceipt;
}

function projectionMessage(value: unknown): V2Projection | null {
  if (!record(value) || value.type !== "projection" || value.protocolVersion !== PROTOCOL_V2_VERSION ||
      !isV2Projection(value.projection)) return null;
  return value.projection;
}

function observation(projection: V2Projection): ProjectionObservation {
  return {
    stateVersion: projection.stateVersion,
    eventSeq: projection.eventSeq,
    pendingChoice: projection.pendingChoice
  };
}

function semanticObservation(projection: V2Projection): string {
  const replay = (zone: V2Projection["zones"][number]) =>
    zone.objects?.map(object => ({ objectId: object.objectId, zoneEntryId: object.zoneEntryId,
      exhausted: object.exhausted, controllerPlayerId: object.controllerPlayerId })) ?? [];
  return JSON.stringify({
    stateVersion: projection.stateVersion,
    eventSeq: projection.eventSeq,
    phase: projection.phase,
    turnNumber: projection.turnNumber,
    activePlayerId: projection.activePlayerId,
    priority: projection.priority,
    chain: projection.chain,
    combat: projection.combat,
    pendingChoice: projection.pendingChoice,
    players: projection.players.map(player => ({ playerId: player.playerId,
      energy: player.energy, power: player.power, score: player.score })),
    zones: projection.zones.map(zone => ({ zone: zone.zone, owner: zone.ownerPlayerId,
      count: zone.count, objects: replay(zone) })),
    objects: projection.objects.map(object => ({ objectId: object.objectId,
      zoneEntryId: object.zoneEntryId, zone: object.zone,
      exhausted: object.exhausted, controllerPlayerId: object.controllerPlayerId })),
    actionOptions: projection.actionOptions,
    winnerPlayerId: projection.winnerPlayerId
  });
}

function phaseLabel(projection: V2Projection): string {
  return `${projection.phase}/turn-${projection.turnNumber}/state-${projection.stateVersion}`;
}

class WebSocketClient {
  private readonly packets: Packet[] = [];
  private readonly waiters = new Set<() => void>();
  private readonly traffic: Packet[] = [];
  private sequence = 0;
  private snapshotState: ClientSnapshot | null = null;
  private open = false;
  private closed = false;
  private closeCount = 0;

  private constructor(
    readonly label: string,
    private readonly socket: WebSocket
  ) {
    socket.on("open", () => { this.open = true; this.wake(); });
    socket.on("close", () => {
      this.closed = true;
      this.open = false;
      this.closeCount += 1;
      this.traffic.push({ type: "socket-close" });
      this.wake();
    });
    socket.on("error", () => {
      this.traffic.push({ type: "socket-error" });
      this.wake();
    });
    socket.on("message", data => {
      let parsed: unknown;
      try { parsed = JSON.parse(String(data)); }
      catch { this.traffic.push({ type: "invalid-json" }); this.wake(); return; }
      const incoming = packet(parsed);
      if (incoming === null) {
        this.traffic.push({ type: "invalid-packet" });
        this.wake();
        return;
      }
      this.traffic.push({ type: incoming.type });
      const current = this.snapshotState;
      if (incoming.type === "welcome" && record(incoming.session)) {
        const session = incoming.session as Record<string, unknown>;
        if (typeof session.roomId === "string" && typeof session.playerId === "string" &&
            typeof session.resumeToken === "string") {
          this.snapshotState = {
            session: {
              roomId: session.roomId,
              playerId: session.playerId,
              resumeToken: session.resumeToken
            },
            roomVersion: current?.roomVersion ?? 0,
            projection: current?.projection ?? null
          };
        }
      } else if (incoming.type === "room" && record(incoming.room) && current !== null) {
        const room = incoming.room;
        if (typeof room.roomVersion === "number") {
          this.snapshotState = { ...current, roomVersion: room.roomVersion };
        }
      } else if (incoming.type === "projection") {
        const projection = projectionMessage(incoming);
        if (projection === null || this.snapshotState === null) {
          this.traffic.push({ type: "invalid-projection" });
        } else {
          this.snapshotState = { ...this.snapshotState, projection };
        }
      }
      this.packets.push(incoming);
      this.wake();
    });
  }

  static async connect(url: string, label: string, timeoutMs: number): Promise<WebSocketClient> {
    const socket = new WebSocket(url);
    const opened = new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", error => reject(new Error(
        `${label}: websocket error ${error.message} (readyState ${socket.readyState})`
      )));
    });
    const client = new WebSocketClient(label, socket);
    await Promise.race([
      opened,
      sleep(timeoutMs).then(() => { throw new Error(`${label}: timed out waiting for websocket open`); })
    ]);
    client.send({ type: "hello", protocolVersion: PROTOCOL_V2_VERSION });
    await client.waitFor(candidate => candidate.type === "welcome" && candidate.session === undefined,
      timeoutMs, "V2 welcome");
    return client;
  }

  get snapshot(): ClientSnapshot {
    if (this.snapshotState === null || this.snapshotState.session.roomId.length === 0) {
      throw new Error(`${this.label}: session state is unavailable`);
    }
    return this.snapshotState;
  }

  get isClosed(): boolean { return this.closed; }
  get disconnectCount(): number { return this.closeCount; }
  get readyState(): number { return this.open && this.socket.readyState === WebSocket.OPEN ? 1 : 0; }

  async createRoom(playerName: string, timeoutMs: number): Promise<void> {
    const requestId = this.nextId("create");
    this.send({ type: "create-room", requestId, playerName, rulesetId: "riftbound-duel" });
    await this.waitRequest(requestId, timeoutMs);
    await this.waitFor(candidate => candidate.type === "welcome" && record(candidate.session),
      timeoutMs, `${this.label} room session`);
    await this.waitFor(candidate => candidate.type === "room" && record(candidate.room),
      timeoutMs, `${this.label} initial room`);
  }

  async joinRoom(roomId: string, playerName: string, timeoutMs: number): Promise<void> {
    const requestId = this.nextId("join");
    this.send({ type: "join-room", requestId, roomId, playerName });
    await this.waitFor(candidate => candidate.type === "welcome" && record(candidate.session),
      timeoutMs, `${this.label} room session`);
    await this.waitRequest(requestId, timeoutMs);
    await this.waitFor(candidate => candidate.type === "room" && record(candidate.room) &&
      Array.isArray(candidate.room.players) && candidate.room.players.length === 2,
      timeoutMs, `${this.label} two-player room`);
  }

  async submitDeck(deck: RoomDeckSubmission, timeoutMs: number): Promise<void> {
    await this.sendRoomMutation("deck", { deck }, timeoutMs);
    await this.waitFor(candidate => candidate.type === "room" && record(candidate.room) &&
      Array.isArray(candidate.room.players) && candidate.room.players.some(player =>
        record(player) && player.id === this.snapshot.session.playerId && player.deckSubmitted === true),
      timeoutMs, `${this.label} deck acknowledgement`);
  }

  async setReady(timeoutMs: number): Promise<void> {
    await this.sendRoomMutation("ready", { ready: true }, timeoutMs);
  }

  async sendCommand(command: V2Command, timeoutMs: number): Promise<{
    readonly receipt: V2CommandReceipt;
    readonly latencyMs: number;
  }> {
    const startIndex = this.packets.length;
    const started = performance.now();
    this.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION, command });
    for (;;) {
      const receiptIndex = this.packets.findIndex((candidate, index) => index >= startIndex &&
        candidate.type === "command-receipt" && candidate.commandId === command.commandId);
      if (receiptIndex >= 0) {
        const candidate = commandReceipt(this.packets.splice(receiptIndex, 1)[0]);
        if (candidate === null) throw new Error(`${this.label}: malformed command receipt`);
        return { receipt: candidate, latencyMs: performance.now() - started };
      }
      const errorIndex = this.packets.findIndex((candidate, index) => index >= startIndex &&
        candidate.type === "error" &&
        (candidate.requestId === command.commandId || candidate.requestId === undefined));
      if (errorIndex >= 0) {
        const failure = this.packets.splice(errorIndex, 1)[0]!;
        throw new Error(`${this.label}: ${String(failure.code ?? "command-rejected")}: ${String(failure.message ?? "")}`);
      }
      if (this.closed) throw new Error(`${this.label}: websocket closed while awaiting ${command.commandId}`);
      if (performance.now() - started >= timeoutMs) {
        throw new Error(`${this.label}: command ${command.commandId} exceeded ${timeoutMs}ms`);
      }
      await this.waitUntilSignal(timeoutMs - (performance.now() - started));
    }
  }

  async waitForConvergence(
    stateVersion: number,
    eventSeq: number,
    label: string,
    timeoutMs: number
  ): Promise<V2Projection> {
    return this.waitForProjection(candidate => candidate.stateVersion >= stateVersion &&
      candidate.eventSeq >= eventSeq, label, timeoutMs);
  }

  async synchronizeProjection(clock: ProjectionObservation, label: string, timeoutMs: number): Promise<void> {
    const current = this.snapshotState?.projection;
    if (current !== null && current !== undefined &&
        current.stateVersion === clock.stateVersion && current.eventSeq === clock.eventSeq) return;
    await this.waitFor(candidate => {
      const projection = projectionMessage(candidate);
      return projection !== null && projection.stateVersion >= clock.stateVersion &&
        projection.eventSeq >= clock.eventSeq;
    }, timeoutMs, label);
  }

  async waitForProjectionAfter(
    commandId: string,
    before: V2Projection,
    receipt: V2CommandReceipt,
    timeoutMs: number
  ): Promise<V2Projection> {
    const previousSemantic = semanticObservation(before);
    let consumed = false;
    const accepts = (projection: V2Projection): boolean => {
      if (projection.stateVersion < receipt.stateVersion || projection.eventSeq < receipt.eventSeq) return false;
      // Pending choices deliberately keep the state and event clocks unchanged.
      // Compare against this client's own prior semantic projection so each
      // viewer must consume the broadcast caused by the accepted command. A
      // comparison against the actor's private view can pass immediately for the
      // other viewer and leave the owner looking at its stale pre-choice state.
      if (consumed || semanticObservation(projection) === previousSemantic) return false;
      consumed = true;
      return true;
    };
    const current = this.snapshotState?.projection;
    if (current !== undefined && current !== null && accepts(current)) return current;
    const candidate = await this.waitFor(raw => {
      const projection = projectionMessage(raw);
      return projection !== null && accepts(projection);
    }, timeoutMs, `${this.label} projection after ${commandId}`);
    const projection = projectionMessage(candidate);
    if (projection === null) throw new Error(`${this.label}: projection disappeared after receipt`);
    return projection;
  }

  async waitForProjection(
    predicate: (projection: V2Projection) => boolean,
    label: string,
    timeoutMs: number
  ): Promise<V2Projection> {
    const current = this.snapshotState?.projection;
    if (current !== null && current !== undefined && predicate(current)) return current;
    const candidate = await this.waitFor(raw => {
      const projection = projectionMessage(raw);
      return projection !== null && predicate(projection);
    }, timeoutMs, label);
    const projection = projectionMessage(candidate);
    if (projection === null) throw new Error(`${this.label}: ${label} yielded a non-projection packet`);
    return projection;
  }

  trace(): readonly Packet[] { return this.traffic; }

  closeImmediately(): void {
    this.open = false;
    try { this.socket.terminate(); } catch { /* already closed */ }
  }

  private send(value: Readonly<Record<string, unknown>>): void {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error(`${this.label}: websocket is not open`);
    this.socket.send(JSON.stringify(value));
  }

  private nextId(kind: string): string {
    this.sequence += 1;
    return `load-${this.label.replaceAll(/[^a-zA-Z0-9-]/g, "-")}-${kind}-${this.sequence}`;
  }

  private async reconcileLatestRoom(): Promise<void> {
    await sleep(25);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (this.packets.some(candidate => candidate.type === "room" && record(candidate.room))) break;
      await sleep(5);
    }
    const roomPackets = this.packets.flatMap((candidate, index) =>
      candidate.type === "room" && record(candidate.room) ? [{ candidate, index }] : []);
    const latest = roomPackets.at(-1);
    const room = latest === undefined ? null : record(latest.candidate.room)
      ? latest.candidate.room : null;
    if (latest !== undefined && room !== null && typeof room.roomVersion === "number") {
      this.snapshotState = this.snapshotState === null ? null : {
        ...this.snapshotState,
        roomVersion: room.roomVersion
      };
      const firstIndex = roomPackets[0]!.index;
      this.packets.splice(firstIndex, latest.index - firstIndex + 1);
    }
  }

  private async waitRequest(requestId: string, timeoutMs: number): Promise<RequestReceipt> {
    const incoming = await this.waitFor(candidate =>
      (candidate.type === "request-result" || candidate.type === "error") &&
      (candidate.requestId === requestId ||
        (candidate.type === "error" && candidate.requestId === undefined)),
      timeoutMs, `${this.label} request ${requestId}`);
    if (incoming.type === "error") {
      throw new Error(`${this.label}: ${String(incoming.code ?? "request-rejected")}: ${String(incoming.message ?? "")}`);
    }
    const receipt = incoming as unknown as RequestReceipt;
    if (receipt.ok !== true) throw new Error(`${this.label}: request ${requestId} was not accepted`);
    if (this.snapshotState !== null && typeof receipt.roomVersion === "number") {
      this.snapshotState = { ...this.snapshotState, roomVersion: receipt.roomVersion };
    }
    return receipt;
  }

  private async sendRoomMutation(
    kind: "deck" | "ready",
    payload: Readonly<Record<string, unknown>>,
    timeoutMs: number
  ): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.reconcileLatestRoom();
      const requestId = this.nextId(kind);
      this.send({
        type: kind === "deck" ? "submit-deck" : "set-ready",
        requestId,
        expectedRoomVersion: this.snapshot.roomVersion,
        ...payload
      });
      try {
        await this.waitRequest(requestId, timeoutMs);
        return;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("stale-version") || attempt === 4) {
          throw error;
        }
        await sleep(10);
      }
    }
  }

  private async waitFor(
    predicate: (candidate: Packet) => boolean,
    timeoutMs: number,
    label: string
  ): Promise<Packet> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      const index = this.packets.findIndex(predicate);
      if (index >= 0) return this.packets.splice(index, 1)[0]!;
      if (this.closed) throw new Error(`${this.label}: websocket closed while waiting for ${label}`);
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        throw new Error(`${this.label}: timed out waiting for ${label}; queued ${JSON.stringify(
          this.packets.map(candidate => ({ type: candidate.type, code: candidate.code }))
        )}; snapshot ${JSON.stringify(this.snapshotState === null ? null : {
          stateVersion: this.snapshotState.projection?.stateVersion,
          eventSeq: this.snapshotState.projection?.eventSeq,
          choice: this.snapshotState.projection?.pendingChoice.status,
          priority: this.snapshotState.projection?.priority,
          phase: this.snapshotState.projection?.phase,
          turn: this.snapshotState.projection?.turnNumber
        })}`);
      }
      await this.waitUntilSignal(remaining);
    }
  }

  private async waitUntilSignal(timeoutMs: number): Promise<void> {
    await new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wake = (): void => {
        this.waiters.delete(wake);
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      };
      this.waiters.add(wake);
      timer = setTimeout(wake, Math.max(1, timeoutMs));
    });
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}

interface RuntimePair {
  readonly first: WebSocketClient;
  readonly second: WebSocketClient;
  readonly roomId: string;
  readonly checkedProjections: { count: number; readonly violations: string[] };
}

function currentClientProjection(client: WebSocketClient): V2Projection {
  const projection = client.snapshot.projection;
  if (projection === null) throw new Error(`${client.label}: no V2 projection`);
  return projection;
}

function dueSetupPlayer(views: readonly [V2Projection, V2Projection]): string | null {
  const pending = views.flatMap(view => view.phase === "setup" &&
    view.pendingChoice.status === "pending" ? [view.pendingChoice.ownerPlayerId] : []);
  return pending.length === 1 ? pending[0]! : null;
}

function projectedActor(projection: V2Projection): string | null {
  const pending = projection.pendingChoice;
  if (pending.status === "pending") return pending.ownerPlayerId;
  if (projection.combat.status === "active") {
    if (projection.combat.step === "damage") return projectedCombatDamagePlayer(projection);
    if (projection.priority.playerId !== null) return projection.priority.playerId;
  }
  if (projection.priority.playerId !== null) return projection.priority.playerId;
  if (projection.actionOptions.canAdvance) return projection.activePlayerId;
  if (projection.actionOptions.canEndTurn) return projection.activePlayerId;
  if (projection.phase === "main" && projection.chain.items.length === 0 &&
      projection.combat.status === "none") return projection.activePlayerId;
  return null;
}

function projectedCombatDamageCommand(
  projection: V2Projection,
  viewerPlayerId: string,
  commandId: string,
  rejectedAssignments: ReadonlySet<string> = new Set()
): Extract<V2Command, { type: "combat-damage" }> | null {
  const damage = projection.combat.status === "active" ? projection.combat.damage : undefined;
  if (damage === undefined || projection.combat.combatId === undefined ||
      projectedCombatDamagePlayer(projection) !== viewerPlayerId ||
      projection.viewerPlayerId !== viewerPlayerId) return null;
  const battlefield = projection.battlefields.find(field =>
    field.battlefieldId === projection.combat.battlefieldId);
  const opponent = projection.players.find(player => player.playerId !== viewerPlayerId)?.playerId;
  if (battlefield === undefined || opponent === undefined) return null;
  const targets = battlefield.occupantObjectIds.flatMap(objectId => {
    const object = projection.objects.find(candidate => candidate.objectId === objectId);
    const controller = object?.controllerPlayerId ?? object?.ownerPlayerId;
    return object === undefined || controller !== opponent || object.zone !== "board" &&
      object.zone !== "battlefield" || object.might === undefined ? [] : [object];
  });
  const budget = damage.attackerSubmitted ? damage.defenderMight : damage.attackerMight;
  const orders = targetOrders(targets);
  for (const order of orders) {
    const assignments: { readonly unitObjectId: string; readonly amount: number }[] = [];
    let remainingBudget = budget;
    for (const target of order) {
      if (remainingBudget <= 0) break;
      const remainingDamage = target.damage ?? 0;
      const lethal = Math.max(1, (target.might ?? 0) - remainingDamage);
      const amount = Math.min(remainingBudget, lethal);
      if (amount > 0) assignments.push({ unitObjectId: target.objectId, amount });
      remainingBudget -= amount;
    }
    if (assignments.length === 0 || remainingBudget > 0) continue;
    const key = combatAssignmentKey(projection, assignments);
    if (rejectedAssignments.has(key)) continue;
    return { type: "combat-damage", commandId, stateVersion: projection.stateVersion,
      combatId: projection.combat.combatId, assignments };
  }
  return null;
}

function targetOrders<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length <= 1) return [values];
  // Exhaustive ordering is bounded because the visible wire surface does not
  // disclose assignment-priority metadata. Beyond six targets, retain one
  // deterministic order and fail closed when the server rejects it.
  if (values.length > 6) return [values];
  return values.flatMap((value, index) => targetOrders([
    ...values.slice(0, index), ...values.slice(index + 1),
  ]).map(rest => [value, ...rest]));
}

function combatAssignmentKey(
  projection: V2Projection,
  assignments: Extract<V2Command, { type: "combat-damage" }>["assignments"]
): string {
  return `${projection.stateVersion}:${projection.combat.status === "active"
    ? projection.combat.combatId ?? "" : ""}:${JSON.stringify(assignments)}`;
}

function projectedActorFromViews(
  views: readonly [V2Projection, V2Projection]
): string | null {
  const pendingOwners = views.flatMap(view => view.pendingChoice.status === "pending"
    ? [view.pendingChoice.ownerPlayerId] : []);
  const uniquePendingOwners = [...new Set(pendingOwners)];
  if (uniquePendingOwners.length > 1) {
    throw new Error(`Projections disagree about choice ownership: ${uniquePendingOwners.join(",")}`);
  }
  if (uniquePendingOwners.length === 1) return uniquePendingOwners[0]!;
  return projectedActor(views[0]);
}

function pendingChoiceFromViews(
  views: readonly [V2Projection, V2Projection]
): Extract<V2Projection["pendingChoice"], { status: "pending" }> | null {
  const pending = views.flatMap(view => view.pendingChoice.status === "pending"
    ? [view.pendingChoice] : []);
  if (pending.length === 0) return null;
  const choice = pending[0]!;
  if (pending.some(candidate => candidate.choiceId !== choice.choiceId ||
      candidate.ownerPlayerId !== choice.ownerPlayerId || candidate.kind !== choice.kind ||
      candidate.stateVersion !== choice.stateVersion)) {
    throw new Error("Projections disagree about the current pending choice");
  }
  return choice;
}

function commandCardName(view: V2Projection): string | null {
  const pending = view.pendingChoice.status === "pending" ? view.pendingChoice : null;
  const sourceName = pending?.source?.name;
  if (typeof sourceName === "string" && sourceName.length > 0) return sourceName;
  return null;
}

function chooseSession(pair: RuntimePair, playerId: string): {
  readonly client: WebSocketClient;
  readonly projection: V2Projection;
} {
  const firstId = pair.first.snapshot.session.playerId;
  const client = firstId === playerId ? pair.first : pair.second;
  const projection = currentClientProjection(client);
  if (projection.viewerPlayerId !== playerId) {
    throw new Error(`${client.label}: selected view belongs to ${String(projection.viewerPlayerId)} instead of ${playerId}`);
  }
  return { client, projection };
}

async function chooseCurrentSession(
  pair: RuntimePair,
  playerId: string,
  expected: Extract<V2Projection["pendingChoice"], { status: "pending" }> | null,
  timeoutMs: number
): Promise<{
  readonly client: WebSocketClient;
  readonly projection: V2Projection;
}> {
  const selected = chooseSession(pair, playerId);
  if (expected === null) return selected;
  const current = selected.projection.pendingChoice;
  if (current.status === "pending" && current.choiceId === expected.choiceId &&
      current.ownerPlayerId === playerId && current.stateVersion === expected.stateVersion) {
    return selected;
  }
  const projection = await selected.client.waitForProjection(candidate => {
    const pending = candidate.pendingChoice;
    return pending.status === "pending" && pending.choiceId === expected.choiceId &&
      pending.ownerPlayerId === playerId && pending.stateVersion === expected.stateVersion;
  }, `${playerId} owner projection for ${expected.choiceId}`, timeoutMs);
  return { client: selected.client, projection };
}

function nextCommandId(seed: string, side: Side, action: number): string {
  return deterministicLoadCommandId(seed, side, action);
}

async function startPair(
  url: string,
  roomIndex: number,
  timeoutMs: number
): Promise<RuntimePair> {
  const seed = `RIFT-1082-${roomIndex}`;
  const privacy: { count: number; violations: string[] } = { count: 0, violations: [] };
  let firstId = "";
  let secondId = "";
  const observe = (projection: V2Projection): void => {
    if (firstId.length === 0 || secondId.length === 0) return;
    if (projection.viewerPlayerId !== firstId && projection.viewerPlayerId !== secondId) return;
    const opponent = projection.viewerPlayerId === firstId ? secondId : firstId;
    const audit = auditProjectionPrivacy(projection, opponent,
      { checkedProjections: privacy.count, violations: privacy.violations });
    privacy.count = audit.checkedProjections;
    privacy.violations = [...audit.violations];
  };
  const first = await WebSocketClient.connect(url, `${seed}-first`, timeoutMs);
  const second = await WebSocketClient.connect(url, `${seed}-second`, timeoutMs);
  try {
    await first.createRoom(`Rumble-${roomIndex}`, timeoutMs);
    await second.joinRoom(first.snapshot.session.roomId, `Fiora-${roomIndex}`, timeoutMs);
    firstId = first.snapshot.session.playerId;
    secondId = second.snapshot.session.playerId;
    await first.submitDeck(V2_M1_PRECONS["rumble-sfd"].deck, timeoutMs);
    await second.submitDeck(V2_M1_PRECONS["fiora-sfd"].deck, timeoutMs);
    await first.setReady(timeoutMs);
    await second.setReady(timeoutMs);
    const views = await Promise.all([
      first.waitForProjection(() => true, `${seed} first started projection`, timeoutMs),
      second.waitForProjection(() => true, `${seed} second started projection`, timeoutMs)
    ]);
    await Promise.all([
      first.waitForProjection(projection => projection.phase === "setup" &&
        projection.pendingChoice.status === "pending", `${seed} first initial clock`, timeoutMs),
      second.waitForProjection(projection => projection.phase === "setup",
        `${seed} second initial clock`, timeoutMs)
    ]);
    if (process.env.RIFT1082_DEBUG === "1") {
      process.stderr.write(JSON.stringify({ message: "pair-projection-inventory", roomIndex,
        first: first.trace().filter(frame => frame.type === "projection").length,
        second: second.trace().filter(frame => frame.type === "projection").length,
        beforeOwner: views.map(view => ({ viewer: view.viewerPlayerId, phase: view.phase,
          pending: view.pendingChoice.status })) }) + "\n");
    }
    observe(views[0]);
    observe(views[1]);
    return { first, second, roomId: first.snapshot.session.roomId, checkedProjections: privacy };
  } catch (error) {
    first.closeImmediately();
    second.closeImmediately();
    throw error;
  }
}

const cardFacts = new Map(Object.values(V2_M1_PRECONS).flatMap<readonly [string, CardFact]>(precon =>
  precon.cards.map(card => {
    const program = cardProgramsById.get(card.canonicalCardId) as unknown as CardProgram | undefined;
    const kind: "unit" | "gear" | "spell" = card.cardType.toLowerCase() === "unit" ? "unit" :
      card.cardType.toLowerCase() === "gear" ? "gear" : "spell";
    return [card.canonicalCardId, {
      energy: card.energy ?? null,
      power: card.power ?? null,
      status: String(program?.status ?? "pending"),
      kind
    }] as const;
  })));

/**
 * Answer the exact choice projected to its owner. The authoritative runtime
 * omits `options` for empty select-objects candidates and for optional/number
 * choices, so the load driver derives only the choice-shaped minimum answer
 * and leaves every legality decision to the server.
 */
export function loadBotCommand(
  projection: V2Projection,
  viewerPlayerId: string,
  commandId: string,
  rejectedPlayIds: ReadonlySet<string> = new Set(),
  cardFacts: ReadonlyMap<string, CardFact> = new Map(),
  rejectedCombatAssignments: ReadonlySet<string> = new Set()
): V2Command | null {
  const pending = projection.pendingChoice;
  if (pending.status !== "pending" || projection.phase === "setup") {
    const combatDamage = projectedCombatDamageCommand(projection, viewerPlayerId, commandId,
      rejectedCombatAssignments);
    if (combatDamage !== null) return combatDamage;
    return botCommand(projection, viewerPlayerId, commandId, rejectedPlayIds, cardFacts);
  }
  if (projection.viewerPlayerId !== viewerPlayerId || pending.ownerPlayerId !== viewerPlayerId) return null;
  const options = pending.options ?? [];
  let answer: V2ChooseCommand["answer"] | null;
  switch (pending.kind) {
    case "optional":
      answer = false;
      break;
    case "mode": {
      const option = options[0];
      answer = option === undefined ? null : option.value ?? option.id;
      break;
    }
    case "select-objects": {
      const min = pending.min ?? 1;
      const max = pending.max ?? options.length;
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min ||
          options.length < min) {
        answer = null;
        break;
      }
      const selected = options.slice(0, min);
      answer = selected.every(option => option.objectRef !== undefined)
        ? selected.map(option => option.objectRef!) : null;
      break;
    }
    case "order": {
      answer = options.length > 0 && options.every(option => option.objectRef !== undefined)
        ? options.map(option => option.objectRef!) : null;
      break;
    }
    case "number": {
      answer = typeof pending.min === "number" && Number.isSafeInteger(pending.min) &&
        typeof pending.max === "number" && Number.isSafeInteger(pending.max) &&
        pending.min >= 0 && pending.max >= pending.min ? pending.min : null;
      break;
    }
  }
  if (answer === null) return null;
  return { type: "choose", commandId, stateVersion: projection.stateVersion,
    choiceId: pending.choiceId, answer };
}

function loadBotSelfTest(): void {
  const base = {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "load-test-self-test",
    viewerPlayerId: "player-1",
    stateVersion: 4,
    eventSeq: 88,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "player-1",
    players: ["player-1", "player-2"].map(playerId => ({ playerId, name: playerId,
      score: 0, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 0,
      runeDeckCount: 0, zoneCounts: {} })),
    zones: [],
    objects: [],
    chain: { status: "closed", phase: "open", priorityPlayerId: null,
      focusPlayerId: null, items: [] },
    priority: { playerId: null, focusPlayerId: null, window: "choice" },
    scoring: { victoryScore: 8, battlefieldLocationIds: [], players: [] },
    battlefields: [],
    combat: { status: "none" },
    actionOptions: { canEndTurn: false, canAdvance: false, moves: [], plays: [] },
    winnerPlayerId: null,
    events: [],
  } as const;
  const withChoice = (pendingChoice: V2Projection["pendingChoice"]): V2Projection =>
    ({ ...base, pendingChoice }) as V2Projection;
  const choice = { status: "pending", choiceId: "choice", ownerPlayerId: "player-1",
    stateVersion: 4 } as const;
  const answerFor = (pendingChoice: V2Projection["pendingChoice"]) => {
    const command = loadBotCommand(withChoice(pendingChoice), "player-1", "self-test");
    return command?.type === "choose" ? command.answer : command;
  };

  // RIFT-1082 reproduced this exact empty-owner projection. It is a complete
  // select-objects prompt because min=0 even though the server correctly omits
  // an empty options array from the wire projection.
  assert.deepEqual(answerFor({ ...choice, kind: "select-objects", min: 0, max: 1 }), []);
  assert.equal(answerFor({ ...choice, kind: "select-objects", min: 1, max: 1 }), null);
  assert.equal(answerFor({ ...choice, kind: "optional" }), false);
  assert.equal(answerFor({ ...choice, kind: "mode", options: [{ id: "yes", label: "Yes", value: true }] }), true);
  assert.equal(answerFor({ ...choice, kind: "number", min: 0, max: 2 }), 0);
  assert.deepEqual(answerFor({ ...choice, kind: "order", options: [
    { id: "first", label: "First", objectRef: { objectId: "unit:1", zoneEntryId: 1 } },
    { id: "second", label: "Second", objectRef: { objectId: "unit:2", zoneEntryId: 1 } },
  ] }), [{ objectId: "unit:1", zoneEntryId: 1 }, { objectId: "unit:2", zoneEntryId: 1 }]);
  assert.equal(loadBotCommand(withChoice({ ...choice, kind: "optional" }), "player-2", "wrong-view"), null);

  const combat = {
    ...base,
    pendingChoice: { status: "none" },
    battlefields: [{ battlefieldId: "field", controllerPlayerId: null,
      contestedByPlayerId: null, staged: "combat", occupantObjectIds: ["unit:1", "unit:2"] }],
    objects: [
      { objectId: "unit:1", zoneEntryId: 1, zone: "battlefield", ownerPlayerId: "player-2",
        faceDown: false, visibility: "public", might: 4, damage: 0 },
      { objectId: "unit:2", zoneEntryId: 1, zone: "battlefield", ownerPlayerId: "player-2",
        faceDown: false, visibility: "public", might: 2, damage: 0 },
    ],
    combat: { status: "active", battlefieldId: "field", step: "damage", combatId: "combat:1",
      attackerPlayerId: "player-1", defenderPlayerId: "player-2",
      damage: { attackerMight: 5, defenderMight: 6, attackerSubmitted: false,
        expectedPlayerId: "player-1" } },
  } as V2Projection;
  assert.deepEqual(loadBotCommand(combat, "player-1", "self-combat"), {
    type: "combat-damage", commandId: "self-combat", stateVersion: 4,
    combatId: "combat:1", assignments: [
      { unitObjectId: "unit:1", amount: 4 }, { unitObjectId: "unit:2", amount: 1 },
    ],
  });
  const firstCombatAssignment = [
    { unitObjectId: "unit:1", amount: 4 }, { unitObjectId: "unit:2", amount: 1 },
  ];
  assert.deepEqual(loadBotCommand(combat, "player-1", "self-combat-next-order", new Set(),
    new Map(), new Set([combatAssignmentKey(combat, firstCombatAssignment)])), {
    type: "combat-damage", commandId: "self-combat-next-order", stateVersion: 4,
    combatId: "combat:1", assignments: [
      { unitObjectId: "unit:2", amount: 2 }, { unitObjectId: "unit:1", amount: 3 },
    ],
  });
}

function levelTraceHash(games: readonly GameResult[]): string {
  return createHash("sha256").update(JSON.stringify(games.map(game => ({
    room: game.room,
    seed: game.seed,
    roomId: game.roomId,
    termination: game.termination,
    winnerPlayerId: game.winnerPlayerId,
    turns: game.turns,
    commands: game.commands,
    commandResults: game.commandResults?.map(command => ({
      type: command.type, accepted: command.accepted, commandId: command.commandId,
      stateVersion: command.stateVersion, phase: command.phase,
      turnNumber: command.turnNumber, cardObjectId: command.cardObjectId,
      actorPlayerId: command.actorPlayerId,
    })),
    failures: game.failures,
  })))).digest("hex");
}

function terminalOutcome(games: readonly GameResult[],
  summary: LevelResult["aggregate"]): LoadTestReport["terminalOutcome"] {
  if (summary.completedGames === games.length && games.every(game =>
      game.termination === "winner" && game.failures.length === 0)) return "natural-win";
  const failures = games.flatMap(game => game.failures);
  if (failures.some(failure => failure.kind === "disconnect" ||
      failure.message.includes("websocket") || failure.message.includes("receipt convergence") ||
      failure.message.includes("projection after"))) return "transport-blocked";
  if (failures.some(failure =>
      failure.message.startsWith("no projected actor") ||
      failure.message.startsWith("no projected legal command") ||
      failure.message.startsWith("no projected answer"))) {
    return "coverage-blocked";
  }
  if (summary.timedOutGames > 0 || failures.some(failure => failure.kind === "timeout")) {
    return "timeout-blocked";
  }
  return "product-blocked";
}

async function driveGame(
  roomIndex: number,
  pair: RuntimePair,
  options: CliOptions
): Promise<GameResult> {
  const started = performance.now();
  const timings: CommandTiming[] = [];
  const failures: GameFailure[] = [];
  const rejectedPlays = new Map<string, Set<string>>();
  const rejectedCombatAssignments = new Map<string, Set<string>>();
  let terminal: V2Projection | null = null;
  let actionCount = 0;
  let termination: GameTermination = "blocked";
  let setupOwnerAfterCommand: string | null = null;
  const seed = `RIFT-1082-${roomIndex}`;
  const playerIds = [pair.first.snapshot.session.playerId, pair.second.snapshot.session.playerId] as const;

  try {
    for (; actionCount < options.maxCommandsPerGame; actionCount += 1) {
      if (performance.now() - started >= options.gameTimeoutMs) {
        termination = "timeout";
        failures.push({ kind: "timeout", message: `game exceeded ${options.gameTimeoutMs}ms` });
        break;
      }
      const live = [currentClientProjection(pair.first), currentClientProjection(pair.second)] as const;
      if (live[0].winnerPlayerId !== null || live[1].winnerPlayerId !== null) {
        termination = "winner";
        terminal = live[0].winnerPlayerId !== null ? live[0] : live[1];
        break;
      }
      if (live[0].stateVersion !== live[1].stateVersion ||
          live[0].eventSeq !== live[1].eventSeq) {
        const anchor = live[0].stateVersion >= live[1].stateVersion &&
          live[0].eventSeq >= live[1].eventSeq ? live[0] :
          live[1].stateVersion >= live[0].stateVersion && live[1].eventSeq >= live[0].eventSeq ? live[1] : null;
        if (anchor === null) {
          failures.push({ kind: "error", message: `viewer clocks crossed without a shared projection at state ` +
            `${live[0].stateVersion}:${live[0].eventSeq},${live[1].stateVersion}:${live[1].eventSeq}` });
          termination = "blocked";
          break;
        }
        if (live[0].stateVersion < anchor.stateVersion ||
            live[0].eventSeq < anchor.eventSeq) {
          await pair.first.waitForProjection(candidate => candidate.stateVersion >= anchor.stateVersion &&
            candidate.eventSeq >= anchor.eventSeq, `${seed} first state convergence`, options.commandTimeoutMs);
        }
        if (live[1].stateVersion < anchor.stateVersion ||
            live[1].eventSeq < anchor.eventSeq) {
          await pair.second.waitForProjection(candidate => candidate.stateVersion >= anchor.stateVersion &&
            candidate.eventSeq >= anchor.eventSeq, `${seed} second state convergence`, options.commandTimeoutMs);
        }
        actionCount -= 1;
        continue;
      }
      if (live[0].turnNumber > options.maxTurnsPerGame) {
        failures.push({ kind: "timeout", message: `turn guard ${options.maxTurnsPerGame} exceeded` });
        termination = "blocked";
        break;
      }
      if (live[0].phase === "setup" && setupOwnerAfterCommand !== null) {
        const previousOwner = setupOwnerAfterCommand;
        const progressDeadline = performance.now() + options.commandTimeoutMs;
        for (;;) {
          const waitingViews = [currentClientProjection(pair.first), currentClientProjection(pair.second)] as const;
          if (waitingViews[0].winnerPlayerId !== null || waitingViews[1].winnerPlayerId !== null) break;
          if (waitingViews[0].phase !== "setup") break;
          const nextOwner = dueSetupPlayer(waitingViews);
          if (nextOwner !== null && nextOwner !== previousOwner) break;
          if (performance.now() >= progressDeadline) {
            throw new Error(`setup did not advance after ${previousOwner}'s mulligan within ${options.commandTimeoutMs}ms`);
          }
          await sleep(10);
        }
        setupOwnerAfterCommand = null;
        actionCount -= 1;
        continue;
      }
      const actor = live[0].phase === "setup" ? dueSetupPlayer(live) : projectedActorFromViews(live);
      if (actor === null) {
        failures.push({ kind: "error", message: `no projected actor at ${phaseLabel(live[0])}` });
        termination = "blocked";
        break;
      }
      const expectedPending = live[0].phase === "setup" ? null : pendingChoiceFromViews(live);
      const selected = await chooseCurrentSession(pair, actor, expectedPending, options.commandTimeoutMs);
      const side: Side = actor === playerIds[0] ? "first" : "second";
      const commandId = nextCommandId(seed, side, actionCount);
      const rejectedForActor = rejectedPlays.get(actor) ?? new Set<string>();
      const rejectedCombatForActor = rejectedCombatAssignments.get(actor) ?? new Set<string>();
      const command = loadBotCommand(selected.projection, actor, commandId, rejectedForActor, cardFacts,
        rejectedCombatForActor);
      if (command === null) {
        const pending = selected.projection.pendingChoice.status === "pending"
          ? selected.projection.pendingChoice : null;
        failures.push({
          kind: pending === null ? "error" : "rejection",
          message: pending === null
            ? `no projected legal command at ${phaseLabel(selected.projection)}; actor ${actor}, ` +
              `actor pending ${selected.projection.pendingChoice.status}, peer pending ${live[0].viewerPlayerId === actor ? live[1].pendingChoice.status : live[0].pendingChoice.status}`
            : `no projected answer for ${pending.kind} choice ${pending.choiceId}; ` +
              `owner ${pending.ownerPlayerId}, options ${pending.options?.length ?? 0}, ` +
              `min ${pending.min ?? "n/a"}, max ${pending.max ?? "n/a"}`,
          phase: selected.projection.phase,
          stateVersion: selected.projection.stateVersion,
        cardName: commandCardName(selected.projection)
        });
        termination = "blocked";
        break;
      }
      const beforeFirst = currentClientProjection(pair.first);
      const beforeSecond = currentClientProjection(pair.second);
      try {
        const { receipt, latencyMs } = await selected.client.sendCommand(command, options.commandTimeoutMs);
        timings.push({ latencyMs, accepted: receipt.accepted, type: command.type,
          commandId, stateVersion: receipt.stateVersion, phase: selected.projection.phase,
          turnNumber: selected.projection.turnNumber,
          cardObjectId: command.type === "play" ? command.cardObjectId : null,
          actorPlayerId: actor });
        if (!receipt.accepted) {
          failures.push({
            kind: "rejection",
            message: receipt.rejection ?? "Command rejected",
            commandId,
            phase: selected.projection.phase,
            stateVersion: selected.projection.stateVersion
          });
          if (command.type === "play") {
            const blocked = rejectedPlays.get(actor) ?? new Set<string>();
            blocked.add(command.cardObjectId);
            rejectedPlays.set(actor, blocked);
          } else if (command.type === "combat-damage") {
            const blocked = rejectedCombatAssignments.get(actor) ?? new Set<string>();
            blocked.add(combatAssignmentKey(selected.projection, command.assignments));
            rejectedCombatAssignments.set(actor, blocked);
          }
          continue;
        }
        await Promise.all([
          pair.first.waitForProjectionAfter(commandId, beforeFirst, receipt,
            options.commandTimeoutMs),
          pair.second.waitForProjectionAfter(commandId, beforeSecond, receipt,
            options.commandTimeoutMs)
        ]);
        if (command.type === "mulligan") setupOwnerAfterCommand = actor;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const disconnected = pair.first.isClosed || pair.second.isClosed;
        failures.push({
          kind: disconnected ? "disconnect" : message.includes("exceeded") ? "timeout" : "error",
          message,
          commandId,
          phase: selected.projection.phase,
          stateVersion: selected.projection.stateVersion,
          cardName: commandCardName(selected.projection)
        });
        termination = "blocked";
        break;
      }
    }
    if (termination !== "winner" && termination !== "timeout") {
      if (actionCount >= options.maxCommandsPerGame) {
        failures.push({ kind: "timeout", message: `command guard ${options.maxCommandsPerGame} exhausted` });
      }
      terminal ??= currentClientProjection(pair.first);
    }
    if (termination === "winner" && terminal?.winnerPlayerId === null) {
      failures.push({ kind: "error", message: "ended match has no winnerPlayerId" });
      termination = "blocked";
    }
  } finally {
    pair.first.closeImmediately();
    pair.second.closeImmediately();
  }
  if (pair.checkedProjections.violations.length > 0) {
    failures.push({ kind: "privacy", message: pair.checkedProjections.violations.join("; ") });
  }
  const errorKinds = failures.filter(failure => failure.kind === "error").length;
  const rejectionKinds = failures.filter(failure => failure.kind === "rejection").length;
  const disconnectKinds = failures.filter(failure => failure.kind === "disconnect").length;
        const timeoutKinds = failures.filter(failure => failure.kind === "timeout").length;
  return {
    room: roomIndex,
    seed,
    roomId: pair.roomId,
    termination,
    winnerPlayerId: terminal?.winnerPlayerId ?? null,
    turns: terminal?.turnNumber ?? 0,
    commands: timings.length,
    elapsedMs: rounded(performance.now() - started),
    latenciesMs: timings.map(timing => rounded(timing.latencyMs)),
    commandResults: timings.map(timing => ({
      type: timing.type,
      accepted: timing.accepted,
      latencyMs: rounded(timing.latencyMs),
      commandId: timing.commandId,
      stateVersion: timing.stateVersion,
      phase: timing.phase,
      turnNumber: timing.turnNumber,
      cardObjectId: timing.cardObjectId,
      actorPlayerId: timing.actorPlayerId
    })),
    rejectedCommands: rejectionKinds,
    errors: errorKinds,
    disconnects: disconnectKinds,
    timeouts: timeoutKinds,
    failures,
    checkedProjections: pair.checkedProjections.count,
    ...(termination === "blocked" || termination === "timeout" ? { diagnosticProjections: [
      currentClientProjection(pair.first), currentClientProjection(pair.second),
    ] } : {})
  };
}

interface PortLease {
  readonly port: number;
  release(): Promise<void>;
}

async function stopChild(child: ChildProcess, timeoutMs = 15_000): Promise<boolean> {
  if (child.exitCode !== null) return true;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
  return child.exitCode !== null;
}

async function acquirePort(options: CliOptions, excluded: ReadonlySet<number>): Promise<PortLease> {
  const { createServer } = await import("node:net");
  for (let port = options.portBase; port < options.portBase + options.portSpan; port += 1) {
    if (excluded.has(port)) continue;
    const lease = await new Promise<PortLease | null>(resolve => {
      const candidate = createServer();
      candidate.once("error", () => resolve(null));
      candidate.listen({ host: "127.0.0.1", port }, () => resolve({
        port,
        release: () => new Promise<void>((done, fail) =>
          candidate.close(error => error === undefined ||
            (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING"
            ? done() : fail(error)))
      }));
    });
    if (lease !== null) return lease;
  }
  throw new Error(`No free port in ${options.portBase}-${options.portBase + options.portSpan - 1}`);
}

async function portAcceptsConnections(port: number, timeoutMs = 500): Promise<boolean> {
  const { createConnection } = await import("node:net");
  return new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

async function assertPortBound(port: number): Promise<void> {
  const deadline = performance.now() + 2_000;
  for (;;) {
    if (await portAcceptsConnections(port)) return;
    if (performance.now() >= deadline) throw new Error(`Server did not retain its bound listener on port ${port}`);
    await sleep(10);
  }
}

async function waitForServer(
  child: ChildProcess,
  port: number,
  output: { stdout: string; stderr: string },
  timeoutMs: number
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited with ${child.exitCode} before listening: ${output.stdout}\n${output.stderr}`);
    }
    if (await portAcceptsConnections(port)) return;
    if (performance.now() >= deadline) {
      throw new Error(`Server did not listen on ${port} within ${timeoutMs}ms: ${output.stdout}\n${output.stderr}`);
    }
    await sleep(25);
  }
}

async function directorySize(directory: string): Promise<DirectorySize> {
  let bytes = 0;
  let files = 0;
  async function walk(current: string): Promise<void> {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await Promise.all(entries.map(async entry => {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(entryPath);
      else if (entry.isFile()) {
        const info = await stat(entryPath);
        bytes += info.size;
        files += 1;
      }
    }));
  }
  await walk(directory);
  return { bytes, files };
}

function parseProcUsage(pid: number, cpuTicks: number): Promise<ProcessUsage & { readonly cpuTicks: number }> {
  return readFile(`/proc/${pid}/stat`, "utf8").then(content => {
    const closingParenthesis = content.lastIndexOf(")");
    if (closingParenthesis < 0) throw new Error(`Malformed /proc/${pid}/stat`);
    const fields = content.slice(closingParenthesis + 2).trim().split(/\s+/);
    const userTicks = Number(fields[11]);
    const systemTicks = Number(fields[12]);
    const rssPages = Number(fields[21]);
    const nextTicks = userTicks + systemTicks;
    return { ticks: nextTicks - cpuTicks, cpuTicks: nextTicks,
      rssBytes: rssPages * 4096 };
  });
}

function readCpuSample(): { readonly active: number; readonly total: number } {
  const fields = readFileSync("/proc/stat", "utf8").split("\n")[0]!.trim().split(/\s+/).slice(1).map(Number);
  return {
    active: fields.slice(0, 8).reduce((sum, value) => sum + value, 0) - (fields[4] ?? 0) - (fields[5] ?? 0),
    total: fields.slice(0, 8).reduce((sum, value) => sum + value, 0)
  };
}

async function startSampler(
  pid: number,
  runStartedAt: number,
  startedUsage: ProcessUsage
): Promise<{
  samples: ProcessSample[];
  stop(): Promise<void>;
}> {
  const samples: ProcessSample[] = [];
  let previousTicks = startedUsage.ticks;
  let previousAt = performance.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;
  const sample = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const now = performance.now();
      const usage = await parseProcUsage(pid, previousTicks);
      const elapsed = Math.max(1, now - previousAt);
      const cpuPercent = usage.ticks / 100 / (elapsed / 1000) * 100;
      const load = loadavg();
      samples.push({
        atMs: rounded(now - runStartedAt),
        rssBytes: usage.rssBytes,
        cpuPercent: rounded(cpuPercent),
        loadAverage: [rounded(load[0] ?? 0), rounded(load[1] ?? 0), rounded(load[2] ?? 0)]
      });
      previousTicks = usage.cpuTicks;
      previousAt = now;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    } finally {
      inFlight = false;
    }
  };
  samples.push({
    atMs: 0,
    rssBytes: startedUsage.rssBytes,
    cpuPercent: 0,
    loadAverage: loadavg().map(rounded) as unknown as readonly [number, number, number]
  });
  timer = setInterval(() => { void sample(); }, 100);
  return {
    samples,
    async stop() {
      if (timer !== undefined) clearInterval(timer);
      while (inFlight) await sleep(5);
      if (await readFile(`/proc/${pid}/stat`, "utf8").then(() => true, () => false)) {
        await sample().catch(error => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
      }
    }
  };
}

async function currentProcUsage(pid: number): Promise<ProcessUsage> {
  const usage = await parseProcUsage(pid, 0);
  return { rssBytes: usage.rssBytes, ticks: usage.cpuTicks };
}

async function gitState(): Promise<LoadTestReport["git"]> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const [commit, branch, status] = await Promise.all([
    run("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
    run("git", ["branch", "--show-current"], { cwd: repositoryRoot }),
    run("git", ["status", "--porcelain=v1"], { cwd: repositoryRoot })
  ]);
  return {
    commit: commit.stdout.trim(),
    branch: branch.stdout.trim(),
    dirty: status.stdout.trim().length > 0
  };
}

async function runLevel(
  options: CliOptions,
  mode: RunMode,
  rooms: number,
  excludedPorts: Set<number>,
  storageRoot: string
): Promise<LevelResult> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let gameExecutionStarted: number | null = null;
  let gameExecutionEnded: number | null = null;
  let serverStartupMs = 0;
  const portLease = await acquirePort(options, excludedPorts);
  activePortLease = portLease;
  const port = portLease.port;
  await portLease.release();
  if (activePortLease === portLease) activePortLease = null;
  excludedPorts.add(port);
  const storageDirectory = mode === "file" ? path.join(storageRoot, `rooms-${rooms}`) : null;
  let storageReused = false;
  if (storageDirectory !== null) {
    const expectedStorageDirectory = path.join(storageRoot, `rooms-${rooms}`);
    if (path.resolve(storageDirectory) !== expectedStorageDirectory) {
      throw new Error(`Refusing to clean unexpected storage directory ${storageDirectory}`);
    }
    storageReused = await access(storageDirectory).then(() => true, () => false);
    await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
  }
  const initialStorage = storageDirectory === null
    ? { bytes: 0, files: 0 }
    : await directorySize(storageDirectory);
  const output: { stdout: string; stderr: string } = { stdout: "", stderr: "" };
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port)
  };
  if (storageDirectory === null) delete env.RIFTBOUND_STORAGE_DIRECTORY;
  else env.RIFTBOUND_STORAGE_DIRECTORY = storageDirectory;
  if (options.deterministicSeed === null) {
    delete env.RIFTBOUND_ALLOW_DETERMINISTIC_RANDOM;
    delete env.RIFTBOUND_DETERMINISTIC_RANDOM_SEED;
  } else {
    env.RIFTBOUND_ALLOW_DETERMINISTIC_RANDOM = "1";
    env.RIFTBOUND_DETERMINISTIC_RANDOM_SEED = options.deterministicSeed;
  }
  let child: ChildProcess | null = null;
  let childSettled = false;
  let cleanupError: unknown;
  let sampler: Awaited<ReturnType<typeof startSampler>> | null = null;
  let samples: ProcessSample[] = [];
  const hostCpuSamples: number[] = [];
  let rssPeakBytes = 0;
  let rssSumBytes = 0;
  let cpuPeakPercent = 0;
  let cpuWeightedTicks = 0;
  let cpuElapsedMs = 0;
  let games: GameResult[] = [];
  let hostCpuSampler: ReturnType<typeof setInterval> | null = null;
  let storageFinal = initialStorage;
  let possiblePortConflict = false;
  const loadStart = loadavg().map(rounded) as unknown as readonly [number, number, number];
  const localHostLoadStart = readCpuSample();
  try {
    child = spawn(process.execPath, ["--import", tsxLoader, serverEntry], {
      cwd: packageRoot,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    activeChild = child;
    if (child.pid === undefined) throw new Error("Failed to spawn game server");
    const childPid = child.pid;
    const serverSpawnedAt = performance.now();
    child.once("exit", () => { childSettled = true; });
    child.stdout?.on("data", chunk => { output.stdout = (output.stdout + String(chunk)).slice(-32_768); });
    child.stderr?.on("data", chunk => { output.stderr = (output.stderr + String(chunk)).slice(-32_768); });
    await appendFile(`/tmp/${taskName}.pids`, `${childPid}\n`);
    await waitForServer(child, port, output, options.startupTimeoutMs);
    // bindServer released the reservation before Node bound its listener. A
    // short landed-state check prevents an ECONNREFUSED race from being
    // recorded as a match error under a heavily loaded shared host.
    await assertPortBound(port);
    serverStartupMs = performance.now() - serverSpawnedAt;
    const usage = await currentProcUsage(childPid);
    sampler = await startSampler(childPid, started, usage);
    const url = `ws://127.0.0.1:${port}/ws`;
    gameExecutionStarted = performance.now();
    let previousHostCpu = readCpuSample();
    hostCpuSampler = setInterval(() => {
      const currentHostCpu = readCpuSample();
      const totalDelta = currentHostCpu.total - previousHostCpu.total;
      if (totalDelta > 0) hostCpuSamples.push(rounded(
        (currentHostCpu.active - previousHostCpu.active) / totalDelta * 100));
      previousHostCpu = currentHostCpu;
    }, 1_000);
    games = await Promise.all(Array.from({ length: rooms }, async (_, roomIndex) => {
      let pair: RuntimePair | null = null;
      try {
        pair = await startPair(url, roomIndex, Math.min(options.startupTimeoutMs, 60_000));
        if (child!.exitCode !== null) throw new Error(
          `Game server exited before game ${roomIndex} completed: ${output.stdout}\n${output.stderr}`
        );
        return await driveGame(roomIndex, pair, options);
      } catch (error) {
        pair?.first.closeImmediately();
        pair?.second.closeImmediately();
        return {
          room: roomIndex,
          seed: `RIFT-1082-${roomIndex}`,
          termination: "blocked" as const,
          winnerPlayerId: null,
          turns: 0,
          commands: 0,
          elapsedMs: 0,
          latenciesMs: [],
          rejectedCommands: 0,
          errors: 1,
          disconnects: 0,
          timeouts: 0,
          failures: [{ kind: "error", message: error instanceof Error ? error.message : String(error) }],
          checkedProjections: 0
        } satisfies GameResult;
      }
    }));
    gameExecutionEnded = performance.now();
    clearInterval(hostCpuSampler);
    hostCpuSampler = null;
    await sampler.stop();
    samples = sampler.samples;
    for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
      const previous = samples[sampleIndex - 1]!;
      const current = samples[sampleIndex]!;
      const elapsed = Math.max(1, current.atMs - previous.atMs);
      cpuWeightedTicks += current.cpuPercent * elapsed / 100;
      cpuElapsedMs += elapsed;
      rssPeakBytes = Math.max(rssPeakBytes, current.rssBytes);
      rssSumBytes += current.rssBytes;
      cpuPeakPercent = Math.max(cpuPeakPercent, current.cpuPercent);
    }
    if (samples.length === 1) {
      rssPeakBytes = rssSumBytes = samples[0]!.rssBytes;
    }
  } catch (error) {
    possiblePortConflict = error instanceof Error && output.stderr.includes("EADDRINUSE");
    throw error;
  } finally {
    if (hostCpuSampler !== null) clearInterval(hostCpuSampler);
    if (child !== null) {
      try { await stopChild(child); } catch (error) { cleanupError ??= error; }
      if (activeChild === child) activeChild = null;
    }
    if (sampler !== null) {
      await sampler.stop().catch(() => undefined);
      if (samples.length === 0) {
        samples = sampler.samples;
        rssPeakBytes = Math.max(0, ...samples.map(sample => sample.rssBytes));
        rssSumBytes = samples.reduce((sum, sample) => sum + sample.rssBytes, 0);
        cpuPeakPercent = Math.max(0, ...samples.map(sample => sample.cpuPercent));
      }
    }
    if (storageDirectory !== null) {
      storageFinal = await directorySize(storageDirectory).catch(() => storageFinal);
    }
    await portLease.release().catch(() => undefined);
    if (activePortLease === portLease) activePortLease = null;
    excludedPorts.delete(port);
  }
  if (cleanupError !== undefined) throw cleanupError;
  const latencies = games.flatMap(game => game.latenciesMs);
  const completed = games.filter(game => game.termination === "winner" &&
    game.failures.length === 0).length;
  const durationMs = performance.now() - started;
  const executionDurationMs = gameExecutionStarted === null
    ? 0
    : (gameExecutionEnded ?? performance.now()) - gameExecutionStarted;
  const activeSamples = gameExecutionStarted === null ? [] : samples.filter(sample =>
    sample.atMs >= gameExecutionStarted - started &&
    sample.atMs <= (gameExecutionEnded ?? performance.now()) - started);
  const totalCommands = games.reduce((sum, game) => sum + game.commands, 0);
  const wonGames = games.filter(game => game.termination === "winner" && game.winnerPlayerId !== null).length;
  const blockedGames = games.filter(game => game.termination === "blocked").length;
  const timedOutGames = games.filter(game => game.termination === "timeout").length;
  const rejectedCommands = games.reduce((sum, game) => sum + game.rejectedCommands, 0);
  const errors = games.reduce((sum, game) => sum + game.errors, 0);
  const disconnects = games.reduce((sum, game) => sum + game.disconnects, 0);
  const timeouts = games.reduce((sum, game) => sum + game.timeouts, 0);
  const finishedAt = new Date().toISOString();
  const portReleased = !(await portAcceptsConnections(port));
  portAcceptsConnectionsCache.set(port, portReleased);
  const limitBreached = percentile(latencies, 0.95) > 3_000 || rejectedCommands > 0 ||
    errors > 0 || disconnects > 0 || timeouts > 0 || child === null || !childSettled || !portReleased;
  return {
    mode,
    rooms,
    port,
    storageDirectory,
    storageReused,
    serverStartupMs: rounded(serverStartupMs),
    gameExecutionMs: rounded(executionDurationMs),
    averageGameMs: games.length === 0 ? 0 : rounded(
      games.reduce((sum, game) => sum + game.elapsedMs, 0) / games.length),
    startedAt,
    endedAt: finishedAt,
    durationMs: rounded(durationMs),
    host: {
      model: cpus()[0]?.model ?? "unknown",
      logicalCpus: availableParallelism(),
      totalMemoryBytes: totalmem(),
      freeMemoryBytesAtStart: freemem(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      storagePath: storageRoot
    },
    server: {
      pid: child?.pid ?? 0,
      rssPeakBytes,
      rssAverageBytes: samples.length === 0 ? 0 : Math.round(rssSumBytes / samples.length),
      cpuAveragePercent: cpuElapsedMs === 0 ? 0 : rounded(cpuWeightedTicks / cpuElapsedMs * 100),
      cpuPeakPercent: rounded(cpuPeakPercent),
      rssSamples: samples.length,
      cpuSamples: samples.length,
      exitedUnexpectedly: !childSettled
    },
    aggregate: {
      completedGames: completed,
      wonGames,
      blockedGames,
      timedOutGames,
      totalCommands,
      commandsPerSecond: executionDurationMs <= 0 ? 0 : rounded(totalCommands / (executionDurationMs / 1000)),
      latencyP50Ms: rounded(percentile(latencies, 0.5)),
      latencyP95Ms: rounded(percentile(latencies, 0.95)),
      latencyP99Ms: rounded(percentile(latencies, 0.99)),
      latencyMaxMs: rounded(percentile(latencies, 1)),
      averageGameMs: games.length === 0 ? 0 : rounded(games.reduce((sum, game) => sum + game.elapsedMs, 0) / games.length),
      rejectedCommands,
      errors,
      disconnects,
      timeouts,
      checkedProjections: games.reduce((sum, game) => sum + game.checkedProjections, 0)
    },
    perGameAverage: {
      commandLatencyP50Ms: rounded(percentile(latencies, 0.5)),
      commandLatencyP95Ms: rounded(percentile(latencies, 0.95)),
      commandLatencyP99Ms: rounded(percentile(latencies, 0.99)),
      commandLatencyMaxMs: rounded(percentile(latencies, 1)),
      rssPeakBytes: rooms === 0 ? 0 : Math.round(Math.max(0, ...activeSamples.map(sample => sample.rssBytes)) / rooms),
      rssAverageBytes: rooms === 0 || activeSamples.length === 0 ? 0 : Math.round(
        activeSamples.reduce((sum, sample) => sum + sample.rssBytes, 0) / activeSamples.length / rooms),
      cpuAveragePercent: rounded(cpuElapsedMs === 0 ? 0 : cpuWeightedTicks / cpuElapsedMs * 100),
      cpuPeakPercent: rounded(cpuPeakPercent),
      storageGrowthBytes: rooms === 0 ? 0 : Math.round((storageFinal.bytes - initialStorage.bytes) / rooms),
      commandsPerSecond: executionDurationMs <= 0 ? 0 :
        rounded(totalCommands / (executionDurationMs / 1000) / Math.max(1, rooms))
    },
    storage: {
      initialBytes: initialStorage.bytes,
      finalBytes: storageFinal.bytes,
      growthBytes: storageFinal.bytes - initialStorage.bytes,
      files: storageFinal.files,
      bytesPerGame: rooms === 0 ? 0 : Math.round((storageFinal.bytes - initialStorage.bytes) / rooms)
    },
    loadAverageStart: loadStart,
    loadAverageEnd: loadavg().map(rounded) as unknown as readonly [number, number, number],
    loadAveragePeak1m: Math.max(0, ...samples.map(sample => sample.loadAverage[0])),
    hostCpuAveragePercent: (() => {
      const end = readCpuSample();
      const tickDelta = end.active - localHostLoadStart.active;
      const totalDelta = end.total - localHostLoadStart.total;
      return totalDelta <= 0 ? 0 : rounded(tickDelta / totalDelta * 100);
    })(),
    hostCpuPeakPercent: (() => {
      return rounded(Math.max(0, ...hostCpuSamples));
    })(),
    games,
    failureCategoryCounts: Object.fromEntries([...new Set(games.flatMap(game =>
      game.failures.map(failure => failure.kind)))].sort().map(kind => [
      kind, games.flatMap(game => game.failures).filter(failure => failure.kind === kind).length
    ])),
    samples,
    limitBreached,
    possiblePortConflict,
    measuredAt: new Date().toISOString(),
    cleanup: {
      serverExited: childSettled,
      socketsClosed: games.every(game => game.disconnects === 0),
      portsReleased: portReleased,
      cleanupProblems: cleanupError === undefined ? [] : [String(cleanupError)]
    }
  };
}

async function writeRawLevel(outputDirectory: string, result: LevelResult): Promise<void> {
  const name = `${result.mode}-n${String(result.rooms).padStart(2, "0")}`;
  await writeFile(path.join(outputDirectory, `${name}.json`),
    `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  const options = parseOptions();
  await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });
  await mkdir(options.storageRoot, { recursive: true, mode: 0o700 });
  const baseline = await gitState();
  const results: LevelResult[] = [];
  const excludedPorts = new Set<number>();
  let stoppedAfter: number | null = null;
  let stopReason: string | null = null;
  let finalOutcome: LoadTestReport["terminalOutcome"] = null;
  let cleanupError: unknown;
  const cleanupProblems: string[] = [];
  const start = performance.now();
  const sequence: { mode: RunMode; rooms: number }[] = [];
  for (const mode of options.modes) {
    if (mode === "file") {
      for (const rooms of options.levels) sequence.push({ mode, rooms });
    } else {
      sequence.push({ mode, rooms: 10 });
    }
  }
  try {
    for (const run of sequence) {
      const result = await runLevel(options, run.mode, run.rooms, excludedPorts,
        options.storageRoot);
      results.push(result);
      finalOutcome = terminalOutcome(result.games, result.aggregate);
      await writeRawLevel(options.outputDirectory, result);
      process.stdout.write(`${result.mode} N=${result.rooms}: ${result.aggregate.completedGames}/${result.rooms} complete, ` +
        `${result.aggregate.totalCommands} commands, p95 ${result.aggregate.latencyP95Ms}ms, ` +
        `RSS peak ${result.server.rssPeakBytes}, CPU average ${result.server.cpuAveragePercent}%, ` +
        `trace ${levelTraceHash(result.games)}\n`);
      const coverageBlocked = result.games.some(game => game.termination !== "winner" &&
        game.failures.some(failure =>
          failure.message.startsWith("no projected actor") ||
          failure.message.startsWith("no projected legal command") ||
          failure.message.startsWith("no projected answer")));
      if (run.mode === "file" && (result.limitBreached || coverageBlocked)) {
        stoppedAfter = run.rooms;
        stopReason = coverageBlocked
          ? "projected command coverage stopped the file level"
          : result.possiblePortConflict
          ? "port conflict or child server startup failure"
          : `p95 ${result.aggregate.latencyP95Ms}ms; rejected ${result.aggregate.rejectedCommands}; ` +
            `errors ${result.aggregate.errors}; disconnected ${result.aggregate.disconnects}; timeouts ${result.aggregate.timeouts}`;
        break;
      }
    }
  } catch (error) {
    cleanupError = error;
    cleanupProblems.push(error instanceof Error ? error.message : String(error));
  }
  const report: LoadTestReport = {
    schema: "riftbound.server-load-test.v1",
    generatedAt: new Date().toISOString(),
    command: process.argv,
    git: baseline,
    environment: {
      elapsedMs: rounded(performance.now() - start),
      processNodeVersion: process.version,
      processPlatform: process.platform,
      processArch: process.arch,
      reportedCpus: cpus().length,
      availableParallelism: availableParallelism(),
      totalMemoryBytes: totalmem(),
      sharedHostLoadAtStart: loadavg().map(rounded),
      sharedHostNote: "load average includes all projects on the shared development host",
      fixedClientSeedPrefix: "RIFT-1082",
      deterministicSeed: options.deterministicSeed,
      deterministicRandomEnabled: options.deterministicSeed !== null && options.deterministicSeed.length > 0,
      authoritativeSeedSource: options.deterministicSeed === null
        ? "server-generated roomId, retained per game as roomId"
        : "explicit deterministic server seed; roomId remains server-generated"
    },
    config: {
      modes: options.modes,
      levels: options.levels,
      portBase: options.portBase,
      portSpan: options.portSpan,
      maxCommandsPerGame: options.maxCommandsPerGame,
      maxTurnsPerGame: options.maxTurnsPerGame,
      commandTimeoutMs: options.commandTimeoutMs,
      gameTimeoutMs: options.gameTimeoutMs,
      startupTimeoutMs: options.startupTimeoutMs,
      deterministicSeed: options.deterministicSeed,
      storagePolicy: "file levels use RIFTBOUND_STORAGE_DIRECTORY; memory control omits it",
      productionEntrypoint: "apps/game-server/src/index.ts",
      clientsPerRoom: 2,
      preconFirst: "rumble-sfd",
      preconSecond: "fiora-sfd"
    },
    results,
    stoppedAfter,
    stopReason,
    terminalOutcome: finalOutcome,
    cleanup: {
      serverExited: results.every(result => result.server.exitedUnexpectedly === false),
      socketsClosed: true,
      portsReleased: results.every(result => portAcceptsConnectionsCache.get(result.port) === true)
    },
    cleanupProblems,
    complete: cleanupError === undefined
  };
  await writeFile(path.join(options.outputDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (cleanupError !== undefined) throw cleanupError;
}

if (scriptEntry) {
  if (process.argv.includes("--self-test")) loadBotSelfTest();
  else await main();
}
