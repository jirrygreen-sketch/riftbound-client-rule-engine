import { describe, expect, it } from "vitest";
import type { FinalizedCostPlan, PowerPaymentSource } from "../../../../packages/engine-core/dist/effects/contract.js";
import { EngineRuntimeHost } from "../../src/engine-runtime/host.js";

function host() {
  return new EngineRuntimeHost({ A: "A", B: "B" }, request => {
    throw new Error(`unexpected choice ${request.id}`);
  });
}

function gain(state: EngineRuntimeHost, power: readonly PowerPaymentSource[], player = "A") {
  return state.perform({ type: "gain-power", player, power });
}

function pay(state: EngineRuntimeHost, plan: FinalizedCostPlan, player = "A") {
  return state.perform({ type: "pay", player, plan });
}

describe("EngineRuntimeHost Universal Power", () => {
  it("holds Universal Power and consumes it for named and [A] plans exactly once", () => {
    const state = host();
    expect(gain(state, ["Order", "universal"]).status).toBe("done");
    expect(pay(state, { finalized: true, power: ["Order"], universalPower: 1 }).status).toBe("done");
    expect(state.player("A").power).toEqual([]);

    expect(gain(state, ["any"]).status).toBe("done");
    expect(pay(state, { finalized: true, universalPower: 1 }).status).toBe("done");
    expect(state.player("A").power).toEqual([]);
  });

  it("rejects missing Universal Power atomically without spending Energy or named Power", () => {
    const state = host();
    state.perform({ type: "gain-energy", player: "A", amount: 2 });
    gain(state, ["Order"]);
    const before = state.checkpoint();
    expect(pay(state, {
      finalized: true, energy: 1, power: ["Order"], universalPower: 1,
    }).status).toBe("prevented");
    expect(state.checkpoint()).toEqual(before);
    expect(state.player("A")).toMatchObject({ energy: 2, power: ["Order"] });
  });

  it("keeps the existing named-domain path and checkpoint/restore behavior unchanged", () => {
    const state = host();
    gain(state, ["Order", "Order", "Mind"]);
    const before = state.checkpoint();
    expect(pay(state, { finalized: true, power: ["Order", "Order"] }).status).toBe("done");
    expect(state.player("A").power).toEqual(["Mind"]);
    state.restore(before);
    expect(state.player("A").power).toEqual(["Order", "Order", "Mind"]);
  });

  it("rejects malformed or unknown Power sources without partial mutation", () => {
    const state = host();
    const before = state.checkpoint();
    expect(state.perform({
      type: "gain-power", player: "A", power: ["Unknown"] as never,
    }).status).toBe("impossible");
    expect(state.checkpoint()).toEqual(before);
  });
});
