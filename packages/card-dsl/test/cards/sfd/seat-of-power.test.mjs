import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/seat-of-power.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

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
  // The refreshed reason must cite the current gaps: the here placeholder and
  // the "you-or-ally" / exclude filter vocabulary (both rejected by the merged
  // filter adapters), not the stale "no conquer emitter" note.
  assert.match(program.judgeReason, /RIFT-270/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.judgeReason.includes("No merged module emits conquer"), false);
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

test("sfd-217-221: the card keeps the printed count/here spellings instead of approximating them", () => {
  // Durable data-level guard (independent of how far the engine currently is):
  // the printed "other battlefield you or allies control" must never be
  // narrowed to a single controller or to a hard-coded amount just to make the
  // count pass. The placeholder spellings stay auditable until the merged
  // vocabulary covers the teammate relation and the battlefield-relative here
  // anchor (see judgeReason).
  assert.deepEqual(drawInstruction.args.amount.filter.controller, "you-or-ally");
  assert.equal(drawInstruction.args.amount.filter.exclude, "self");
  assert.equal(ability.trigger.filter.here, true);
  assert.equal(ability.trigger.filter.player, "controller");
  // No hard-coded 1 for the "for each" amount, and no second draw instruction.
  assert.equal(ability.body.length, 1);
  assert.equal(drawInstruction.args.amount.kind, "count");
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

test("sfd-217-221: the trigger keeps the printed battlefield-relative here restriction instead of a substitute event", () => {
  // Durable guard: the card must keep the printed "conquer here" restriction.
  // While the EventPattern vocabulary has no battlefield-relative anchor the
  // spec must fail closed (never silently register a broader conquer trigger
  // that would draw on every battlefield); once the anchor lands the same
  // printed restriction is what gets validated.
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.trigger.filter.here, true);
  const validation = validateTriggerSpec(ability.trigger);
  if (!validation.ok) {
    // Until the vocabulary lands, every rejection must concern exactly the
    // printed placeholders (here / conquer / controller selector) — never a
    // silently narrowed or substituted trigger.
    const paths = [...new Set(validation.issues.map((issue) => issue.path))].sort();
    assert.deepEqual(paths, [
      "trigger.filter.event",
      "trigger.filter.here",
      "trigger.filter.player"
    ]);
  }
});

test.todo(
  "sfd-217-221: 战场能力的触发注册（conquer 时点由 turn/flow.ts 的 Score wave 发出，但 EventPattern 的" +
    "战场相对 here 语义词表未合入；依赖 RIFT-257 的 CardProgram → TriggerRegistration 过滤器适配）"
);
test.todo(
  "sfd-217-221: Battlefield 对象进入可查询集合、ObjectFilter 支持 exclude 锚点与队友（allies）关系后，" +
    "count 真实统计\"other battlefield you or allies control\"（RIFT-9 target.query / 队伍模式接线）"
);
// Direct evidence for the two vocabulary gaps recorded in the judgeReason:
// the exclude anchor is rejected outright, and you-or-ally passes the binding
// adapter only as an unnormalized literal that the layer matcher then treats
// as an unknown player value (never an ally set).
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
test("sfd-217-221 Seat of Power: the exclude anchor is rejected by the merged filter adapter", () => {
  assert.throws(
    () => translateObjectFilter(BATTLEFIELD_COUNT.filter),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Unsupported filter field exclude/);
      return true;
    }
  );
});

test("sfd-217-221 Seat of Power: you-or-ally has no PlayerSelector semantics in the binding or the matcher (CR 471.1.a)", () => {
  // The adapter does not normalize the spelling — it is carried through as a
  // literal controller value...
  const translated = translateObjectFilter({ type: "battlefield", controller: "you-or-ally" });
  assert.deepEqual(translated, { type: "battlefield", controller: "you-or-ally" });

  // ...and the layer matcher compares that literal against each object's
  // controller, so an allied battlefield never matches. Teammate semantics
  // therefore exist in neither layer; the printed count cannot be evaluated.
  const kernel = world().player("A").build();
  const battlefield = {
    ref: { id: "bf-1", zoneEntryId: 1 },
    id: "bf-1",
    types: ["battlefield"],
    tags: [],
    zone: "board",
    controller: "A",
    owner: "A"
  };
  assert.equal(matchesObjectFilter({ controller: "you-or-ally" }, battlefield), false);
  assert.equal(matchesObjectFilter({ controller: "A" }, battlefield), true);
});

