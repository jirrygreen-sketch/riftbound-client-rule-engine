import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/shard-of-undoing.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-6c9353964d68cf174354c551a4cf9b2c7ca9c3322303954f03d108f7f1bca840";
const SOURCE_TEXT =
  "The first time a friendly unit dies during your Beginning Phase each turn, " +
  "each opponent must kill one of their units.";

const [ability] = program.abilities;
const [killInstruction] = ability.body;
const opponentUnitsPick = killInstruction.picks[0];

test("unl-174-219 Shard of Undoing: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-174-219 Shard of Undoing: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Beginning Phase/);
  assert.match(program.judgeReason, /315\.2\.a\.1/);
  assert.match(program.judgeReason, /each opponent/);
  assert.match(program.judgeReason, /TriggerRegistration|阶段字段/);
});

test("unl-174-219 Shard of Undoing: a friendly unit's death subscribes to object-killed", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 429.1 / 429.2.a / 808.1.d：死亡观察点是 object-killed。
  assert.equal(ability.trigger.at, "object-killed");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-killed",
    // "a friendly unit"：死亡者由本能力控制者控制。
    object: { type: "unit", controller: "self" },
    // "during your Beginning Phase" 仍是待接入的阶段窗口谓词。
    duringPhase: "beginning"
  });
  assert.equal(ability.trigger.once, "per-turn");
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.optional, false);
});

test("unl-174-219 Shard of Undoing: 'each opponent must kill one of their units' is a non-target pick", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "shard-of-undoing.kill-opponent-units"
  ]);
  assert.equal(killInstruction.op, "effect.kill");
  // 355.10.e / 355.10.f：由其它玩家选定的对象不是目标。
  assert.deepEqual(killInstruction.args.picks, {
    kind: "constant",
    value: "shard-of-undoing.opponent-units"
  });
  assert.equal(killInstruction.args.self, undefined);
  assert.equal(killInstruction.args.count, undefined);
  assert.equal(killInstruction.targets, undefined);
  assert.equal(killInstruction.linkedTo, undefined);
  assert.deepEqual(opponentUnitsPick, {
    id: "shard-of-undoing.opponent-units",
    options: ["runtime:one-unit-per-opponent"],
    filter: { type: "unit", controller: "opponent" },
    min: 0,
    max: null,
    selection: "any"
  });
});

test("unl-174-219 Shard of Undoing: the forced kill executes through the interpreter with per-opponent picks", () => {
  const kernel = world()
    .unit("opponent-a", { owner: "B" })
    .unit("opponent-b", { owner: "B" })
    .unit("mine", { owner: "A" })
    .build();
  // 355.10.e：各对手自己选出一个单位；Finalize 锁定的 pick 由内核提供。
  kernel.setPicks("shard-of-undoing.opponent-units", [kernel.ref("opponent-a")]);
  const outcome = resolveChainBody([killInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // 429.1：被消灭的单位进入其拥有者的 Trash；未被选择的对手单位与己方单位不动。
  assert.equal(kernel.getObject("opponent-a").zone, "trash");
  assert.equal(kernel.getObject("opponent-b").zone, "board");
  assert.equal(kernel.getObject("mine").zone, "board");
  assert.deepEqual(kernel.events.map(event => event.action), ["kill"]);
});

test("unl-174-219 Shard of Undoing: effect.kill executes the chosen pick on the reference kernel", () => {
  const kernel = world().unit("victim", { owner: "B" }).build();
  const run = runInstruction(
    kill,
    { picks: "shard-of-undoing.opponent-units" },
    { world: kernel, picks: { "shard-of-undoing.opponent-units": [kernel.ref("victim")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("victim").zone, "trash");
  assert.equal(run.events.filter(event => event.action === "kill").length, 1);
});

test("unl-174-219 Shard of Undoing: a replaced kill does not report a false success (CR 359.2.c)", () => {
  const kernel = world().unit("victim", { owner: "B" }).build();
  kernel.addReplacement(action => (action.type === "kill" ? "replaced" : null));
  const run = runInstruction(
    kill,
    { picks: "shard-of-undoing.opponent-units" },
    { world: kernel, picks: { "shard-of-undoing.opponent-units": [kernel.ref("victim")] } }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "replaced");
  assert.equal(kernel.getObject("victim").zone, "board");
});

test.todo(
  "Shard of Undoing: restrict the trigger to deaths during the controller's Beginning Phase (CR 315.2) — " +
    "TriggerSpec/EventPattern carry no phase window predicate and ObjectSnapshot exposes no phase, so both " +
    "beginning-start and an unconditional once: 'per-turn' would be wrong approximations (contract change request)"
);
test.todo(
  "Shard of Undoing: bind 'each opponent must kill one of their units' per opponent (CR 355.10.e/f) — no " +
    "per-opponent chooser fan-out primitive is merged (RIFT-9 target.player family, same gap as ogn/kings-edict)"
);
