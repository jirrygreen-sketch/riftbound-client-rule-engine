import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/seat-of-power.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL =
  "card.hash-8ad41dd9ba742358d12656164c456e4f9cc43b4712fcb9c9f120661d5c208fac";
const SOURCE_TEXT =
  "When you conquer here, draw 1 for each other battlefield you or allies control..";

const [ability] = program.abilities;
const [drawInstruction] = ability.body;

const BATTLEFIELD_COUNT = {
  kind: "count",
  subject: "battlefields",
  filter: {
    type: "battlefield",
    controller: "you-or-ally",
    exclude: "self"
  }
};

test("sfd-217-221 Seat of Power: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("sfd-217-221 Seat of Power: identity, ruleset, status and verbatim (double-period) text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The catalog text ends with "control.." — kept verbatim; the data issue is
  // reported in the final summary, not fixed here.
  assert.equal(program.sourceText, SOURCE_TEXT);
  // Build-time codegen over src/cards/**; the golden proves the identity is
  // actually registered (one identity, one file).
  assert.equal(cardProgramsById.get(CANONICAL), program);
  assert.equal(program.sourceText.endsWith("control.."), true);
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /allies/);
  assert.match(program.judgeReason, /RIFT-31/);
  assert.match(program.judgeReason, /data-issues-recheck/);
});

test("sfd-217-221: conquer trigger whose draw amount is the qualifying battlefield count", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  // 053.3 "here" + 190.6.d "you"; sibling battlefield programs keep this
  // placeholder spelling while the conquer pipeline is unmerged.
  assert.deepEqual(ability.trigger.filter, {
    event: "conquer",
    here: true,
    player: "controller"
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);

  // "draw 1 for each other battlefield you or allies control": one draw whose
  // amount is the size of the qualifying set, read at resolution (414.1/414.3).
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "seat-of-power.draw-per-battlefield"
  ]);
  assert.equal(drawInstruction.op, "effect.draw");
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.deepEqual(drawInstruction.args.amount, BATTLEFIELD_COUNT);
});

test("sfd-217-221: the amount is a dynamic count, not a hard-coded 1", () => {
  // The printed "for each" makes the draw amount depend on the board at
  // resolution, so the declaration must not bake in a constant. This is the
  // part that stays reviewable while the population itself is missing.
  assert.equal(drawInstruction.args.amount.kind, "count");
  assert.equal(drawInstruction.args.amount.subject, "battlefields");
  assert.deepEqual(drawInstruction.args.amount.filter, {
    type: "battlefield",
    controller: "you-or-ally",
    exclude: "self"
  });
});

test("sfd-217-221: the merged kernel's count cannot enumerate Battlefields or allies", () => {
  // Evidence for the judgeReason. The reference test kernel's query matches
  // snapshots of Board units; its WorldBuilder can only create Unit-like
  // objects (unit/battlefield/base/card all build ObjectSnapshot units), and
  // the filter's controller selector has no "you-or-ally" spelling. The count
  // therefore cannot distinguish the printed set here.
  const kernel = world().unit("unit-a").unit("unit-b", { owner: "B" }).build();
  assert.equal(
    kernel.evaluate({
      kind: "count",
      subject: "battlefields",
      filter: { type: "battlefield", controller: "you-or-ally", exclude: "self" }
    }),
    0
  );
  // Even the raw objects the builder exposes are units, not Battlefields.
  assert.deepEqual(
    kernel.objects.map(object => object.types),
    [["unit"], ["unit"]]
  );
});

test("sfd-217-221: the merged draw primitive executes the count-driven shape for a bound population", () => {
  // The draw primitive itself is merged and evaluates its amount at resolution
  // (414.1/414.3). This golden binds an explicit count of the other
  // battlefields the controller/allies control and proves the draw follows it;
  // the missing population/allies binding is what keeps the card
  // judge-required.
  const kernel = world().deck(["a", "b", "c", "d"], { owner: "A" }).build();
  const boundOtherBattlefields = 2;

  const run = runInstruction(
    draw,
    { amount: { kind: "constant", value: boundOtherBattlefields } },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
  assert.equal(run.linked.drawn, 2);
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 2);
});

test("sfd-217-221: zero qualifying battlefields draws zero cards", () => {
  const kernel = world().deck(["a", "b"], { owner: "A" }).build();

  const run = runInstruction(
    draw,
    { amount: { kind: "constant", value: 0 } },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 2);
  assert.deepEqual(kernel.events, []);
});

test("sfd-217-221: the trigger filter still carries the unreplaced here placeholder", () => {
  assert.throws(() => assertTriggerSpec(ability.trigger), /EventPattern 不允许此字段/);
});

test.todo(
  "sfd-217-221: conquer 由 scoring/ 发出并进链，战场能力按控制者注册触发（RIFT-31/RIFT-33）"
);
test.todo(
  "sfd-217-221: Battlefield 对象进入可查询集合、ObjectFilter 支持 exclude 锚点与队友（allies）关系后，" +
    "count 真实统计\"other battlefield you or allies control\"（RIFT-9 target.query / 队伍模式接线）"
);
