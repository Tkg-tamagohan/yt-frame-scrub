/**
 * MV3 サービスワーカー。
 * 要件定義書 FR-6「機能の有効と無効は、ツールバーの拡張機能アイコンからも
 * 切り替えられるようにする」の実装である。
 * アクションアイコンのクリックで enabled を反転し、現在の状態を
 * バッジ(無効時のみ)とアイコンタイトルで示す。
 */

import { t } from "./shared/i18n";
import { loadSettings, onSettingsChanged, saveSetting } from "./shared/settings";

const DISABLED_BADGE_COLOR = "#9aa0a6";

/** バッジとタイトルを現在の enabled 状態へ合わせる。 */
async function refreshActionUi(): Promise<void> {
  const { enabled } = await loadSettings();
  await chrome.action.setBadgeText({ text: enabled ? "" : t("badgeOff") });
  await chrome.action.setTitle({
    title: `${t("actionTitle")}: ${enabled ? t("stateEnabled") : t("stateDisabled")}`,
  });
}

chrome.action.onClicked.addListener(() => {
  void (async () => {
    const { enabled } = await loadSettings();
    await saveSetting("enabled", !enabled);
    // onSettingsChanged 経由でも refreshActionUi が走るが、
    // 連打時に保存と表示の順序を確実にするためここでも更新する。
    await refreshActionUi();
  })();
});

// オプションページなど別コンテキストからの enabled 変更にも追従する
onSettingsChanged((changes) => {
  if (changes.enabled !== undefined) {
    void refreshActionUi();
  }
});

chrome.runtime.onStartup.addListener(() => {
  void refreshActionUi();
});

void chrome.action.setBadgeBackgroundColor({ color: DISABLED_BADGE_COLOR });
// サービスワーカー起動のたびに表示を同期する(バッジは永続化されないため)
void refreshActionUi();
