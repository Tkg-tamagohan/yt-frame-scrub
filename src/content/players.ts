/**
 * watch ページと Shorts ページのプレイヤー検出（FR-7、仕様決定 D）。
 *
 * watch は `#movie_player` を基準とする。Shorts では画面外にも上下の
 * `ytd-reel-video-renderer` が DOM に残り得るため、複数候補の中から
 * 「アクティブらしさ」を採点して選ぶ。`is-active` 属性が付く構造を
 * 第一候補とするが、現行の YouTube では属性が付与されないケースを
 * 実機確認済みのため、ビューポート占有率などのフォールバックも併用する。
 * DOM 構造への依存を本モジュールへ閉じ込め、呼び出し側は
 * {@link findActivePlayer} の有無だけを見ればよい。
 */

export type PageKind = "watch" | "shorts";

export interface PlayerTarget {
  /** 対象ページの種別。 */
  page: PageKind;
  /**
   * オーバーレイのマウント先であり wheel 捕捉のルートでもあるコンテナ。
   * 全画面・シアター・ミニプレイヤーでも同一要素が追従するため、
   * オーバーレイはこの要素の中へ入れる。
   */
  container: HTMLElement;
  video: HTMLVideoElement;
}

/** パス名から対象ページ種別を判定する（純粋関数、単体テスト対象）。 */
export function pageKindOf(pathname: string): PageKind | null {
  if (pathname.startsWith("/watch")) {
    return "watch";
  }
  if (pathname.startsWith("/shorts")) {
    return "shorts";
  }
  return null;
}

const WATCH_PLAYER_ID = "movie_player";
const HTML5_PLAYER_SELECTOR = ".html5-video-player";
const SHORTS_RENDERER_SELECTOR = "ytd-reel-video-renderer";

/**
 * video を内包するプレイヤーコンテナを推定する。
 * YouTube の HTML5 プレイヤーは watch / Shorts ともに `html5-video-player`
 * クラスを持つ想定で、見つからなければ近いコンテナへフォールバックする。
 */
export function findPlayerContainer(video: HTMLVideoElement): HTMLElement {
  const byClass = video.closest<HTMLElement>(HTML5_PLAYER_SELECTOR);
  if (byClass !== null) {
    return byClass;
  }
  const watch = video.closest<HTMLElement>(`#${WATCH_PLAYER_ID}`);
  if (watch !== null) {
    return watch;
  }
  const shortsPlayer = video.closest<HTMLElement>("ytd-player");
  if (shortsPlayer !== null) {
    return shortsPlayer;
  }
  return video.parentElement ?? video;
}

/** YouTube の主動画が持つ安定クラス。広告用の別 video と取り違えないよう優先する。 */
const MAIN_VIDEO_SELECTOR = "video.html5-main-video";

/** watch ページのメインプレイヤーとその video 要素を探す。 */
export function findWatchPlayer(): PlayerTarget | null {
  const video =
    document.querySelector<HTMLVideoElement>(
      `#${WATCH_PLAYER_ID} ${MAIN_VIDEO_SELECTOR}`,
    ) ??
    document.querySelector<HTMLVideoElement>(`#${WATCH_PLAYER_ID} video`);
  if (video === null) {
    return null;
  }
  return { page: "watch", container: findPlayerContainer(video), video };
}

/** 要素の矩形がビューポート内に占める割合（0〜1）。display:none 等なら 0。 */
function visibleFraction(el: Element): number {
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0) {
    return 0;
  }
  const visible =
    Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  return Math.max(0, Math.min(1, visible / rect.height));
}

/**
 * Shorts のアクティブなプレイヤーを返す。
 * レンダラーが複数 DOM に残り得るため、候補ごとにスコアを付けて最良のものを選ぶ。
 * - `is-active` 属性: あれば最優先（現行 YouTube では付かないことを実機確認済み）
 * - ビューポート占有率×100: 画面に最も映っているレンダラーを主指標とする
 * - 再生中の video: 占有率がほぼ同じときのタイブレーク用（+0.5、占有率の
 *   差が小さいときにだけ効く。隣接する再生中レンダラーが、より大きく
 *   見える一時停止中レンダラーを上回らないよう重みは小さくする）
 * 動画を持つレンダラーが一つも無ければ null（再評価に委ねる）。
 */
export function findShortsPlayer(): PlayerTarget | null {
  const candidates: { renderer: Element; video: HTMLVideoElement }[] = [];
  for (const renderer of document.querySelectorAll(SHORTS_RENDERER_SELECTOR)) {
    const video =
      renderer.querySelector<HTMLVideoElement>(MAIN_VIDEO_SELECTOR) ??
      renderer.querySelector<HTMLVideoElement>("video");
    if (video !== null) {
      candidates.push({ renderer, video });
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  let best = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    let score = visibleFraction(candidate.renderer) * 100;
    if (candidate.renderer.hasAttribute("is-active")) {
      score += 1000;
    }
    if (!candidate.video.paused) {
      score += 0.5;
    }
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return {
    page: "shorts",
    container: findPlayerContainer(best.video),
    video: best.video,
  };
}

/**
 * 対象外ページ（検索結果など）に残るミニプレイヤーを探す。
 * YouTube は watch から別ページへ遷移してもミニプレイヤーへ同じ動画要素を
 * 残す（要件定義書「対象範囲」: ミニプレイヤーでも同一の動画要素を追従）。
 * `ytd-miniplayer` 配下の動画、またはプレイヤーの `ytp-mini` モード印だけを
 * 対象とし、休眠中のプレイヤー（ページ内に残る #movie_player 等）は拾わない。
 */
export function findMiniplayer(): PlayerTarget | null {
  const inMini = document.querySelector<HTMLVideoElement>(
    `ytd-miniplayer ${MAIN_VIDEO_SELECTOR}`,
  );
  if (inMini !== null) {
    return {
      page: "watch",
      container: findPlayerContainer(inMini),
      video: inMini,
    };
  }
  for (const video of document.querySelectorAll<HTMLVideoElement>(
    MAIN_VIDEO_SELECTOR,
  )) {
    const container = findPlayerContainer(video);
    if (container.classList.contains("ytp-mini")) {
      return { page: "watch", container, video };
    }
  }
  return null;
}

/**
 * 現在のパス名に応じて対象プレイヤーを返す。
 * 対象外ページでもミニプレイヤーが表示中ならそちらを返す
 * （ミニプレイヤーでも同一の動画要素を追従する要件のため）。
 */
export function findActivePlayer(
  pathname: string = location.pathname,
): PlayerTarget | null {
  switch (pageKindOf(pathname)) {
    case "watch":
      return findWatchPlayer();
    case "shorts":
      return findShortsPlayer();
    default:
      return findMiniplayer();
  }
}
