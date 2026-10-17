import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/stalwart-goatherd.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

const CARD_ID = "card.hash-7f7a5adb7ade7c414e4fe27dffeabdf651e620759800bc7ab9794451ca9952a9";
const SOURCE_TEXT =
  "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
  "When you play me, you may kill a gear with Energy cost :rb_energy_4: or less.";

const gearKernel = () =>
  world()
    .unit("stalwart-goatherd", { might: 2, zone: "board", location: { type: "base", player: "A" } })
    .unit("friendly-gear", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();

test("rad-083-167 Stalwart Goatherd: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Energy cost/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-083-167 Stalwart Goatherd: [Shield 2] keyword and the may-kill trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "shield", value: 2 });

  const triggered = program.abilities[1];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["stalwart-goatherd.may"]);
});

test("rad-083-167 Stalwart Goatherd: 'you may kill a gear' is a choice.optional body (contract 3.9)", () => {
  const [may] = program.abilities[1].body;
  assert.equal(may.op, "choice.optional");
  assert.equal(may.linkedTo, undefined);
  assert.equal(may.args.body.kind, "constant");

  const [killInstruction] = may.args.body.value;
  assert.equal(killInstruction.id, "stalwart-goatherd.kill");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, { kind: "constant", value: "stalwart-goatherd.gear" });
  assert.equal(killInstruction.linkedTo, undefined);
  assert.deepEqual(killInstruction.targets, [
    {
      id: "stalwart-goatherd.gear",
      filter: { type: "gear", zone: "board", energyLte: 4 },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("rad-083-167 Stalwart Goatherd: [Shield 2] resolves to the merged Shield definition", () => {
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "shield", value: 2 });
  const definition = keywordDefinitionsById.get("Shield");
  assert.equal(definition, shield);
  assert.equal(definition.valued, true);
  assert.equal(definition.stacking, "sum");
  const expansion = definition.expand({ value: 2, host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].kind, "static");
  assert.equal(expansion[0].effect.kind, "continuous.might");
  assert.equal(expansion[0].effect.amount.value, 2);
  // 814.1.c: the +X is gated on the Defender designation.
  assert.deepEqual(expansion[0].condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "defender" }
  });
});

test("rad-083-167 Stalwart Goatherd: the Shield expansion registers +2 Might in the arithmetic layer", () => {
  // 814.1.c / 814.2: the expansion is a single arithmetic-layer Might
  // modification carrying the summed Shield Value. This test covers the merged
  // arithmetic registration; the declaration's defender gate is the part named
  // in judgeReason (see the TODO below).
  const definition = keywordDefinitionsById.get("Shield");
  const expansion = definition.expand({ value: 2, host: { canonicalCardId: CARD_ID } });
  const host = {
    ref: { id: "goatherd", zoneEntryId: 1 },
    cardId: CARD_ID,
    name: "stalwart-goatherd",
    types: ["unit"],
    tags: [],
    keywords: [{ id: "Shield", value: 2 }],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    combatRole: "defender",
    might: 2,
    energy: 4,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const engine = createLayerEngine(new Map([[host.ref.id + ":" + host.ref.zoneEntryId, host]]));
  engine.register(
    {
      id: "goatherd:shield",
      layer: "arithmetic",
      source: host.ref,
      filter: { objectId: "goatherd" },
      effect: expansion[0].effect
    },
    { type: "permanent" }
  );
  // The arithmetic registration is the merged half: the host's 2 Might is
  // increased by the declared Shield Value 2.
  assert.equal(engine.evaluate(host.ref).might, 4);
});

test("rad-083-167 Stalwart Goatherd: accepting the optional kills the locked gear through effect.kill", () => {
  const [may] = program.abilities[1].body;
  const kernel = gearKernel();
  // Finalize already resolved the gear choice; the kernel receives it as the
  // locked target set for the declared TargetSpec id.
  kernel.setTargets("stalwart-goatherd.gear", [kernel.ref("friendly-gear")]);
  kernel.setAnswers({ "stalwart-goatherd.may/optional": true });
  const outcome = runAbilityBody([may], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => `${result.id}:${result.result.status}`), [
    "stalwart-goatherd.kill:executed",
    "stalwart-goatherd.may:executed"
  ]);
  // 429.1: a killed permanent goes to the trash from the board.
  assert.equal(kernel.getObject("friendly-gear").zone, "trash");
  assert.equal(outcome.events.filter(event => event.action === "kill").length, 1);
});

test("rad-083-167 Stalwart Goatherd: declining the optional leaves the gear alone", () => {
  const [may] = program.abilities[1].body;
  const kernel = gearKernel();
  kernel.setTargets("stalwart-goatherd.gear", [kernel.ref("friendly-gear")]);
  kernel.setAnswers({ "stalwart-goatherd.may/optional": false });
  const outcome = runAbilityBody([may], kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["stalwart-goatherd.may"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("friendly-gear").zone, "board");
  assert.deepEqual(kernel.events, []);
});

test("rad-083-167 Stalwart Goatherd: effect.kill ignores a gear that left its zone (CR 359.3.e.7)", () => {
  const kernel = gearKernel();
  const stale = kernel.ref("friendly-gear");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    kill,
    { target: "stalwart-goatherd.gear" },
    { world: kernel, targets: { "stalwart-goatherd.gear": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test.todo(
  "stalwart-goatherd: 'gear with Energy cost 4 or less' target restriction (CR 163.1 / 356.x printed Energy)" +
    " needs a target-pipeline evaluator for the printed Energy cost; energy:null means no printed value" +
    " and must never be treated as 0"
);
test.todo(
  "stalwart-goatherd: [Shield 2] expansion (+2 Might while defending, stacking sum) through the Shield" +
    " KeywordDef and the layers consumer — the merged conditionMatches does not evaluate the" +
    " declaration's 'designation' predicate and ObjectSnapshot exposes combatRole instead"
);
