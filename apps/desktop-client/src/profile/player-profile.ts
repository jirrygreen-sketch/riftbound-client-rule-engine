/**
 * 真正本机玩家资料：仅保存在当前设备的 `localStorage` 里，没有账号后端，
 * 也不是服务端状态。
 *
 * 这里只存三样纯本地字段：昵称、预设头像标识、个人简介。
 * 它是刻意**不**包含任何账号/会话/凭证/牌组/准备信息：
 * - 没有 token、resumeToken 或 session 拷贝；
 * - 没有卡组内容或 deckFingerprint；
 * - 没有 ready / 已提交之类的对局状态。
 *
 * 存储契约：读取是宽容的（JSON 损坏、schema 不符、字段越界一律逐字段回退到
 * 默认值，绝不抛异常），写入是尽力而为的（不可用或会抛异常的 storage 只会返回
 * `false`，绝不从本模块抛出）。写入返回 `false` 时界面不得假装保存成功。
 *
 * key 与命名牌库 key、working-draft key、ui-preferences key 都相互独立。
 */
export const PROFILE_STORAGE_KEY = "riftbound.desktop-client.player-profile.v1";
export const PROFILE_SCHEMA_VERSION = 1;

export const MIN_NAME_LENGTH = 1;
export const MAX_NAME_LENGTH = 24;
export const MAX_BIO_LENGTH = 160;

/** 预设头像标识：只允许固定四种，绝不接受任意图片 URL。 */
export const PLAYER_AVATAR_IDS = ["rune", "blade", "star", "leaf"] as const;

export type PlayerAvatarId = (typeof PLAYER_AVATAR_IDS)[number];

/**
 * 本机玩家资料。`avatar` 为 `string`（与对外契约一致），但其合法取值只来自
 * `PLAYER_AVATAR_IDS`；写入前会校验，读取时会逐字段回退。
 */
export interface PlayerProfile {
  name: string;
  avatar: string;
  bio: string;
}

/** 最小 storage 面：既能接 `window.localStorage`，也能接测试替身。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_PLAYER_PROFILE: PlayerProfile = {
  name: "玩家",
  avatar: "rune",
  bio: ""
};

/** 默认头像标识，窄化到合法联合类型，供内部回退使用。 */
const DEFAULT_AVATAR_ID: PlayerAvatarId = "rune";

interface StoredPlayerProfile {
  readonly schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  readonly name: string;
  readonly avatar: PlayerAvatarId;
  readonly bio: string;
}

export interface ProfileFieldErrors {
  readonly name: string | null;
  readonly bio: string | null;
}

export type PlayerProfileValidation =
  | { readonly ok: true; readonly value: PlayerProfile }
  | { readonly ok: false; readonly errors: ProfileFieldErrors };

export function isPlayerAvatarId(value: unknown): value is PlayerAvatarId {
  return (
    typeof value === "string" &&
    (PLAYER_AVATAR_IDS as readonly string[]).includes(value)
  );
}

/** 头像标识对应的中文标签，供界面展示；未知标识回退到默认。 */
export function playerAvatarLabel(value: unknown): string {
  switch (value) {
    case "rune":
      return "符文";
    case "blade":
      return "利刃";
    case "star":
      return "星辰";
    case "leaf":
      return "新叶";
    default:
      return "符文";
  }
}

/**
 * 逐字段清洗：合法字段保留，越界/类型错误的字段回退到默认值。只用于读取与
 * 展示，不做「静默修正后当作有效写入」——写入仍走 `validatePlayerProfile`。
 */
export function sanitizePlayerProfile(input: unknown): PlayerProfile {
  if (!isRecord(input)) return { ...DEFAULT_PLAYER_PROFILE };
  const name = normalizeName(input.name);
  const bio = normalizeBio(input.bio);
  return {
    name: name ?? DEFAULT_PLAYER_PROFILE.name,
    avatar: isPlayerAvatarId(input.avatar)
      ? input.avatar
      : DEFAULT_PLAYER_PROFILE.avatar,
    bio: bio ?? DEFAULT_PLAYER_PROFILE.bio
  };
}

