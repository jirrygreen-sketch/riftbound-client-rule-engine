import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/viktor-innovator.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { registerProgramTriggers } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const [ability] = program.abilities;
const c = value => ({ kind: "constant", value });

test("Viktor, Innovator program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Viktor, Innovator identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-27a69aef36a430f79f170618dfa72e36b2605b39fa8a3a67366ac01669844aa0"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /opponent's turn/);
  assert.match(program.judgeReason, /activePlayerId/);
  // Re-probed 2026-10-17: the placeholder gate is truthy, so the missing
  // predicate is the only thing standing between this card and over-triggering.
  assert.match(program.judgeReason, /恒真/);
  assert.equal(/RIFT-359/.test(program.judgeReason), false);
  assert.equal(
    program.sourceText,
    "When you play a card on an opponent's turn, play a 1 :rb_might: Recruit unit token in your base."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: card-played trigger whose condition depends on the active player", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 420.4.a：打出动作完成后触发。
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    player: "controller"
  });
  // 「on an opponent's turn」必须在触发时比较回合玩家与控制者；冻结 IR 里只能保留
  // 原文含义的受阻谓词（见 judgeReason）。
  assert.deepEqual(ability.trigger.condition, {
    kind: "expression",
    value: c("active-player-is-opponent-of-controller")
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("structure: the body creates the Recruit token on the chain, then plays it to your base", () => {
  assert.deepEqual(
    ability.body.map(instruction => instruction.id),
    ["viktor.controller-base", "viktor.play-recruit"]
  );

  const [base, create] = ability.body;
  assert.equal(base.op, "condition.value");
  assert.deepEqual(base.args.value, {
    kind: "location", value: { type: "base", player: "controller" }
  });
  assert.deepEqual(base.args.key, c("base"));
  assert.equal(create.op, "effect.token");
  // 187.1：1 Might Recruit 单位 token。
  assert.deepEqual(create.args.token, c("recruit"));
  assert.deepEqual(create.args.amount, c(1));
  // 440.2.c / 185.2.a："play a … token" 先在链上生成，再由 play 接手。
  assert.deepEqual(create.args.mode, c("play"));
  assert.deepEqual(create.args.location, {
    kind: "linked-value", instructionId: base.id, key: "base"
  });
  assert.deepEqual(create.args.linkKey, c("recruitToken"));
  assert.equal(create.targets, undefined);
});

test("golden: the Recruit token really enters the controller's base as a token", () => {
  // 已合入的 token 打出链路（create-token to chain + play）真实执行；这是本卡的局部
  // 执行证据，但不代表整卡可执行（触发条件未落地）。
  const kernel = world().build();
  const run = resolveChainBody(ability.body, kernel);

  assert.equal(run.status, "executed");
  assert.equal(run.results[1].result.status, "executed");
  const created = kernel.query({ zone: "board", type: "unit" });
  assert.equal(created.length, 1);
  const [recruit] = created;
  assert.equal(recruit.name, "Recruit");
  assert.equal(recruit.might, 1);
  assert.deepEqual(recruit.location, { type: "base", player: "A" });
  assert.equal(recruit.isToken, true);
  // 185.3：token 没有 printed cost（null 不是 0）。
  assert.equal(recruit.energy, null);
  assert.equal(recruit.power, null);
  assert.deepEqual(run.linkedValues["viktor.play-recruit.recruitToken.objects"], [recruit.ref]);
});

test("Viktor, Innovator: the authored token body executes once through the production Expr adapter", async () => {
  const { translateTriggerFilter } = await import("../../../../engine-core/dist/programs/filters.js");
  const kernel = world().build().clone({ controller: "B" });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
  assert.equal(kernel.objects.length, 1);
  const [recruit] = kernel.objects;
  assert.deepEqual(recruit.location, { type: "base", player: "B" });
  assert.equal(recruit.might, 1);
  assert.equal(recruit.energy, null);
  assert.equal(recruit.power, null);
  assert.deepEqual(outcome.linkedValues["viktor.play-recruit.recruitToken.objects"], [recruit.ref]);
  assert.deepEqual(translateTriggerFilter(ability.trigger.filter, "viktor", "card-played"), {
    event: "card-played", player: "self"
  });
});

test("Viktor, Innovator boundary: the placeholder condition is truthy, so the card fires on its controller's own turn (CR 383.2.a.1)", () => {
  // Re-probed 2026-10-17: expression conditions take Boolean(value), and the
  // authored constant string is always truthy. Driving the real card-played wave
  // on the controller's own turn therefore appends a trigger item, which is the
  // over-trigger the missing turn-ownership predicate has to prevent.
  const f = fixture({ cards: [{ id: "viktor", cardId: program.canonicalCardId, types: ["unit"], energy: 5, power: ["Mind"], might: 5 }] });
  const context = bindResolveContext(f.kernel, { host: f.kernel.ref("source") });
  assert.equal(evaluateCondition(ability.trigger.condition, {
    context, host: f.kernel.ref("source"), linked: () => undefined, canLookBack: () => true, isIgnored: () => false
  }), true);
  assert.deepEqual(ability.trigger.condition.value, c("active-player-is-opponent-of-controller"));

  f.engine.commit({ type: "move-zone", object: f.kernel.ref("viktor"), to: "board", location: { type: "base", player: "A" } });
  f.engine.advance();
  // turnPlayer is A and the ability controller is A: this is the controller's own turn.
  assert.equal(f.engine.pipeline.turnPlayer, "A");
  assert.equal(f.kernel.getObject("viktor").controller, "A");
  registerProgramTriggers(new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]), f.engine, f.kernel.getObject("viktor"));
  f.engine.pipeline.emit({ timingPoint: "card-played", object: f.kernel.getObject("source"), source: f.kernel.getObject("source"), player: "A", fromZone: "hand" });
  assert.deepEqual(f.engine.items.map(item => item.source.ref.id), ["viktor"]);
});

