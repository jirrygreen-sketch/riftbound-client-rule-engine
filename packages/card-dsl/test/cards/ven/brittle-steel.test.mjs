import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/brittle-steel.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-045b07d4199255ec6dcfd300272520972fba1ee89dc4e3cfe4e63f1f6b6c95e3";
const SOURCE_TEXT =
  "Kill a gear.\n" +
  "[Flow] :rb_energy_4::rb_rune_fury: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [killInstruction] = play.body;
const [gearSpec] = killInstruction.targets;

test("ven-003-166 Brittle Steel: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-003-166 Brittle Steel: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  // README section 2: name the exact missing pieces (the Flow cost channel and
  // the Flow consumers) and the rules they come from.
  assert.match(program.judgeReason, /Flow/);
  assert.match(program.judgeReason, /829\.1\.c/);
  assert.match(program.judgeReason, /params\.cost|3\.8\.3/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-260/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-003-166 Brittle Steel: [Flow] is declared, never re-implemented in the card", () => {
  // cards/README.md section 5: only the keyword identity is declared. The printed
  // Flow cost (4 energy + 1 Fury power, 829.1.c.1) has no KeywordAbility field yet
  // (contract 3.8.3), so the card must not invent one, and 4 is not smuggled in as
  // a numeric keyword value.
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.equal(flowKeyword.value, undefined);
});

test("ven-003-166 Brittle Steel: printed base cost and one Kill instruction", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(play.kind, "play");
  // Catalog: energy 2, power 1, domains ["Fury"].
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.equal(play.body.length, 1);
  assert.equal(killInstruction.id, "brittle-steel.kill-gear");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, {
    kind: "constant",
    value: "brittle-steel.gear"
  });
  assert.equal(killInstruction.linkedTo, undefined);
  assert.equal(killInstruction.picks, undefined);
  // 355.9.a.1: "gear" means a Board object, and it is a target (355.7/355.8).
  assert.deepEqual(gearSpec, {
    id: "brittle-steel.gear",
    filter: { type: "gear", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ven-003-166 Brittle Steel golden: effect.kill really sends the gear to its owner's trash", () => {
  const kernel = world()
    .unit("enemy-gear", {
      owner: "B",
      types: ["gear"],
      zone: "board",
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("bystander", { owner: "B" })
    .build();
  const locked = kernel.ref("enemy-gear");

  const run = runInstruction(kill, { target: gearSpec.id }, {
    world: kernel,
    targets: { [gearSpec.id]: [locked] }
  });

  assert.equal(run.result.status, "executed");
  // CR 429: the gear leaves the Board for its owner's trash; nothing else moves.
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.equal(kernel.getObject("bystander").zone, "board");
  assert.deepEqual(run.linked.killed, [locked]);
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
});

test("ven-003-166 Brittle Steel boundary: an already-killed gear ignores the instruction (359.3.e)", () => {
  const kernel = world()
    .unit("enemy-gear", { owner: "B", types: ["gear"], zone: "board" })
    .build();
  const stale = kernel.ref("enemy-gear");
  kernel.perform({ type: "kill", object: stale });

  const run = runInstruction(kill, { target: gearSpec.id }, {
    world: kernel,
    targets: { [gearSpec.id]: [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test.todo(
  "ven-003-166 Brittle Steel: play from trash for the printed Flow cost (4 energy + 1 Fury power, " +
    "829.1.c.1) then banish it (829.1.b.1 delayed replacement) — the printed cost cannot reach " +
    "KeywordDef.expand (contract 3.8.3 params.cost unmerged; RIFT-261 alternate-cost consumer, " +
    "RIFT-260 replacement registration)"
);
