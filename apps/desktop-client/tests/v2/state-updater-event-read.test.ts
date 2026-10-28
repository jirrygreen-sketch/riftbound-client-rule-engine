import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.node";
import ts from "typescript";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  V2MatchBoard,
  type V2MatchBoardProps
} from "../../src/full-product/v2/V2MatchBoard";
import {
  createV2ChoiceUiState,
  createV2ClientState,
  type V2ClientState
} from "../../src/state/v2";
import type { V2Projection } from "../../../../../packages/protocol/src/v2/index.js";

// RIFT-1062: found in a real two-browser M1 run on macOS. The combat damage
// input read event.currentTarget inside a state updater; React runs updaters
// after the event has finished dispatching, when currentTarget is null, so the
// first keystroke threw and blanked the board in the middle of combat. The
// component test invokes the real captured onChange handler after clearing the
// event, and the source scanner checks equivalent update patterns.

interface SourceText {
  readonly fileName: string;
  readonly text: string;
}

interface EventRead {
  readonly fileName: string;
  readonly line: number;
  readonly position: number;
}

const interaction = vi.hoisted(() => ({
  handlers: [] as Array<{ readonly props: Record<string, unknown> }>,
  pendingUpdate: null as null | ((current: Readonly<Record<string, string>>) => Readonly<Record<string, string>>),
  includeDrafts: false
}));

vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  const capture = (type: unknown, props: unknown, ...rest: unknown[]) => {
    if (props && typeof props === "object") {
      const record = props as Record<string, unknown>;
      if (typeof record.onChange === "function") interaction.handlers.push({ props: record });
    }
    return (actual.jsxDEV as (...args: unknown[]) => unknown)(type, props, ...rest);
  };
  return { ...actual, jsxDEV: capture };
});

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: ((initial: unknown) => {
      const [value, update] = actual.useState(initial);
      const draftsInitial = interaction.includeDrafts && value !== null && typeof value === "object" &&
        Object.hasOwn(value, "enemy-1");
      if (!draftsInitial) return [value, update] as const;
      return [value, (next: unknown) => {
        if (typeof next !== "function") throw new Error("combat damage draft update must be functional");
        interaction.pendingUpdate = next as typeof interaction.pendingUpdate;
      }] as const;
    }) as typeof actual.useState
  };
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/u.test(name) ? [path] : [];
  });
}

const clientRoot = fileURLToPath(new URL("../..", import.meta.url));
const sourceRoot = join(clientRoot, "src");
const syntheticFileName = fileURLToPath(new URL("./__state-updater-sample.tsx", import.meta.url));
const sourceUpdaterSample = [
  "interface SyntheticEventLike {",
  "  readonly currentTarget: { readonly value: string };",
  "  readonly target: { readonly value: string };",
  "}",
  "declare function setDrafts(update: (current: Record<string, string>) => Record<string, string>): void;",
  "declare function setEvents(update: (current: SyntheticEventLike[]) => SyntheticEventLike[]): void;",
  "declare function setOpen(update: (current: boolean) => boolean): void;",
  "const row = { target: \"ok\" };",
  "const bracket = (event: SyntheticEventLike) => setDrafts(current => ({",
  "  ...current,",
  "  first: event[\"currentTarget\"].value,",
  "  second: event[\"target\"].value",
  "}));",
  "const shadowed = (event: SyntheticEventLike) => setEvents(current => {",
  "  current.map(event => event.target);",
  "  return [...current, event.currentTarget];",
  "});",
  "const plainObject = () => setDrafts(current => ({",
  "  ...current,",
  "  target: row.target",
  "}));",
  "const nested = (event: SyntheticEventLike) => setEvents(current => {",
  "  setDrafts(inner => ({ ...inner, x: event.target.value }));",
  "  return current;",
  "});",
  "// setDrafts(current => ({ ...current, x: event.currentTarget.value })),",
  "const direct = (event: SyntheticEventLike) => setDrafts(current => ({",
  "  ...current,",
  "  x: event.currentTarget.value",
  "}));",
  "const before = (event: SyntheticEventLike) => { const value = event.currentTarget.value; setDrafts(current => ({ ...current, x: value })); };",
  "const functionUpdater = (event: SyntheticEventLike) => setOpen(function (open) { return event.target.value ? !open : open; });",
  "export {};"
].join("\n");

function isWithin(node: ts.Node, container: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current !== undefined) {
    if (current === container) return true;
    current = current.parent;
  }
  return false;
}

function eventPropertyName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const property = node.argumentExpression;
  return ts.isStringLiteralLike(property) ? property.text : null;
}

function hasEventShape(type: ts.Type, checker: ts.TypeChecker): boolean {
  if ((type.flags & (ts.TypeFlags.Union | ts.TypeFlags.Intersection)) !== 0) {
    return type.types.some(member => hasEventShape(member, checker));
  }
  return checker.getPropertyOfType(type, "currentTarget") !== undefined &&
    checker.getPropertyOfType(type, "target") !== undefined;
}

