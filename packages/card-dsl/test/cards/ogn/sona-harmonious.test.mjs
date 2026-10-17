import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/sona-harmonious.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";


test("ogn-073-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-dfe8783713db3f1121fbe8f02d18a936119747140a56f3207d218839b579f070");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /383.2.a.1|up to 4/);
  assert.match(program.judgeReason, /EventPattern|事件词表|turn-end/);
  assert.equal(program.sourceText, "While I'm at a battlefield, ready 4 friendly runes at the end of your turn.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

const [triggered] = program.abilities;
const readyRunes = triggered.body[0];

test("Sona: your turn-end trigger checks battlefield presence before entering the chain", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.deepEqual(triggered.trigger, { at: "turn-end", filter: { event: "turn-end", player: "self" }, condition: { kind: "compare", left: { kind: "count", subject: "objects", filter: { object: "self", zone: "battlefield" } }, operator: "gte", right: { kind: "constant", value: 1 } } });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
  assert.equal(readyRunes.condition, undefined);
  assert.equal(readyRunes.linkedTo, undefined);
});

test("Sona: preserve the catalog's four-rune target count and record the CR up-to discrepancy", () => {
  assert.equal(readyRunes.op, "effect.ready");
  assert.deepEqual(readyRunes.args, { objects: { kind: "constant", value: { kind: "target", id: "friendly-runes" } }, amount: { kind: "constant", value: 4 } });
  assert.deepEqual(readyRunes.targets, [{ id: "friendly-runes", filter: { type: "rune", zone: "rune-zone", controller: "controller" }, min: 4, max: 4, selection: "any" }]);
  assert.match(program.judgeReason, /ready 4.*ready up to 4/);
});

test("Sona golden subeffect: ready the four finalized runes, leave enemy runes untouched", () => {
  const builder = world().unit("sona", { might: 4 });
  for (let i = 1; i <= 4; i++) builder.object(`rune-${i}`, { types: ["rune"], zone: "rune-zone", exhausted: true });
  const kernel = builder.object("enemy-rune", { owner: "B", types: ["rune"], zone: "rune-zone", exhausted: true }).build();
  const selected = [1, 2, 3, 4].map(i => kernel.ref(`rune-${i}`));
  const run = runInstruction(ready, readyRunes.args, { world: kernel, targets: { "friendly-runes": selected } });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.readied, { count: 4, objects: selected });
  for (let i = 1; i <= 4; i++) assert.equal(kernel.getObject(`rune-${i}`).exhausted, false);
  assert.equal(kernel.getObject("enemy-rune").exhausted, true);
  assert.deepEqual(run.events.map(event => event.action), ["ready", "ready", "ready", "ready"]);
});

test("Sona golden subeffect: already-ready runes produce no extra ready event", () => {
  const builder = world().unit("sona", { might: 4 });
  for (let i = 1; i <= 4; i++) builder.object(`rune-${i}`, { types: ["rune"], zone: "rune-zone", exhausted: i !== 4 });
  const kernel = builder.build();
  const run = runInstruction(ready, readyRunes.args, { world: kernel, targets: { "friendly-runes": [1, 2, 3, 4].map(i => kernel.ref(`rune-${i}`)) } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 3);
  assert.equal(run.events.length, 3);
});

test("Sona golden subeffect: no surviving finalized rune targets means ignored", () => {
  const kernel = world().unit("sona", { might: 4 }).build();
  const run = runInstruction(ready, readyRunes.args, { world: kernel, targets: { "friendly-runes": [] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
});

test.todo("Sona: resolve ready-4 vs up-to-4 source discrepancy against CR 383.2.a.1 before accepting optional fewer-rune selection");
test.todo("Sona: resolve the printed four-rune wording against the CR up-to-four example and admit a controller-scoped turn-end trigger in the EventPattern contract");
