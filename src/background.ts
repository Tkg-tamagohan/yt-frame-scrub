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
const LOG_PREFIX = "[yt-frame-scrub]";

/**
 * アイコン操作と表示更新を直列化するキュー。
 * クリック処理と表示更新が並行に走ると「読み取り→反転→書き込み」が交差し、
 * 連打時にトグルが消えたり古い表示が新しい表示を上書きしたりする。
 * 全処理をこのチェーンに載せ、実行時点の最新値を読んでから反映する。
 */
let actionQueue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): void {
  actionQueue = actionQueue
    .then(task)
    .catch((error: unknown) => {
      console.error(`${LOG_PREFIX} background task failed`, error);
    });
}

/**
 * バッジとタイトルを現在の enabled 状態へ合わせる。
 * 他の処理と交差しないよう enqueue 経由でのみ呼ぶ。
 */
async function refreshActionUi(): Promise<void> {
  const { enabled } = await loadSettings();
  await chrome.action.setBadgeText({ text: enabled ? "" : t("badgeOff") });
  await chrome.action.setTitle({
    title: `${t("actionTitle")}: ${enabled ? t("stateEnabled") : t("stateDisabled")}`,
  });
}

chrome.action.onClicked.addListener(() => {
  enqueue(async () => {
    const { enabled } = await loadSettings();
    await saveSetting("enabled", !enabled);
    await refreshActionUi();
  });
});

// オプションページなど別コンテキストからの enabled 変更にも追従する
onSettingsChanged((changes) => {
  if (changes.enabled !== undefined) {
    enqueue(refreshActionUi);
  }
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(refreshActionUi);
});

void chrome.action.setBadgeBackgroundColor({ color: DISABLED_BADGE_COLOR });
// サービスワーカー起動のたびに表示を同期する(バッジは永続化されないため)
enqueue(refreshActionUi);
