/**
 * FR-4 / 仕様決定 E のオーバーレイ表示。
 *
 * コマ送り操作中のみ、フレーム番号・タイムコード・推定 fps を
 * プレイヤーのコンテナ要素内の小さなオーバーレイに表示する。
 * 操作停止から数秒でフェードアウトし、常時は表示しない。
 * Shadow DOM で実装し、YouTube 側のスタイルと干渉しない。
 *
 * 表記は `F 123`、`30 fps`、`--:--:--.---` のような言語中立の記号で
 * 構成し、意図的に chrome.i18n を通していない。
 * 言語依存の文言を表示する要素を追加する場合は別途 i18n の配線が要る。
 *
 * Phase 5 時点では index.ts / stepper.ts へ未接続のモジュールであり、
 * 呼び出し側は後続フェーズが配線する。全画面・シアター・ミニプレイヤーでの
 * 位置追従は Phase 7 の担当であり、本モジュールは「プレイヤーコンテナを
 * 引数で受け取りマウントする」再マウント可能な形までを提供する。
 */

/**
 * 操作停止からフェードアウトを開始するまでの時間(ms)。
 * 仕様決定 E は「数秒」とだけ定めるため、実装定数として 3 秒を採用する。
 */
export const OVERLAY_FADEOUT_MS = 3000;

/** フェードアウトの CSS トランジション時間(ms)。 */
export const OVERLAY_FADE_TRANSITION_MS = 300;

const UNKNOWN_TIMECODE = "--:--:--.---";
const UNKNOWN_FRAME = "F ?";
const UNKNOWN_FPS = "? fps";

/**
 * 秒を `HH:MM:SS.mmm` 形式へ整形する。
 * - ミリ秒未満は四捨五入し、繰り上がりは秒・分・時へ伝播させる。
 * - 60 分を超える場合は時間の桁をそのまま増やす(上限で丸めない)。
 * - 負値は先頭に `-` を付けて絶対値を整形する。
 * - NaN や ±Infinity など非有限値は `--:--:--.---` を返す。
 */
