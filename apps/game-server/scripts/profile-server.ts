import { spawn, type ChildProcess } from "node:child_process";
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
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { V2Command, V2CommandReceipt, V2Projection } from "../../../packages/protocol/src/v2/index.js";
import type { V2WebSocketSession } from "../../../packages/integration-tests/src/v2-duel/ws-session.js";
import type { V2DuelResult } from "../../../packages/integration-tests/src/v2-duel/types.js";
import type { CardProgram } from "../../../packages/card-dsl/dist/ir/index.js";

interface ProfileCommand {
  readonly index: number;
  readonly type: V2Command["type"];
  readonly actorPlayerId: string;
  readonly commandId: string;
  readonly phase: V2Projection["phase"];
  readonly turnNumber: number;
  readonly beforeStateVersion: number;
  readonly receiptStateVersion: number;
  readonly eventSeq: number;
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly latencyMs: number;
  readonly projectionConvergenceMs: number;
  readonly commandWireBytes: number;
  readonly receiptWireBytes: number;
  readonly projectionPackets: Readonly<Record<string, number>>;
  readonly projectionWireBytes: Readonly<Record<string, number>>;
  readonly fileBytesBefore: number;
  readonly fileBytesAfterReceipt: number;
  readonly fileBytesAfterConvergence: number;
  readonly fileBytesDelta: number;
  readonly processWriteBytes: number;
  readonly processWriteCalls: number;
  readonly startedAtEpochMs: number;
  readonly receiptAtEpochMs: number;
  readonly convergedAtEpochMs: number;
}

interface InstrumentationSnapshot {
  readonly pid: number;
  readonly capturedAt: string;
  readonly counters: Record<string, CounterSnapshot>;
  readonly patchFailures?: readonly string[];
}

interface ComplianceSnapshot {
  readonly commandCount: number;
  readonly gameDefaultRuleset: {
    readonly rulesetVersion: V2Projection["rulesetVersion"];
    readonly protocolVersion: V2Projection["protocolVersion"];
    readonly runtimeMode: string;
  };
  readonly projectionConstructions: {
    readonly journalObservationsPerCompletedRecord: number;
    readonly actorResultPerCompletedCommand: number;
    readonly roomBroadcastsPerConnectedViewer: number;
    readonly totalBeforeTransport: number;
    readonly digestOperationsPerCompletedRecord: number;
    readonly duplicateEvidence: {
      readonly publicView: boolean;
      readonly playerViews: boolean;
    };
  };
  readonly pendingChoice: {
    readonly suspendingCommands: number;
    readonly resumedChoiceCommands: number;
    readonly rollbackThenReexecutesOriginalCommand: boolean;
  };
  readonly layerPasses: {
    readonly evaluateAllCalls: number;
    readonly evaluateCalls: number;
    readonly stableLayerCalls: number;
    readonly avgEvaluateAllPerCommand: number;
    readonly avgEvaluatePerCommand: number;
    readonly avgStableLayerCallsPerCommand: number;
  };
  readonly storagePerCommand: {
    readonly archiveLogBytesAvg: number;
    readonly privateJournalHeadBytesAvg: number;
    readonly measuredFileBytesAvg: number;
    readonly processWriteBytesAvg: number;
  };
}

interface CounterSnapshot {
  readonly calls: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly units: number;
}

interface ProfileNode {
  readonly id: number;
  readonly callFrame: {
    readonly functionName: string;
    readonly url: unknown;
    readonly lineNumber: number;
    readonly columnNumber: number;
  };
  readonly children?: readonly number[];
}

interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly startTime: number;
  readonly endTime: number;
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

interface Hotspot {
  readonly function: string;
  readonly file: string;
  readonly line: number;
  readonly category: string;
  readonly package: string;
  readonly selfMs: number;
  readonly totalMs: number;
  readonly percent: number;
  readonly totalPercent: number;
}

interface PhaseMs {
  readonly engineExecution: number;
  readonly layers: number;
  readonly projection: number;
  readonly digestCanonicalJson: number;
  readonly protocolValidation: number;
  readonly journal: number;
  readonly storage: number;
  readonly jsonSerialization: number;
  readonly copy: number;
  readonly idle: number;
  readonly websocket: number;
  readonly cardDsl: number;
  readonly gameServer: number;
  readonly nodeInternal: number;
  readonly other: number;
}

interface ProfileAnalysis {
  readonly profileDurationMs: number;
  readonly sampledMs: number;
  readonly host: string;
  readonly profilePath: string;
  readonly topHotspots: readonly Hotspot[];
  readonly packageTime: readonly {
    readonly package: string;
    readonly selfMs: number;
    readonly totalMs: number;
    readonly percent: number;
    readonly totalPercent: number;
  }[];
  readonly phaseTime: PhaseMs;
  readonly phasePercent: PhaseMs;
  readonly effectiveCpuMs: number;
  readonly gcMs: number;
  readonly effectiveCpuPercent: number;
  readonly gcPercent: number;
  readonly commandAverage: {
    readonly commands: number;
    readonly averageElapsedMs: number;
    readonly sampledMs: number;
    readonly sampledPercentOfElapsed: number;
    readonly phasesMs: PhaseMs;
    readonly phasesPercentOfSample: PhaseMs;
  };
  readonly aggregateByType: readonly {
    readonly type: V2Command["type"];
    readonly count: number;
    readonly averageActiveCpuMs: number;
    readonly phasesMs: PhaseMs;
  }[];
  readonly phaseTimeline: readonly {
    readonly commandIndex: number;
    readonly phasesMs: PhaseMs;
  }[];
  readonly commandCpu: readonly {
    readonly commandIndex: number;
    readonly type: V2Command["type"];
    readonly sampledMs: number;
    readonly activeCpuMs: number;
    readonly gcMs: number;
    readonly phasesMs: PhaseMs;
  }[];
}

interface GameSummary {
  readonly seed: string;
  readonly termination: V2DuelResult["termination"];
  readonly winnerPlayerId: string | null;
  readonly blockedReason: string | null;
  readonly elapsedMs: number;
  readonly commandCount: number;
  readonly commands: readonly ProfileCommand[];
  readonly aggregateByType: readonly {
    readonly type: V2Command["type"];
    readonly count: number;
    readonly averageLatencyMs: number;
    readonly p50LatencyMs: number;
    readonly p95LatencyMs: number;
    readonly p99LatencyMs: number;
    readonly maxLatencyMs: number;
    readonly averageFileBytes: number;
    readonly averageProcessWriteBytes: number;
  }[];
  readonly projectionCounts: {
    readonly profileLifecycle: "mulligan is driven through the room setup command; per-game commands are mulligan plus EngineRuntime records";
    readonly wsPackets: number;
    readonly wsPacketsPerCommand: number;
    readonly wsWireBytes: number;
    readonly sourceSemantics: Readonly<Record<string, string>>;
  };
  readonly storage: {
    readonly root: string;
    readonly initialBytes: number;
    readonly finalBytes: number;
    readonly growthBytes: number;
    readonly archiveLogGrowthBytes: number;
    readonly archiveRecordBytes: {
      readonly records: number;
      readonly average: number;
      readonly median: number;
      readonly max: number;
    };
    readonly runFiles: readonly { readonly path: string; readonly bytes: number }[];
  };
}

interface ServerRun {
  readonly profilePath: string;
  readonly instrumentationPath: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly childPid: number;
  readonly profileEpochMs: number;
  readonly instrumentation: InstrumentationSnapshot | null;
}

interface ProfileRunConfig {
  readonly schema: "riftbound.server-command-cpu-profile.config.v1";
  readonly port: number;
  readonly seed: string;
  readonly roomId: string | null;
  readonly maxCommands: number;
  readonly commandTimeoutMs: number;
  readonly gameTimeoutMs: number;
  readonly startupTimeoutMs: number;
}

