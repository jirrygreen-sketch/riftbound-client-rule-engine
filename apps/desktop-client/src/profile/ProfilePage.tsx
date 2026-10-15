import { useEffect, useRef, useState, type FormEvent } from "react";
import { Gem, Leaf, Save, Star, Sword, UserRound, type LucideIcon } from "lucide-react";
import {
  MAX_BIO_LENGTH,
  MAX_NAME_LENGTH,
  PLAYER_AVATAR_IDS,
  isPlayerAvatarId,
  playerAvatarLabel,
  playerProfileEquals,
  validatePlayerProfile,
  type PlayerProfile,
  type PlayerProfileValidation,
  type ProfileFieldErrors
} from "./player-profile";
import "./ProfilePage.css";

/** 预设头像：id 与图标一一对应，不依赖任何额外图片资源。 */
export interface PlayerAvatarPreset {
  readonly id: (typeof PLAYER_AVATAR_IDS)[number];
  readonly label: string;
  readonly icon: LucideIcon;
}

export const PLAYER_AVATAR_PRESETS: readonly PlayerAvatarPreset[] = [
  { id: "rune", label: "符文", icon: Gem },
  { id: "blade", label: "利刃", icon: Sword },
  { id: "star", label: "星辰", icon: Star },
  { id: "leaf", label: "新叶", icon: Leaf }
];

/** 头像标识对应的图标；未知标识回退到默认预设。 */
export function avatarIconFor(avatar: string): LucideIcon {
  const preset = PLAYER_AVATAR_PRESETS.find(candidate => candidate.id === avatar);
  return preset?.icon ?? PLAYER_AVATAR_PRESETS[0]!.icon;
}

export interface AvatarChooserProps {
  /** 当前选中的头像标识（受控）。 */
  value: string;
  /** 选择回调；只在点选合法预设时触发。 */
  onChange: (next: string) => void;
  /** 可选：禁用整组选择（例如保存进行中）。 */
  disabled?: boolean;
  /** 可选：radiogroup 的可访问名称。 */
  label?: string;
}

/**
 * 四种预设头像选择器（受控）。只暴露固定标识，不接受任意图片 URL，不需要任何
 * 额外图片依赖；每个按钮带 `aria-pressed` 与图标/文字标签，键盘可达。
 */
