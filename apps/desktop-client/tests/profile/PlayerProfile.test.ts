import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYER_PROFILE,
  MAX_BIO_LENGTH,
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  PLAYER_AVATAR_IDS,
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORAGE_KEY,
  isPlayerAvatarId,
  playerAvatarLabel,
  playerProfileEquals,
  readPlayerProfile,
  sanitizePlayerProfile,
  serializePlayerProfile,
  validatePlayerProfile,
  writePlayerProfile,
  type PlayerProfile
} from "../../src/profile/player-profile";

const PROFILE: PlayerProfile = {
  name: "真名玩家",
  avatar: "star",
  bio: "本机资料，仅此而已。"
};

describe("player profile storage key", () => {
  it("uses its own key, independent of the named library and ui preferences", () => {
    expect(PROFILE_STORAGE_KEY).toBe("riftbound.desktop-client.player-profile.v1");
    expect(PROFILE_STORAGE_KEY).not.toBe("riftbound.desktop-client.deck-library.v1");
    expect(PROFILE_STORAGE_KEY).not.toBe("riftbound.desktop-client.ui-preferences.v1");
    expect(PROFILE_STORAGE_KEY).not.toBe("riftbound.desktop-client.deck");
    expect(PROFILE_SCHEMA_VERSION).toBe(1);
  });

  it("stores only local profile fields and never a token, session, ready or deck", () => {
    const serialized = serializePlayerProfile(PROFILE);
    for (const forbidden of [
      "token",
      "resumeToken",
      "session",
      "ready",
      "deck",
      "fingerprint",
      "password",
      "win"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("player profile read tolerance", () => {
  it("returns the default profile for null storage and for missing keys", () => {
    expect(readPlayerProfile(null)).toEqual(DEFAULT_PLAYER_PROFILE);
    expect(readPlayerProfile(new MemoryStorage())).toEqual(DEFAULT_PLAYER_PROFILE);
  });

  it("never throws on malformed JSON and degrades to the default", () => {
    const storage = new MemoryStorage();
    storage.setItem(PROFILE_STORAGE_KEY, "{ not json ");
    expect(readPlayerProfile(storage)).toEqual(DEFAULT_PLAYER_PROFILE);
  });

  it("rejects a wrong schema version and a non-object payload", () => {
    const wrongSchema = new MemoryStorage();
    wrongSchema.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 999, name: "其他", avatar: "star", bio: "x" })
    );
    expect(readPlayerProfile(wrongSchema)).toEqual(DEFAULT_PLAYER_PROFILE);

    const arrayPayload = new MemoryStorage();
    arrayPayload.setItem(PROFILE_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(readPlayerProfile(arrayPayload)).toEqual(DEFAULT_PLAYER_PROFILE);
  });

  it("falls back field by field instead of dropping the whole profile", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: PROFILE_SCHEMA_VERSION,
        name: "",
        avatar: "https://example.com/a.png", // 任意图片 URL 不允许
        bio: 42
      })
    );
    const profile = readPlayerProfile(storage);
    expect(profile.name).toBe(DEFAULT_PLAYER_PROFILE.name);
    expect(profile.avatar).toBe(DEFAULT_PLAYER_PROFILE.avatar);
    expect(profile.bio).toBe(DEFAULT_PLAYER_PROFILE.bio);
  });

  it("keeps valid fields while clamping a too-long stored name and bio", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: PROFILE_SCHEMA_VERSION,
        name: "x".repeat(MAX_NAME_LENGTH + 5),
        avatar: "leaf",
        bio: "y".repeat(MAX_BIO_LENGTH + 5)
      })
    );
    const profile = readPlayerProfile(storage);
    expect(profile.name).toBe(DEFAULT_PLAYER_PROFILE.name);
    expect(profile.avatar).toBe("leaf");
    expect(profile.bio).toBe(DEFAULT_PLAYER_PROFILE.bio);
  });

  it("recovers when storage itself throws on read", () => {
    expect(readPlayerProfile(new ThrowingReadStorage())).toEqual(DEFAULT_PLAYER_PROFILE);
  });
});

