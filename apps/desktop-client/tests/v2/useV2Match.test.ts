import { describe, expect, it } from "vitest";
import { buildV2RoomUrl } from "../../src/hooks/useV2Match";

describe("useV2Match room URL", () => {
  it("binds the v2 route to the authenticated room without changing the server path", () => {
    expect(buildV2RoomUrl("ws://127.0.0.1:8787/ws", "room-7", {
      playerId: "alice",
      resumeToken: "resume-7"
    })).toBe("ws://127.0.0.1:8787/ws?roomId=room-7&playerId=alice&resumeToken=resume-7");
  });
});
