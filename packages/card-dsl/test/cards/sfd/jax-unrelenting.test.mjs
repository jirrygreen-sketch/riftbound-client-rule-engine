import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/jax-unrelenting.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import weaponmaster from "../../../../engine-core/dist/effects/keywords/Weaponmaster.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL = "card.hash-e3c3834ab49461988dec4155b965077754fcd478f5efc15474112568b47083ca";
const SOURCE_TEXT =
  "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\n" +
  "When you attach an Equipment to me, you may pay :rb_energy_1: to draw 1.";

const [keyword, attachTrigger] = program.abilities;
const [mayPay] = attachTrigger.body;
const [payInstruction, drawInstruction] = mayPay.args.body.value;

test("sfd-119-221 Jax, Unrelenting: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-119-221 Jax, Unrelenting: judgeReason names the Weaponmaster and attach-trigger gaps", () => {
  assert.match(program.judgeReason, /Weaponmaster/);
  assert.match(program.judgeReason, /821\.1\.b/);
  assert.match(program.judgeReason, /821\.1\.c\.2/);
  assert.match(program.judgeReason, /435\.1/);
  assert.match(program.judgeReason, /435\.4\.a/);
  assert.match(program.judgeReason, /object-attached/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /topMostCardId/);
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /204\.1\.c/);
  assert.match(program.judgeReason, /TriggeredAbility/);
});

test("sfd-119-221 Jax, Unrelenting: [Weaponmaster] is declared, not expanded (821 / contract 3.7)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "weaponmaster" });
  assert.equal(keyword.value, undefined);

  // The merged keyword definition owns the expansion; the card must not write
  // its own copy of the play trigger + Equip cost rewrite + attach chain.
  assert.equal(weaponmaster.keyword, "Weaponmaster");
  assert.equal(weaponmaster.valued, false);
  assert.equal(weaponmaster.stacking, "separate");
  assert.ok(weaponmaster.ruleRefs.includes("821.1.c.2"));
  assert.ok(weaponmaster.ruleRefs.includes("821.1.c.6"));
});

test("sfd-119-221 Jax, Unrelenting: 'when you attach an Equipment to me' subscribes to object-attached", () => {
  assert.equal(attachTrigger.kind, "triggered");
  // 383.1 / 435.1 / 435.3: the closed object-attached timing point fires once
  // an object becomes attached to a new top-most card; re-attaching to the same
  // host does not.
  assert.equal(attachTrigger.trigger.at, "object-attached");
  assert.deepEqual(attachTrigger.trigger.filter, {
    event: "object-attached",
    // 150 / 150.1 / 150.5: Equipment is a Gear tag, readable as a characteristic.
    target: { type: "gear", tags: ["Equipment"] },
    // "to me": the host identity is this card (see the judgeReason gap).
    filter: { source: "self" }
  });
  assert.equal(attachTrigger.trigger.condition, undefined);
  assert.equal(attachTrigger.trigger.once, undefined);
  // 403.1: the printed "you may" is the instruction-level optional wrapper, so
  // the trigger itself is mandatory, the disarming-rake convention.
  assert.equal(attachTrigger.optional, false);
});

test("sfd-119-221 Jax, Unrelenting: the may-shape records the deferred payment and draw (contract 3.9)", () => {
  assert.deepEqual(attachTrigger.body.map((instruction) => instruction.id), ["jax-unrelenting.may-pay"]);
  assert.equal(mayPay.op, "choice.optional");
  assert.deepEqual(mayPay.args.prompt, {
    kind: "constant",
    value: "Pay :rb_energy_1: to draw 1?"
  });
  assert.equal(mayPay.args.body.kind, "constant");
  assert.deepEqual(mayPay.args.body.value.map((instruction) => instruction.id), [
    "jax-unrelenting.pay-1",
    "jax-unrelenting.draw-1"
  ]);

  // Structural placeholder only: the payment is a trigger base cost and is
  // not executable until the Finalize binding described in judgeReason lands.
  assert.equal(payInstruction.op, "cost.pay");
  assert.deepEqual(payInstruction.args, { payments: { kind: "constant", value: { energy: 1 } } });
  assert.equal(payInstruction.linkedTo, undefined);

  // 414.1 / 414.3: the drawer defaults to the ability's controller (190.6.d);
  // the draw is linked to the payment so a failed payment suppresses it.
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, "jax-unrelenting.pay-1");

  // The may-node declares no target of its own, and contract 3.9 forbids
  // choice + linkedTo on the wrapper.
  assert.equal(mayPay.targets, undefined);
  assert.equal(mayPay.picks, undefined);
  assert.equal(mayPay.linkedTo, undefined);
});