/**
 * 校验一份待保存草稿。返回规范化后的值（昵称/简介会 `trim`），并把逐字段错误
 * 一并交给界面。昵称 `trim` 后需 1..24 个字，简介 `trim` 后需 <=160 个字。
 */
export function validatePlayerProfile(input: unknown): PlayerProfileValidation {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: { name: "昵称需为 1 到 24 个字。", bio: null }
    };
  }
  const rawName = typeof input.name === "string" ? input.name : null;
  const rawBio = typeof input.bio === "string" ? input.bio : "";
  const trimmedName = rawName === null ? null : rawName.trim();
  const trimmedBio = rawBio.trim();

  const nameLength = trimmedName === null ? 0 : countChars(trimmedName);
  const bioLength = countChars(trimmedBio);

  const nameError =
    trimmedName === null || nameLength < MIN_NAME_LENGTH || nameLength > MAX_NAME_LENGTH
      ? "昵称需为 1 到 24 个字。"
      : null;
  const bioError =
    rawBio !== "" && bioLength > MAX_BIO_LENGTH
      ? "个人简介最多 160 个字。"
      : null;

  if (nameError !== null || bioError !== null) {
    return { ok: false, errors: { name: nameError, bio: bioError } };
  }

  return {
    ok: true,
    value: {
      name: trimmedName as string,
      avatar: isPlayerAvatarId(input.avatar) ? input.avatar : DEFAULT_AVATAR_ID,
      bio: trimmedBio
    }
  };
}

/**
 * 读取本机资料。任何损坏（JSON 解析失败、schema 不符、字段越界）或 storage 抛
 * 异常都逐字段回退，永远返回一份可用的资料，绝不抛异常。
 */
export function readPlayerProfile(storage: StorageLike | null): PlayerProfile {
  if (!storage) return { ...DEFAULT_PLAYER_PROFILE };
  let raw: string | null;
  try {
    raw = storage.getItem(PROFILE_STORAGE_KEY);
  } catch {
    return { ...DEFAULT_PLAYER_PROFILE };
  }
  if (!raw) return { ...DEFAULT_PLAYER_PROFILE };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PLAYER_PROFILE };
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    return { ...DEFAULT_PLAYER_PROFILE };
  }
  return sanitizePlayerProfile(parsed);
}

/**
 * 保存本机资料。非法资料直接返回 `false`（不写入）；写入失败（无 storage 或
 * `setItem` 抛异常）同样返回 `false`。只有真正写入成功才返回 `true`，界面据此
 * 判断是否显示成功提示。
 */
export function writePlayerProfile(
  storage: StorageLike | null,
  profile: PlayerProfile
): boolean {
  if (!storage) return false;
  const validation = validatePlayerProfile(profile);
  if (!validation.ok) return false;
  try {
    storage.setItem(PROFILE_STORAGE_KEY, serializePlayerProfile(validation.value));
    return true;
  } catch {
    return false;
  }
}

export function serializePlayerProfile(profile: PlayerProfile): string {
  const stored: StoredPlayerProfile = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    name: profile.name,
    avatar: isPlayerAvatarId(profile.avatar) ? profile.avatar : DEFAULT_AVATAR_ID,
    bio: profile.bio
  };
  return JSON.stringify(stored);
}

/** 两个资料是否在三个可见字段上完全一致（用于判断草稿是否有改动）。 */
export function playerProfileEquals(a: PlayerProfile, b: PlayerProfile): boolean {
  return a.name === b.name && a.avatar === b.avatar && a.bio === b.bio;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const length = countChars(trimmed);
  if (length < MIN_NAME_LENGTH || length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

function normalizeBio(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (countChars(trimmed) > MAX_BIO_LENGTH) return null;
  return trimmed;
}

/** 按 Unicode 码点计数，避免中文/emoji 被按 UTF-16 长度误判。 */
function countChars(value: string): number {
  return Array.from(value).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
