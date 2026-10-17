import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateCardProgram } from "../../dist/index.js";

const program = (expression, extra = {}) => ({
  canonicalCardId: "test.player-state", rulesetVersion: "core-1.5", status: "executable", sourceText: "synthetic",
  abilities: [{ kind: "play", body: [{ id: "read", op: "condition.value", args: { value: expression }, ...extra }] }]
});
const check = (expression, extra) => validateCardProgram(program(expression, extra));
const property = (property, player) => ({ kind: "player-property", property, ...(player === undefined ? {} : { player }) });
const selections = {
  targets: [{ id: "unit", filter: { type: "unit" }, min: 1, max: 1 }],
  picks: [{ id: "player", options: ["A", "B"], min: 1, max: 1 }]
};

for (const name of ["points", "score", "energy", "xp", "handSize", "handCount", "deckSize", "deckCount", "runeDeckSize", "runeDeckCount", "trashSize", "trashCount"]) {
  test(`validates numeric player property ${name}`, () => {
    assert.equal(check(property(name)).ok, true);
  });
}

for (const player of ["controller", { id: "A" }, { controllerOf: "self" }, { ownerOf: "source" }, { controllerOf: { target: "unit" } }, { pick: "player" }]) {
  test(`validates player selector ${JSON.stringify(player)}`, () => {
    const result = check(property("points", player), selections);
    assert.equal(result.ok, true, JSON.stringify(result));
  });
}

for (const expression of [
  { kind: "turn-number" }, { kind: "player-turn-count" }, { kind: "player-turn-count", player: { id: "B" } },
  { kind: "object-designation", object: "self" }, { kind: "object-designation", object: { target: "unit" } },
  { kind: "arithmetic", operator: "add", operands: [property("points"), { kind: "player-turn-count" }] }
]) {
  test(`validates ${JSON.stringify(expression)}`, () => {
    const result = check(expression, selections);
    assert.equal(result.ok, true, JSON.stringify(result));
  });
}

for (const [expression, path] of [
  [property("constructor"), ".property"], [property("hand"), ".property"], [property(null), ".property"],
  [property("points", "opponent"), ".player"], [property("points", null), ".player"],
  [property("points", { id: "" }), ".player.id"], [property("points", { id: "A", pick: "player" }), ".player"],
  [property("points", { ownerOf: { id: "runtime", zoneEntryId: 1 } }), ".player.ownerOf"],
  [property("points", { pick: "missing" }), ".player.pick"],
  [property("points", { controllerOf: { target: "missing" } }), ".player.controllerOf.target"],
  [{ kind: "turn-number", player: "controller" }, ".player"],
  [{ kind: "player-turn-count", player: { ownerOf: { linked: "later" } } }, ".player.ownerOf.linked"],
  [{ kind: "object-designation", object: { id: "runtime", zoneEntryId: 1 } }, ".object"],
  [{ kind: "object-designation", object: { target: "missing" } }, ".object.target"]
]) {
  test(`rejects malformed state expression ${JSON.stringify(expression)}`, () => {
    const result = check(expression, selections);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.path.endsWith(path)), JSON.stringify(result));
  });
}

test("player selectors preserve preceding-link validation", () => {
  const data = program(property("points", { controllerOf: { linked: "before" } }));
  data.abilities[0].body.unshift({ id: "before", op: "effect.draw", args: {} });
  assert.equal(validateCardProgram(data).ok, true);
});

test("new expressions stay literal when stored inside a constant", () => {
  assert.equal(check({ kind: "constant", value: property("unsupported", "opponent") }).ok, true);
});

test("new state expressions also validate in static conditions and value slots", () => {
  const data = program(property("points"));
  data.abilities = [{
    kind: "static", effect: { kind: "continuous.might", value: property("points", { controllerOf: "self" }) },
    condition: { kind: "compare", left: { kind: "player-turn-count" }, operator: "gte", right: { kind: "constant", value: 3 } }
  }];
  const result = validateCardProgram(data);
  assert.equal(result.ok, true, JSON.stringify(result));
});

test("new expressions in open continuous effect slots are validated rather than treated as metadata", () => {
  for (const [slot, expr, suffix] of [
    ["amount", property("hand"), ".property"],
    ["delta", { kind: "player-turn-count", player: { pick: "missing" } }, ".player.pick"],
    ["keywordValue", { kind: "object-designation", object: { id: "runtime", zoneEntryId: 1 } }, ".object"],
    ["amount", { kind: "turn-number", player: "controller" }, ".player"]
  ]) {
    const data = program(property("points"));
    data.abilities = [{ kind: "static", effect: { kind: "continuous.might", [slot]: expr } }];
    const result = validateCardProgram(data);
    assert.equal(result.ok, false, JSON.stringify(data));
    assert.ok(result.issues.some(issue => issue.path.endsWith(`${slot}${suffix}`)), JSON.stringify(result));
  }
});

test("exported player-state types compose without changing existing Expr variants", async () => {
  const { default: ts } = await import("typescript");
  const compiled = ts.createProgram([fileURLToPath(new URL("./player-state.types.ts", import.meta.url))], {
    noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext
  });
  assert.deepEqual(ts.getPreEmitDiagnostics(compiled).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
});
