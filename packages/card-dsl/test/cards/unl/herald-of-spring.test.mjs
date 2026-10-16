import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/herald-of-spring.js";
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
  assert.match(program.judgeReason, /823\.1/);
  assert.match(program.judgeReason, /Hunt/);
  assert.match(program.judgeReason, /383\.4\.d\.2/);
  assert.match(program.judgeReason, /RIFT-33/);
});

test("unl-034-219 Herald of Spring: [Hunt] stays a keyword declaration with no hand-rolled expansion", () => {
  assert.equal(program.abilities.length, 2);
  // 823.1.c.2：印刷省略 Hunt Value，按 1 处理；展开由 keywords/Hunt.ts 负责（契约 3.7）。
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
  // 链接值：实际获得量缺省写在 gained，获得者写在 gainedTo。
  assert.equal(
    outcome.linkedValues["herald-of-spring.gain-2-xp.gained"],
    2
  );
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
  "unl-034-219 Herald of Spring: expand [Hunt] (CR 823.1.b/823.1.c.1: 'When I Conquer or Hold, my " +
    "controller gains 1 XP', 823.2 summing) into conquer and hold triggers — no hunt KeywordDef exists " +
    "(ability-templates kw-hunt needs trigger.score + effect.xp)"
);
test.todo(
  "unl-034-219 Herald of Spring: bind the hold trigger to the unit present at the held battlefield " +
    "(CR 383.4.d.2/.2.a) — the hold payload carries only battlefield/player (RIFT-31/RIFT-33)"
);
test.todo(
  "unl-034-219 Herald of Spring: register card keyword abilities through the KeywordDef expansion and " +
    "the event/chain pipeline (contract 3.5/3.7, RIFT-33/RIFT-120)"
);
