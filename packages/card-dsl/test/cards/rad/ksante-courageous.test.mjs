import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ksante-courageous.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import Shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CARD_ID = "card.hash-5a036961fb00b9d4befa78e1fb2d424a4647453d50975b08ec9edb34881c6035";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
  "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
  "When I hold, channel 1 rune.";

test("rad-086-167 K'Sante, Courageous: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /383\.4\.d/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /814/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /designation|combatRole/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-91|RIFT-120|RIFT-257|RIFT-261/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-086-167 K'Sante, Courageous: Accelerate and Shield 2 keyword declarations", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "accelerate" });
  assert.equal(program.abilities[0].value, undefined);
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "shield", value: 2 });
});

test("rad-086-167 K'Sante, Courageous: hold trigger channels exactly one rune", () => {
  const triggered = program.abilities[2];
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "hold");
  assert.deepEqual(triggered.trigger.filter, { event: "hold", filter: { source: "self" } });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.optional, false);
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["ksante-courageous.channel"]);

  const [instruction] = triggered.body;
  assert.equal(instruction.op, "effect.channel");
  assert.deepEqual(instruction.args, { amount: { kind: "constant", value: 1 } });
  // 431.2: without an "exhausted" stipulation the runes are channelled readied.
  assert.equal(instruction.args.exhausted, undefined);
});

test("rad-086-167 K'Sante, Courageous: channel 1 rune moves the top rune of the Rune Deck (CR 431.1)", () => {
  const [instruction] = program.abilities[2].body;
  const kernel = world().rune(["top-rune", "second-rune"]).build();
  const run = runInstruction(channel, instruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.deepEqual(kernel.zone("A", "rune-zone").map(ref => ref.id), ["top-rune"]);
  assert.equal(kernel.getObject("top-rune").exhausted, false);
  assert.equal(run.events[0].action, "channel-rune");
});

test("rad-086-167 K'Sante, Courageous: the hold trigger body executes through the interpreter", () => {
  const body = program.abilities[2].body;
  const kernel = world().rune(["top-rune", "second-rune"]).build();
  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.linkedValues, { "ksante-courageous.channel.channeled": 1 });
  assert.deepEqual(kernel.zone("A", "rune-zone").map(ref => ref.id), ["top-rune"]);
});

test("rad-086-167 K'Sante, Courageous: an empty Rune Deck channels as many as possible without negating (CR 431.3)", () => {
  const [instruction] = program.abilities[2].body;
  const kernel = world().build();
  const run = runInstruction(channel, instruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 0);
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
});

test.todo(
  "ksante-courageous: [Accelerate] expansion (CR 805 optional additional cost [1] + matching-domain Power and the" +
    " enter-ready replacement) through the Accelerate KeywordDef and the cost pipeline; the accelerate.cost static" +
    " declaration still has no layer mapping and no card-facing adapter into the play Finalize optionalAdditional list"
);
test.todo(
  "ksante-courageous: hold trigger end-to-end (CR v1.5 383.4.d.2/.2.a): the 'hold' timing point emitted by scoring" +
    " must carry the battlefield unit present during the hold so the object-bound source filter can match"
);

/** Build a ChainEngine over the test kernel with the production static binder. */
function engineFor(kernel) {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  return new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
}

test("rad-086-167 K'Sante, Courageous boundary: the Accelerate cost declaration has no layer mapping", () => {
  // 805.1.b: the printed optional additional cost. The KeywordDef is merged and
  // its enter-ready replacement binds, but the accelerate.cost static effect is
  // rejected by the merged layer mapping, so Finalize never sees the option.
  const expansion = accelerate.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion[0].kind, "static");
  assert.equal(expansion[0].effect.kind, "accelerate.cost");
  assert.equal(expansion[1].kind, "replacement");

  const kernel = world().object("ksante", { cardId: CARD_ID, types: ["unit"], might: 4, power: ["Body"] }).build();
  const engine = engineFor(kernel);
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(expansion[0], kernel.getObject("ksante")),
    /accelerate\.cost has no layer mapping/
  );
  assert.doesNotThrow(() => binder.bindReplacement(expansion[1], kernel.getObject("ksante")));
});

test("rad-086-167 K'Sante, Courageous boundary: the [Shield 2] expansion cannot evaluate its designation", () => {
  // 814.1.c: "While I am a defender, I have +2 [M]". The expansion reads the
  // `designation` property, which ObjectSnapshot does not carry (it exposes
  // combatRole), so binding leaves the printed Might untouched.
  const expansion = Shield.expand({ value: 2, host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(expansion[0].condition.left, {
    kind: "object-property", object: "self", property: "designation"
  });
  const kernel = world().object("ksante", { cardId: CARD_ID, types: ["unit"], might: 4, combatRole: "defender" }).build();
  const engine = engineFor(kernel);
  createEngineStaticBinder(engine).bindStatic(expansion[0], kernel.getObject("ksante"));
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ksante")).might, 4);
});

test("rad-086-167 K'Sante, Courageous boundary: the hold trigger can never match a scoring hold event", () => {
  // 383.4.d.2/.2.a: the Hold Effect must bind the unit that was present at the
  // hold. The merged trigger adapter compiles the printed source filter into an
  // object-bound filter, but the scoring hold timing point carries only
  // battlefieldId/playerId, so the registration can never fire for this card.
  const kernel = world().object("ksante", { cardId: CARD_ID, types: ["unit"], might: 4 }).build();
  const registration = triggerRegistrations(
    new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]),
    kernel.getObject("ksante")
  )[0];
  assert.equal(registration.spec.at, "hold");
  assert.deepEqual(registration.spec.filter, { event: "hold", object: { objectId: "ksante" } });
  const scoringHold = { timingPoint: "hold", kind: "hold", player: "A", details: { battlefieldId: "bf-1" } };
  assert.equal(matchesTriggerEvent(registration.spec.filter, scoringHold, "A"), false);
  const unitBoundHold = { ...scoringHold, object: kernel.getObject("ksante") };
  assert.equal(matchesTriggerEvent(registration.spec.filter, unitBoundHold, "A"), true);
});