export function formatTimecode(timeSeconds: number): string {
  if (!Number.isFinite(timeSeconds)) {
    return UNKNOWN_TIMECODE;
  }
  const negative = timeSeconds < 0;
  const totalMs = Math.round(Math.abs(timeSeconds) * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const sign = negative ? "-" : "";
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const mmm = String(millis).padStart(3, "0");
  return `${sign}${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * フレーム番号を `F 1234` 形式へ整形する。
 * 要件定義書はフレーム番号を推定値として扱うため、`estimated` が真のとき
 * 数値の前に `~` を付けて推定値であることを示す(`F ~1234`)。
 * 小数は四捨五入し、非有限値は `F ?` を返す。
 */
export function formatFrameNumber(frame: number, estimated = false): string {
  if (!Number.isFinite(frame)) {
    return UNKNOWN_FRAME;
  }
  return `F ${estimated ? "~" : ""}${Math.round(frame)}`;
}

/**
 * fps を `30 fps` 形式へ整形する。
 * 非整数は小数 2 位へ丸める(29.97 → `29.97 fps`、23.976 → `23.98 fps`)。
 * 0 以下や非有限値は検出失敗として `? fps` を返す。
 */
export function formatFps(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) {
    return UNKNOWN_FPS;
  }
  return `${Number(fps.toFixed(2))} fps`;
}

/** update() で受け取る表示値。seeked イベント駆動の更新を想定する。 */
export interface OverlayReadout {
  /** フレーム番号(推定値)。 */
  frame: number;
  /** 現在時刻(秒)。 */
  timeSeconds: number;
  /** 推定 fps。 */
  fps: number;
  /** フレーム番号を推定値として表記するか。 */
  estimated: boolean;
}

export interface OverlayOptions {
  /** フェードアウト開始までの時間(ms)。省略時は OVERLAY_FADEOUT_MS。 */
  fadeoutMs?: number;
}

/** オーバーレイの公開 API。 */
export interface FrameOverlay {
  /**
   * プレイヤーのコンテナ要素内へオーバーレイをマウントする。
   * 別のコンテナへ再度呼ぶと再マウント(移動)する。
   */
  attach(container: HTMLElement): void;
  /** オーバーレイを DOM から取り外し、フェードアウト予約を解除する。 */
  detach(): void;
  /** 表示値を更新する。表示・非表示には影響しない。 */
  update(readout: OverlayReadout): void;
  /**
   * コマ送り操作の発生を通知する。
   * オーバーレイを表示し、フェードアウトの予約を仕切り直す。
   */
  notifyActivity(): void;
  /**
   * overlayEnabled 設定を反映する。
   * false を渡すと即座に非表示となり、再有効化まで操作通知でも表示しない。
   */
  setEnabled(enabled: boolean): void;
  /** コンテナへマウント済みなら true。 */
  isAttached(): boolean;
}

const SHADOW_STYLES = `
  :host {
    position: absolute;
    right: 8px;
    bottom: 48px;
    z-index: 60;
    pointer-events: none;
  }
  .overlay {
    white-space: nowrap;
    text-align: right;
    font-family: monospace;
    font-size: 12px;
    line-height: 1.4;
    color: #fff;
    background: rgba(0, 0, 0, 0.75);
    padding: 4px 8px;
    border-radius: 4px;
    opacity: 0;
    transition: opacity ${OVERLAY_FADE_TRANSITION_MS}ms ease;
  }
`;

/**
 * オーバーレイを生成する。
 * 生成時点では DOM へ未接続であり、attach() でコンテナへマウントする。
 */
export function createFrameOverlay(options: OverlayOptions = {}): FrameOverlay {
  const fadeoutMs = options.fadeoutMs ?? OVERLAY_FADEOUT_MS;

  const host = document.createElement("div");
  host.dataset.ytFrameScrubOverlay = "";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = SHADOW_STYLES;

  const box = document.createElement("div");
  box.className = "overlay";
  const frameEl = document.createElement("div");
  const timeEl = document.createElement("div");
  const fpsEl = document.createElement("div");
  box.append(frameEl, timeEl, fpsEl);
  shadow.append(style, box);
  resetReadout();

  let enabled = true;
  let attachedContainer: HTMLElement | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  // 絶対配置の基準を確保するため、position が static のコンテナには
  // 一時的に relative を当て、detach / 再マウント時に元へ戻す。
  let positionPatch: { container: HTMLElement; previous: string } | null = null;

  function show(): void {
    box.style.opacity = "1";
  }

  function hide(): void {
    box.style.opacity = "0";
  }

  function clearFadeTimer(): void {
    if (fadeTimer !== null) {
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }
  }

  function scheduleFadeout(): void {
    clearFadeTimer();
    fadeTimer = setTimeout(hide, fadeoutMs);
  }

  function restorePositionPatch(): void {
    if (positionPatch === null) {
      return;
    }
    const { container, previous } = positionPatch;
    positionPatch = null;
    // マウント中にページ側が位置指定を更新していた場合は、
    // その更新を消さないよう、このモジュールが設定した relative の
    // まま残っているときだけ元の値へ戻す。
    if (container.style.position === "relative") {
      container.style.position = previous;
    }
  }

  function resetReadout(): void {
    frameEl.textContent = UNKNOWN_FRAME;
    timeEl.textContent = UNKNOWN_TIMECODE;
    fpsEl.textContent = UNKNOWN_FPS;
  }

  function attach(container: HTMLElement): void {
    if (attachedContainer === container && host.parentElement === container) {
      return;
    }
    if (attachedContainer !== container) {
      restorePositionPatch();
      // 前のコンテナ(動画)の表示値とフェードアウト予約を持ち越さない。
      // 新しいコンテナでは次の update / notifyActivity まで表示しない。
      clearFadeTimer();
      hide();
      resetReadout();
    }
    if (getComputedStyle(container).position === "static") {
      positionPatch = {
        container,
        previous: container.style.position,
      };
      container.style.position = "relative";
    }
    attachedContainer = container;
    container.appendChild(host);
  }

  function detach(): void {
    clearFadeTimer();
    hide();
    host.remove();
    restorePositionPatch();
    attachedContainer = null;
  }

  function update(readout: OverlayReadout): void {
    frameEl.textContent = formatFrameNumber(readout.frame, readout.estimated);
    timeEl.textContent = formatTimecode(readout.timeSeconds);
    fpsEl.textContent = formatFps(readout.fps);
  }

  function notifyActivity(): void {
    if (!enabled || !isAttached()) {
      return;
    }
    show();
    scheduleFadeout();
  }

  function setEnabled(next: boolean): void {
    enabled = next;
    if (!enabled) {
      clearFadeTimer();
      hide();
    }
  }

  function isAttached(): boolean {
    return attachedContainer !== null && host.parentElement === attachedContainer;
  }

  return {
    attach,
    detach,
    update,
    notifyActivity,
    setEnabled,
    isAttached,
  };
}
