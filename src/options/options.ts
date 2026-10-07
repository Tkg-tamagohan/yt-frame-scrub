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

/** 直近に確定した設定値。入力不正時の差し戻しと外部変更の反映に使う。 */
let currentSettings: Settings;
let statusTimer: number | undefined;

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

/** フォーム単位での設定反映。フォーカス中のフィールドだけは入力を潰さない。 */
function applySettingsToFormKeepFocus(settings: Settings): void {
  for (const [key, element] of Object.entries(fields)) {
    if (element === document.activeElement) {
      continue;
    }
    const value = settings[key as keyof Settings];
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      element.checked = value as boolean;
    } else {
      element.value = String(value);
    }
  }
  updateShiftConflict(settings.captureModifier);
}

async function persist(patch: Partial<Settings>): Promise<void> {
  try {
    await saveSettings(patch);
    currentSettings = { ...currentSettings, ...patch };
    showStatus("statusSaved");
  } catch {
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
  key: "stepThreshold" | "shiftStepSize" | "manualFps",
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
  fields.stepThreshold.addEventListener("change", () => {
    const value = readNumber(fields.stepThreshold, "stepThreshold", { min: 1 });
    if (value !== null) {
      fields.stepThreshold.value = String(value);
      void persist({ stepThreshold: value });
    }
  });
  fields.shiftStepSize.addEventListener("change", () => {
    const value = readNumber(fields.shiftStepSize, "shiftStepSize", {
      min: 1,
      integer: true,
    });
    if (value !== null) {
      fields.shiftStepSize.value = String(value);
      void persist({ shiftStepSize: value });
    }
  });
  fields.manualFps.addEventListener("change", () => {
    const value = readNumber(fields.manualFps, "manualFps", { min: 0 });
    if (value !== null) {
      fields.manualFps.value = String(value);
      void persist({ manualFps: value });
    }
  });
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
    applySettingsToFormKeepFocus(next);
  });
}

void init();
