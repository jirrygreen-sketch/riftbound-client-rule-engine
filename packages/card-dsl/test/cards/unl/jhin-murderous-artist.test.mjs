import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/jhin-murderous-artist.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import resolveResources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-3539a53a7ed8decc559cac147b6167db91015277a9e34f52eed7548acab3e468";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "[Ganking] (I can move from battlefield to battlefield.)\n" +
  "When I move, [Add] :rb_energy_1::rb_rune_rainbow:. (Abilities that add resources can't be reacted to.)";

const [deflect, ganking, movedTrigger] = program.abilities;
const [addResources] = movedTrigger.body;

test("unl-022-219 Jhin, Murderous Artist: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-022-219 Jhin, Murderous Artist: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // 135.2.e.5 / 163.2.b: [A] is Universal Power; the judgeReason must name it.
  assert.match(program.judgeReason, /Universal/);
  assert.match(program.judgeReason, /rainbow/);
  assert.match(program.judgeReason, /163\.2\.b/);
  // Both keyword definitions and their static shapes are present; the remaining
  // gaps are the target-tax / movement consumers and object-moved event wiring.
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /movement/);
  assert.match(program.judgeReason, /object-moved/);
});

test("unl-022-219 Jhin, Murderous Artist: [Deflect] and [Ganking] keyword declarations", () => {
  assert.equal(program.abilities.length, 3);
  // 809.1.b.3: the printed [Deflect] carries no number, so the declaration
  // omits the value; the Deflect Value is presumed to be 1 by that rule.
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect" });
  assert.equal(deflect.value, undefined);
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
  assert.equal(ganking.value, undefined);
});

test("unl-022-219 Jhin, Murderous Artist: 'When I move' is the object-moved trigger on self", () => {
  // 421.1 / 449.1: only a completed Move emits the closed object-moved timing
  // point; the filter anchors the event source to this card.
  assert.equal(movedTrigger.kind, "triggered");
  assert.equal(movedTrigger.trigger.at, "object-moved");
  assert.deepEqual(movedTrigger.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(movedTrigger.optional, false);
  assert.equal(movedTrigger.body.length, 1);
});

test("unl-022-219 Jhin, Murderous Artist: the body adds 1 Energy and keeps [A] descriptive", () => {
  assert.equal(addResources.id, "jhin.add-energy-and-universal-power");
  assert.equal(addResources.op, "effect.resources");
  assert.deepEqual(addResources.args.energy, { kind: "constant", value: 1 });
  // [A] has no representable Domain; the descriptive "rainbow" spelling is kept
  // instead of silently choosing one of the six domains (see judgeReason).
  assert.deepEqual(addResources.args.power, { kind: "constant", value: ["rainbow"] });
  assert.equal(addResources.targets, undefined);
  assert.equal(addResources.picks, undefined);
  assert.equal(addResources.linkedTo, undefined);
});

test("unl-022-219 Jhin, Murderous Artist: [Deflect] and [Ganking] expand to merged static shapes", async () => {
  const { default: deflect } = await import("../../../../engine-core/dist/effects/keywords/Deflect.js");
  const { default: ganking } = await import("../../../../engine-core/dist/effects/keywords/Ganking.js");
  const [deflectExpansion] = deflect.expand({ host: { canonicalCardId: CANONICAL_ID } });
  // 809.1.b.3: the printed [Deflect] omits its value, so X is presumed 1.
  assert.equal(deflectExpansion.effect.kind, "target.tax");
  assert.deepEqual(deflectExpansion.effect.value, { kind: "constant", value: 1 });
  const [gankingExpansion] = ganking.expand({ host: { canonicalCardId: CANONICAL_ID } });
  // 810.1.b: Ganking adds the Battlefield -> Battlefield Standard Move permission.
  assert.equal(gankingExpansion.effect.kind, "continuous.movement");
  assert.equal(gankingExpansion.effect.permission, "battlefield-to-battlefield");
});

test("unl-022-219 Jhin, Murderous Artist: the program binding resolves the trigger's self anchor", async () => {
  // programs/filters.ts normalises the {source: "self"} spelling to the host
  // object filter, so the authored anchor has a production translation.
  const { translateTriggerFilter } = await import("../../../../engine-core/dist/programs/filters.js");
  const translated = translateTriggerFilter(movedTrigger.trigger.filter, "jhin");
  assert.deepEqual(translated, { event: "object-moved", object: { objectId: "jhin" } });
});

test("unl-022-219 Jhin, Murderous Artist golden: the Energy half alone is a real merged addition", () => {
  const kernel = world().player("A", { energy: 0 }).build();
  const run = runInstruction(
    resolveResources,
    { energy: { kind: "constant", value: 1 } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.resources, { player: "A", energy: 1, power: [] });
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["gain-energy"]);
});

test.todo(
  "unl-022-219 Jhin, Murderous Artist: [Deflect] target.tax (CR 809.1.c) is applied when an opponent chooses this " +
    "unit — the target-tax permission still needs to enter target locking and the additional cost plan"
);
test.todo(
  "unl-022-219 Jhin, Murderous Artist: [Ganking] continuous.movement permission (CR 810.1.b / 144.4.c.1) is " +
    "read by the movement system and a completed move emits the object-moved trigger for this unit"
);