function isCapturedEvent(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  updater: ts.ArrowFunction | ts.FunctionExpression,
  checker: ts.TypeChecker
): boolean {
  if (!ts.isIdentifier(node.expression)) return false;
  const symbol = checker.getSymbolAtLocation(node.expression);
  const declarations = symbol?.declarations ?? [];
  if (declarations.length === 0 || declarations.every(declaration => isWithin(declaration, updater))) return false;
  return hasEventShape(checker.getTypeAtLocation(node.expression), checker);
}

interface ParsedSource {
  readonly input: SourceText;
  readonly file: ts.SourceFile;
}

function parseSource(input: SourceText): ParsedSource {
  return {
    input,
    file: ts.createSourceFile(input.fileName, input.text, ts.ScriptTarget.Latest, true,
      /\.[cm]?tsx$/u.test(input.fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  };
}

function hasUpdaterEventCandidate(parsed: ParsedSource): boolean {
  let candidate = false;
  const visit = (node: ts.Node): void => {
    if (candidate) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^set[A-Z]/u.test(node.expression.text)) {
      const updater = node.arguments[0];
      if (updater !== undefined && (ts.isArrowFunction(updater) || ts.isFunctionExpression(updater))) {
        const scan = (child: ts.Node): void => {
          if (ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) {
            const property = eventPropertyName(child);
            if (property === "currentTarget" || property === "target") candidate = true;
          }
          if (!candidate) ts.forEachChild(child, scan);
        };
        scan(updater);
      }
    }
    if (!candidate) ts.forEachChild(node, visit);
  };
  visit(parsed.file);
  return candidate;
}

function scannerProgram(inputs: readonly ParsedSource[]): { readonly checker: ts.TypeChecker;
  readonly virtual: ReadonlyMap<string, ts.SourceFile> } {
  const configPath = join(clientRoot, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, clientRoot, undefined, configPath);
  const sourceByPath = new Map(inputs.map(({ input, file }) => [input.fileName, file] as const));
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = fileName => sourceByPath.has(fileName) || fileExists(fileName);
  host.readFile = fileName => sourceByPath.get(fileName) ?? readFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = sourceByPath.get(fileName);
    if (source !== undefined) return source;
    return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const program = ts.createProgram({ rootNames: inputs.map(parsedSource => parsedSource.input.fileName),
    options: parsed.options, host });
  const virtual = new Map(inputs.flatMap(parsedSource => {
    const source = program.getSourceFile(parsedSource.input.fileName);
    return source === undefined ? [] : [[parsedSource.input.fileName, source] as const];
  }));
  return { checker: program.getTypeChecker(), virtual };
}

/** Source positions where a functional state update reads a captured event value. */
export function eventReadsInUpdaters(inputs: readonly SourceText[]): EventRead[] {
  const parsed = inputs.map(parseSource);
  const candidates = parsed.filter(hasUpdaterEventCandidate);
  if (candidates.length === 0) return [];
  const { checker, virtual } = scannerProgram(candidates);
  const positions = new Map<string, EventRead>();
  for (const { input } of candidates) {
    const file = virtual.get(input.fileName);
    if (file === undefined) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^set[A-Z]/u.test(node.expression.text)) {
        const updater = node.arguments[0];
        if (updater !== undefined && (ts.isArrowFunction(updater) || ts.isFunctionExpression(updater))) {
          const scan = (child: ts.Node): void => {
            if (ts.isPropertyAccessExpression(child) || ts.isElementAccessExpression(child)) {
              const property = eventPropertyName(child);
              if ((property === "currentTarget" || property === "target") && isCapturedEvent(child, updater, checker)) {
                const position = child.getStart(file);
                const fileName = file.fileName;
                positions.set(`${fileName}:${position}`, {
                  fileName,
                  line: file.getLineAndCharacterOfPosition(position).line + 1,
                  position
                });
              }
            }
            ts.forEachChild(child, scan);
          };
          scan(updater);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return [...positions.values()].sort((left, right) =>
    left.fileName.localeCompare(right.fileName) || left.position - right.position);
}

function projection(): V2Projection {
  return {
    projectionContract: "riftbound.protocol.v2.projection",
    protocolVersion: "2.0.0",
    rulesetVersion: "core-1.5",
    matchId: "match-v2",
    viewerPlayerId: "player-1",
    stateVersion: 9,
    eventSeq: 4,
    phase: "main",
    turnNumber: 2,
    activePlayerId: "player-1",
    players: [
      { playerId: "player-1", name: "Alice", score: 0, energy: 3, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 10, zoneCounts: {} },
      { playerId: "player-2", name: "Bob", score: 0, energy: 1, power: {}, xp: 0, handCount: 0, deckCount: 20, runeDeckCount: 10, zoneCounts: {} }
    ],
    zones: [],
    objects: [
      { objectId: "enemy-1", zoneEntryId: 11, zone: "board", ownerPlayerId: "player-2", cardId: "enemy-1", name: "Enemy One", faceDown: false, visibility: "public", might: 3, location: { kind: "battlefield", battlefieldId: "field-1" } }
    ],
    chain: { status: "closed", phase: "open", priorityPlayerId: "player-1", focusPlayerId: null, items: [] },
    priority: { playerId: "player-1", focusPlayerId: null, window: "open" },
    scoring: { victoryScore: 8, battlefieldLocationIds: ["field-1"], players: [
      { playerId: "player-1", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
      { playerId: "player-2", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
    ] },
    battlefields: [{ battlefieldId: "field-1", controllerPlayerId: "player-2", contestedByPlayerId: "player-1", staged: "combat", occupantObjectIds: ["enemy-1"] }],
    combat: { status: "active", battlefieldId: "field-1", step: "damage", combatId: "combat-1",
      attackerPlayerId: "player-1", defenderPlayerId: "player-2",
      damage: { attackerMight: 5, defenderMight: 4, attackerSubmitted: false, expectedPlayerId: "player-1" } },
    actionOptions: { canEndTurn: true, canAdvance: true, moves: [], plays: [] },
    pendingChoice: { status: "none" },
    winnerPlayerId: null,
    events: []
  };
}

function state(value: V2Projection): V2ClientState {
  return {
    ...createV2ClientState({ viewerPlayerId: "player-1", now: 0, choiceTimeoutMs: 10_000 }),
    projection: value,
    stateVersion: value.stateVersion,
    eventSeq: value.eventSeq,
    connectionStatus: "connected",
    choice: createV2ChoiceUiState(value.pendingChoice, { viewerPlayerId: "player-1", now: 0, timeoutMs: 10_000 })
  };
}

function renderBoard(props: Omit<V2MatchBoardProps, "state" | "onCommand"> = {}) {
  interaction.handlers.length = 0;
  interaction.includeDrafts = true;
  interaction.pendingUpdate = null;
  return renderToStaticMarkup(createElement(V2MatchBoard, {
    ...props,
    state: state(projection()),
    onCommand: async () => ({
      type: "command-receipt" as const, protocolVersion: "2.0.0" as const, commandId: "x", stateVersion: 9,
      eventSeq: 4, accepted: true, duplicate: false, rejection: null
    })
  }));
}

beforeEach(() => {
  interaction.handlers.length = 0;
  interaction.pendingUpdate = null;
  interaction.includeDrafts = false;
});

let staticScan: {
  readonly syntheticLines: readonly number[];
  readonly productionReads: readonly string[];
};

beforeAll(() => {
  // Share one file walk and AST pre-screen between both assertions. Only files
  // containing a possible event read enter the TypeScript semantic Program.
  const inputs = [
    ...sources(sourceRoot).map(fileName => ({ fileName, text: readFileSync(fileName, "utf8") })),
    { fileName: syntheticFileName, text: sourceUpdaterSample }
  ];
  const reads = eventReadsInUpdaters(inputs);
  staticScan = {
    syntheticLines: reads.filter(read => read.fileName === syntheticFileName).map(read => read.line),
    productionReads: reads
      .filter(read => read.fileName !== syntheticFileName)
      .map(read => `${read.fileName.slice(sourceRoot.length)}:${read.line}`)
  };
}, 30_000);

describe("RIFT-1062 state updaters never read the event", () => {
  it("uses lexical bindings and event types across supported update syntaxes", () => {
    expect(staticScan.syntheticLines).toEqual([11, 12, 16, 23, 29, 32]);
  });

  it("finds no functional state update in desktop-client src that reads a captured event", () => {
    expect(staticScan.productionReads).toEqual([]);
  });

  it("updates only the changed target's draft after React has cleared currentTarget", () => {
    const markup = renderBoard({ initialCombatDamageDrafts: { "enemy-1": "initial" } });
    expect(markup).toContain("aria-label=\"Enemy One 伤害\"");
    const input = interaction.handlers.find(entry =>
      entry.props.type === "number" && entry.props["aria-label"] === "Enemy One 伤害");
    if (input === undefined || typeof input.props.onChange !== "function") throw new Error("combat damage input not captured");
    const event = { currentTarget: { value: "4" } as { value: string } | null, target: {} };
    (input.props.onChange as (value: typeof event) => void)(event);
    event.currentTarget = null;
    const update = interaction.pendingUpdate;
    if (update === null) throw new Error("combat damage draft updater not captured");
    expect(update({ "enemy-1": "1", untouched: "7" })).toEqual({ "enemy-1": "4", untouched: "7" });
  });
});