test("sfd-119-221 Jax, Unrelenting golden: declining the may leaves the board and hand untouched", () => {
  const kernel = world().deck(["top"]).build();
  kernel.setAnswers({ "jax-unrelenting.may-pay/optional": false });

  // Declining the optional choice does not enter the descriptive cost.pay body.
  // Finalize payment remains a separate contract gap (see the TODO below).
  const outcome = resolveChainBody(attachTrigger.body, kernel);

  assert.deepEqual(outcome.results.map((entry) => entry.id), ["jax-unrelenting.may-pay"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("sfd-119-221 Jax, Unrelenting golden: the supported draw body executes independently", () => {
  // The 1 Energy payment is a trigger base cost and must be offered at
  // Finalize. This test covers only the already-merged effect.draw half; it
  // deliberately does not treat direct Resolve-time cost.pay as card support.
  const kernel = world().deck(["top", "second"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top"]);
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
});

test("sfd-119-221 Jax, Unrelenting: a real attach emission identifies Equipment but does not bind the host", () => {
  const kernel = world().unit("jax").object("blade", { types: ["gear"], tags: ["Equipment"], zone: "board" }).build();
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(),
    restore: state => kernel.restore(state),
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const { outcome, emissions } = host.execute({ type: "attach", object: kernel.ref("blade"), host: kernel.ref("jax") });
  assert.equal(outcome.status, "done");
  assert.deepEqual(kernel.getObject("blade").attachedTo, kernel.ref("jax"));
  const attached = emissions.find(event => event.timingPoint === "object-attached");
  assert.ok(attached);
  assert.deepEqual(attached.object.ref, kernel.ref("blade"));
  assert.equal(attached.target, undefined);
  assert.equal(attached.details?.topMostCardId, undefined);
  const result = validateTriggerSpec(attachTrigger.trigger);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.path.includes("event")));
});

test.todo(
  "sfd-119-221 Jax, Unrelenting: the optional 1 Energy trigger base cost must be selected and paid " +
    "at Finalize (CR 204.1.c / 403.1 / 404.1.b.1), before the body resolves — TriggeredAbility has no " +
    "cost field and programs/triggers.ts does not populate TriggerRegistration.cost/mayAtFinalize; " +
    "the descriptive body cost.pay must not be used as a Resolve-time substitute. Add a real ChainEngine " +
    "Finalize/Resolve test when the contract binding exists."
);

test.todo(
  "sfd-119-221 Jax, Unrelenting: [Weaponmaster] expands through effects/keywords/Weaponmaster.ts — the " +
    "chosen Equipment's authoritative Equip-cost binding and original [A]/[C] symbol provenance " +
    "(821.1.b, 821.1.c.2/.c.2.a, 821.1.c.6 \"the Equip ability is not actually activated\") are not " +
  "executable yet (cost.modify's Equipment source branch fails closed)"
);

test.todo(
  "sfd-119-221 Jax, Unrelenting: the object-attached timing point exposes the top-most card (host) and " +
    "the attached object so the host identity binds Jax and the Equipment tag filters the attached Gear " +
  "(435.1/435.3/435.4.a): EVENT_PATTERN_TYPES needs object-attached and action-adapter.ts must " +
  "produce a host target or topMostCardId details before a host predicate can match"
);
