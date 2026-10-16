// Golden test for Ekko, Revolutionary (rad-021-167).
//
// judge-required (see the program's judgeReason): "I enter ready" needs the
// unmerged entry replacement, the Discard-1 cost needs a filter-based cost
// selection, and the [Assault] expansion has no card→layers producer. The
// runnable evidence is the merged banish → play-to-base-ignoring-cost half
// (428.1 / 420.3 / 356.1.b.1) plus the structural cost declaration.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ekko-revolutionary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

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
  // README §2: the reason names the missing semantics and the owner tasks.
  assert.match(program.judgeReason, /I enter ready|enter ready/);
  assert.match(program.judgeReason, /Discard 1/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
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
  assert.equal(enterReady.with[0].op, "effect.ready");
  assert.deepEqual(enterReady.with[0].args.objects, {
    kind: "constant",
    value: { kind: "source" }
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

test("rad-021-167 Ekko, Revolutionary: the declared Discard cost cannot be built from static IR yet", () => {
  // CostSpec choices must name exact ObjectRefs at Finalize (cost/plan-values.ts
  // choiceObjects); a static program can only declare a placeholder, and the
  // merged cost pipeline rejects it instead of guessing a card.
  const kernel = world().unit("ekko", { might: 4, energy: 5, power: ["Fury"] }).hand("card-a").build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  assert.throws(
    () => buildCostPlan(context, { id: "ekko.activate", cost: activated.cost }),
    /exact object reference/
  );
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
  assert.deepEqual(playInstruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  // 356.1.b.1: "ignoring its cost" sets the base Energy and Power costs to zero.
  assert.deepEqual(playInstruction.args.cost, {
    kind: "constant",
    value: { finalized: true, energy: 0, power: [], xp: 0 }
  });
});

test("rad-021-167 Ekko, Revolutionary: banish → play really resolves through the interpreter", () => {
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
  // 356.1.b.1: "ignoring its cost" is carried as a finalized zero-cost plan.
  assert.deepEqual(playInstruction.args.cost.value, {
    finalized: true,
    energy: 0,
    power: [],
    xp: 0
  });
  // The static IR names the playing player's base symbolically ("controller");
  // substituting the concrete player yields that player's base.
  const concrete = resolveChainBody(
    [
      banishInstruction,
      {
        ...playInstruction,
        args: {
          ...playInstruction.args,
          location: { kind: "constant", value: { type: "base", player: "A" } }
        }
      }
    ],
    kernel.clone({ sourceSnapshot: kernel.getObject("ekko") })
  );
  assert.equal(concrete.status, "executed");
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

test.todo(
  "Ekko, Revolutionary: 'I enter ready' as an entry replacement (369.3 / 359.2.c) — blocked because no merged primitive " +
    "registers a card's replacement ability as an entry rewrite and effect.ready cannot simulate entering ready (RIFT-9/RIFT-120)"
);

test.todo(
  "Ekko, Revolutionary: collecting 'Discard 1' as an activation cost with a filter-based (non-target) selection — blocked because " +
    "CostSpec choices require exact ObjectRefs and cost.discard / cost.pay consumers are unmerged (RIFT-89)"
);

test.todo(
  "Ekko, Revolutionary: [Assault] +1 Might while attacking (807.1.c/.d.1) — the KeywordDef is merged (RIFT-81) but no producer " +
    "resolves a card's keyword abilities into the layers, and the Attacker designation is not an ObjectSnapshot characteristic (RIFT-91 / contract 3.8)"
);

test.todo(
  "Ekko, Revolutionary: registering the activation (and its chain cost/target lifecycle) from the card program — shared wiring " +
    "tracked by the coordinator (RIFT-1 / RIFT-120 follow-up)"
);
