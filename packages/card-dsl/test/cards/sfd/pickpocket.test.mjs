import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/pickpocket.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-f3ac5fe953d58a49296d503b4ab1e9969bdcae7211e65966f5d4e0d68a8426ab";
const MAY_ID = "pickpocket.may-kill-gear";
const KILL_ID = "pickpocket.kill-gear";
const TOKEN_ID = "pickpocket.play-gold-token";
const TARGET_ID = "pickpocket.cheap-gear";

const [ability] = program.abilities;
const [mayKill] = ability.body;
const [killInstruction, tokenInstruction] = mayKill.args.body.value;

const resultFor = (outcome, id) => outcome.results.find((result) => result.id === id);

/** The may node locks its target at Finalize, so pre-load the kernel. */
function resolveWith(kernel, { gearRef, accepted }) {
  kernel.setTargets(TARGET_ID, gearRef === undefined ? [] : [gearRef]);
  kernel.setAnswers({ [MAY_ID + "/optional"]: accepted });
  return resolveChainBody(ability.body, kernel);
}

test("sfd-074-221 Pickpocket: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you play me, you may kill a gear with Energy cost no more than :rb_energy_1:. " +
      "If you do, play a Gold gear token exhausted."
  );
});

test("sfd-074-221 Pickpocket: judgeReason names current cost/Gold/entry gaps and the merged kill receipt", () => {
  assert.match(program.judgeReason, /206/);
  assert.match(program.judgeReason, /costEnergyLte/);
  assert.match(program.judgeReason, /359\.3\.e\.14\.b/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /linked-value \+ compare/);
  assert.match(program.judgeReason, /非空 killed 回执/);
  assert.match(program.judgeReason, /184\.1\/185\.2\.d/);
  assert.doesNotMatch(program.judgeReason, /RIFT-90|condition\.result|没有动作\/费用回执绑定/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-074-221 Pickpocket: the may-kill is wrapped in choice.optional with its target on the choice node", () => {
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });

  // Contract 3.9: the printed "you may" wraps the chosen instructions in body.
  assert.deepEqual(ability.body.map((instruction) => instruction.id), [MAY_ID]);
  assert.equal(mayKill.op, "choice.optional");
  assert.equal(mayKill.args.body.kind, "constant");
  assert.deepEqual(mayKill.args.body.value.map((instruction) => instruction.id), [KILL_ID, TOKEN_ID]);
  assert.equal(mayKill.linkedTo, undefined);

  // 355.7 / 355.9.a.1 / 355.12: "a gear" is one chosen Board object, and every
  // choice of the may-action is locked with the play, so the TargetSpec lives on
  // the may node. The Energy ceiling is recorded descriptively only (206) — no
  // merged filter reads costEnergyLte (see judgeReason).
  assert.equal(mayKill.targets.length, 1);
  const [target] = mayKill.targets;
  assert.equal(target.id, TARGET_ID);
  assert.deepEqual(target.filter, { type: "gear", zone: "board", costEnergyLte: 1 });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(mayKill.picks, undefined);
});

test("sfd-074-221 Pickpocket: the kill and the Gold play keep their declared shapes", () => {
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args, {
    target: { kind: "constant", value: TARGET_ID }
  });
  assert.equal(killInstruction.targets, undefined);
  assert.equal(killInstruction.linkedTo, undefined);
  // 359.3.e.14.b: "If you do" directly references the kill action, so the Gold
  // play reads the actual killed receipt. linkedTo alone would still allow a
  // negated kill through (359.3.e.14.b); the nonempty-receipt condition gates it.
  assert.equal(killInstruction.condition, undefined);
  assert.deepEqual(tokenInstruction.condition, {
    kind: "compare",
    left: { kind: "linked-value", instructionId: KILL_ID, key: "killed" },
    operator: "ne",
    right: { kind: "constant", value: [] }
  });
  assert.equal(tokenInstruction.linkedTo, undefined);

  // 440.2.c / 185.2.a: a played token is created on the Chain; 184.1/185.2.d:
  // "exhausted" is an entry stipulation, never a later effect.exhaust.
  assert.equal(tokenInstruction.op, "effect.token");
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  // effect.token rejects the unknown entersExhausted argument; the entry state
  // is the recorded judge-required gap, so no invented key is declared.
  assert.equal(tokenInstruction.args.entersExhausted, undefined);
});

