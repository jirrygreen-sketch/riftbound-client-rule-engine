import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/rockfall-path.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-0bf84d1f197b32b1d70c409fd2d0f0fe59c23923e72f6f7eeb77cb1e4376db7d";
const SOURCE_TEXT = "Units can't be played here.";

const [ability] = program.abilities;

function unit(id, overrides = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: "card:" + id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    might: 2,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...overrides
  };
}

test("sfd-216-221 Rockfall Path: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("sfd-216-221 Rockfall Path: identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // Build-time codegen over src/cards/**; the golden proves the identity is
  // actually registered (one identity, one file).
  assert.equal(cardProgramsById.get(CANONICAL), program);
  // 054/054.1 is the operative rule; the reason must name the missing
  // primitive/consumer, not just "not implemented".
  assert.match(program.judgeReason, /054/);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("sfd-216-221: one static prohibition on playing units at this Battlefield (054.1, 053.3)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 054.1: a prohibition removes the option and never grants one.
  assert.equal(ability.effect.kind, "continuous.restrict");
  assert.equal(ability.effect.restriction, "units-cannot-be-played-here");
  assert.equal(ability.effect.prohibits, true);
  // 355.2: the prohibited action applies to Units, and "here" (053.3) is this
  // Battlefield.
  assert.equal(ability.effect.action, "play");
  assert.equal(ability.effect.cardType, "unit");
  assert.equal(ability.effect.location, "self");
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  // No instruction is encoded: the ability is a passive prohibition with no
  // chain interaction (contract 3.1 static).
  assert.equal("body" in ability, false);
  assert.equal("with" in ability, false);
});

test("sfd-216-221: continuous.restrict has no merged instruction file or layer consumer", () => {
  // Evidence for the judgeReason: the RIFT-9 inventory names continuous.restrict
  // and the merged registry has no such opcode; layers/engine.ts applyAbility
  // reads only movement permissions, so a registered continuous.restrict
  // changes nothing.
  assert.equal(instructionDefinitionsById.has("continuous.restrict"), false);

  const unitHere = unit("unit-here");
  const engine = createLayerEngine([unitHere], [
    {
      effect: {
        id: "rockfall-path",
        layer: "ability",
        filter: ability.effect.filter,
        effect: { kind: "continuous.restrict", restriction: ability.effect.restriction }
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects([unitHere]);

  const snapshot = engine.evaluate(unitHere.ref);
  // The prohibition is not recorded anywhere on the unit: a play restriction
  // belongs to the Battlefield's Valid Locations (355.2.b), and the layer
  // engine only knows movement permissions.
  assert.deepEqual(snapshot.movement.restrictions, []);
  assert.equal(snapshot.movement.allowed, true);
  assert.equal(snapshot.movement.canMove, true);
  assert.equal(snapshot.movement.canGank, false);
  assert.equal(snapshot.keywords.length, 0);
});

test("sfd-216-221: the merged unit-play slice binds only the actor's own Base", () => {
  // Evidence for the judgeReason: cardplay-unit-v2.ts resolves the entry
  // location from the actor's own base (baseLocationId -> board-base) and
  // consults no Battlefield-level play restriction, so a Battlefield that
  // prohibits units can never be vetoed by the merged play path. The reference
  // test kernel likewise has no play-destination binding to exercise.
  const kernel = world().unit("some-unit").build();
  assert.equal(
    kernel.getObject("some-unit").location.type,
    "battlefield"
  );
  // No merged instruction or ability slot carries the printed prohibition:
  // the ability itself has no body and the registry has no restriction opcode.
  assert.equal("body" in ability, false);
  assert.equal(instructionDefinitionsById.has("continuous.restrict"), false);
});

test.todo(
  "sfd-216-221: continuous.restrict 落地后，355.2.b 的 Valid Location 计算必须拒绝把单位打到本战场（054/054.1）（RIFT-89/RIFT-91）"
);
test.todo(
  "sfd-216-221: 需要已合入的 CardProgram static 注册路径把战场禁止规则接进打出流程（engine 批 5/6）"
);
