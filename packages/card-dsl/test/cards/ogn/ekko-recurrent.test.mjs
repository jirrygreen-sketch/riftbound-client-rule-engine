import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/ekko-recurrent.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [accelerate, deathknell, triggered] = program.abilities;
const c = value => ({ kind: "constant", value });

const rune = (id, extra = {}) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: `card:${id}`,
  name: id,
  types: ["rune"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "rune-deck",
  location: null,
  might: null,
  energy: null,
  power: null,
  exhausted: true,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...extra
});

test("Ekko, Recurrent program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Ekko, Recurrent identity and judge-required reason", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-20b19f69eca1bec8914d6f44145077493010be44bbcce72961eaa633e8a62bd2"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
      "[Deathknell] — Recycle me to ready your runes. (When I die, get the effect.)"
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("structure: [Accelerate] and [Deathknell] keyword declarations come first", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
});

test("structure: Deathknell body recycles me, then readies your runes", () => {
  assert.equal(triggered.kind, "triggered");
  // 808.1.c / 429.1.a.1.b：自身死亡触发在送入 Trash 前入链（object-killed）。
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-killed",
    filter: { role: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.deepEqual(
    triggered.body.map(instruction => instruction.id),
    ["ekko.recycle-me", "ekko.ready-runes"]
  );

  // 383.3.b："Recycle me" 是效果开头的前导费用，静态 IR 用 "self" 选择器。
  const [recycle] = triggered.body;
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "object-property",
    object: "self",
    property: "ref"
  });
  assert.equal(recycle.linkedTo, undefined);

  // 416.1："ready your runes" 是该区域的无选择集合查询（355.10.d）。
  const [ready] = [triggered.body[1]];
  assert.equal(ready.op, "effect.ready");
  assert.equal(ready.linkedTo, "ekko.recycle-me");
  assert.deepEqual(ready.args.objects, c({
    kind: "query",
    filter: { zone: "rune-zone", type: "rune", owner: "controller" }
  }));
});

test("golden: recycle me then ready your runes, leaving enemy runes exhausted", () => {
  const kernel = world()
    .unit("ekko", { might: 5 })
    .card("rune-a", { types: ["rune"], zone: "rune-zone", exhausted: true })
    .card("rune-b", { types: ["rune"], zone: "rune-zone", exhausted: true })
    .card("enemy-rune", { types: ["rune"], zone: "rune-zone", exhausted: true, owner: "B", controller: "B" })
    .deck(["deck:1", "deck:2"])
    .build();
  // 宿主与来源绑定：能力执行开始时提供宿主当前 zone-bound 引用（解释器不按 id 重绑），
  // 并把"来源"设为 Ekko 自己的快照（object-killed 触发时来源已离场，这里用作 last-known）。
  const sourced = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  // "your runes" 里的 owner 是选择管线占位符（190.6.d 的 implied "you"）：静态 IR 写
  // "controller"，由 Finalize/选择管线绑定成实际玩家。参考测试内核按值比较，不解析该
  // 占位符，所以这里像 assembly-rig 的 golden 一样把它替换成具体玩家后才执行。
  const body = [
    triggered.body[0],
    {
      ...triggered.body[1],
      args: {
        ...triggered.body[1].args,
        objects: c({
          kind: "query",
          filter: { zone: "rune-zone", type: "rune", owner: "A" }
        })
      }
    }
  ];
  const outcome = resolveChainBody(body, sourced);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => ({ id: result.id, status: result.result.status })),
    [
      { id: "ekko.recycle-me", status: "executed" },
      { id: "ekko.ready-runes", status: "executed" }
    ]
  );

  // "Recycle me" 把我从 board 放到牌库底（417.1）。
  assert.equal(sourced.getObject("ekko").zone, "deck");
  assert.deepEqual(sourced.objectsInZone("A", "deck").map(ref => ref.id).slice(-1), ["ekko"]);

  // "ready your runes"：只重置己方的符文。
  assert.equal(sourced.getObject("rune-a").exhausted, false);
  assert.equal(sourced.getObject("rune-b").exhausted, false);
  assert.equal(sourced.getObject("enemy-rune").exhausted, true);
});

test("golden: with no exhausted rune the ready instruction still executes with zero objects", () => {
  const kernel = world()
    .unit("ekko", { might: 5 })
    .deck(["deck:1"])
    .build();

  const sourced = kernel.clone({ sourceSnapshot: kernel.getObject("ekko") });
  const outcome = resolveChainBody(
    [
      triggered.body[0],
      {
        ...triggered.body[1],
        args: {
          ...triggered.body[1].args,
          objects: c({
            kind: "query",
            filter: { zone: "rune-zone", type: "rune", owner: "A" }
          })
        }
      }
    ],
    sourced
  );

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(outcome.results[1].result.linkedValues.readied.count, 0);
});

test.todo(
  "Ekko, Recurrent: the registered Deathknell KeywordDef still needs its trigger.leave/object-killed " +
    "consumer — subscribing object-killed through the keyword " +
    "registry, removing the pending item when the death is replaced (808.1.d.1), and recording " +
    "last-known information before the trash move (808.1.d.3)"
);

test.todo(
  "Ekko, Recurrent: the registered Accelerate KeywordDef still needs cost.modify/cost.pay and the entry " +
    "replacement pipeline (RIFT-261) — the optional " +
    "{1 energy + 1 Mind power} additional cost and the enter-ready replacement (805.2.b / 805.6)"
);

test.todo(
  "Ekko, Recurrent: the card-program adapter must parse the leading 'Recycle me' instruction into the " +
    "triggered ability's base cost at Finalize (CR 383.3.b.1), so the trigger only enters the chain " +
    "once the cost is paid (RIFT-257)"
);
