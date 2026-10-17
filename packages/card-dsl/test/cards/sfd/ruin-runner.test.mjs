import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/ruin-runner.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/index.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/index.js";
import { finalizeTargetPlan } from "../../../../engine-core/dist/target/index.js";

const CARD_ID = "card.hash-4c33c3a92166927cee28b4acd0740603992c27aa8567488dee47edd7288ae1a1";
const [ability] = program.abilities;

test("sfd-105-221 Ruin Runner: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-105-221 Ruin Runner: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "I can't be chosen by enemy spells and abilities.");
});

test("sfd-105-221 Ruin Runner: judgeReason names the untargetability consumer gap", () => {
  assert.match(program.judgeReason, /756/);
  assert.match(program.judgeReason, /757\.1/);
  assert.match(program.judgeReason, /758/);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /target\/target-plan\.ts/);
  // RIFT-259 merged the primitive and the rules-query helpers; the accurate
  // gap is the missing consumer and the missing chooser/source-category keys.
  assert.match(program.judgeReason, /RIFT-259/);
  assert.match(program.judgeReason, /restrictions\(\)/);
  assert.match(program.judgeReason, /chooser/);
  assert.match(program.judgeReason, /sources/);
  assert.match(program.judgeReason, /RIFT-90\/RIFT-91/);
  assert.doesNotMatch(program.judgeReason, /effects\/instructions\/ 没有 continuous\.restrict 原语/);
});

test("sfd-105-221 Ruin Runner: one static untargetable declaration naming chooser and source category", () => {
  // 757 / 757.1: the passive ability designates the host as Untargetable for
  // the [Category] spells and abilities the text names — 757's own example is
  // this card verbatim. The declaration is data; no target rule is restated.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.restrict");
  assert.equal(ability.effect.mode, "untargetable");
  assert.equal(ability.effect.appliesTo, "self");
  assert.equal(ability.effect.chooser, "opponent");
  assert.deepEqual(ability.effect.sources, ["spell", "ability"]);
  assert.equal(ability.condition, undefined);
});

test("sfd-105-221 Ruin Runner: the program authors no instruction, target or keyword it cannot execute", () => {
  // The restriction is a whole-object eligibility rule (355.9.b / 359.3.e.5),
  // not a filter on some instruction, so nothing in body could carry it; a
  // body-level no-op would fake execution.
  assert.equal(ability.body, undefined);
  assert.equal(ability.effect.body, undefined);
  assert.equal(/\.op\b/.test(JSON.stringify(program.abilities)), false);
});

test.todo(
  "sfd-105-221 Ruin Runner: the untargetability declaration must be consumed by target legality so an " +
    "opponent's spell or ability cannot choose this unit on the board (757/757.1, 758, 355.9.b) — " +
    "continuous.restrict is merged but target/target-plan.ts never reads its registry, and no " +
    "chooser/source-category keys exist on ObjectFilter or TargetSpec (RIFT-90 / RIFT-91)"
);

test.todo(
  "sfd-105-221 Ruin Runner: re-check untargetability on resolution so a unit that becomes untargetable " +
    "after being targeted mistargets (758.1, 758.2 / 758.2.a, 359.3.e.5) — same consumer gap"
);

test("sfd-105-221 Ruin Runner: the merged continuous.restrict primitive registers the prohibition", () => {
  // RIFT-259 merged the primitive: it registers an ability-layer restriction
  // whose restriction name and action list are queryable through the merged
  // rules helpers. The claim in the judgeReason is only about the missing
  // consumer, not about the absence of the primitive.
  const kernel = world().unit("ruin-runner", { owner: "A", controller: "A", might: 5 }).build();
  const outcome = resolveChainBody(
    [{
      id: "untargetable",
      op: "continuous.restrict",
      args: {
        mode: { kind: "constant", value: "prohibit" },
        action: { kind: "constant", value: ["target"] },
        restriction: { kind: "constant", value: "untargetable" },
        appliesTo: { kind: "constant", value: { objectId: "ruin-runner" } }
      }
    }],
    kernel
  );
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registered] = kernel.continuousEffects;
  assert.equal(registered.effect.layer, "ability");
  assert.equal(registered.effect.effect.kind, "restriction");
  assert.equal(registered.effect.effect.restriction, "untargetable");
  assert.deepEqual(registered.effect.effect.actions, ["target"]);

  const registry = {
    list: () => kernel.continuousEffects.map((entry, index) => ({ ...entry, id: `reg-${index}` }))
  };
  const query = restrictions(registry, "target", kernel.ref("ruin-runner"), kernel.getObject("ruin-runner"), "A");
  assert.equal(query.length, 1);
  assert.equal(query[0].name, "untargetable");
});

test("sfd-105-221 Ruin Runner: target legality never consults the restriction registry", () => {
  // Evidence for the judgeReason: finalizeTargetPlan decides legality from the
  // spec filter plus the caller-supplied isPending/isLegal hooks only. An
  // untargetability restriction registered for the host changes nothing, and
  // its "chooser is the opponent" / "source is a spell or ability" dimensions
  // still have no key on ObjectFilter or TargetSpec.
  const kernel = world()
    .unit("ruin-runner", { owner: "A", controller: "A", might: 5 })
    .build();
  const ref = kernel.ref("ruin-runner");
  const object = kernel.getObject("ruin-runner");
  const plan = finalizeTargetPlan(kernel, { id: "chosen-unit", filter: { type: "unit" }, min: 1, max: 1 }, {
    selected: [ref]
  });
  assert.deepEqual(plan.selected, [ref]);

  // The card's declared dimensions are not dimensions the merged evaluator
  // consults; the evaluator has no chooser/source-category keys of its own.
  assert.equal(matchesObjectFilter({ type: "unit" }, object), true);
});


test.todo(
  "sfd-105-221 Ruin Runner: target legality must consult the merged restriction registry so an " +
    "opponent's spell or ability cannot choose this unit (757/757.1, 758, 355.9.b), including the " +
    "chooser-is-the-opponent and source-is-a-spell-or-ability dimensions — RIFT-90 / RIFT-91"
);
