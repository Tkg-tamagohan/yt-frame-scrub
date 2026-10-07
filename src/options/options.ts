/**
 * オプションページのエントリポイント。
 * 要件定義書 FR-6 と実装計画の設定スキーマ表に従い、chrome.storage.sync の
 * 全設定キーをフォームで編集する。
 * 保存は各フィールドの change イベントで即時に行う方式を採用した
 * (チェックボックスとセレクトは選択時、数値入力は確定(blur/Enter)時に保存)。
 */

import { localizePage, t } from "../shared/i18n";
import {
  type CaptureModifier,
  loadSettings,
  onSettingsChanged,
  saveSettings,
  type Settings,
  type SettingsKey,
} from "../shared/settings";

const fields = {
  enabled: document.getElementById("enabled") as HTMLInputElement,
  invertDirection: document.getElementById("invertDirection") as HTMLInputElement,
  captureModifier: document.getElementById(
    "captureModifier",
  ) as HTMLSelectElement,
  stepThreshold: document.getElementById("stepThreshold") as HTMLInputElement,
  shiftStepSize: document.getElementById("shiftStepSize") as HTMLInputElement,
  overlayEnabled: document.getElementById("overlayEnabled") as HTMLInputElement,
  manualFps: document.getElementById("manualFps") as HTMLInputElement,
};

const shiftConflictNotice = document.getElementById(
  "shift-conflict",
) as HTMLElement;
const statusElement = document.getElementById("status") as HTMLElement;

type NumberKey = "stepThreshold" | "shiftStepSize" | "manualFps";

const NUMBER_KEYS: readonly string[] = [
  "stepThreshold",
  "shiftStepSize",
  "manualFps",
];

function isNumberKey(key: string): key is NumberKey {
  return NUMBER_KEYS.includes(key);
}

/** 直近に確定した設定値。入力不正時の差し戻しと外部変更の反映に使う。 */
let currentSettings: Settings;
let statusTimer: number | undefined;
/** 保存処理の通し番号。失敗時の復元が後続の保存を上書きしないよう判定に使う。 */
let persistSeq = 0;
const lastPersistByKey = new Map<SettingsKey, number>();

/**
 * 入力途中(未確定)の数値フィールド。
 * 外部変更が届いても即時反映を保留し、確定または blur で解消する。
 * チェックボックスやセレクトは「編集中」が存在しないため対象外。
 */
const dirtyNumberFields = new Set<NumberKey>();
/**
 * change で確定済みのフィールド。
 * blur 時の再同期を一度だけスキップする目印(確定値を優先するため)。
 */
const committedFields = new Set<string>();

function showStatus(
  messageKey: "statusSaved" | "statusInvalid" | "statusSaveFailed",
  isError = false,
): void {
  statusElement.textContent = t(messageKey);
  statusElement.classList.toggle("error", isError);
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    statusElement.textContent = "";
  }, 2000);
}

/**
 * captureModifier が "shift" のとき、仕様どおり Shift 併用の複数コマ移動が
 * 使えない旨の注意書きを表示し、効果のない shiftStepSize 入力を無効化する。
 */
function updateShiftConflict(modifier: CaptureModifier): void {
  const conflict = modifier === "shift";
  shiftConflictNotice.hidden = !conflict;
  fields.shiftStepSize.disabled = conflict;
}

function applySettingsToForm(settings: Settings): void {
  fields.enabled.checked = settings.enabled;
  fields.invertDirection.checked = settings.invertDirection;
  fields.captureModifier.value = settings.captureModifier;
  fields.stepThreshold.value = String(settings.stepThreshold);
  fields.shiftStepSize.value = String(settings.shiftStepSize);
  fields.overlayEnabled.checked = settings.overlayEnabled;
  fields.manualFps.value = String(settings.manualFps);
  updateShiftConflict(settings.captureModifier);
}

function setFieldValue(key: SettingsKey, value: Settings[SettingsKey]): void {
  const element = fields[key];
  if (element instanceof HTMLInputElement && element.type === "checkbox") {
    element.checked = value as boolean;
  } else {
    element.value = String(value);
  }
}

/**
 * 外部から届いた設定変更をフォームへ反映する。
 * 未確定の入力を持つ数値フィールドだけ上書きを避け、それ以外
 * (チェックボックス・セレクト・編集していない入力)は即時に追従させる。
 */
function applySettingsToFormRespectingDirty(settings: Settings): void {
  for (const key of Object.keys(fields) as SettingsKey[]) {
    if (isNumberKey(key) && dirtyNumberFields.has(key)) {
      continue;
    }
    setFieldValue(key, settings[key]);
  }
  updateShiftConflict(settings.captureModifier);
}

