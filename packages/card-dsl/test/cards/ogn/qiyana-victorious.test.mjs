import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/qiyana-victorious.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-f26c9365df2b773179f654031d3a114d51b6f183d2086ba1fa9f1891050a0a71";

const [deflect, conquer] = program.abilities;
const modeInstruction = conquer.body[0];
const [drawMode, channelMode] = modeInstruction.args.modes.value;

test("ogn-155-298 Qiyana, Victorious: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
      "When I conquer, draw 1 or channel 1 rune exhausted."
  );
});

test("ogn-155-298 Qiyana, Victorious: judgeReason cites the current Deflect, conquer and binding gaps", () => {
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /809/);
  // The conquer timing point is emitted by the Score wave and the card-program
  // trigger binding (RIFT-257) is merged; the remaining gaps are the target-tax
  // production wiring (RIFT-360), the EventPattern source/here vocabulary and
  // the choice.mode Finalize/Resolve adapter.
  assert.match(program.judgeReason, /turn\/flow\.ts/);
  // cost.pay/cost.modify are merged; the reason must present the current target-tax
  // producer gap and must not list the merged primitives as missing dependencies.
  assert.match(program.judgeReason, /cost\.pay\/cost\.modify 已合入/);
  assert.ok(!/未合入的 cost\.pay/.test(program.judgeReason));
  // The card-program trigger binding is merged; the reason states that instead
  // of listing the binding itself as a missing dependency.
  assert.match(program.judgeReason, /触发注册的卡牌程序绑定已合入/);
  assert.match(program.judgeReason, /RIFT-360/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.match(program.judgeReason, /EventPattern/);
});

test("ogn-155-298 Qiyana, Victorious: Deflect is a keyword declaration, not a hand-written tax", () => {
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect" });
  assert.equal(program.abilities.filter(ability => ability.kind === "static").length, 0);
});

test("ogn-155-298 Qiyana, Victorious: conquer trigger chooses draw 1 or channel 1 exhausted (choice.mode, contract 3.9)", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(conquer.kind, "triggered");
  assert.equal(conquer.trigger.at, "conquer");
  assert.deepEqual(conquer.trigger.filter, { event: "conquer", filter: { source: "self" } });
  assert.equal(conquer.optional, false);
  assert.equal(conquer.body.length, 1);

  assert.equal(modeInstruction.id, "qiyana.draw-or-channel");
  assert.equal(modeInstruction.op, "choice.mode");
  assert.deepEqual(modeInstruction.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(modeInstruction.args.different, { kind: "constant", value: true });
  assert.equal(modeInstruction.args.modes.kind, "constant");

  assert.deepEqual(drawMode.id, "qiyana.draw-mode");
  assert.deepEqual(channelMode.id, "qiyana.channel-mode");
  assert.equal(drawMode.body.length, 1);
  assert.equal(channelMode.body.length, 1);
  assert.equal(drawMode.body[0].op, "effect.draw");
  assert.deepEqual(drawMode.body[0].args.amount, { kind: "constant", value: 1 });
  assert.equal(channelMode.body[0].op, "effect.channel");
  assert.deepEqual(channelMode.body[0].args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelMode.body[0].args.exhausted, { kind: "constant", value: true });
});

test("ogn-155-298 Qiyana, Victorious: the draw branch executes through the merged effect.draw primitive (414.3)", () => {
  const kernel = world().deck(["c1", "c2"]).build();
  const run = runInstruction(draw, drawMode.body[0].args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("ogn-155-298 Qiyana, Victorious: the channel branch enters exhausted through the merged effect.channel primitive (431.1/431.2)", () => {
  const kernel = world().rune(["r1", "r2"]).build();
  const run = runInstruction(channel, channelMode.body[0].args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  const channelEvent = run.events.find(event => event.action === "channel-rune");
  assert.ok(channelEvent, "expected a channel-rune game action");
});

test("ogn-155-298 Qiyana, Victorious: the merged Deflect KeywordDef only emits the target tax effect (809.1.c)", () => {
  const deflectDef = keywordDefinitionsById.get("Deflect");
  assert.ok(deflectDef, "Deflect KeywordDef must be registered");
  assert.equal(deflectDef.valued, true);
  assert.equal(deflectDef.stacking, "sum");
  const [expanded] = deflectDef.expand({ value: undefined, host: { canonicalCardId: CANONICAL } });
  // 809.1.b.3: no printed Deflect Value means 1.
  assert.equal(expanded.kind, "static");
  assert.equal(expanded.effect.kind, "target.tax");
  assert.deepEqual(expanded.effect.value, { kind: "constant", value: 1 });
});

test.todo(
  "ogn-155-298 Qiyana, Victorious: the Deflect target tax (809.1.c/d) needs a consumer that reads the " +
    "expanded target.tax effect while targets are finalized and folds it into the cost plan and its " +
    "payment (RIFT-360, in flight); the merged target plan only appends a caller-supplied tax, and the " +
    "merged static binder has no target.tax layer mapping."
);
test.todo(
  "ogn-155-298 Qiyana, Victorious: 'When I conquer' (383.4.c.2) needs the conquer event's participating " +
    "unit/location identity in EventPattern so the trigger can be narrowed to this unit (the " +
    "CardProgram→TriggerRegistration binder itself is merged); the conquer timing point itself is now emitted by " +
    "turn/flow.ts and the choice.mode body still needs the Finalize/Resolve choice-plan adapter."
);