export function AvatarChooser({
  value,
  onChange,
  disabled = false,
  label = "选择头像"
}: AvatarChooserProps) {
  const selected = isPlayerAvatarId(value) ? value : null;
  return (
    <div className="profile-avatars" role="group" aria-label={label}>
      {PLAYER_AVATAR_PRESETS.map(preset => {
        const Icon = preset.icon;
        const active = preset.id === selected;
        return (
          <button
            key={preset.id}
            type="button"
            className={`profile-avatar ${active ? "active" : ""}`}
            aria-pressed={active}
            aria-label={preset.label}
            disabled={disabled}
            onClick={() => onChange(preset.id)}
          >
            <Icon size={22} aria-hidden />
            <span>{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface ProfilePageProps {
  /** 当前已保存的本机资料（唯一权威），界面草稿从它初始化。 */
  profile: PlayerProfile;
  /**
   * 保存回调。返回 `true` 才算真正落盘；返回 `false` 时界面必须显示失败，
   * 不得假装保存成功。
   */
  onSave: (next: PlayerProfile) => boolean;
  /** 是否处于房间内；用于人话提示「改名只影响下次进入房间」。 */
  inRoom: boolean;
}

const EMPTY_ERRORS: ProfileFieldErrors = { name: null, bio: null };

type SaveStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saved" }
  | { readonly kind: "failed" };

interface Draft {
  readonly name: string;
  readonly avatar: string;
  readonly bio: string;
}

function toDraft(profile: PlayerProfile): Draft {
  return { name: profile.name, avatar: profile.avatar, bio: profile.bio };
}

/**
 * 真正本机玩家资料页面：编辑昵称、预设头像与个人简介，提交后由父组件写入本机
 * 存储。这里只是纯 UI + 校验，没有任何账号后端、云登录或胜率展示。
 *
 * 房间内提示：改名只用于「下次进入房间」，不会改动当前房间里服务器已确认的
 * 权威玩家身份。
 */
export function ProfilePage({ profile, onSave, inRoom }: ProfilePageProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));
  const [errors, setErrors] = useState<ProfileFieldErrors>(EMPTY_ERRORS);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  // 记住上次同步进草稿的资料，只有外部资料真的变了才重置草稿，避免打断输入。
  const syncedProfile = useRef<PlayerProfile>(profile);

  useEffect(() => {
    if (playerProfileEquals(syncedProfile.current, profile)) return;
    syncedProfile.current = profile;
    setDraft(toDraft(profile));
    setErrors(EMPTY_ERRORS);
    setStatus({ kind: "idle" });
  }, [profile]);

  const dirty = !playerProfileEquals(draft, profile);

  function updateDraft(patch: Partial<Draft>) {
    setDraft(previous => ({ ...previous, ...patch }));
    // 任何编辑都清掉上次的状态提示，避免过期的「已保存」误导。
    setStatus(previous => (previous.kind === "idle" ? previous : { kind: "idle" }));
    setErrors(EMPTY_ERRORS);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation: PlayerProfileValidation = validatePlayerProfile(draft);
    if (!validation.ok) {
      setErrors(validation.errors);
      setStatus({ kind: "idle" });
      return;
    }
    setErrors(EMPTY_ERRORS);
    const saved = onSave(validation.value);
    setStatus(saved ? { kind: "saved" } : { kind: "failed" });
  }

  const nameLength = Array.from(draft.name.trim()).length;
  const bioLength = Array.from(draft.bio.trim()).length;

  return (
    <section className="profile-page" aria-label="个人信息管理">
      <header className="profile-head">
        <div className="profile-head-icon" aria-hidden>
          <UserRound size={26} />
        </div>
        <div className="profile-head-text">
          <h2>个人信息</h2>
          <p>这些资料只保存在本机（这台电脑的浏览器存储里），没有账号后端，也不会上传。</p>
        </div>
      </header>

      <form className="profile-form" onSubmit={handleSubmit} noValidate>
        <div className="profile-field">
          <label htmlFor="profile-name">昵称</label>
          <input
            id="profile-name"
            name="name"
            className="profile-input"
            type="text"
            autoComplete="off"
            value={draft.name}
            maxLength={MAX_NAME_LENGTH * 2}
            aria-invalid={errors.name !== null}
            aria-describedby="profile-name-help"
            onChange={event => updateDraft({ name: event.target.value })}
          />
          <span id="profile-name-help" className="profile-hint">
            1 到 {MAX_NAME_LENGTH} 个字（当前 {nameLength}）。进入房间时会用这个昵称。
          </span>
          {errors.name !== null ? (
            <span className="profile-error" role="alert">{errors.name}</span>
          ) : null}
        </div>

        <div className="profile-field">
          <span className="profile-label">头像</span>
          <AvatarChooser
            value={draft.avatar}
            onChange={next => updateDraft({ avatar: next })}
            label="选择头像"
          />
          <span className="profile-hint">
            从四个预设图案中选一个（{PLAYER_AVATAR_IDS.map(playerAvatarLabel).join("、")}）。
          </span>
        </div>

        <div className="profile-field profile-field-bio">
          <label htmlFor="profile-bio">个人简介</label>
          <textarea
            id="profile-bio"
            name="bio"
            className="profile-input profile-textarea"
            rows={3}
            value={draft.bio}
            aria-invalid={errors.bio !== null}
            aria-describedby="profile-bio-help"
            onChange={event => updateDraft({ bio: event.target.value })}
          />
          <span id="profile-bio-help" className="profile-hint">
            最多 {MAX_BIO_LENGTH} 个字（当前 {bioLength}）。
          </span>
          {errors.bio !== null ? (
            <span className="profile-error" role="alert">{errors.bio}</span>
          ) : null}
        </div>

        <div className="profile-actions">
          <button className="profile-save" type="submit">
            <Save size={16} aria-hidden />
            保存到本机
          </button>
          {status.kind === "saved" ? (
            <span className="profile-status ok" role="status">已保存到本机。</span>
          ) : null}
          {status.kind === "failed" ? (
            <span className="profile-status error" role="status">
              保存失败：本机存储不可用，请检查浏览器存储权限后重试。
            </span>
          ) : null}
        </div>
      </form>

      {inRoom ? (
        <p className="profile-room-note" role="note">
          你正在房间里：这里改的昵称只用于<strong>下次进入房间</strong>，不会改动当前房间里已经确定
          的玩家身份。
        </p>
      ) : null}
    </section>
  );
}