/**
 * 保存に失敗したキーだけを保存済みの値へ戻す。
 * 全項目の再読み込みで別項目の新しい値を古いスナップショットで上書きする
 * 競合を避けるため、復元は失敗した patch のキーに限定する。
 * 同じキーへの後続の保存や未確定の入力は上書きしない
 * (処理番号が更新されているキーは復元対象外とする)。
 */
async function revertFailedKeys(keys: SettingsKey[], seq: number): Promise<void> {
  try {
    const stored = await loadSettings();
    for (const key of keys) {
      if (lastPersistByKey.get(key) !== seq) {
        continue;
      }
      // マップ型への書き込みはキー単位の型が絞れないため Record 経由で代入する
      (currentSettings as unknown as Record<string, unknown>)[key] = stored[key];
      if (!(isNumberKey(key) && dirtyNumberFields.has(key))) {
        setFieldValue(key, stored[key]);
      }
    }
  } catch {
    // 再読み込みも失敗した場合は patch 反映前の currentSettings で戻す
    for (const key of keys) {
      if (
        lastPersistByKey.get(key) === seq &&
        !(isNumberKey(key) && dirtyNumberFields.has(key))
      ) {
        setFieldValue(key, currentSettings[key]);
      }
    }
  }
  updateShiftConflict(currentSettings.captureModifier);
}

async function persist(patch: Partial<Settings>): Promise<void> {
  const seq = ++persistSeq;
  const keys = Object.keys(patch) as SettingsKey[];
  for (const key of keys) {
    lastPersistByKey.set(key, seq);
  }
  try {
    await saveSettings(patch);
    currentSettings = { ...currentSettings, ...patch };
    showStatus("statusSaved");
  } catch {
    await revertFailedKeys(keys, seq);
    showStatus("statusSaveFailed", true);
  }
}

interface NumberConstraint {
  min: number;
  integer?: boolean;
}

/**
 * 数値入力を読み取る。不正値は保存せず、表示を直近の確定値へ戻す。
 * 値域の下限はスキーマの意味(閾値・コマ数は正、manualFps は 0=自動)から取る。
 */
function readNumber(
  input: HTMLInputElement,
  key: NumberKey,
  constraint: NumberConstraint,
): number | null {
  const raw = input.value.trim();
  const value = Number(raw);
  if (raw === "" || !Number.isFinite(value) || value < constraint.min) {
    input.value = String(currentSettings[key]);
    showStatus("statusInvalid", true);
    return null;
  }
  return constraint.integer === true ? Math.round(value) : value;
}

/**
 * 数値フィールドの束縛。
 * input で未確定を記録し(再編集時は確定済みフラグも消して blur の再同期を
 * 有効にする)、change(確定)で保存、blur で保留していた外部変更を再同期する。
 * 確定を伴う blur では入力値を優先し再同期しない。
 */
function bindNumberField(key: NumberKey, constraint: NumberConstraint): void {
  const input = fields[key];
  input.addEventListener("input", () => {
    dirtyNumberFields.add(key);
    committedFields.delete(key);
  });
  input.addEventListener("change", () => {
    dirtyNumberFields.delete(key);
    committedFields.add(key);
    const value = readNumber(input, key, constraint);
    if (value !== null) {
      input.value = String(value);
      void persist({ [key]: value });
    }
  });
  input.addEventListener("blur", () => {
    dirtyNumberFields.delete(key);
    if (!committedFields.delete(key)) {
      input.value = String(currentSettings[key]);
    }
  });
}

function bindHandlers(): void {
  fields.enabled.addEventListener("change", () =>
    persist({ enabled: fields.enabled.checked }),
  );
  fields.invertDirection.addEventListener("change", () =>
    persist({ invertDirection: fields.invertDirection.checked }),
  );
  fields.overlayEnabled.addEventListener("change", () =>
    persist({ overlayEnabled: fields.overlayEnabled.checked }),
  );
  fields.captureModifier.addEventListener("change", () => {
    const modifier = fields.captureModifier.value as CaptureModifier;
    updateShiftConflict(modifier);
    void persist({ captureModifier: modifier });
  });
  bindNumberField("stepThreshold", { min: 1 });
  bindNumberField("shiftStepSize", { min: 1, integer: true });
  bindNumberField("manualFps", { min: 0 });
}

async function init(): Promise<void> {
  localizePage();
  currentSettings = await loadSettings();
  applySettingsToForm(currentSettings);
  bindHandlers();
  // ツールバーアイコンや別コンテキストからの変更をフォームへ追従させる
  onSettingsChanged((changes) => {
    const next = { ...currentSettings };
    for (const [key, change] of Object.entries(changes)) {
      (next as Record<string, unknown>)[key] = change.newValue;
    }
    currentSettings = next;
    applySettingsToFormRespectingDirty(next);
  });
}

void init();