interface ProfileRunSummary {
  readonly schema: "riftbound.server-command-cpu-profile.v1";
  readonly generatedAt: string;
  readonly task: string;
  readonly repositoryRoot: string;
  readonly git: { readonly commit: string; readonly branch: string; readonly dirty: boolean };
  readonly environment: Readonly<Record<string, unknown>>;
  readonly artifacts: {
    readonly profileConfig: string;
    readonly cpuProfile: string;
    readonly summaryJson: string;
    readonly instrumentationJson: string;
    readonly serverStdout: string;
    readonly serverStderr: string;
    readonly storageRoot: string;
  };
  readonly server: ServerRun;
  readonly game: GameSummary;
  readonly compliance: ComplianceSnapshot;
  readonly analysis: ProfileAnalysis;
  readonly limitations: readonly string[];
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const packageRoot = path.resolve(scriptDirectory, "..");
const taskName = process.env.SWARM_TASK ?? "RIFT-1083-server-command-cpu-profile";
const seed = option("seed") ?? "RIFT-955-v2-07";
const roomId = option("room-id");
const maxCommands = integerOption("max-commands", 500, 1, 2_000);
const commandTimeoutMs = integerOption("command-timeout-ms", 60_000, 1_000, 300_000);
const gameTimeoutMs = integerOption("game-timeout-ms", 900_000, 10_000, 3_600_000);
const startupTimeoutMs = integerOption("startup-timeout-ms", 180_000, 1_000, 300_000);
const port = Number(process.env.SWARM_PORT_BASE ?? 35_740);
const baseOutputDirectory = path.resolve(option("output-dir") ??
  "/root/swarm-rift/shared/RIFT-1083-server-command-cpu-profile");
const analyzeExistingDirectory = option("analyze-existing");

if (analyzeExistingDirectory === undefined) await runParent();
else await analyzeExistingRun(path.resolve(analyzeExistingDirectory));

async function runParent(): Promise<void> {
  if (process.env.SWARM_TASK === undefined) {
    throw new Error("SWARM_TASK is required so only owned child PIDs are recorded");
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError("PORT/SWARM_PORT_BASE must be a valid TCP port");
  }
  if (process.env.SWARM_PORT_BASE === undefined) {
    throw new Error("SWARM_PORT_BASE is required so the profiled server uses an owned port");
  }
  if ((roomId ?? "").length === 0) {
    throw new Error("--room-id must be non-empty so the V2 engine seed is deterministic");
  }
  if (port < 35_740 || port > 35_759) {
    throw new RangeError("RIFT-1083 server profiling may use only ports 35740..35759");
  }
  const requiredBuilds = [
    "packages/engine-core/dist/layers/engine.js",
    "packages/card-dsl/dist/cards/registry.generated.js",
    "apps/game-server/dist/server.js"
  ];
  const missingBuilds = [];
  for (const relative of requiredBuilds) {
    if (!await access(path.join(repositoryRoot, relative)).then(() => true, () => false)) {
      missingBuilds.push(relative);
    }
  }
  if (missingBuilds.length > 0) {
    throw new Error(`Missing ${missingBuilds.join(", ")}; run ` +
      "`heavy pnpm --recursive --if-present run build` before profiling");
  }
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const outputDirectory = path.join(baseOutputDirectory, `run-${stamp}`);
  const storageRoot = path.join(outputDirectory, "storage");
  const profilePath = path.join(outputDirectory, "server.cpuprofile");
  const instrumentationPath = path.join(outputDirectory, "server-instrumentation.json");
  const stdoutPath = path.join(outputDirectory, "server.stdout.log");
  const stderrPath = path.join(outputDirectory, "server.stderr.log");
  const summaryPath = path.join(outputDirectory, "summary.json");
  const gameHandoffPath = path.join(outputDirectory, "game-summary.json");
  const profileClockPath = path.join(outputDirectory, "profile-clock.json");
  const serverReadyPath = path.join(outputDirectory, "server-ready.json");
  const bootstrapPath = path.join(outputDirectory, "server-bootstrap.mjs");
  const configPath = path.join(outputDirectory, "profile-config.json");
  await mkdir(storageRoot, { recursive: true, mode: 0o700 });
  await mkdir(baseOutputDirectory, { recursive: true, mode: 0o700 });
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await writeFile(bootstrapPath, serverBootstrapSource(), { mode: 0o600 });
  await writeFile(configPath, `${JSON.stringify(runConfig(), null, 2)}\n`, { mode: 0o600 });

  const stdout: string[] = [];
  const stderr: string[] = [];
  let child: ChildProcess | null = null;
  let childExited = false;
  try {
    const childArguments = [
      "--enable-source-maps",
      "--cpu-prof",
      `--cpu-prof-dir=${outputDirectory}`,
      `--cpu-prof-name=server-${stamp}.cpuprofile`,
      "--cpu-prof-interval=1000",
      bootstrapPath,
      `--instrumentation-path=${instrumentationPath}`,
      `--profile-clock-path=${profileClockPath}`,
      `--server-ready-path=${serverReadyPath}`,
      ...(roomId === undefined ? [] : [`--room-id=${roomId}`])
    ];
    child = spawn(process.execPath, childArguments, {
      cwd: packageRoot,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        RIFTBOUND_STORAGE_DIRECTORY: storageRoot,
        RIFTBOUND_DUEL_PROFILE: "p4"
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.once("error", error => { stderr.push(`spawn error: ${message(error)}\n`); });
    if (child.pid === undefined) throw new Error("Profile server failed to spawn");
    const childPid = child.pid;
    child.once("exit", () => { childExited = true; });
    child.stdout?.on("data", chunk => { stdout.push(String(chunk)); });
    child.stderr?.on("data", chunk => { stderr.push(String(chunk)); });
    await appendFile(`/tmp/${taskName}.pids`, `${childPid}\n`);
    await waitForFile(profileClockPath, 30_000);
    await waitForFile(serverReadyPath, startupTimeoutMs);
    await warmUpCatalog(port);

    await waitForFile(profileClockPath, 5_000);
    const profileClock = JSON.parse(await readFile(profileClockPath, "utf8")) as {
      readonly timeOrigin: number;
    };
    const profileEpochMs = profileClock.timeOrigin;
    const game = await driveProfileGame(
      `ws://127.0.0.1:${port}/ws`, storageRoot, childPid, profileEpochMs
    );
    await writeFile(gameHandoffPath, `${JSON.stringify(game)}\n`, { mode: 0o600 });

    if (child.exitCode !== null) throw new Error("Profile server exited before instrumentation capture");
    child.kill("SIGUSR2");
    await waitForFile(instrumentationPath, 90_000);
  } finally {
    if (child !== null && !childExited) {
      child.kill("SIGTERM");
      await waitForExit(child, 30_000);
    }
    if (child !== null && childExited) {
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
    await writeFile(stdoutPath, stdout.join(""), { mode: 0o600 });
    await writeFile(stderrPath, stderr.join(""), { mode: 0o600 });
  }

  if (childExited && child.exitCode !== null && child.exitCode !== 0 && child.signalCode === null) {
    throw new Error(`Profile server exited ${child.exitCode}: ${stderr.join("").slice(-4000)}`);
  }
  const generatedProfilePath = path.join(outputDirectory, `server-${stamp}.cpuprofile`);
  await waitForFile(generatedProfilePath, 30_000);
  await (await import("node:fs/promises")).rename(generatedProfilePath, profilePath);
  const config = JSON.parse(await readFile(configPath, "utf8")) as Partial<ProfileRunConfig>;
  if (config.port !== undefined && (config.port < 35_740 || config.port > 35_759)) {
    throw new RangeError(`Stored profile port must be in 35740..35759, received ${config.port}`);
  }
  if (config.schema !== "riftbound.server-command-cpu-profile.config.v1" ||
      config.port === undefined || config.seed === undefined || config.maxCommands === undefined ||
      config.commandTimeoutMs === undefined || config.gameTimeoutMs === undefined ||
      config.startupTimeoutMs === undefined) {
    throw new Error(`${configPath} is missing required run parameters`);
  }
  const runOptions = config as ProfileRunConfig;
  const instrumentation = JSON.parse(await readFile(instrumentationPath, "utf8")) as InstrumentationSnapshot;
  const profileClock = JSON.parse(await readFile(profileClockPath, "utf8")) as {
    readonly timeOrigin: number;
  };
  const profileEpochMs = profileClock.timeOrigin;

  const capturedGame = JSON.parse(await readFile(gameHandoffPath, "utf8")) as GameSummary;
  const storage = await storageSummary(storageRoot);
  const gameWithStorage: GameSummary = { ...capturedGame, storage };
  const analysis = analyzeProfile(profilePath, gameWithStorage.commands, profileEpochMs);
  const compliance = complianceFrom(gameWithStorage, instrumentation, analysis);
  const git = await gitState();
  const summary: ProfileRunSummary = {
    schema: "riftbound.server-command-cpu-profile.v1",
    generatedAt: new Date().toISOString(),
    task: taskName,
    repositoryRoot,
    git,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuProfileIntervalUs: 1_000,
      port: runOptions.port,
      seed: runOptions.seed,
      roomId: runOptions.roomId,
      maxCommands: runOptions.maxCommands,
      commandTimeoutMs: runOptions.commandTimeoutMs,
      gameTimeoutMs: runOptions.gameTimeoutMs,
      startupTimeoutMs: runOptions.startupTimeoutMs,
      storageMode: "file",
      profileWindow: "server child process lifetime; command windows are reported separately"
    },
    artifacts: { profileConfig: configPath, cpuProfile: profilePath, summaryJson: summaryPath,
      instrumentationJson: instrumentationPath, serverStdout: stdoutPath,
      serverStderr: stderrPath, storageRoot },
    server: { profilePath, instrumentationPath, stdoutPath, stderrPath,
      childPid: child.pid ?? 0, profileEpochMs, instrumentation },
    game: gameWithStorage,
    compliance,
    analysis,
    limitations: [
      "CPU profile covers the complete server child process lifetime; per-command windows are correlated by wall-clock epoch and may include adjacent asynchronous storage or GC work.",
      "Panels overlap conceptually: layers, projection, digest, storage and WebSocket categories are assigned by the innermost matching stack frame to avoid double-counting self samples.",
      "File size deltas are measured after each receipt and after both viewer projections converge; filesystem allocation, block padding and external contention are outside the CPU profile.",
      "This is one deterministic M1 match on one shared host, not a capacity certificate or proof that every official card/rules path is complete."
    ]
  };
  const serializedSummary = JSON.stringify(summary, null, 2);
  await writeFile(summaryPath, `${serializedSummary}\n`, { mode: 0o600 });
  await writeFile(path.join(baseOutputDirectory, "latest-summary.json"),
    `${serializedSummary}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    verdict: gameWithStorage.termination === "winner" ? "profiled" : "completed-with-blocker",
    outputDirectory,
    profilePath,
    summaryPath,
    termination: gameWithStorage.termination,
    commands: gameWithStorage.commandCount,
    elapsedMs: gameWithStorage.elapsedMs,
    topHotspots: analysis.topHotspots.slice(0, 10)
  }, null, 2)}\n`);
}

function runConfig(): ProfileRunConfig {
  return { schema: "riftbound.server-command-cpu-profile.config.v1",
    port, seed, roomId: roomId ?? null, maxCommands,
    commandTimeoutMs, gameTimeoutMs, startupTimeoutMs };
}

async function analyzeExistingRun(outputDirectory: string): Promise<void> {
  const profilePath = path.join(outputDirectory, "server.cpuprofile");
  const instrumentationPath = path.join(outputDirectory, "server-instrumentation.json");
  const gameHandoffPath = path.join(outputDirectory, "game-summary.json");
  const profileClockPath = path.join(outputDirectory, "profile-clock.json");
  const summaryPath = path.join(outputDirectory, "summary.json");
  const storageRoot = path.join(outputDirectory, "storage");
  const configPath = path.join(outputDirectory, "profile-config.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as Partial<ProfileRunConfig>;
  if (config.port !== undefined && (config.port < 35_740 || config.port > 35_759)) {
    throw new RangeError(`Stored profile port must be in 35740..35759, received ${config.port}`);
  }
  if (config.schema !== "riftbound.server-command-cpu-profile.config.v1" ||
      config.port === undefined || config.seed === undefined || config.maxCommands === undefined ||
      config.commandTimeoutMs === undefined || config.gameTimeoutMs === undefined ||
      config.startupTimeoutMs === undefined) {
    throw new Error(`${configPath} is missing required run parameters`);
  }
  const validatedConfig = config as ProfileRunConfig;
  const instrumentation = JSON.parse(await readFile(instrumentationPath, "utf8")) as InstrumentationSnapshot;
  const profileClock = JSON.parse(await readFile(profileClockPath, "utf8")) as {
    readonly timeOrigin: number;
  };
  const capturedGame = JSON.parse(await readFile(gameHandoffPath, "utf8")) as GameSummary;
  const storage = await storageSummary(storageRoot);
  const gameWithStorage: GameSummary = { ...capturedGame, storage };
  const analysis = analyzeProfile(profilePath, gameWithStorage.commands, profileClock.timeOrigin);
  const compliance = complianceFrom(gameWithStorage, instrumentation, analysis);
  const git = await gitState();
  const summary: ProfileRunSummary = {
    schema: "riftbound.server-command-cpu-profile.v1",
    generatedAt: new Date().toISOString(),
    task: taskName,
    repositoryRoot,
    git,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuProfileIntervalUs: 1_000,
      port: validatedConfig.port,
      seed: validatedConfig.seed,
      roomId: validatedConfig.roomId,
      maxCommands: validatedConfig.maxCommands,
      commandTimeoutMs: validatedConfig.commandTimeoutMs,
      gameTimeoutMs: validatedConfig.gameTimeoutMs,
      startupTimeoutMs: validatedConfig.startupTimeoutMs,
      storageMode: "file",
      profileWindow: "server child process lifetime; command windows are reported separately",
      analyzedFromExistingArtifacts: true
    },
    artifacts: { profileConfig: configPath, cpuProfile: profilePath, summaryJson: summaryPath,
      instrumentationJson: instrumentationPath,
      serverStdout: path.join(outputDirectory, "server.stdout.log"),
      serverStderr: path.join(outputDirectory, "server.stderr.log"), storageRoot },
    server: { profilePath, instrumentationPath,
      stdoutPath: path.join(outputDirectory, "server.stdout.log"),
      stderrPath: path.join(outputDirectory, "server.stderr.log"),
      childPid: instrumentation.pid, profileEpochMs: profileClock.timeOrigin, instrumentation },
    game: gameWithStorage,
    compliance,
    analysis,
    limitations: [
      "CPU profile covers the complete server child process lifetime; per-command windows are correlated by wall-clock epoch and may include adjacent asynchronous storage or GC work.",
      "Panels overlap conceptually: layers, projection, digest, storage and WebSocket categories are assigned by the innermost matching stack frame to avoid double-counting self samples.",
      "File size deltas are measured after each receipt and after both viewer projections converge; filesystem allocation, block padding and external contention are outside the CPU profile.",
      "This is one deterministic M1 match on one shared host, not a capacity certificate or proof that every official card/rules path is complete."
    ]
  };
  const serializedSummary = JSON.stringify(summary, null, 2);
  await writeFile(summaryPath, `${serializedSummary}\n`, { mode: 0o600 });
  await writeFile(path.join(baseOutputDirectory, "latest-summary.json"),
    `${serializedSummary}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ verdict: "analyzed-existing",
    outputDirectory, summaryPath, commands: gameWithStorage.commandCount,
    termination: gameWithStorage.termination,
    topHotspots: analysis.topHotspots.slice(0, 10) }, null, 2)}\n`);
}

async function driveProfileGame(url: string, storageRoot: string, serverPid: number,
  profileEpochMs: number): Promise<GameSummary> {
  const [{ V2WebSocketSession }, { botCommand }, { V2_M1_PRECONS }, { dueSetupPlayer },
    { cardProgramsById }] = await Promise.all([
    import("../../../packages/integration-tests/src/v2-duel/ws-session.ts"),
    import("../../../packages/integration-tests/src/v2-duel/bot.ts"),
    import("../../../packages/integration-tests/src/v2-duel/m1-precons.ts"),
    import("../../../packages/integration-tests/src/v2-duel/runner.ts"),
    import("../../../packages/card-dsl/dist/cards/registry.generated.js")
  ]);

  const events = { first: { packets: 0, bytes: 0 }, second: { packets: 0, bytes: 0 } };
  const first = await V2WebSocketSession.connect(url, `${seed}-first`, projection => {
    events.first.packets += 1;
    events.first.bytes += wireProjectionBytes(projection);
  });
  const second = await V2WebSocketSession.connect(url, `${seed}-second`, projection => {
    events.second.packets += 1;
    events.second.bytes += wireProjectionBytes(projection);
  });
  const startedAt = performance.now();
  try {
    await first.createRoom("rumble-sfd-client");
    await second.joinRoom(first.snapshot.session.roomId, "fiora-sfd-client");
    await first.submitDeck(V2_M1_PRECONS["rumble-sfd"].deck);
    await second.submitDeck(V2_M1_PRECONS["fiora-sfd"].deck);
    await first.setReady();
    await second.setReady();
    await Promise.all([
      first.waitForProjection(() => true, "first started projection"),
      second.waitForProjection(() => true, "second started projection")
    ]);

    const cardFacts = new Map(Object.values(V2_M1_PRECONS).flatMap(precon => precon.cards.map(card => {
      const program = cardProgramsById.get(card.canonicalCardId) as unknown as CardProgram | undefined;
      const normalized = card.cardType.toLowerCase();
      return [card.canonicalCardId, {
        energy: card.energy ?? null,
        power: card.power ?? null,
        status: String(program?.status ?? "pending"),
        kind: normalized === "unit" ? "unit" as const : normalized === "gear" ? "gear" as const : "spell" as const
      }] as const;
    })));
    const commands: ProfileCommand[] = [];
    const rejectedPlays = new Map<string, Set<string>>();
    let terminal: V2Projection | null = null;
    let termination: V2DuelResult["termination"] = "guard";
    let blockedReason: string | null = null;
    let lastAcceptedSignature: string | null = null;
    let repeatedAccepted = 0;
    const noProgress = new Map<string, number>();
    let previousFileBytes = await storageBytes(storageRoot);

    for (let index = 0; index < maxCommands; index += 1) {
      if (performance.now() - startedAt >= gameTimeoutMs) {
        termination = "guard";
        blockedReason = `game timeout ${gameTimeoutMs}ms`;
        break;
      }
      let live = snapshots(first, second);
      if (live[0].stateVersion !== live[1].stateVersion || live[0].eventSeq !== live[1].eventSeq) {
        const stateVersion = Math.max(live[0].stateVersion, live[1].stateVersion);
        const eventSeq = Math.max(live[0].eventSeq, live[1].eventSeq);
        await Promise.all([
          first.waitForProjection(value => value.stateVersion >= stateVersion &&
            value.eventSeq >= eventSeq, "first convergence"),
          second.waitForProjection(value => value.stateVersion >= stateVersion &&
            value.eventSeq >= eventSeq, "second convergence")
        ]);
        index -= 1;
        continue;
      }
      const current = live[0];
      if (current.winnerPlayerId !== null) {
        termination = "winner";
        terminal = current;
        break;
      }
      const actor = current.phase === "setup" ? dueSetupPlayer(live) : projectedActor(current);
      if (actor === null) {
        blockedReason = `no actor at ${current.phase}/${current.priority.window}, state ${current.stateVersion}`;
        terminal = current;
        break;
      }
      const session = first.snapshot.session.playerId === actor ? first : second;
      const view = session.snapshot.projection;
      if (view === null || view.viewerPlayerId !== actor) {
        const candidate = [first.snapshot.projection, second.snapshot.projection]
          .find(projection => projection?.viewerPlayerId === actor) ?? null;
        if (candidate === null) {
          blockedReason = `viewer mismatch for ${actor}`;
          terminal = current;
          break;
        }
      }
      const rejected = rejectedPlays.get(actor) ?? new Set<string>();
      const commandId = `profile-${seed}-${index}-${Date.now().toString(36)}`;
      const actorSession = view === null || view.viewerPlayerId !== actor ?
        ([first, second].find(candidate => candidate.snapshot.projection?.viewerPlayerId === actor) ?? session) : session;
      const actorView = actorSession.snapshot.projection ?? view;
      if (actorView === null) {
        blockedReason = `actor view unavailable for ${actor}`;
        terminal = current;
        break;
      }
      const actorBefore = actorView;
      const partialProgress = actorView.combat.status === "active" &&
          actorView.combat.step === "damage"
        ? combatDamageCommand(actorView, actor, commandId)
        : botCommand(actorView, actor, commandId, rejected, cardFacts);
      const command = partialProgress === null && actorView.phase === "setup" &&
        actorView.pendingChoice.status === "pending" &&
        actorView.pendingChoice.ownerPlayerId === actor &&
        actorView.pendingChoice.options?.some(option => option.objectRef !== undefined) === true
      ? { type: "mulligan" as const, commandId, stateVersion: actorView.stateVersion,
          selectedObjectIds: [] }
      : partialProgress;
      if (command === null) {
        blockedReason = `no legal command at ${current.phase}, state ${current.stateVersion}`;
        terminal = current;
        break;
      }
      const beforeEvents = { first: { ...events.first }, second: { ...events.second } };
      const startedAtEpochMs = Date.now();
      const ioBefore = await processIo(serverPid);
      const receipt = await actorSession.sendCommandWithin(command, commandTimeoutMs);
      const receiptAtEpochMs = Date.now();
      const latencyMs = receiptAtEpochMs - startedAtEpochMs;
      const afterReceipt = await storageBytes(storageRoot);
      const ioAfter = await processIo(serverPid);
      const next = command.type === "mulligan"
        ? await waitForAnyMulliganTransition(first, second, current, receipt, commandTimeoutMs)
        : receipt.rejection === null
          ? await waitForReceiptConvergence(first, second, receipt, commandTimeoutMs)
          : [first.snapshot.projection ?? actorBefore,
            second.snapshot.projection ?? actorBefore] as const;
      const convergedAtEpochMs = Date.now();
      const afterConvergence = await storageBytes(storageRoot);
      const packetFirst = events.first.packets - beforeEvents.first.packets;
      const packetSecond = events.second.packets - beforeEvents.second.packets;
      const bytesFirst = events.first.bytes - beforeEvents.first.bytes;
      const bytesSecond = events.second.bytes - beforeEvents.second.bytes;
      const result: ProfileCommand = {
        index, type: command.type, actorPlayerId: actor, commandId,
        phase: current.phase, turnNumber: current.turnNumber,
        beforeStateVersion: current.stateVersion,
        receiptStateVersion: receipt.stateVersion,
        eventSeq: receipt.eventSeq, accepted: receipt.accepted, duplicate: receipt.duplicate,
        latencyMs: round(latencyMs),
        projectionConvergenceMs: round(convergedAtEpochMs - receiptAtEpochMs),
        commandWireBytes: Buffer.byteLength(JSON.stringify({ type: "command", protocolVersion: "2.0.0", command })),
        receiptWireBytes: Buffer.byteLength(JSON.stringify(receipt)),
        projectionPackets: { first: packetFirst, second: packetSecond },
        projectionWireBytes: { first: bytesFirst, second: bytesSecond },
        fileBytesBefore: previousFileBytes,
        fileBytesAfterReceipt: afterReceipt,
        fileBytesAfterConvergence: afterConvergence,
        fileBytesDelta: Math.max(0, afterConvergence - previousFileBytes),
        processWriteBytes: Math.max(0, ioAfter.writeBytes - ioBefore.writeBytes),
        processWriteCalls: Math.max(0, ioAfter.writeCalls - ioBefore.writeCalls),
        startedAtEpochMs, receiptAtEpochMs, convergedAtEpochMs
      };
      commands.push(result);
      previousFileBytes = afterConvergence;
      if (!receipt.accepted) {
        blockedReason = receipt.rejection ?? `command ${command.type} rejected`;
        if (command.type === "play") {
          rejected.add(command.cardObjectId);
          rejectedPlays.set(actor, rejected);
        } else {
          terminal = next[0];
          break;
        }
        continue;
      }

      if (receipt.accepted && command.type !== "mulligan" &&
          !(next[0].pendingChoice.status === "pending" && next[1].pendingChoice.status === "pending")) {
        const signature = JSON.stringify([receipt.stateVersion, next[0].stateVersion,
          command.type]);
        if (signature === lastAcceptedSignature) repeatedAccepted += 1;
        else { lastAcceptedSignature = signature; repeatedAccepted = 1; }
        if (repeatedAccepted >= 2) {
          blockedReason = `accepted ${command.type} did not advance state at ${receipt.stateVersion}`;
          terminal = next[0];
          break;
        }
      } else {
        lastAcceptedSignature = null;
        repeatedAccepted = 0;
      }
      if (next[0].stateVersion === current.stateVersion &&
        next[1].stateVersion === current.stateVersion &&
        next[0].eventSeq === current.eventSeq && next[1].eventSeq === current.eventSeq &&
        next[0].pendingChoice.status === current.pendingChoice.status &&
        !(next[0].pendingChoice.status === "pending" && current.pendingChoice.status === "pending" &&
          (next[0].pendingChoice.choiceId !== current.pendingChoice.choiceId ||
            next[0].pendingChoice.ownerPlayerId !== current.pendingChoice.ownerPlayerId))) {
      const key = `${actor}\0${command.type}\0${JSON.stringify(command)}`;
      const prior = noProgress.get(key) ?? 0;
      if (prior >= 1) {
        blockedReason = `accepted ${command.type} produced no projected progress`;
        terminal = next[0];
        break;
      }
      noProgress.set(key, prior + 1);
      }
      live = next;
      terminal = next[0];
    }

    const final = terminal ?? snapshots(first, second)[0];
    if (termination !== "winner") {
      termination = "blocked";
      blockedReason ??= `command guard ${maxCommands} exhausted`;
    }
    const aggregateByType = aggregateCommands(commands);
    const summary: GameSummary = {
      seed,
      termination,
      winnerPlayerId: final.winnerPlayerId,
      blockedReason,
      elapsedMs: round(performance.now() - startedAt),
      commandCount: commands.length,
      commands,
      aggregateByType,
      projectionCounts: {
        profileLifecycle: "mulligan is driven through the room setup command; per-game commands are mulligan plus EngineRuntime records",
        wsPackets: events.first.packets + events.second.packets,
        wsPacketsPerCommand: commands.length === 0 ? 0 : round((events.first.packets + events.second.packets) / commands.length),
        wsWireBytes: events.first.bytes + events.second.bytes,
        sourceSemantics: {
          actorResult: "submit -> executeAndCommit -> projectFor(actor): 1 projection for a completed command",
          journalObservation: "appendJournal builds player A, player B, and spectator projections: 3 projections per written journal record",
          roomBroadcast: "submitEngineV2 -> broadcastProjections -> sendProjection for each connected player: 2 projections",
          completedCommandTotal: "1 actor result + 3 journal observations + 2 WebSocket broadcasts = 6 projection constructions per completed command before additional caller-side use",
          digestWork: "journal append digest work is spectator/viewer A/viewer B + public state + private A/B = 5 canonical JSON+SHA operations per completed record",
          pendingChoice: "suspending command rolls back authoritative host/flow state, records the pending receipt, then choose re-executes the original command from its beginning against frozen decisions; journal/room publication then runs again"
        }
      },
      storage: { root: storageRoot, initialBytes: 0, finalBytes: previousFileBytes,
        growthBytes: previousFileBytes, archiveLogGrowthBytes: 0,
        archiveRecordBytes: { records: 0, average: 0, median: 0, max: 0 }, runFiles: [] }
    };
    return summary;
  } finally {
    first.closeImmediately();
    second.closeImmediately();
  }
}

function projectedActor(projection: V2Projection): string | null {
  if (projection.pendingChoice.status === "pending" &&
      projection.pendingChoice.ownerPlayerId === projection.viewerPlayerId)
    return projection.pendingChoice.ownerPlayerId;
  if (projection.phase === "setup" && projection.pendingChoice.status === "pending")
    return projection.pendingChoice.ownerPlayerId;
  if (projection.combat.status === "active") {
    if (projection.combat.step === "damage") return combatDamagePlayer(projection);
    if (projection.priority.playerId !== null) return projection.priority.playerId;
  }
  if (projection.priority.playerId !== null) return projection.priority.playerId;
  if (projection.actionOptions.canAdvance) return projection.activePlayerId;
  if (projection.actionOptions.canEndTurn) return projection.activePlayerId;
  if (projection.phase === "main" && projection.chain.items.length === 0 &&
      projection.combat.status === "none") return projection.activePlayerId;
  return projection.priority.playerId;
}

function combatDamagePlayer(projection: V2Projection): string | null {
  const damage = projection.combat.status === "active" ? projection.combat.damage : undefined;
  if (damage === undefined) return null;
  if (projection.players.some(player => player.playerId === damage.expectedPlayerId)) {
    return damage.expectedPlayerId;
  }
  return damage.expectedPlayerId === "A" ? projection.players[0]?.playerId ?? null :
    damage.expectedPlayerId === "B" ? projection.players[1]?.playerId ?? null : null;
}

function combatDamageCommand(projection: V2Projection, actor: string, commandId: string):
  Extract<V2Command, { readonly type: "combat-damage" }> | null {
  const combat = projection.combat;
  if (combat.status !== "active" || combat.step !== "damage" || combat.damage === undefined ||
      combat.combatId === undefined || combat.battlefieldId === undefined ||
      combat.damage.expectedPlayerId !== actor) return null;
  const battlefield = projection.battlefields.find(field =>
    field.battlefieldId === combat.battlefieldId);
  if (battlefield === undefined) return null;
  const opponent = projection.players.find(player => player.playerId !== actor)?.playerId;
  if (opponent === undefined) return null;
  const targets = battlefield.occupantObjectIds.flatMap(id => {
    const unit = projection.objects.find(object => object.objectId === id);
    const controller = unit?.controllerPlayerId ?? unit?.ownerPlayerId;
    return unit !== undefined && controller === opponent ? [unit] : [];
  }).sort((left, right) =>
    Math.max(0, (left.might ?? 0) - (left.damage ?? 0)) -
    Math.max(0, (right.might ?? 0) - (right.damage ?? 0)));
  if (targets.length === 0) return null;
  // Assign lethal in sequence, then excess to the final legal target. This is
  // derived only from public object damage/might; the server remains the
  // authority and rejects malformed allocations.
  const remaining = combat.damage.attackerSubmitted
    ? combat.damage.defenderMight : combat.damage.attackerMight;
  let budget = remaining;
  const assignments = targets.flatMap(unit => {
    if (budget <= 0) return [];
    const lethal = Math.max(0, (unit.might ?? 0) - (unit.damage ?? 0));
    const amount = Math.min(budget, lethal);
    budget -= amount;
    return amount > 0 ? [{ unitObjectId: unit.objectId, amount }] : [];
  });
  if (budget > 0) {
    const last = assignments.at(-1);
    if (last !== undefined) {
      last.amount += budget;
      budget = 0;
    }
  }
  if (assignments.length === 0 || budget > 0) return null;
  return { type: "combat-damage", commandId, stateVersion: projection.stateVersion,
    combatId: combat.combatId, assignments };
}

function snapshots(first: V2WebSocketSession, second: V2WebSocketSession): readonly [V2Projection, V2Projection] {
  const left = first.snapshot.projection;
  const right = second.snapshot.projection;
  if (left === null || right === null) throw new Error("Both clients require a projection");
  return [left, right];
}

async function waitForCommandProjection(session: V2WebSocketSession,
  before: V2Projection, command: V2Command, receipt: V2CommandReceipt): Promise<V2Projection> {
  const changed = (projection: V2Projection): boolean =>
    projection.stateVersion > receipt.stateVersion || projection.eventSeq > receipt.eventSeq ||
    (receipt.rejection !== null && projection.stateVersion === before.stateVersion &&
      projection.eventSeq === before.eventSeq) ||
    projection.pendingChoice.status !== before.pendingChoice.status ||
    (projection.pendingChoice.status === "pending" && before.pendingChoice.status === "pending" &&
      (projection.pendingChoice.choiceId !== before.pendingChoice.choiceId ||
        projection.pendingChoice.kind !== before.pendingChoice.kind));
  return session.waitForProjection(changed,
    `${session.name} projection after ${command.commandId}`, commandTimeoutMs);
}

async function waitForAnyMulliganTransition(first: V2WebSocketSession,
  second: V2WebSocketSession, before: V2Projection, receipt: V2CommandReceipt,
  timeoutMs: number): Promise<readonly [V2Projection, V2Projection]> {
  const transition = (projection: V2Projection): boolean =>
    projection.phase !== "setup" || projection.stateVersion > receipt.stateVersion ||
    projection.eventSeq > receipt.eventSeq ||
    projection.pendingChoice.status !== before.pendingChoice.status ||
    (projection.pendingChoice.status === "pending" && before.pendingChoice.status === "pending" &&
      (projection.pendingChoice.choiceId !== before.pendingChoice.choiceId ||
        projection.pendingChoice.ownerPlayerId !== before.pendingChoice.ownerPlayerId));
  const winner = await Promise.race([
    first.waitForProjection(transition, "first mulligan transition", timeoutMs),
    second.waitForProjection(transition, "second mulligan transition", timeoutMs)
  ]);
  const snapshotsNow = [first.snapshot.projection, second.snapshot.projection];
  return [snapshotsNow[0] ?? winner, snapshotsNow[1] ?? winner] as const;
}

async function waitForReceiptConvergence(first: V2WebSocketSession,
  second: V2WebSocketSession, receipt: V2CommandReceipt,
  timeoutMs: number): Promise<readonly [V2Projection, V2Projection]> {
  const reached = (projection: V2Projection): boolean =>
    projection.stateVersion >= receipt.stateVersion && projection.eventSeq >= receipt.eventSeq;
  const current = [first.snapshot.projection, second.snapshot.projection];
  if (current[0] !== null && current[1] !== null && reached(current[0]) && reached(current[1])) {
    return current as readonly [V2Projection, V2Projection];
  }
  const pair = await Promise.all([
    first.waitForProjection(reached, "first receipt convergence", timeoutMs),
    second.waitForProjection(reached, "second receipt convergence", timeoutMs)
  ]);
  return pair as readonly [V2Projection, V2Projection];
}

function aggregateCommands(commands: readonly ProfileCommand[]): GameSummary["aggregateByType"] {
  return [...new Set(commands.map(command => command.type))].sort().map(type => {
    const rows = commands.filter(command => command.type === type);
    const latencies = rows.map(row => row.latencyMs);
    return {
      type,
      count: rows.length,
      averageLatencyMs: round(average(latencies)),
      p50LatencyMs: round(percentile(latencies, 0.5)),
      p95LatencyMs: round(percentile(latencies, 0.95)),
      p99LatencyMs: round(percentile(latencies, 0.99)),
      maxLatencyMs: round(Math.max(...latencies)),
      averageFileBytes: round(average(rows.map(row => row.fileBytesDelta))),
      averageProcessWriteBytes: round(average(rows.map(row => row.processWriteBytes)))
    };
  });
}

function complianceFrom(game: GameSummary, instrumentation: InstrumentationSnapshot,
  analysis: ProfileAnalysis): ComplianceSnapshot {
  const fileRows = game.commands.filter(command => command.type !== "mulligan");
  const archiveFiles = game.storage.runFiles.filter(file => file.path.endsWith("archive.log"));
  const journalFiles = game.storage.runFiles.filter(file => file.path.endsWith("head.json"));
  const stageMs = analysis.phaseTime;
  void stageMs;
  return {
    commandCount: game.commandCount,
    gameDefaultRuleset: {
      rulesetVersion: "core-1.5",
      protocolVersion: "2.0.0",
      runtimeMode: "engine-v2"
    },
    projectionConstructions: {
      journalObservationsPerCompletedRecord: 3,
      actorResultPerCompletedCommand: 1,
      roomBroadcastsPerConnectedViewer: 2,
      totalBeforeTransport: 6,
      digestOperationsPerCompletedRecord: 5,
      duplicateEvidence: {
        publicView: true,
        playerViews: true
      }
    },
    pendingChoice: {
      suspendingCommands: game.commands.filter(command =>
        command.type === "choose").length,
      resumedChoiceCommands: game.commands.filter(command =>
        command.type === "choose").length,
      rollbackThenReexecutesOriginalCommand: game.commands.some(command => command.type === "choose")
    },
    layerPasses: {
      evaluateAllCalls: instrumentation.counters["layer.evaluateAll"]?.calls ?? 0,
      evaluateCalls: instrumentation.counters["layer.evaluate"]?.calls ?? 0,
      stableLayerCalls: instrumentation.counters["chain.withStableLayers"]?.calls ?? 0,
      avgEvaluateAllPerCommand: game.commandCount === 0 ? 0 :
        round((instrumentation.counters["layer.evaluateAll"]?.calls ?? 0) / game.commandCount),
      avgEvaluatePerCommand: game.commandCount === 0 ? 0 :
        round((instrumentation.counters["layer.evaluate"]?.calls ?? 0) / game.commandCount),
      avgStableLayerCallsPerCommand: game.commandCount === 0 ? 0 :
        round((instrumentation.counters["chain.withStableLayers"]?.calls ?? 0) / game.commandCount)
    },
    storagePerCommand: {
      archiveLogBytesAvg: fileRows.length === 0 ? 0 : round(average(fileRows.map(command =>
        command.fileBytesAfterReceipt - command.fileBytesBefore))),
      privateJournalHeadBytesAvg: 0,
      measuredFileBytesAvg: fileRows.length === 0 ? 0 :
        round(average(fileRows.map(command => command.fileBytesDelta))),
      processWriteBytesAvg: fileRows.length === 0 ? 0 :
        round(average(fileRows.map(command => command.processWriteBytes)))
    }
  };
}

function analyzeProfile(profilePath: string, commands: readonly ProfileCommand[],
  profileEpochMs: number): ProfileAnalysis {
  const profile = JSON.parse(readFileSync(profilePath, "utf8")) as CpuProfile;
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const stackCache = new Map<number, readonly ProfileNode[]>();
  const stackOf = (id: number): readonly ProfileNode[] => {
    const cached = stackCache.get(id);
    if (cached !== undefined) return cached;
    const stack: ProfileNode[] = [];
    let cursor: number | undefined = id;
    while (cursor !== undefined) {
      const node = nodes.get(cursor);
      if (node === undefined) break;
      stack.push(node);
      cursor = parent.get(cursor);
    }
    stack.reverse();
    stackCache.set(id, stack);
    return stack;
  };
  interface Aggregate {
    function: string;
    file: string;
    line: number;
    category: string;
    package: string;
    selfUs: number;
    idleUs: number;
    inclusiveUs: number;
  }
  const hotspots = new Map<string, Aggregate>();
  const commandHotspots = new Map<string, Aggregate>();
  const phaseTimelineUs: { readonly commandIndex: number;
    readonly phases: PhaseAccumulator }[] = [];
  for (const block of commands) {
    phaseTimelineUs.push({ commandIndex: block.index,
      phases: zeroPhases() });
  }
  const commandGcUs = commands.map(() => 0);
  const packageUs = new Map<string, number>();
  const packageInclusiveUs = new Map<string, number>();
  const phaseUs = zeroPhases();
  const commandPhaseUs = commands.map(() => zeroPhases());
  let sampledUs = 0;
  let rangeSampledUs = 0;
  let timestamp = profile.startTime;
  const firstCommandEpochMs = commands[0]?.startedAtEpochMs;
  const lastCommandEpochMs = commands.at(-1)?.convergedAtEpochMs;
  const rangeStartUs = firstCommandEpochMs === undefined
    ? profile.startTime
    : Math.max(profile.startTime,
        profile.startTime + (firstCommandEpochMs - profileEpochMs) * 1000);
  const rangeEndUs = lastCommandEpochMs === undefined
    ? profile.endTime
    : Math.min(profile.endTime,
        profile.startTime + (lastCommandEpochMs - profileEpochMs) * 1000);
  if (rangeEndUs <= rangeStartUs) {
    throw new Error("Command timing window does not overlap the CPU profile");
  }
  for (let index = 0; index < profile.samples.length; index += 1) {
    const deltaUs = Math.max(0, profile.timeDeltas[index] ?? 0);
    timestamp += deltaUs;
    const node = nodes.get(profile.samples[index]!);
    if (node === undefined) continue;
    sampledUs += deltaUs;
    if (timestamp < rangeStartUs || timestamp > rangeEndUs) continue;
    rangeSampledUs += deltaUs;
    const stack = stackOf(node.id);
    const category = categoryOf(stack);
    const frameUrl = frameUrlOf(node.callFrame.url);
    const packageName = packageOf(frameUrl);
    phaseUs[categoryKey(category)] += deltaUs;
    for (const included of new Set(stack.map(caller => packageOf(frameUrlOf(caller.callFrame.url))))) {
      packageInclusiveUs.set(included, (packageInclusiveUs.get(included) ?? 0) + deltaUs);
    }
    packageUs.set(packageName, (packageUs.get(packageName) ?? 0) + deltaUs);
    const frame = node.callFrame;
    const file = relativeProfilePath(frameUrl);
    const key = `${frame.functionName || "(anonymous)"}\u0000${file}\u0000${frame.lineNumber}`;
    const aggregate = hotspots.get(key) ?? { function: frame.functionName || "(anonymous)",
      file, line: frame.lineNumber + 1, category, package: packageName, selfUs: 0,
      idleUs: 0, inclusiveUs: 0 };
    aggregate.selfUs += deltaUs;
    if (frame.functionName === "(idle)") aggregate.idleUs += deltaUs;
    hotspots.set(key, aggregate);
    for (let callerIndex = stack.length - 2; callerIndex >= 0; callerIndex -= 1) {
      const caller = stack[callerIndex]!;
      const callerFrame = caller.callFrame;
      const callerUrl = frameUrlOf(callerFrame.url);
      const callerFile = relativeProfilePath(callerUrl);
      const callerCategory = categoryOf(stack.slice(0, callerIndex + 1));
      const callerPackage = packageOf(callerUrl);
      const callerKey = `${callerFrame.functionName || "(anonymous)"}\u0000${callerFile}\u0000${callerFrame.lineNumber}`;
      const callerAggregate = hotspots.get(callerKey) ?? {
        function: callerFrame.functionName || "(anonymous)", file: callerFile,
        line: callerFrame.lineNumber + 1, category: callerCategory,
        package: callerPackage, selfUs: 0, idleUs: 0, inclusiveUs: 0,
      };
      callerAggregate.inclusiveUs += deltaUs;
      hotspots.set(callerKey, callerAggregate);
    }
    const sampleEpochMs = profileEpochMs + (timestamp - profile.startTime) / 1000;
    const commandIndex = commands.findIndex(command =>
      sampleEpochMs >= command.startedAtEpochMs && sampleEpochMs <= command.convergedAtEpochMs);
    if (commandIndex >= 0) {
      commandPhaseUs[commandIndex]![categoryKey(category)] += deltaUs;
      const block = phaseTimelineUs[commandIndex]!;
      block.phases[categoryKey(category)] += deltaUs;
      if (node.callFrame.functionName === "(garbage collector)") commandGcUs[commandIndex]! += deltaUs;
      const commandHotspot = commandHotspots.get(key) ?? { function: frame.functionName || "(anonymous)",
        file, line: frame.lineNumber + 1, category, package: packageName, selfUs: 0,
        idleUs: 0, inclusiveUs: 0 };
      commandHotspot.selfUs += deltaUs;
      commandHotspot.inclusiveUs += deltaUs;
      if (frame.functionName === "(idle)") commandHotspot.idleUs += deltaUs;
      commandHotspots.set(key, commandHotspot);
      // CPU profile nodes form invocation trees. Walk the cached ancestor path
      // once per sample so each matching caller can report inclusive time
      // without recomputing the full stack for every ancestor.
      for (let callerIndex = stack.length - 2; callerIndex >= 0; callerIndex -= 1) {
        const callerFrame = stack[callerIndex]!.callFrame;
        const callerUrl = frameUrlOf(callerFrame.url);
        const callerFile = relativeProfilePath(callerUrl);
        const callerKey = `${callerFrame.functionName || "(anonymous)"}\u0000${callerFile}\u0000${callerFrame.lineNumber}`;
        const callerAggregate = commandHotspots.get(callerKey) ?? {
          function: callerFrame.functionName || "(anonymous)", file: callerFile,
          line: callerFrame.lineNumber + 1, category,
          package: packageOf(callerUrl), selfUs: 0, idleUs: 0, inclusiveUs: 0,
        };
        callerAggregate.inclusiveUs += deltaUs;
        commandHotspots.set(callerKey, callerAggregate);
      }
    }
  }
  const durationMs = Math.max(0, rangeEndUs - rangeStartUs) / 1000;
  const sampledMs = rangeSampledUs / 1000;
  const commandSampledUs = rangeSampledUs;
  const commandDenominatorUs = commands.reduce((sum, command) => sum + Math.max(0,
    (command.convergedAtEpochMs - command.startedAtEpochMs) * 1000), 0);
  const gcUs = commandGcUs.reduce((sum, value) => sum + value, 0);
  const effectiveCpuUs = Math.max(0, rangeSampledUs - phaseUs.idle - phaseUs.other + gcUs);
  if (effectiveCpuUs === 0) throw new Error("CPU profile has no active samples in the command window");
  const topHotspots = [...commandHotspots.entries()]
    .map(([key, value]) => [key, { ...value,
      selfUs: value.selfUs - value.idleUs }] as const)
    .filter(([, value]) => value.selfUs > 0 && value.function !== "(garbage collector)")
    .sort((left, right) => right[1].selfUs - left[1].selfUs)
    .slice(0, 20).map(([, value]) => ({ function: value.function, file: value.file,
      line: value.line, category: value.category, package: value.package,
      selfMs: round(value.selfUs / 1000), totalMs: round(value.inclusiveUs / 1000),
      percent: finitePercent(value.selfUs, effectiveCpuUs),
      totalPercent: finitePercent(value.inclusiveUs, commandDenominatorUs) }));
  const aggregateAverage = zeroPhases();
  for (const phases of commandPhaseUs) for (const [key, value] of Object.entries(phases)) {
    aggregateAverage[key as PhaseKey] += value;
  }
  const commandCount = Math.max(1, commands.length);
  for (const key of Object.keys(aggregateAverage) as PhaseKey[]) {
    aggregateAverage[key] /= commandCount;
  }
  const typeCpu = [...new Set(commands.map(command => command.type))].sort().map(type => {
    const indexes = commands.flatMap((command, index) => command.type === type ? [index] : []);
    const phases = zeroPhases();
    let activeUs = 0;
    for (const index of indexes) {
      for (const [key, value] of Object.entries(commandPhaseUs[index]!)) {
        phases[key as PhaseKey] += value;
      }
      activeUs += Math.max(0, Object.entries(commandPhaseUs[index]!).filter(([key]) =>
        key !== "idle" && key !== "other").reduce((sum, [, value]) => sum + value, 0) +
        commandGcUs[index]!);
    }
    for (const key of Object.keys(phases) as PhaseKey[]) phases[key] /= Math.max(1, indexes.length);
    return { type, count: indexes.length,
      averageActiveCpuMs: round(activeUs / Math.max(1, indexes.length) / 1000),
      phasesMs: convertPhases(phases) };
  });
  return {
    profileDurationMs: round(durationMs),
    sampledMs: round(sampledMs),
    host: process.version,
    profilePath,
    topHotspots,
    packageTime: [...packageUs].sort((left, right) => right[1] - left[1]).slice(0, 20)
      .map(([name, us]) => ({ package: name, selfMs: round(us / 1000),
        totalMs: round((packageInclusiveUs.get(name) ?? 0) / 1000),
        percent: finitePercent(us, effectiveCpuUs),
        totalPercent: finitePercent(packageInclusiveUs.get(name) ?? 0,
          commandDenominatorUs) })),
    phaseTime: convertPhases(phaseUs),
    phasePercent: phasePercents(phaseUs),
    effectiveCpuMs: round(effectiveCpuUs / 1000),
    gcMs: round(gcUs / 1000),
    effectiveCpuPercent: finitePercent(effectiveCpuUs, rangeSampledUs),
    gcPercent: finitePercent(gcUs, rangeSampledUs),
    commandAverage: {
      commands: commands.length,
      averageElapsedMs: commands.length === 0 ? 0 :
        round(commands.reduce((sum, command) =>
          sum + command.convergedAtEpochMs - command.startedAtEpochMs, 0) / commands.length),
      sampledMs: round(commandSampledUs / 1000 / commandCount),
      sampledPercentOfElapsed: finitePercent(commandSampledUs,
        commandDenominatorUs),
      phasesMs: convertPhases(aggregateAverage),
      phasesPercentOfSample: phasePercents(aggregateAverage)
    },
    aggregateByType: typeCpu,
    phaseTimeline: phaseTimelineUs.map(block => ({ commandIndex: block.commandIndex,
        phasesMs: convertPhases(block.phases) })),
    commandCpu: commands.map((command, index) => ({
      commandIndex: command.index,
      type: command.type,
      sampledMs: round(Object.entries(commandPhaseUs[index]!).filter(([key]) =>
        key !== "idle" && key !== "other").reduce((sum, [, value]) => sum + value, 0) / 1000),
      activeCpuMs: round(Math.max(0,
        Object.entries(commandPhaseUs[index]!).filter(([key]) =>
          key !== "idle" && key !== "other").reduce((sum, [, value]) => sum + value, 0) +
        commandGcUs[index]!) / 1000),
      gcMs: round(commandGcUs[index]! / 1000),
      phasesMs: convertPhases(commandPhaseUs[index]!)
    }))
  };
}

type PhaseKey = keyof PhaseMs;
type PhaseAccumulator = Record<PhaseKey, number>;

function zeroPhases(): PhaseAccumulator {
  return { engineExecution: 0, layers: 0, projection: 0, digestCanonicalJson: 0,
    protocolValidation: 0, journal: 0, storage: 0, jsonSerialization: 0,
    copy: 0, idle: 0, websocket: 0, cardDsl: 0, gameServer: 0,
    nodeInternal: 0, other: 0 };
}

function convertPhases(value: PhaseAccumulator): PhaseMs {
  return Object.fromEntries(Object.entries(value).map(([key, us]) => [key, round(us / 1000)])) as unknown as PhaseMs;
}

function phasePercents(value: PhaseAccumulator): PhaseMs {
  const total = Object.values(value).filter(Number.isFinite).reduce((sum, amount) => sum + amount, 0);
  return Object.fromEntries(Object.entries(value).map(([key, amount]) => [
    key, finitePercent(amount, total),
  ])) as unknown as PhaseMs;
}

function finitePercent(value: number, total: number): number {
  return total <= 0 || !Number.isFinite(total) || !Number.isFinite(value)
    ? 0 : Math.max(0, Math.min(100, Math.round(value / total * 10_000) / 100));
}

function categoryKey(category: string): PhaseKey {
  return category as PhaseKey;
}

function categoryOf(stack: readonly ProfileNode[]): string {
  const frames = stack.map(node => node.callFrame);
  const includes = (...names: readonly string[]) => frames.some(frame =>
    names.some(name => frame.functionName === name || frame.functionName.includes(name)));
  const urlsInclude = (...parts: readonly string[]) => frames.some(frame =>
    parts.some(part => frameUrlOf(frame.url).includes(part)));
  if (frames[frames.length - 1]?.functionName === "(idle)") return "idle";
  if (frames.some(frame => frame.functionName === "(garbage collector)")) return "other";
  if (frames[frames.length - 1]?.functionName === "structuredClone") return "copy";
  if (includes("projectionDigest", "digestJournalValue", "canonicalJournalJson", "canonicalJson", "digest")) return "digestCanonicalJson";
  if (includes("isV2Projection", "isDuelProjection", "isClientMessage", "isV2Command", "isDuelCommand")) return "protocolValidation";
  if (includes("LayerEngine", "KeywordGrantLayerEngine", "withStableLayers", "layerObjects", "freshLayerObjects", "evaluateAll", "layerPass")) return "layers";
  if (includes("projectRuntime", "projectFor", "projectObjectForChoice", "projectCanonicalDuelMatch", "projectDuelRuntime", "projectActionsV2", "actionOptions", "withChoiceMetadata")) return "projection";
  if (urlsInclude("private-journal-cas-store", "file-event-store", "persistent-room-store", "file-room-store") || includes("FileEventStore", "PersistentRoomArchiveStore", "FileRoomStore", "compareAndSwap", "installBlob", "writeRecord", "readDurableBlob")) return "storage";
  if (includes("RuntimeJournalWriter", "appendJournal", "canonicalCommand", "pendingChoiceFor", "currentJournal", "restoreRecording", "appendRecording")) return "journal";
  if (frames.some(frame => frame.functionName === "stringify" || frame.functionName === "parse" ||
      (frameUrlOf(frame.url) === "" && (frame.functionName.includes("JSON") || frame.functionName.includes("stringify"))))) return "jsonSerialization";
  if (urlsInclude("/node_modules/ws/", "websocket") || includes("websocket.send", "Sender.send", "Receiver", "handleUpgrade")) return "websocket";
  if (urlsInclude("/packages/card-dsl/")) return "cardDsl";
  if (includes("MatchRuntime", "atomicCommand", "executeAndCommit", "executeValidatedCommand", "TurnFlow", "ChainEngine", "applyDuel", "playDuel", "resolveDuel", "Effect", "execute")) return "engineExecution";
  if (urlsInclude("/packages/engine-core/")) return "engineExecution";
  if (urlsInclude("/apps/game-server/")) return "gameServer";
  if (urlsInclude("node:internal")) return "nodeInternal";
  return "other";
}

function packageOf(url: string): string {
  if (url.includes("/packages/engine-core/src/layers/") || url.includes("/packages/engine-core/dist/layers/")) return "engine-core/layers";
  if (url.includes("/packages/engine-core/src/chain/") || url.includes("/packages/engine-core/dist/chain/")) return "engine-core/chain";
  if (url.includes("/packages/engine-core/src/programs/") || url.includes("/packages/engine-core/dist/programs/")) return "engine-core/programs";
  if (url.includes("/packages/engine-core/src/effects/") || url.includes("/packages/engine-core/dist/effects/")) return "engine-core/effects";
  if (url.includes("/packages/engine-core/src/duel/") || url.includes("/packages/engine-core/dist/duel/")) return "engine-core/duel";
  if (url.includes("/packages/engine-core/")) return "engine-core/other";
  if (url.includes("/packages/card-dsl/")) return "card-dsl";
  if (/\/apps\/game-server\/(?:src|dist)\/engine-runtime\/projection/u.test(url)) return "game-server/projection";
  if (/\/apps\/game-server\/(?:src|dist)\/engine-runtime\/(?:journal|runtime|host)/u.test(url)) return "game-server/runtime";
  if (/\/apps\/game-server\/(?:src|dist)\/room/u.test(url)) return "game-server/room";
  if (/\/apps\/game-server\/(?:src|dist)\/(?:private-journal|storage\/)/u.test(url)) return "game-server/storage";
  if (/\/apps\/game-server\/(?:src|dist)\/server/u.test(url)) return "game-server/server";
  if (url.includes("/apps/game-server/")) return "game-server/other";
  if (url.includes("/packages/replay-core/")) return "replay-core";
  if (url.includes("/packages/protocol/")) return "protocol";
  if (url.includes("/node_modules/ws/")) return "ws";
  if (url.includes("node:internal")) return "node/internal";
  if (url === "") return "v8-builtin";
  if (url.startsWith("node:")) return "node/internal";
  return "other";
}

function relativeProfilePath(value: unknown): string {
  if (typeof value !== "string") return String(value);
  if (value.startsWith("file:")) {
    try { return path.relative(repositoryRoot, fileURLToPath(value)); } catch { return value; }
  }
  return value;
}

function frameUrlOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && "toString" in value) {
    try { return String(value); } catch { return "[unprintable URL]"; }
  }
  return "";
}

function serverBootstrapSource(): string {
  return `import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const options = new Map(process.argv.slice(2).map(argument => {
  const index = argument.indexOf("=");
  return index < 0 ? [argument, ""] : [argument.slice(0, index), argument.slice(index + 1)];
}));
const counters = new Map();
const failures = [];
const instrument = (target, property, name) => {
  const original = target[property];
  if (typeof original !== "function") { failures.push(name); return; }
  Object.defineProperty(target, property, { configurable: true, writable: true,
    value: function (...args) {
      const started = performance.now();
      try { return original.apply(this, args); }
      finally {
        const elapsed = performance.now() - started;
        const count = counters.get(name) ?? { calls: 0, totalMs: 0, maxMs: 0 };
        count.calls += 1; count.totalMs += elapsed; count.maxMs = Math.max(count.maxMs, elapsed);
        counters.set(name, count);
      }
    } });
};

await writeFileSync(options.get("--profile-clock-path"),
  JSON.stringify({ timeOrigin: performance.timeOrigin }));
const { LayerEngine } = await import("${pathToFileURL(path.join(repositoryRoot, "packages/engine-core/dist/layers/engine.js")).href}");
instrument(LayerEngine.prototype, "evaluate", "layer.evaluate");
instrument(LayerEngine.prototype, "evaluateAll", "layer.evaluateAll");
const { ChainEngine } = await import("${pathToFileURL(path.join(repositoryRoot, "packages/engine-core/dist/chain/engine.js")).href}");
instrument(ChainEngine.prototype, "withStableLayers", "chain.withStableLayers");
const { TurnFlow } = await import("${pathToFileURL(path.join(repositoryRoot, "packages/engine-core/dist/turn/flow.js")).href}");
instrument(TurnFlow.prototype, "checkpoint", "turnflow.checkpoint");
instrument(TurnFlow.prototype, "restore", "turnflow.restore");
const { EngineRuntimeHost } = await import("${pathToFileURL(path.join(packageRoot, "dist/engine-runtime/host.js")).href}");
instrument(EngineRuntimeHost.prototype, "objects", "runtimeHost.objects");
instrument(EngineRuntimeHost.prototype, "checkpoint", "runtimeHost.checkpoint");
instrument(EngineRuntimeHost.prototype, "restore", "runtimeHost.restore");
const { RuntimeJournalWriter } = await import("${pathToFileURL(path.join(packageRoot, "dist/engine-runtime/journal.js")).href}");
instrument(RuntimeJournalWriter.prototype, "append", "runtimeJournal.append");

process.once("SIGUSR2", () => {
  writeFileSync(options.get("--instrumentation-path"), JSON.stringify({
    pid: process.pid, capturedAt: new Date().toISOString(),
    counters: Object.fromEntries([...counters].map(([name, value]) => [name, {
      calls: value.calls, totalMs: Math.round(value.totalMs * 100) / 100,
      maxMs: Math.round(value.maxMs * 100) / 100, units: 0
    }])), ...(failures.length ? { patchFailures: failures } : {})
  }, null, 2));
});

const { createGameServer } = await import("${pathToFileURL(path.join(packageRoot, "dist/server.js")).href}");
const configuredRoomId = options.get("--room-id") || undefined;
const server = createGameServer({ host: "127.0.0.1", port: Number(process.env.PORT),
  storageDirectory: process.env.RIFTBOUND_STORAGE_DIRECTORY,
  ...(configuredRoomId === undefined ? {} : { roomIdFactory: () => configuredRoomId }) });
await server.start();
writeFileSync(options.get("--server-ready-path"), JSON.stringify({
  pid: process.pid, preparedAt: new Date().toISOString()
}));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal,
  () => void server.stop().finally(() => process.exit(0)));
`;
}

async function storageSummary(root: string): Promise<GameSummary["storage"]> {
  const files: { path: string; bytes: number }[] = [];
  const visit = async (directory: string): Promise<number> => {
    let total = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) total += await visit(full);
      else if (entry.isFile()) {
        const bytes = (await stat(full)).size;
        total += bytes;
        files.push({ path: full, bytes });
      }
    }
    return total;
  };
  const finalBytes = await visit(root);
  const archive = files.find(file => file.path.endsWith("archive.log"));
  const recordBytes = archive === undefined ? [] : (await readFile(archive.path, "utf8"))
    .split("\n").filter(line => line.length > 0).map(line => Buffer.byteLength(line) + 1);
  const sortedRecordBytes = [...recordBytes].sort((left, right) => left - right);
  return { root, initialBytes: 0, finalBytes, growthBytes: finalBytes,
    archiveLogGrowthBytes: archive?.bytes ?? 0,
    archiveRecordBytes: {
      records: recordBytes.length,
      average: round(average(recordBytes)),
      median: sortedRecordBytes.length === 0 ? 0 :
        sortedRecordBytes[Math.floor((sortedRecordBytes.length - 1) / 2)]!,
      max: sortedRecordBytes.at(-1) ?? 0,
    },
    runFiles: files.sort((left, right) => right.bytes - left.bytes) };
}

