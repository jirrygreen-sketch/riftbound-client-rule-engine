import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/ocean-drake.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-772fd552ac23dc61d1d65dfaf1aeda496e923d75ef3ee6143e56f48de0ebc165";
const SOURCE_TEXT =
  "You may play me to an open battlefield.\n" +
  "When you play me, you may return a non-Dragon unit to its owner's hand.";

const [permission, onPlay] = program.abilities;
const [returnChoice] = onPlay.body;
const [returnUnit] = returnChoice.args.body.value;

test("ven-115-166 Ocean Drake: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-115-166 Ocean Drake: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 打出位置许可与否定 tag 过滤两处缺口。
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /355\.2\.b/);
  assert.match(program.judgeReason, /excludeTags/);
});

test("ven-115-166 Ocean Drake: the extra play location is a static open-battlefield permission", () => {
  // 355.2.b 的额外位置许可；170.11.a/170.11.c 定义 "open" = 未占据且未控制。
  assert.equal(permission.kind, "static");
  assert.equal(permission.effect.kind, "play-location-permission");
  assert.equal(permission.effect.duration, "while-in-hand");
  assert.deepEqual(permission.effect.value, {
    kind: "constant",
    value: {
      zone: "battlefield",
      battlefield: { open: true },
      appliesTo: "self"
    }
  });
  assert.equal(permission.condition, undefined);
});

test("ven-115-166 Ocean Drake: the play trigger wraps the return in a choice.optional", () => {
  // 383.4.a.1：Play Effect —— card-played 时点过滤来源自身。
  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(onPlay.optional, false);

  // 契约 3.9："you may return …" 是被选指令包在 body 里的可选效果。
  assert.equal(onPlay.body.length, 1);
  assert.equal(returnChoice.op, "choice.optional");
  assert.equal(returnChoice.args.body.kind, "constant");
  assert.deepEqual(
    returnChoice.args.body.value.map((instruction) => [instruction.id, instruction.op]),
    [["ocean-drake.return-unit", "effect.zone"]]
  );
  assert.equal(returnChoice.linkedTo, undefined);
});

test("ven-115-166 Ocean Drake: the return targets a non-Dragon unit and sends it to its owner's hand", () => {
  // 355.7/355.9.a："a non-Dragon unit" 是玩家选定的目标；133.8 的 tag 排除只能以
  // excludeTags 占位（当前匹配器不读该键，故整卡保持 judge-required）。
  assert.deepEqual(returnUnit.targets, [
    {
      id: "ocean-drake.non-dragon-unit",
      filter: {
        type: "unit",
        zone: "board",
        excludeTags: ["Dragon"]
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.deepEqual(returnUnit.args.target, {
    kind: "constant",
    value: "ocean-drake.non-dragon-unit"
  });
  // 126/108.7：目的地是拥有者的手牌，owner 路由由动作层负责。
  assert.deepEqual(returnUnit.args.to, { kind: "constant", value: "hand" });
  assert.equal(returnUnit.linkedTo, undefined);
});

test("ven-115-166 Ocean Drake golden: accepting returns the chosen unit to its owner's hand", () => {
  // 126：回手的对象属于其**拥有者**，不是控制者。
  const base = world()
    .player("controller")
    .player("opponent")
    .unit("drake", {
      controller: "controller",
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("dragon", {
      owner: "opponent",
      controller: "opponent",
      location: { type: "battlefield", id: "bf-1" },
      tags: ["Dragon"]
    })
    .unit("enemy-soldier", {
      owner: "opponent",
      controller: "opponent",
      location: { type: "battlefield", id: "bf-1" },
      tags: ["Noxus"]
    })
    .build();
  const kernel = base.clone({
    controller: "controller",
    sourceSnapshot: base.getObject("drake")
  });
  kernel.setTargets("ocean-drake.non-dragon-unit", [kernel.ref("enemy-soldier")]);
  kernel.setAnswers({ "ocean-drake.may-return/optional": true });

  const outcome = resolveChainBody(onPlay.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["ocean-drake.return-unit", "executed"],
      ["ocean-drake.may-return", "executed"]
    ]
  );
  assert.deepEqual(kernel.zone("opponent", "hand").map((ref) => ref.id), ["enemy-soldier"]);
  assert.deepEqual(kernel.zone("controller", "hand"), []);
  assert.deepEqual(
    kernel.events.map((event) => event.action),
    ["return-to-hand"]
  );
});

test("ven-115-166 Ocean Drake golden: declining returns nothing", () => {
  const base = world()
    .player("controller")
    .player("opponent")
    .unit("drake", { controller: "controller" })
    .unit("enemy-soldier", {
      owner: "opponent",
      controller: "opponent",
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const kernel = base.clone({
    controller: "controller",
    sourceSnapshot: base.getObject("drake")
  });
  kernel.setTargets("ocean-drake.non-dragon-unit", [kernel.ref("enemy-soldier")]);
  kernel.setAnswers({ "ocean-drake.may-return/optional": false });

  const outcome = resolveChainBody(onPlay.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => entry.id), ["ocean-drake.may-return"]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.zone("opponent", "hand"), []);
  assert.deepEqual(outcome.events, []);
});

test("ven-115-166 Ocean Drake golden: a stale target ignores only the return instruction", () => {
  // 359.3.e.7：目标在结算时全部失效 → 该指令 ignored（拒绝路径仍是 skipped）。
  const base = world()
    .player("controller")
    .player("opponent")
    .unit("drake", { controller: "controller" })
    .unit("enemy-soldier", {
      owner: "opponent",
      controller: "opponent",
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const stale = base.ref("enemy-soldier");
  base.perform({ type: "return-to-hand", object: stale });
  const kernel = base.clone({
    controller: "controller",
    sourceSnapshot: base.getObject("drake")
  });
  kernel.setTargets("ocean-drake.non-dragon-unit", [stale]);
  kernel.setAnswers({ "ocean-drake.may-return/optional": true });

  const outcome = resolveChainBody(onPlay.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
});

test.todo(
  "ven-115-166 Ocean Drake: 'You may play me to an open battlefield' reaches the Make Relevant Choices / " +
    "Finalize play-location permission (CR 355.2.a/355.2.b; open = unoccupied + uncontrolled, 170.11.a/170.11.c) " +
    "— programs/statics.ts needs a play-location-permission mapping and the play Finalize consumer (RIFT-357)"
);

test.todo(
  "ven-115-166 Ocean Drake: 'a non-Dragon unit' filters by excluding the Dragon tag (CR 133.8/133.8.a) — " +
    "ObjectFilter and every matcher only support positive tags, so the placeholder excludeTags key is not read " +
    "(contract change request); nested optional targets also need the Finalize target lifecycle"
);
