/**
 * 機能無効化の判定（要件定義書「対象範囲」の無効化条件、仕様決定 B）。
 *
 * - 広告再生中：プレイヤーコンテナの `ad-showing` / `ad-interrupting`
 *   クラス。YouTube が広告映像の再生中にプレイヤーへ付けるクラス名で、
 *   第三者の拡張実装でも広く使われているものを採用する。
 *   バナー系のオーバーレイ広告（ytp-ad-overlay-open 等）は主映像が
 *   動き続けるため対象にしない（本編を誤って無効化しない方を優先）。
 * - ライブ配信・プレミア公開のリアルタイム再生：
 *   `video.duration === Infinity`。Media Source によるライブ系ストリームは
 *   長さを持たず、通常動画では Infinity になりえない強い根拠。
 *   `.ytp-live-badge` は通常動画のプレイヤーにも常駐するため根拠に使わない
 *   （実機で確認：VOD のバッジに disabled 属性は付かず誤検出になる）。
 *   なおライブの追いかけ再生（DVR で過去へ戻れる区間）も一律無効化とし、
 *   本編の誤無効化を避ける方を優先する。
 *
 * 判定はすべて呼び出し時点の DOM 状態を読む同期処理とし、
 * ポーリングによる監視は持たない（非機能要件）。
 * DOM 非依存の形で export し、単体テスト可能にする。
 */

/** 広告再生中を示すプレイヤーコンテナのクラス名。 */
export const AD_PLAYER_CLASSES = ["ad-showing", "ad-interrupting"] as const;

/**
 * プレイヤーの classList が広告再生中を示すか。
 * 渡すのは `DOMTokenList` 互換の最小インターフェースでよい。
 */
export function isAdPlayback(classList: {
  contains(name: string): boolean;
}): boolean {
  return AD_PLAYER_CLASSES.some((name) => classList.contains(name));
}

export interface LivePlaybackInput {
  /**
   * `video.duration`。ライブ・プレミア公開のリアルタイム再生では
   * `Infinity` になる（通常動画は有限値）。
   */
  duration: number;
}

/** ライブ配信・プレミア公開のリアルタイム再生と判断できるか。 */
export function isLivePlayback(input: LivePlaybackInput): boolean {
  return input.duration === Number.POSITIVE_INFINITY;
}

export interface CaptureGateInput {
  /** 設定の機能トグル（FR-6）。 */
  enabled: boolean;
  /** `video.paused`（FR-5：再生中は捕捉しない）。 */
  paused: boolean;
  /** 広告再生中か。 */
  adPlaying: boolean;
  /** ライブ・プレミアのリアルタイム再生か。 */
  liveLike: boolean;
}

/** コマ送りの捕捉を行ってよい状態か（総合ゲート）。 */
export function isSteppingEnabled(input: CaptureGateInput): boolean {
  return (
    input.enabled && input.paused && !input.adPlaying && !input.liveLike
  );
}