test("Viktor, Innovator boundary: the event carries activePlayerId, but no Condition or Expr member reads it (CR 383.2.a.1)", () => {
  // Re-probed 2026-10-17: the pipeline event really does carry the turn owner,
  // so the data is present; what is missing is the predicate surface. The merged
  // predicate condition kinds cover play origin, printed characteristics and
  // finalized results only.
  const f = fixture({ cards: [] });
  f.engine.pipeline.emit({ timingPoint: "card-played", object: f.kernel.getObject("source"), source: f.kernel.getObject("source"), player: "A", fromZone: "hand" });
  const [event] = f.engine.pipeline.events.filter(candidate => candidate.timingPoint === "card-played");
  assert.equal(event.activePlayerId, "A");
  assert.equal(event.player, "A");
});

for (const controller of ["A", "B"]) {
  for (const sourceLocation of [{ type: "base", player: controller }, { type: "battlefield", id: "bf-1" }]) {
    test(`Viktor, Innovator: authored body plays one Recruit into ${controller}'s base from ${sourceLocation.type}`, () => {
      const base = world().unit("viktor", {
        cardId: program.canonicalCardId, owner: controller, controller, location: sourceLocation
      }).build();
      const kernel = base.clone({ controller, sourceSnapshot: base.getObject("viktor") });
      const outcome = resolveChainBody(ability.body, kernel);
      assert.equal(outcome.status, "executed");
      assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
        ["viktor.controller-base", "executed"], ["viktor.play-recruit", "executed"]
      ]);
      assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
      assert.equal(kernel.pendingItems.length, 0);
      assert.equal(kernel.objects.length, 2);
      const recruits = kernel.objects.filter(object => object.isToken);
      assert.equal(recruits.length, 1);
      const [recruit] = recruits;
      assert.equal(recruit.name, "Recruit");
      assert.equal(recruit.might, 1);
      assert.equal(recruit.zone, "board");
      assert.equal(recruit.owner, controller);
      assert.equal(recruit.controller, controller);
      assert.equal(recruit.energy, null);
      assert.equal(recruit.power, null);
      assert.deepEqual(recruit.location, { type: "base", player: controller });
      assert.deepEqual(outcome.linkedValues["viktor.controller-base.base"], recruit.location);
      assert.deepEqual(outcome.linkedValues["viktor.play-recruit.recruitToken.objects"], [recruit.ref]);
      assert.deepEqual(kernel.getObject("viktor").location, sourceLocation);
    });
  }
}
