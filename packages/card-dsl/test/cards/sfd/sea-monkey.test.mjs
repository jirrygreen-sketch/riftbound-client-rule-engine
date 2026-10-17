import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/sea-monkey.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-8b94882b556c55cce216445bf3c9f8b69b9e4c725571f25e890a951c67bb05c6";
const SOURCE_TEXT =
  "You may pay :rb_energy_1: as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, buff me. (Give me a +1 :rb_might: buff if I don't already have one.)";

const [additionalCost, playTrigger] = program.abilities;
const [buffInstruction] = playTrigger.body;
const [selfSpec] = buffInstruction.targets;

/** The kernel binds "self" to the context source, so Sea Monkey is the source. */
function monkeyWorld({ buffs = 0 } = {}) {
  const kernel = world().unit("sea-monkey", { might: 2, buffs }).build();
  return kernel.clone({ source: kernel.ref("sea-monkey"), sourceSnapshot: kernel.getObject("sea-monkey") });
}

test("sfd-098-221 Sea Monkey: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-098-221 Sea Monkey: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-098-221 Sea Monkey: judgeReason names the additional-cost and paid-receipt gaps", () => {
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /condition\.result/);
  // The cost pipeline (cost.pay / cost.modify, additional-cost binding) and the
  // CardProgram filter adapter are the remaining dependencies; the card data
  // must not silently approximate either half.
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("sfd-098-221 Sea Monkey: the optional additional cost is 1 Energy on a passive ability", () => {
  // 356.2.b / 356.2.b.1: Optional Additional Cost imposed by a Passive Ability
  // of the card being played; the decision is made in step 2 (355.1.a).
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "sea-monkey.additional-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.deepEqual(additionalCost.effect.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } }
  ]);
});

test("sfd-098-221 Sea Monkey: card-played self trigger whose body buffs the host", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  // "if you paid the additional cost" gates this ability; the frozen IR has no
  // condition source that reads the cost plan result (see judgeReason), so no
  // always-true condition is fabricated here.
  assert.equal(playTrigger.trigger.condition, undefined);
  assert.equal(playTrigger.optional, false);

  assert.equal(playTrigger.body.length, 1);
  assert.equal(buffInstruction.id, "sea-monkey.buff-me");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "sea-monkey.self" }
  });
  // 355.10.d.1: "me" is programmatically selected and is never a choice; the
  // contract 3.6 "self" selector binds the host at runtime.
  assert.deepEqual(selfSpec, {
    id: "sea-monkey.self",
    filter: { object: "self", type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(buffInstruction.linkedTo, undefined);
});

test("sfd-098-221 Sea Monkey golden: the buff body places one Buff on the host (702.2.a)", () => {
  const kernel = monkeyWorld();
  // The reference kernel compares the filter's raw values and ignores the
  // contract 3.6 "object" anchor (RIFT-90 owns that binding), so the golden
  // pins the already-Finalize-locked host reference itself.
  kernel.setTargets("sea-monkey.self", [kernel.ref("sea-monkey")]);
  const outcome = resolveChainBody(playTrigger.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["sea-monkey.buff-me", "executed"]
  ]);
  assert.equal(kernel.getObject("sea-monkey").buffs, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["buff"]);
});

test("sfd-098-221 Sea Monkey golden: a second buff is a no-op (702.3.a, 427.1.c)", () => {
  const kernel = monkeyWorld({ buffs: 1 });
  kernel.setTargets("sea-monkey.self", [kernel.ref("sea-monkey")]);
  const outcome = resolveChainBody(playTrigger.body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.result.status, entry.result.reason]), [
    ["negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("sea-monkey").buffs, 1);
  assert.deepEqual(outcome.events, []);
});

test("sfd-098-221 Sea Monkey: the declared additional cost and self anchor are not approximated", () => {
  // Durable data-level guards for the two remaining dependencies (see
  // judgeReason): the card must keep the printed additional cost on a static
  // cost declaration (never rewritten as a resolution-time effect), and the
  // "me" anchor must stay the contract 3.6 self selector rather than a
  // hard-coded ObjectRef. The merged CardProgram adapter cannot bind the anchor
  // yet, which is why the binding path stops there.
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal("op" in additionalCost.effect, false);
  assert.deepEqual(additionalCost.effect.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } }
  ]);
  assert.deepEqual(selfSpec.filter.object, "self");
  assert.equal(selfSpec.filter.objectId, undefined);

  // The merged programs/filters.ts adapter is the only bridge into the engine
  // query. It must never silently drop the anchor (that would buff a wrong
  // set): it either translates the body preserving the host-bound target, or it
  // fails closed with the judge-required reason. This stays true when the
  // anchor lands (RIFT-257).
  let translated = null;
  try {
    translated = translateInstructionTargets(playTrigger.body);
  } catch (error) {
    assert.equal(error.code, "judge-required");
    assert.match(error.message, /filter field object/);
  }
  if (translated !== null) {
    const [anchor] = translated[0].targets;
    assert.deepEqual(anchor.filter.object, "self");
  }
});

test.todo(
  "sfd-098-221 Sea Monkey: charge the optional additional 1 Energy through the cost plan and expose the " +
    "356.4.f.1 paid decision so the buff is gated on it — the additional-cost/finalized-receipt binding is " +
    "still pending in the in-progress RIFT-261 cost work (cost.pay / cost.modify); the Condition shape has no " +
    "cost-result source (survey: condition.result)"
);

test.todo(
  "sfd-098-221 Sea Monkey: the CardProgram binding must accept the body's `object: \"self\"` target anchor " +
    "(programs/filters.ts translateObjectFilter currently rejects it as an unsupported filter field) — RIFT-257"
);