test("sfd-074-221 Pickpocket golden: accepting the may kills the locked gear (CR 429)", () => {
  // 355.10.a / 355.9.a.1: "a gear" is not qualified as friendly, so both
  // controllers' Board gear are legal; the production chain test supplies the
  // gear the controller locked at Finalize. The Gold half still resolves to the
  // documented judge-required negation, so only the kill is asserted as done.
  const kernel = world()
    .unit("pickpocket", { might: 3 })
    .unit("cheap-gear", { types: ["gear"], owner: "A", controller: "A", energy: 1 })
    .build();
  // Isolate the merged kill body: effect.token still has no Gold definition, so the
  // composite body cannot execute as a whole yet (see the todo below).
  kernel.setTargets(TARGET_ID, [kernel.ref("cheap-gear")]);
  kernel.setAnswers({ [MAY_ID + "/optional"]: true });
  const outcome = resolveChainBody([{ ...mayKill, args: { ...mayKill.args, body: { kind: "constant", value: [killInstruction] } } }], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(resultFor(outcome, KILL_ID).result.status, "executed");
  assert.deepEqual(kernel.events.map((event) => event.action), ["kill"]);
  assert.equal(kernel.getObject("cheap-gear").zone, "trash");
  assert.deepEqual(resultFor(outcome, KILL_ID).result.linkedValues.killed, [
    { id: "cheap-gear", zoneEntryId: 1 }
  ]);

  // The program's own may node keeps both instructions in its body.
  assert.deepEqual(mayKill.args.body.value.map((instruction) => instruction.op), [
    "effect.kill",
    "effect.token"
  ]);
});

test("sfd-074-221 Pickpocket golden: declining skips the kill and leaves the gear on the Board", () => {
  const kernel = world()
    .unit("pickpocket", { might: 3 })
    .unit("kept-gear", { types: ["gear"], owner: "A", controller: "A", energy: 1 })
    .build();
  const outcome = resolveWith(kernel, { gearRef: kernel.ref("kept-gear"), accepted: false });

  // No child executes: the Gold token's missing definition would otherwise be
  // reached, so refusal is the path that leaves the declared body untouched.
  assert.deepEqual(outcome.results.map((entry) => entry.id), [MAY_ID]);
  assert.equal(resultFor(outcome, MAY_ID).result.status, "negated");
  assert.equal(resultFor(outcome, MAY_ID).result.reason, "skipped");
  assert.equal(kernel.getObject("kept-gear").zone, "board");
  assert.deepEqual(outcome.events, []);
});

test("sfd-074-221 Pickpocket kill receipt: only a successful kill reaches the original Gold instruction", () => {
  const kernel = world()
    .unit("pickpocket", { might: 3 })
    .unit("cheap-gear", { types: ["gear"], energy: 1 })
    .build();
  const gearRef = kernel.ref("cheap-gear");
  const outcome = resolveWith(kernel, { gearRef, accepted: true });

  assert.equal(resultFor(outcome, KILL_ID).result.status, "executed");
  assert.deepEqual(resultFor(outcome, KILL_ID).result.linkedValues.killed, [gearRef]);
  assert.equal(kernel.getObject("cheap-gear").zone, "trash");
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill", "create-token", "play"]);
  // 187.5 / 185.2.a: the successful Kill receipt opens the original Gold body.
  const [gold] = kernel.query({ type: "gear" }).filter((object) => object.isToken);
  assert.ok(gold);
  assert.equal(gold.name, "Gold");
  assert.deepEqual(gold.location, { type: "base", player: "A" });
  assert.equal(resultFor(outcome, TOKEN_ID).result.status, "executed");
  assert.equal(outcome.linkedValues[`${MAY_ID}/${TOKEN_ID}.goldToken`].amount, 1);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.pendingItems, []);
});

for (const actionOutcome of ["replaced", "prevented", "impossible"]) {
  test(`sfd-074-221 Pickpocket kill receipt: ${actionOutcome} kill does not reach Gold`, () => {
    const kernel = world()
      .unit("pickpocket", { might: 3 })
      .unit("cheap-gear", { types: ["gear"], energy: 1 })
      .build();
    kernel.addReplacement((action) => action.type === "kill" ? actionOutcome : null);
    const outcome = resolveWith(kernel, { gearRef: kernel.ref("cheap-gear"), accepted: true });

    const killed = resultFor(outcome, KILL_ID).result;
    assert.equal(killed.status, "negated");
    assert.equal(killed.reason, actionOutcome === "replaced" ? "replaced" : "impossible");
    assert.equal(killed.linkedValues, undefined);
    assert.equal(kernel.getObject("cheap-gear").zone, "board");
    assert.deepEqual(outcome.events.map((event) => [event.action, event.outcome]), [["kill", actionOutcome]]);
    assert.deepEqual(resultFor(outcome, TOKEN_ID).result, {
      status: "ignored", reason: "mistargeted"
    });
    assert.equal(outcome.linkedValues[`${MAY_ID}/${KILL_ID}.killed`], undefined);
    assert.equal(outcome.linkedValues[`${MAY_ID}/${TOKEN_ID}.goldToken`], undefined);
    assert.equal(outcome.status, "partial");
    assert.deepEqual(kernel.pendingItems, []);
    assert.equal(kernel.objects.some((object) => object.isToken), false);
  });
}

test("sfd-074-221 Pickpocket kill receipt: a stale target leaves the gear in hand and never reaches Gold", () => {
  const kernel = world()
    .unit("pickpocket", { might: 3 })
    .unit("cheap-gear", { types: ["gear"], energy: 1 })
    .build();
  const gearRef = kernel.ref("cheap-gear");
  assert.equal(kernel.perform({ type: "return-to-hand", object: gearRef }).status, "done");
  assert.equal(kernel.object(gearRef), null);
  const outcome = resolveWith(kernel, { gearRef, accepted: true });

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => entry.id), [MAY_ID]);
  assert.deepEqual(resultFor(outcome, MAY_ID).result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("cheap-gear").zone, "hand");
  assert.deepEqual(outcome.linkedValues, {});
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.pendingItems, []);
  assert.equal(kernel.objects.some((object) => object.isToken), false);
});

test("sfd-074-221 Pickpocket golden: the declared kill instruction kills its locked gear (CR 429)", () => {
  const kernel = world().unit("enemy-gear", { types: ["gear"], owner: "B", controller: "B", energy: 4 }).build();
  const run = runInstruction(
    kill,
    { target: TARGET_ID },
    { world: kernel, targets: { [TARGET_ID]: [kernel.ref("enemy-gear")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["kill"]);
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.deepEqual(run.linked.killed, [{ id: "enemy-gear", zoneEntryId: 1 }]);
});

test.todo(
  "sfd-074-221 Pickpocket: enforce 'a gear with Energy cost no more than 1' as a working target restriction " +
    "(CR 206 printed-cost comparison; programs/filters.ts rejects costEnergyLte and the target filter has no cost consumer)"
);
test.todo(
  "sfd-074-221 Pickpocket: play a Gold gear token exhausted — CR 187.5 Gold definition and " +
    "the 184.1/185.2.d exhausted entry stipulation remain unsupported by effect.token"
);
