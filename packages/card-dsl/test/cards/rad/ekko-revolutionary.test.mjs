import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ekko-revolutionary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL =
  "card.hash-8a2cf1027c6f770452bef4d4eacd322301ebafc77620d3a76b855446639089e8";
const SOURCE_TEXT =
  "I enter ready.\n" +
  "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
  "[Action][>] Discard 1, :rb_energy_1::rb_rune_fury:: Banish me, then play me to your base, ignoring my cost.";

const [enterReady, assaultKeyword, activated] = program.abilities;
const [banishInstruction, playInstruction] = activated.body;

test("rad-021-167 Ekko, Revolutionary: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-021-167 Ekko, Revolutionary: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: the reason names the remaining binding gaps.
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /Discard 1/);
  assert.match(program.judgeReason, /choiceObjects/);
  assert.match(program.judgeReason, /condition\.predicate/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  // The Assault condition gap keeps the designation wording (the expansion
  // still reads designation) and records that combatRole exists but lacks the
  // binding; the snapshot-field claim stays historical.
  assert.match(program.judgeReason, /ObjectSnapshot 也不在解释器表达式环境/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-021-167 Ekko, Revolutionary: enter-ready replacement, Assault keyword, action-speed activation", () => {
  assert.equal(program.abilities.length, 3);
  // CR 369.3: "I enter ready" replaces the exhausted entry, it is not an effect.ready.
  assert.equal(enterReady.kind, "replacement");
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.equal(enterReady.with[0].op, "replacement.enter");
  assert.deepEqual(enterReady.with[0].args.state, {
    kind: "constant",
    value: "ready"
  });
  // CR 807.1.b.3: a printed [Assault] with no number is Assault 1.
  assert.deepEqual(assaultKeyword, { kind: "keyword", keyword: "assault" });
  // CR 806.1.a / 813.1.d: the activation is Action speed; no [Reaction] is printed.
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
});

test("rad-021-167 Ekko, Revolutionary: the printed activation cost is Discard 1 + 1 energy + 1 Fury power", () => {
  assert.deepEqual(activated.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(activated.cost.power, { kind: "constant", value: ["Fury"] });
  assert.equal(activated.cost.payments.length, 1);
  const [discard] = activated.cost.payments;
  assert.equal(discard.kind, "discard");
  assert.deepEqual(discard.amount, { kind: "constant", value: 1 });
  assert.equal(discard.choice.id, "ekko.discarded-card");
  assert.equal(discard.choice.selection, "one");
  // 423.3: a Discard cost must be completable, so it is declared as a cost here.
  assert.equal(discard.choice.zone, "hand");
});

test("rad-021-167 Ekko, Revolutionary: the printed activation cost really plans once Finalize locks the discard choice", () => {
  // 423.3 / 415.4: "Discard 1" is a completable activation cost. The merged
  // cost pipeline builds it from the card's own CostSpec as soon as the
  // Finalize step supplies the exact candidate objects (cost/plan-values.ts
  // choiceObjects requires exact ObjectRefs). The card's printed ChoiceSpec is
  // kept as declared; only the runtime candidate list, which static IR cannot
  // know, is bound here the same way the concrete player is bound elsewhere.
  const kernel = world().unit("ekko", { might: 4, energy: 5, power: ["Fury"] }).hand("card-a").build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  context.setAnswers({ "ekko.activate:pick:ekko.discarded-card": [kernel.ref("card-a")] });
  const discardChoice = activated.cost.payments[0].choice;
  const costSpec = {
    ...activated.cost,
    payments: [
      {
        ...activated.cost.payments[0],
        choice: { ...discardChoice, options: [kernel.ref("card-a")] }
      }
    ]
  };

  const plan = buildCostPlan(context, { id: "ekko.activate", cost: costSpec });

  assert.equal(plan.finalized, true);
  // 415.3.a / 163.1: one Energy plus one Power of the printed Fury domain.
  assert.equal(plan.base.energy, 1);
  assert.deepEqual(plan.base.power, [{ amount: 1, allowedDomains: ["Fury"] }]);
  // 423.3: the Discard-1 payment is planned against the chosen hand card.
  assert.deepEqual(plan.base.actions, [
    {
      id: "base:payment:0:0",
      componentId: "base",
      action: { type: "discard", object: kernel.ref("card-a") }
    }
  ]);
  // The card's own ChoiceSpec (min/max/selection/zone) drives the selection;
  // the chosen hand card is what the payment consumes.
  assert.equal(discardChoice.min, 1);
  assert.equal(discardChoice.max, 1);
  assert.equal(discardChoice.zone, "hand");
});

test("rad-021-167 Ekko, Revolutionary: 'Banish me' then 'play me to your base, ignoring my cost'", () => {
  assert.equal(banishInstruction.op, "effect.banish");
  // 053.1: a Unit says "me", so the selector is the ability source.
  assert.deepEqual(banishInstruction.args.objects, { kind: "literal", value: "self" });
  assert.deepEqual(banishInstruction.args.linkKey, {
    kind: "constant",
    value: "ekko.banished"
  });

  assert.equal(playInstruction.op, "effect.play");
  assert.equal(playInstruction.linkedTo, "ekko.banish-self");
  // 124: crossing a zone invalidates the old reference, so the play reads the
  // new Banishment reference produced by the banish step.
  assert.deepEqual(playInstruction.args.object, {
    kind: "linked",
    instructionId: "ekko.banish-self",
    key: "ekko.banishedObject"
  });
  // effect.play defaults to the actual playing controller's base.
  assert.equal(playInstruction.args.location, undefined);
  // 356.1.b.1: "ignoring its cost" sets the base Energy and Power costs to zero.
  assert.deepEqual(playInstruction.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [], xp: 0 }
  });
});

