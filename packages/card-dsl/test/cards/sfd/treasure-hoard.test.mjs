import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/treasure-hoard.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const [choice] = ability.body;
const body = choice.args.body.value;

test("treasure-hoard: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("treasure-hoard: optional conquer structure with pay, token and play", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Gold gear token/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /details\.battlefieldId/);
  assert.match(program.judgeReason, /programs\/filters\.ts/);
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "conquer");
  assert.equal(ability.trigger.filter.here, true);
  assert.equal(ability.optional, true);
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["treasure-hoard.opt-in"]);
  assert.equal(choice.op, "choice.optional");
  assert.equal(choice.args.body.kind, "constant");
  const body = choice.args.body.value;
  const ids = body.map(instruction => instruction.id);
  assert.deepEqual(ids, [
    "treasure-hoard.pay",
    "treasure-hoard.create"
  ]);
  assert.equal(body[0].op, "cost.pay");
  assert.deepEqual(body[0].args.payments, { kind: "constant", value: { energy: 1 } });
  assert.equal(body[0].linkedTo, undefined);
  assert.equal(body[1].op, "effect.token");
  assert.equal(body[1].linkedTo, "treasure-hoard.pay");
  assert.deepEqual(body[1].args.token, { kind: "constant", value: "gold" });
  // 420.3/440.2.c：印刷的 「play a … token」由已合入的 effect.token mode "play"
  // 在链上创建并交给打出流程；旧程序里的描述性 "chain" 已改为原语实际取值。
  assert.deepEqual(body[1].args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(body[1].args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(body[1].args.linkKey, { kind: "constant", value: "goldToken" });
  assert.deepEqual(body[1].args.location, { kind: "location", value: "ability-controller-base" });
  // effect.token mode "play" performs the play itself (440.2.c); no separate
  // effect.play is authored for the printed "play a … token".
  assert.equal(body.some((instruction) => instruction.op === "effect.play"), false);
});

test("treasure-hoard: declining skips payment, creation and token play", () => {
  const kernel = world().build();
  kernel.setAnswers({ "treasure-hoard.opt-in/optional": false });
  const outcome = runAbilityBody(ability.body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["treasure-hoard.opt-in"]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
});

test("treasure-hoard: the merged token primitive really creates and plays a token with mode play", () => {
  // With a definition the frozen table does have (mech), the same mode:"play"
  // instruction really creates on the Chain and hands the object to the play
  // flow; only the Gold definition and the entry-exhaust override keep the
  // printed ability judge-required. The card's descriptive destination marker is
  // replaced by a real LocationRef here for that execution.
  const kernel = world().build();
  const run = runInstruction(
    token,
    {
      ...body[1].args,
      token: { kind: "constant", value: "mech" },
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.goldToken.createdAmount, 1);
  assert.equal(run.linked.goldToken.amount, 1);
  assert.deepEqual(run.events.map((event) => event.action), ["create-token", "play"]);
  assert.equal(kernel.getObject(run.linked.goldToken.objects[0].id).zone, "board");
});

test("treasure-hoard: the printed one-Energy payment uses the merged cost.pay primitive", () => {
  const kernel = world().player("A", { energy: 1 }).build();
  const run = runInstruction(costPay, body[0].args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(run.events.map((event) => event.action), ["pay"]);
});

test.todo("treasure-hoard: Gold gear token definition with its own activated ability (CR 187.5) needs the token table extension");
test.todo("treasure-hoard: exhausted entry override on the created token (143.4/185.2.d)");
test.todo(
  "treasure-hoard: resolve the conquer event's battlefield identity into the printed 'here' anchor " +
    "(details.battlefieldId -> location filter; programs/filters.ts currently rejects the unresolved field); " +
    "the Energy payment is already executable through cost.pay."
);
