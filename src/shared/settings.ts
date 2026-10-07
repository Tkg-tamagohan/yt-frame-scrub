/**
 * chrome.storage.sync に保存する設定スキーマ。
 * キーと既定値は docs/implementation-plan.md の「設定スキーマ」表に従う。
 * content/ と options/ の両コンテキストから参照される共有モジュール。
 */

/** スクロール捕捉に必須とする修飾キー。"none" は常時捕捉を表す。 */
export const CAPTURE_MODIFIERS = ["none", "alt", "ctrl", "shift"] as const;
export type CaptureModifier = (typeof CAPTURE_MODIFIERS)[number];

export interface Settings {
  /** 機能の有効/無効 */
  enabled: boolean;
  /** スクロール方向とコマ送り方向の反転 */
  invertDirection: boolean;
  /** 捕捉に必須とする修飾キー */
  captureModifier: CaptureModifier;
  /** 1 コマ化する deltaY 累積閾値(px) */
  stepThreshold: number;
  /** Shift 併用時のコマ数 */
  shiftStepSize: number;
  /** オーバーレイの表示/非表示 */
  overlayEnabled: boolean;
  /** 手動 fps。0 = 自動検出と既定 30 へのフォールバック */
  manualFps: number;
}

export type SettingsKey = keyof Settings;

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  enabled: true,
  invertDirection: false,
  captureModifier: "none",
  stepThreshold: 100,
  shiftStepSize: 10,
  overlayEnabled: true,
  manualFps: 0,
};

const SETTINGS_KEYS = new Set<string>(Object.keys(DEFAULT_SETTINGS));

function isSettingsKey(key: string): key is SettingsKey {
  return SETTINGS_KEYS.has(key);
}

/**
 * 全設定を読み込む。未保存のキーは既定値で補完される。
 */
export async function loadSettings(): Promise<Settings> {
  const items = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...items };
}

/**
 * 設定を部分的に保存する。
 * 構造的型付けではスキーマ外のキーを持つ値も渡せるため、書き込み前に
 * スキーマ内キーだけへ絞り込む。undefined の値は書き込まない。
 */
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const filtered: Partial<Settings> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!isSettingsKey(key) || value === undefined) {
      continue;
    }
    (filtered as Record<string, unknown>)[key] = value;
  }
  if (Object.keys(filtered).length === 0) {
    return;
  }
  await chrome.storage.sync.set(filtered);
}

/**
 * 単一キーの保存。アイコントグルなど 1 項目だけ更新する用途向け。
 */
export async function saveSetting<K extends SettingsKey>(
  key: K,
  value: Settings[K],
): Promise<void> {
  await chrome.storage.sync.set({ [key]: value });
}

/**
 * onSettingsChanged に渡される変更マップ。変更のあったスキーマ内キーのみ含む。
 */
export type SettingsChanges = {
  [K in SettingsKey]?: {
    oldValue: Settings[K] | undefined;
    newValue: Settings[K];
  };
};

/**
 * chrome.storage.onChanged の薄いラッパー。
 * storage.sync 領域かつ本スキーマのキーに限定した変更だけを通知する。
 * キーが削除されて値が undefined の場合は既定値へ戻ったものとして通知する。
 * 戻り値は購読解除関数。
 */
export function onSettingsChanged(
  listener: (changes: SettingsChanges) => void,
): () => void {
  const handler = (
    raw: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ): void => {
    if (areaName !== "sync") {
      return;
    }
    const changes: SettingsChanges = {};
    for (const [key, change] of Object.entries(raw)) {
      if (!isSettingsKey(key)) {
        continue;
      }
      // マップ型への書き込みはキー単位の型が絞れないため Record 経由で代入する
      (changes as Record<string, unknown>)[key] = {
        oldValue: change.oldValue,
        newValue: change.newValue ?? DEFAULT_SETTINGS[key],
      };
    }
    if (Object.keys(changes).length > 0) {
      listener(changes);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
