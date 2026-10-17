import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/herald-of-spring.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-31eb0f7b272ead3837c42e44cd4050722667b2142fc50acd5a91843a859b42cf";
const SOURCE_TEXT = "[Hunt] (When I conquer or hold, gain 1 XP.)\nWhen you play me, gain 2 XP.";

const [hunt, onPlay] = program.abilities;
const [gainTwoXp] = onPlay.body;

test("unl-034-219 Herald of Spring: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-034-219 Herald of Spring: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The KeywordDef and the expansion path are merged; the remaining gap is the
  // held/conquering-unit attribution in the scoring payload.
  assert.match(program.judgeReason, /823\.1/);
  assert.match(program.judgeReason, /Hunt/);
  assert.match(program.judgeReason, /383\.4\.d\.2/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.match(program.judgeReason, /单位对象|快照|归因/);
  assert.doesNotMatch(program.judgeReason, /RIFT-31\/33/);
  assert.doesNotMatch(program.judgeReason, /kw-hunt/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(257|264|265|266|267|268)/);
});

test("unl-034-219 Herald of Spring: [Hunt] stays a keyword declaration with no hand-rolled expansion", () => {
  assert.equal(program.abilities.length, 2);
  // 823.1.c.2: the printed Hunt value is omitted and counts as 1; expansion is
  // owned by keywords/Hunt.ts (contract 3.7).
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt" });
  assert.equal(hunt.value, undefined);
  assert.equal(
    program.abilities.some((ability) => ability.kind === "triggered" && ability.trigger.at === "conquer"),
    false,
    "[Hunt] must not be re-written as a conquer trigger inside the card"
  );
  assert.equal(
    program.abilities.some((ability) => ability.kind === "triggered" && ability.trigger.at === "hold"),
    false,
    "[Hunt] must not be re-written as a hold trigger inside the card"
  );
});

test("unl-034-219 Herald of Spring: the merged [Hunt] KeywordDef expands into conquer and hold XP triggers", () => {
  // The merged Hunt keyword gives CR 823.1.b/823.1.c.1 the two
  // timing points and 823.1.c.2 defaults the omitted value to 1.
  const huntDef = keywordDefinitionsById.get("Hunt");
  assert.ok(huntDef, "the merged Hunt KeywordDef is registered (CR 823)");
  assert.equal(huntDef.valued, true);
  // 823.2: several Hunt sources sum, so the keyword stacks by sum.
  assert.equal(huntDef.stacking, "sum");
  const expansion = huntDef.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expansion.map((ability) => ability.trigger.at), ["conquer", "hold"]);
  assert.deepEqual(
    expansion.map((ability) => ability.body[0].op),
    ["effect.xp", "effect.xp"]
  );
  assert.deepEqual(expansion[0].body[0].args, { amount: { kind: "constant", value: 1 } });
  assert.deepEqual(expansion[1].body[0].args, { amount: { kind: "constant", value: 1 } });
  assert.deepEqual(expansion[0].trigger.filter, { event: "conquer", filter: { source: "self" } });
  assert.deepEqual(expansion[1].trigger.filter, { event: "hold", filter: { source: "self" } });
  // 823.2: a valued Hunt instance raises the granted amount.
  const valued = huntDef.expand({ value: 3, host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(valued[0].body[0].args, { amount: { kind: "constant", value: 3 } });
});

test("unl-034-219 Herald of Spring: card-played self trigger grants exactly 2 XP", () => {
  assert.equal(onPlay.kind, "triggered");
  assert.deepEqual(onPlay.trigger, {
    at: "card-played",
    filter: { event: "card-played", filter: { source: "self" } }
  });
  assert.equal(onPlay.optional, false);
  assert.equal(onPlay.body.length, 1);
  assert.equal(gainTwoXp.id, "herald-of-spring.gain-2-xp");
  assert.equal(gainTwoXp.op, "effect.xp");
  assert.deepEqual(gainTwoXp.args, { amount: { kind: "constant", value: 2 } });
  assert.equal(gainTwoXp.targets, undefined);
  assert.equal(gainTwoXp.picks, undefined);
  assert.equal(gainTwoXp.linkedTo, undefined);
});

test("unl-034-219 Herald of Spring golden: the printed 'gain 2 XP' raises the controller's XP (CR 730.1)", () => {
  const kernel = world().player("A", { xp: 3 }).build();
  const outcome = resolveChainBody(onPlay.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["herald-of-spring.gain-2-xp", "executed"]
  ]);
  assert.equal(kernel.player("A").xp, 5);
  assert.deepEqual(outcome.events.map((event) => event.action), ["gain-xp"]);
  // Linked receipt: the actual gain and the recipient.
  assert.equal(outcome.linkedValues["herald-of-spring.gain-2-xp.gained"], 2);
});

test("unl-034-219 Herald of Spring golden: a replaced gain-xp action negates the instruction", () => {
  const kernel = world().player("A", { xp: 0 }).build();
  kernel.addReplacement((action) => (action.type === "gain-xp" ? "replaced" : null));
  const run = runInstruction(xp, gainTwoXp.args, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(kernel.player("A").xp, 0);
});

test.todo(
  "unl-034-219 Herald of Spring: attribute the conquer/hold trigger to the scoring unit — the merged Hunt " +
    "expansion registers both timings, but turn/flow.ts's Score wave carries only player + " +
    "details.battlefieldId, so the self-scoped filter has no scoring-unit object or snapshot to match"
);
test.todo(
  "unl-034-219 Herald of Spring: bind the hold trigger to the unit present at the held battlefield " +
    "(CR 383.4.d.2/.2.a) — the hold payload carries only battlefield/player"
);
test("unl-034-219 Herald of Spring golden: both Hunt bodies award the current controller rather than the owner", () => {
  const definition = keywordDefinitionsById.get("Hunt");
  assert.ok(definition);
  for (const ability of definition.expand({ host: { canonicalCardId: CANONICAL_ID } })) {
    const kernel = world().player("A", { xp: 2 }).player("B", { xp: 3 })
      .unit("herald", { owner: "A", controller: "B", cardId: CANONICAL_ID })
      .build();
    const context = kernel.clone({ sourceSnapshot: kernel.getObject("herald"), controller: "B" });
    const outcome = resolveChainBody(ability.body, context);
    assert.equal(outcome.status, "executed");
    assert.equal(context.player("A").xp, 2);
    assert.equal(context.player("B").xp, 4);
    assert.equal(outcome.linkedValues[`${encodeURIComponent(ability.body[0].id)}.gainedTo`], "B");
    assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
  }
});
