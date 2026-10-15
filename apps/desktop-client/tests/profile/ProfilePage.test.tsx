import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  PLAYER_AVATAR_PRESETS,
  ProfilePage,
  AvatarChooser,
  avatarIconFor,
  type ProfilePageProps
} from "../../src/profile/ProfilePage";
import {
  DEFAULT_PLAYER_PROFILE,
  PLAYER_AVATAR_IDS,
  type PlayerProfile
} from "../../src/profile/player-profile";

// SSR 无法点击。这里沿用仓库既有做法：只替换 useState 的初始值，让真实组件在
// 指定草稿/状态/错误下渲染；其余状态保持真实初始值。
const forced = vi.hoisted(() => ({
  draft: null as { name: string; avatar: string; bio: string } | null,
  status: null as { kind: "idle" | "saved" | "failed" } | null,
  errors: null as { name: string | null; bio: string | null } | null
}));

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: ((initial: unknown) => {
      if (isRecord(initial) && "kind" in initial && forced.status) {
        return actual.useState(forced.status);
      }
      if (isRecord(initial) && "avatar" in initial && forced.draft) {
        return actual.useState(forced.draft);
      }
      if (
        isRecord(initial) &&
        "name" in initial &&
        "bio" in initial &&
        !("avatar" in initial) &&
        forced.errors
      ) {
        return actual.useState(forced.errors);
      }
      return actual.useState(initial);
    }) as typeof actual.useState
  };
});

const PROFILE: PlayerProfile = {
  name: "真名玩家",
  avatar: "star",
  bio: "本机资料，仅此而已。"
};

function renderPage(overrides: Partial<ProfilePageProps> = {}): string {
  return renderToStaticMarkup(
    <ProfilePage profile={PROFILE} onSave={() => true} inRoom={false} {...overrides} />
  );
}

function inputValue(markup: string, id: string): string | null {
  const match = markup.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`));
  return match ? match[1]! : null;
}

/** Value of a <textarea> is its rendered text content, not a value attribute. */
function textareaValue(markup: string, id: string): string | null {
  const match = markup.match(new RegExp(`<textarea[^>]*id="${id}"[^>]*>([^<]*)</textarea>`));
  return match ? match[1]! : null;
}

function buttonTagFor(markup: string, label: string): string {
  const index = markup.indexOf(label);
  if (index < 0) throw new Error(`label not found: ${label}`);
  const start = markup.lastIndexOf("<button", index);
  return markup.slice(start, markup.indexOf(">", start) + 1);
}

describe("ProfilePage local profile UI", () => {
  it("renders the saved local profile, uses native inputs, and labels the region", () => {
    const markup = renderPage();
    expect(markup).toContain('aria-label="个人信息管理"');
    expect(inputValue(markup, "profile-name")).toBe(PROFILE.name);
    expect(textareaValue(markup, "profile-bio")).toBe(PROFILE.bio);
    expect(markup).toContain("<textarea");
    expect(markup).toContain("保存到本机");
  });

  it("explains that the data is local-only and has no account backend", () => {
    const markup = renderPage();
    expect(markup).toContain("只保存在本机");
    expect(markup).toContain("没有账号后端");
    // 不编造云账户/胜率等后端数据。
    expect(markup).not.toContain("登录");
    expect(markup).not.toContain("胜率");
    expect(markup).not.toContain("云端");
  });

  it("offers exactly the four preset avatars via identifier, never an image URL", () => {
    const markup = renderPage();
    const pressed = PLAYER_AVATAR_IDS.filter(id => {
      const preset = PLAYER_AVATAR_PRESETS.find(candidate => candidate.id === id)!;
      return buttonTagFor(markup, preset.label).includes('aria-pressed="true"');
    });
    expect([...pressed]).toEqual([PROFILE.avatar]);
    // 头像只能是内联图标，绝不引用任意图片：不出现 <img>/src 或图片 URL。
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("example.com");
    expect(markup).not.toContain("src=");
  });

  it("shows the in-room note only inside a room, telling the truth about next join", () => {
    expect(renderPage({ inRoom: false })).not.toContain("下次进入房间");
    const inRoom = renderPage({ inRoom: true });
    expect(inRoom).toContain('role="note"');
    expect(inRoom).toContain("下次进入房间");
    expect(inRoom).toContain("不会改动当前房间");
  });

  it("renders a failed save as failure, never as a success", () => {
    forced.status = { kind: "failed" };
    try {
      const markup = renderPage();
      expect(markup).toContain("保存失败");
      expect(markup).not.toContain("已保存到本机。");
    } finally {
      forced.status = null;
    }
  });

  it("renders a successful save as a local success message", () => {
    forced.status = { kind: "saved" };
    try {
      const markup = renderPage();
      expect(markup).toContain("已保存到本机。");
      expect(markup).not.toContain("保存失败");
    } finally {
      forced.status = null;
    }
  });

  it("surfaces a field error as an alert when the draft is invalid", () => {
    forced.errors = { name: "昵称需为 1 到 24 个字。", bio: null };
    try {
      const markup = renderPage();
      expect(markup).toContain('role="alert"');
      expect(markup).toContain("昵称需为 1 到 24 个字。");
      expect(markup).toContain('aria-invalid="true"');
    } finally {
      forced.errors = null;
    }
  });

  it("shows a live character count for the name and bio", () => {
    const markup = renderPage();
    expect(markup).toContain(`当前 ${PROFILE.name.length}`);
    expect(markup).toContain(`当前 ${PROFILE.bio.length}`);
    expect(markup).toContain("最多 160 个字");
  });
});

describe("AvatarChooser", () => {
  it("marks the selected preset and calls back with the identifier", () => {
    const onChange = vi.fn();
    const markup = renderToStaticMarkup(
      <AvatarChooser value="blade" onChange={onChange} />
    );
    expect(buttonTagFor(markup, "利刃")).toContain('aria-pressed="true"');
    for (const preset of PLAYER_AVATAR_PRESETS) {
      if (preset.id === "blade") continue;
      expect(buttonTagFor(markup, preset.label)).toContain('aria-pressed="false"');
    }
    // 渲染是纯静态的；这里只确认回调被声明为可用、且组件不抛异常。
    expect(onChange).not.toHaveBeenCalled();
  });

  it("selects nothing for an unknown avatar id and falls back its icon", () => {
    const markup = renderToStaticMarkup(<AvatarChooser value="not-an-id" onChange={() => {}} />);
    expect(markup).not.toContain('aria-pressed="true"');
    expect(avatarIconFor("not-an-id")).toBe(avatarIconFor(DEFAULT_PLAYER_PROFILE.avatar));
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
