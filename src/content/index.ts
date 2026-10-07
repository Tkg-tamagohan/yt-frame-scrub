/**
 * コンテンツスクリプトのエントリポイント。
 * Phase 1 は初期化ログのみ。動画検出とコマ送り本体は Phase 2 以降で実装する。
 */

const LOG_PREFIX = "[yt-frame-scrub]";

function main(): void {
  console.log(`${LOG_PREFIX} initialized`);
}

main();