async function storageBytes(root: string): Promise<number> {
  let total = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) total += (await stat(full).catch(() => ({ size: 0 }))).size;
    }
  };
  await visit(root);
  return total;
}

async function processIo(pid: number): Promise<{ writeBytes: number; writeCalls: number }> {
  const text = await readFile(`/proc/${pid}/io`, "utf8").catch(() => "");
  const value = (name: string): number => Number(new RegExp(`^${name}:\\s*(\\d+)`, "mu").exec(text)?.[1] ?? 0);
  return { writeBytes: value("write_bytes"), writeCalls: value("syscw") };
}

function wireProjectionBytes(projection: V2Projection): number {
  return Buffer.byteLength(JSON.stringify({ type: "projection", protocolVersion: "2.0.0", projection }));
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>(resolve => child.once("exit", () => resolve())),
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Server stop timeout")), timeoutMs))
  ]);
}

async function waitForFile(file: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await access(file).then(() => true, () => false)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function gitState(): Promise<ProfileRunSummary["git"]> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const [commit, branch, status] = await Promise.all([
    run("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
    run("git", ["branch", "--show-current"], { cwd: repositoryRoot }),
    run("git", ["status", "--porcelain=v1"], { cwd: repositoryRoot })
  ]);
  return { commit: commit.stdout.trim(), branch: branch.stdout.trim(), dirty: status.stdout.trim().length > 0 };
}

async function warmUpCatalog(port: number): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/cards`);
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch { /* catalog preload is still running */ }
    await sleep(100);
  }
  throw new Error("Card catalog warm-up did not complete");
}

async function waitForHttp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch { /* HTTP listener may lag the start marker. */ }
    await sleep(100);
  }
  throw new Error(`HTTP listener unavailable on ${port}`);
}

async function waitForHttpForServer(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch { /* listener can bind asynchronously */ }
    await sleep(10);
  }
  throw new Error(`Profiled server HTTP listener unavailable on ${port}`);
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

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]!;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(durationMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, durationMs));
}