test("rad-021-167 Ekko, Revolutionary: banish → play primitives resolve with the declared cost placeholder", () => {
  const kernel = world().unit("ekko", { might: 4 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  // resolveChainBody is the merged card-program → primitive adapter (it keeps
  // the declared Expr args and lets each primitive evaluate them).
  const outcome = resolveChainBody([banishInstruction, playInstruction], scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["ekko.banish-self", "executed"],
      ["ekko.play-from-banishment", "executed"]
    ]
  );
  // 428.1 + 420.3: the card left for Banishment and was then played out of it.
  const ekko = scoped.getObject("ekko");
  assert.equal(ekko.zone, "board");
  // The banish receipt linked the new (post-zone-change) reference; the play
  // step reported one successful play.
  assert.equal(outcome.linkedValues["ekko.banish-self.ekko.banishedCount"], 1);
  assert.equal(outcome.linkedValues["ekko.play-from-banishment.played"], 1);
  // This checks the declared placeholder, not the missing Finalize adaptation
  // for CR 356.1.b.1 and other cost adjustments.
  assert.deepEqual(playInstruction.args.cost.value, {
    finalized: true,
    energy: 0,
    power: [],
    xp: 0
  });
});

test("rad-021-167 Ekko, Revolutionary: the play step is ignored when the banished reference is stale", () => {
  // 359.3.e.14.a/b + 124: a stale linked reference cannot be revived, so the
  // linked play step ignores instead of playing some other object.
  const kernel = world().unit("ekko", { might: 4 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  scoped.link("stale-step.ekko.banishedObject", { id: "ekko", zoneEntryId: 99 });
  const outcome = resolveChainBody(
    [
      {
        ...playInstruction,
        linkedTo: undefined,
        args: {
          ...playInstruction.args,
          object: {
            kind: "linked",
            instructionId: "stale-step",
            key: "ekko.banishedObject"
          }
        }
      }
    ],
    scoped
  );
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(scoped.getObject("ekko").zone, "board");
});

test("rad-021-167 Ekko, Revolutionary: 'I enter ready' really replaces the exhausted entry through the merged binding", () => {
  // CR 369.3 / 359.2.c: the unit's default exhausted entry is replaced by a
  // ready entry, so no separate "becomes ready" timing is produced. The
  // replacement binding is the merged RIFT-260 path (bindReplacement).
  const { kernel, engine, host } = fixture({
    cards: [{ id: "ekko", cardId: CANONICAL, types: ["unit"], energy: 0, power: null, might: 4 }]
  });
  bindReplacement(enterReady, kernel.ref("ekko"), {
    host: { ...host, object: ref => kernel.object(ref) }, pipeline: engine.pipeline
  });
  engine.execute({
    id: "play-ekko",
    controller: "A",
    source: kernel.getObject("ekko"),
    kind: "unit",
    speed: "normal",
    body: []
  });
  resolveAll(engine);

  const played = kernel.getObject("ekko");
  assert.equal(played.zone, "board");
  assert.equal(played.exhausted, false);
  assert.equal(
    engine.pipeline.events.some(event => event.timingPoint === "object-readied"),
    false
  );
});

test.todo('Ekko, Revolutionary: bind Discard 1 non-target cost candidates and the ignored-base-cost play plan at Finalize (CR 423.3/355.10.c/356.1.b.1)');
test.todo('Ekko, Revolutionary: bind the Assault designation condition to combatRole attacker (CR 807.1.c/807.1.d.1)');
