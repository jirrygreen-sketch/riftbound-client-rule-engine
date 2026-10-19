import { describe, expect, test } from "vitest";
import { legacyFlow, routes } from "./legacy-flow.js";
import { optionalUnits } from "./scenarios.js";

/** These are legacy oracles, not passes of the new-kernel retirement gate. */
describe("optional Unit legacy observable command traces", () => {
  for (const unit of optionalUnits) for (const route of routes) {
    test.each(["pay", "decline"] as const)(`${unit.printingId} ${route.name}: %s`, async decision => {
      const flow = await legacyFlow(unit, route, decision);
      const { target, beforePlay, choice, prompt } = flow;
      const actor = () => flow.playing().match.players.find(player => player.playerId === "alice")!;
      const base = () => flow.playing().match.resources.bases.find(item => item.playerId === "alice")!;
      const pool = () => flow.playing().match.resources.players.find(item => item.playerId === "alice")!.runePool;
      const opened = flow.playing();
      expect(opened.match.stateVersion - beforePlay.match.stateVersion).toBe(route.physical ? 2 : 1);
      expect(opened.match.eventSeq - beforePlay.match.eventSeq).toBe(route.physical ? 2 : 1);
      // Only the physical route has the v1.5 Hand → Chain ordering. Do not
      // encode the current route's known ordering defect as a green oracle.
      if (route.physical) {
        expect(actor().hand!.some(card => card.uid === target.uid)).toBe(false);
        expect(opened.match.frame.chain).toMatchObject({ active: true, itemCount: 1, pendingCount: 1 });
      }
      expect(opened.match.board.units).toHaveLength(0);
      expect(opened.match.resources).toEqual(beforePlay.match.resources);
      expect(opened.match.scoring).toEqual(beforePlay.match.scoring);
      expect(prompt).toMatchObject({ kind: "optional-cost", minSelections: 1, maxSelections: 1 });
      expect(prompt.options.map(item => item.label)).toEqual(["支付额外费用", "不支付额外费用"]);
      expect(new Set(prompt.options.map(item => item.id)).size).toBe(2);
      for (const viewer of ["bob", null]) expect(flow.playing(viewer).match.frame.pendingChoice).toEqual({ active: true });
      expect(opened.actions.filter(action => action.enabled).map(action => action.kind)).toEqual(["answer-pending-choice"]);

      // Rejections exercise the genuine command guard, never a forged result DTO.
      const waiting = flow.views();
      expect(flow.send("alice", { type: "rune-energy", uid: base().baseRunes[0]!.uid }).result.ack.type).toBe("blocked");
      expect(flow.send("bob", flow.answer(decision)).result.ack.type).toBe("error");
      expect(flow.send("alice", flow.answer(decision), opened.match.stateVersion - 1).result.ack.type).toBe("error");
      expect(flow.send("alice", { type: "answer-pending-choice", choiceId: choice.choiceId,
        answers: [{ promptId: prompt.promptId, optionIds: ["foreign-option"] }] }).result.ack.type).toBe("error");
      expect(flow.views()).toEqual(waiting);
      flow.restart();

      const answered = flow.accepted("alice", flow.answer(decision));
      const pending = flow.playing().match.frame.pendingPayment;
      if (!pending?.paymentId || !pending.resolvedCost) throw new Error("Actual pending payment required");
      const cost = { energy: unit.energy + (decision === "pay" ? 1 : 0),
        power: decision === "pay" ? [{ allowedDomains: ["Fury"], amount: 1 }] : [] };
      expect(pending.resolvedCost).toEqual(cost);
      expect(flow.playing().match.board.units).toHaveLength(0);
      expect(flow.playing().match.resources).toEqual(beforePlay.match.resources);
      for (const viewer of ["bob", null]) expect(flow.playing(viewer).match.frame.pendingPayment).toEqual({ active: true });
      const afterAnswer = flow.views();
      expect(flow.duplicate("alice", answered.packet).ack).toEqual({ ...answered.result.ack, duplicate: true });
      expect(flow.views()).toEqual(afterAnswer);
      const early = flow.send("alice", { type: "pay-pending", paymentId: pending.paymentId });
      expect(early.result.ack.ok).not.toBe(true);
      expect(flow.views()).toEqual(afterAnswer);
      flow.restart();

      // Reserve a READY Fury Rune for Power. This also satisfies v1.5 164.2.b's
      // exhaust cost; historical tests sometimes recycled an exhausted Rune.
      const powerRune = decision === "pay" ? base().baseRunes.find(rune => rune.readied && rune.domain === "Fury") : null;
      if (decision === "pay" && !powerRune) throw new Error("Actual ready Fury Rune required");
      const beforeRunes = base().baseRunes.length;
      for (let index = 0; index < cost.energy; index++) {
        const energy = flow.playing().actions.find(action => action.kind === "rune-energy" && action.enabled && action.uid !== powerRune?.uid);
        if (!energy || energy.kind !== "rune-energy") throw new Error("Actual ready Energy Rune required");
        const funded = flow.accepted("alice", { type: "rune-energy", uid: energy.uid });
        expect(pool().energy).toBe(index + 1);
        expect(flow.playing().match.frame.pendingPayment?.resolvedCost).toEqual(cost);
        expect(flow.playing().match.board.units).toHaveLength(0);
        const snapshot = flow.views();
        expect(flow.duplicate("alice", funded.packet).ack).toEqual({ ...funded.result.ack, duplicate: true });
        expect(flow.views()).toEqual(snapshot);
      }
      if (powerRune) {
        flow.accepted("alice", { type: "rune-power", uid: powerRune.uid });
        expect(pool().power.Fury).toBe(1);
        expect(base().baseRunes.some(rune => rune.uid === powerRune.uid)).toBe(false);
      }
      expect(base().baseRunes).toHaveLength(beforeRunes - (decision === "pay" ? 1 : 0));
      const funded = flow.views();
      flow.restart();
      expect(flow.views()).toEqual(funded);
      const paid = flow.accepted("alice", { type: "pay-pending", paymentId: pending.paymentId });
      const completed = flow.playing();
      expect(completed.match.frame.pendingChoice).toBeNull();
      expect(completed.match.frame.pendingPayment).toBeNull();
      expect(completed.match.frame.chain.active).toBe(false);
      expect(completed.match.frame.execution.status).toBe("ready");
      expect(completed.match.board.units).toHaveLength(1);
      expect(completed.match.board.units[0]).toMatchObject({ objectId: target.uid, trait: { kind: "card", cardId: unit.printingId },
        readied: decision === "pay", locationId: base().locationId });
      expect(actor().hand!.some(card => card.uid === target.uid)).toBe(false);
      expect(pool().energy).toBe(0);
      expect(pool().power.Fury).toBe(0);
      expect(completed.match.scoring).toEqual(beforePlay.match.scoring);
      for (const viewer of ["bob", null]) {
        expect(flow.playing(viewer).match.board.units).toEqual(completed.match.board.units);
        expect(flow.playing(viewer).match.players.find(player => player.playerId === "alice")!.hand).toBeUndefined();
      }
      const settled = flow.views();
      expect(flow.duplicate("alice", paid.packet).ack).toEqual({ ...paid.result.ack, duplicate: true });
      expect(flow.views()).toEqual(settled);
      flow.restart();

      // The public facade exposes clocks, not PipelineEvent kinds. Preserve the
      // actual ordered wire commands here; new event-kind parity remains E12 TODO.
      expect(flow.acceptedCommandTypes).toEqual(["mulligan", "mulligan", ...Array.from({ length: unit.turn - 1 }, () => "end-turn"),
        "play-card", "answer-pending-choice", ...Array.from({ length: cost.energy }, () => "rune-energy"),
        ...(decision === "pay" ? ["rune-power"] : []), "pay-pending"]);
      // Scorcher replays seven normal turns at four checkpoints. Genuine
      // traces have reached 126s solo and timed out at 120-180s when the shared
      // runner was heavily loaded; retain every observation and give the longer
      // history its own time limit.
    }, unit.turn > 3 ? 600_000 : 480_000);
  }
});