describe("player profile sanitize", () => {
  it("trims and keeps an in-range name/avatar/bio", () => {
    expect(sanitizePlayerProfile({ name: "  阿狸  ", avatar: "blade", bio: "  hi  " })).toEqual({
      name: "阿狸",
      avatar: "blade",
      bio: "hi"
    });
  });

  it("counts by code point, so a 24-char CJK name is allowed", () => {
    const name = "界".repeat(MAX_NAME_LENGTH);
    expect(sanitizePlayerProfile({ name, avatar: "rune", bio: "" }).name).toBe(name);
  });
});

describe("player profile validation", () => {
  it("accepts a valid draft and normalizes whitespace", () => {
    const result = validatePlayerProfile({ name: "  真名  ", avatar: "star", bio: "  本机签名  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: "真名", avatar: "star", bio: "本机签名" });
    }
  });

  it("rejects an empty or whitespace-only name at the 1..24 boundary", () => {
    for (const name of ["", "   ", "x".repeat(MAX_NAME_LENGTH + 1)]) {
      const result = validatePlayerProfile({ name, avatar: "rune", bio: "" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.name).not.toBeNull();
    }
    expect(MIN_NAME_LENGTH).toBe(1);
  });

  it("rejects a bio beyond 160 characters but allows an empty bio", () => {
    const tooLong = validatePlayerProfile({
      name: "真名",
      avatar: "rune",
      bio: "z".repeat(MAX_BIO_LENGTH + 1)
    });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.errors.bio).not.toBeNull();

    const empty = validatePlayerProfile({ name: "真名", avatar: "rune", bio: "   " });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value.bio).toBe("");
  });

  it("falls back to the default avatar for an unknown identifier", () => {
    const result = validatePlayerProfile({ name: "真名", avatar: "unknown", bio: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.avatar).toBe(DEFAULT_PLAYER_PROFILE.avatar);
  });
});

describe("player profile write", () => {
  it("round-trips exactly, preserving the avatar identifier", () => {
    const storage = new MemoryStorage();
    expect(writePlayerProfile(storage, PROFILE)).toBe(true);
    expect(readPlayerProfile(storage)).toEqual(PROFILE);
  });

  it("returns false for invalid input without writing anything", () => {
    const storage = new MemoryStorage();
    expect(writePlayerProfile(storage, { name: "", avatar: "rune", bio: "" })).toBe(false);
    expect(readPlayerProfile(storage)).toEqual(DEFAULT_PLAYER_PROFILE);
  });

  it("returns false for a null storage", () => {
    expect(writePlayerProfile(null, PROFILE)).toBe(false);
  });

  it("returns false when storage throws on write, so the UI cannot fake success", () => {
    expect(writePlayerProfile(new ThrowingWriteStorage(), PROFILE)).toBe(false);
  });
});

describe("player profile avatar identifiers", () => {
  it("only accepts the four fixed preset ids, never an image URL", () => {
    expect([...PLAYER_AVATAR_IDS]).toEqual(["rune", "blade", "star", "leaf"]);
    for (const id of PLAYER_AVATAR_IDS) expect(isPlayerAvatarId(id)).toBe(true);
    expect(isPlayerAvatarId("https://example.com/a.png")).toBe(false);
    expect(isPlayerAvatarId("RUNE")).toBe(false);
    expect(isPlayerAvatarId(1)).toBe(false);
  });

  it("labels every preset and degrades an unknown id to the default label", () => {
    for (const id of PLAYER_AVATAR_IDS) {
      expect(playerAvatarLabel(id).length).toBeGreaterThan(0);
    }
    expect(playerAvatarLabel("unknown")).toBe(playerAvatarLabel(DEFAULT_PLAYER_PROFILE.avatar));
  });
});

describe("player profile equality", () => {
  it("differs when any visible field changes and matches on identity", () => {
    expect(playerProfileEquals(PROFILE, { ...PROFILE })).toBe(true);
    expect(playerProfileEquals(PROFILE, { ...PROFILE, name: "别的" })).toBe(false);
    expect(playerProfileEquals(PROFILE, { ...PROFILE, avatar: "leaf" })).toBe(false);
    expect(playerProfileEquals(PROFILE, { ...PROFILE, bio: "改了" })).toBe(false);
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingReadStorage {
  getItem(): string | null {
    throw new Error("SecurityError");
  }

  setItem(): void {}
}

class ThrowingWriteStorage {
  getItem(): string | null {
    return null;
  }

  setItem(): void {
    throw new Error("QuotaExceededError");
  }
}
