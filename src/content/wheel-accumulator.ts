/**
 * ホイール蓄積モジュール（FR-2, FR-3、仕様決定 A・C）。
 *
 * wheel イベントの deltaY を累積し、閾値を超えるごとにコマ数として消費する。
 * DOM 非依存の純粋モジュールであり、イベント由来の値と設定値を入力、
 * 捕捉可否と符号付きコマ数を出力とする。
 *
 * 座標系の約束:
 *   - 入力の deltaY は DOM の値どおり（下スクロールが正）。
 *   - 内部では「コマ送り方向を正」に正規化する（上スクロールが正）。
 *   - 出力 frames は正でコマ送り、負でコマ戻し。invertDirection で反転する。
 *
 * 要件定義書に数値の定めがない暫定値は DEFAULT_* 定数に集約した:
 *   - 行単位・ページ単位の px 換算係数（LINE_HEIGHT_PX / PAGE_HEIGHT_PX）
 *   - 減衰の開始遅延と半減期（DECAY_DELAY_MS / DECAY_HALF_LIFE_MS）
 *   - レート上限（MAX_STEPS_PER_SECOND）
 */

import type { CaptureModifier } from "../shared/settings";

/** deltaMode=1（行）の px 換算係数。1 ノッチ≒3 行 ≒ 120px と想定。 */
export const LINE_HEIGHT_PX = 40;
/** deltaMode=2（ページ）の px 換算係数。 */
export const PAGE_HEIGHT_PX = 800;

/** 入力停止から減衰が始まるまでの時間(ms)。 */
export const DECAY_DELAY_MS = 80;
/** 減衰の半減期(ms)。遅延後、この時間ごとに残量が半分になる。 */
export const DECAY_HALF_LIFE_MS = 150;
/** 1 秒あたりのコマ数上限。トラックパッド慣性の誤爆防止。 */
export const MAX_STEPS_PER_SECOND = 30;
/** 残量がこの px 未満なら 0 とみなす（浮動小数点の残留を消す）。 */
const ACC_EPSILON_PX = 0.5;

/** wheel イベント由来の 1 入力。 */
export interface WheelInput {
  /** DOM の deltaY（下スクロールが正）。 */
  deltaY: number;
  /** DOM の deltaMode。0=ピクセル、1=行、2=ページ。 */
  deltaMode: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export interface WheelAccumulatorConfig {
  /** 1 コマに換算する累積量(px)。設定キー stepThreshold。 */
  stepThresholdPx: number;
  /** Shift 併用時の 1 ノッチあたりコマ数。設定キー shiftStepSize。 */
  shiftStepSize: number;
  /** スクロール方向とコマ送り方向の反転。設定キー invertDirection。 */
  invertDirection: boolean;
  /** 捕捉に必須とする修飾キー。設定キー captureModifier。 */
  captureModifier: CaptureModifier;
  /** 入力停止から減衰開始までの時間(ms)。 */
  decayDelayMs: number;
  /** 減衰の半減期(ms)。0 以下は減衰なし。 */
  decayHalfLifeMs: number;
  /** 1 秒あたりのコマ数上限。0 以下は無制限。 */
  maxStepsPerSecond: number;
}

/** feed() の戻り値。 */
export interface WheelResult {
  /**
   * このイベントを捕捉したか。
   * true のとき呼び出し側は preventDefault し、false のときはイベントを素通しする。
   */
  captured: boolean;
  /** 捕捉により発生したコマ数（符号付き、0 = 閾値未満の蓄積のみ）。 */
  frames: number;
}

/**
 * 設定スキーマから蓄積器の設定を組み立てる。
 */
export function configFromSettings(settings: {
  invertDirection: boolean;
  captureModifier: CaptureModifier;
  stepThreshold: number;
  shiftStepSize: number;
}): WheelAccumulatorConfig {
  return {
    stepThresholdPx: settings.stepThreshold,
    shiftStepSize: settings.shiftStepSize,
    invertDirection: settings.invertDirection,
    captureModifier: settings.captureModifier,
    decayDelayMs: DECAY_DELAY_MS,
    decayHalfLifeMs: DECAY_HALF_LIFE_MS,
    maxStepsPerSecond: MAX_STEPS_PER_SECOND,
  };
}

/**
 * deltaY を「コマ送り方向が正」の px 量へ正規化する。
 * DOM では下スクロールが正のため符号を反転する。
 */
export function normalizeDeltaPx(deltaY: number, deltaMode: number): number {
  const factor =
    deltaMode === 1 ? LINE_HEIGHT_PX : deltaMode === 2 ? PAGE_HEIGHT_PX : 1;
  return -deltaY * factor;
}

/**
 * 修飾キーゲート（仕様決定 C）。
 * captureModifier が "none" なら常に捕捉、"alt" 等ならそのキー押下中のみ捕捉する。
 */
export function isCaptureAllowed(
  captureModifier: CaptureModifier,
  input: Pick<WheelInput, "altKey" | "ctrlKey" | "shiftKey">,
): boolean {
  switch (captureModifier) {
    case "none":
      return true;
    case "alt":
      return input.altKey;
    case "ctrl":
      return input.ctrlKey;
    case "shift":
      return input.shiftKey;
  }
}

/**
 * deltaY の累積とコマ数への換算を行う状態機械。
 * 時刻は呼び出し側が渡す（実装上は WheelEvent.timeStamp を想定）。
 */
export class WheelAccumulator {
  private config: WheelAccumulatorConfig;
  /** 未消化の累積量(px)。コマ送り方向が正。 */
  private accPx = 0;
  /** 直前入力の時刻(ms)。未入力は null。 */
  private lastInputAt: number | null = null;
  /** レート制限のトークン残量。上限まで自動補充される。 */
  private tokenBudget: number;
  private lastRefillAt: number | null = null;

  constructor(config: WheelAccumulatorConfig) {
    this.config = config;
    this.tokenBudget = config.maxStepsPerSecond;
  }

  /** 設定変更をリロードなしで反映する。内部状態（累積・トークン）は保持する。 */
  updateConfig(config: WheelAccumulatorConfig): void {
    this.config = config;
    if (config.maxStepsPerSecond < this.tokenBudget) {
      this.tokenBudget = config.maxStepsPerSecond;
    }
  }

  /**
   * wheel イベント 1 件を処理する。
   * @param input イベント由来の値
   * @param now イベント時刻(ms)。テストでは任意の単調時計でよい。
   */
  feed(input: WheelInput, now: number): WheelResult {
    if (!isCaptureAllowed(this.config.captureModifier, input)) {
      // ゲート不成立の入力は捕捉せず、累積にも加えない
      return { captured: false, frames: 0 };
    }

    const px = normalizeDeltaPx(input.deltaY, input.deltaMode);
    if (!Number.isFinite(px) || px === 0) {
      return { captured: true, frames: 0 };
    }

    this.decay(now);
    // 逆方向の入力が来たら残っている蓄積は捨てる（方向転換を即座に反映するため）
    if (this.accPx !== 0 && Math.sign(px) !== Math.sign(this.accPx)) {
      this.accPx = 0;
    }
    this.accPx += px;

    const threshold = this.config.stepThresholdPx;
    let notches = 0;
    if (threshold > 0 && Math.abs(this.accPx) >= threshold) {
      notches = Math.trunc(this.accPx / threshold);
      // 消化しきれない閾値未満の端数だけ残す
      this.accPx -= notches * threshold;
    }

    // FR-3: Shift 併用で 1 ノッチあたり shiftStepSize コマ。
    // captureModifier === "shift" のとき Shift は捕捉条件なので本機能は使わない。
    const shiftStepActive =
      input.shiftKey && this.config.captureModifier !== "shift";
    let frames =
      notches * (shiftStepActive ? this.config.shiftStepSize : 1);

    frames = this.applyRateLimit(frames, now);

    if (this.config.invertDirection) {
      frames = -frames;
    }
    this.lastInputAt = now;
    return { captured: true, frames };
  }

  /**
   * 入力停止から decayDelayMs 経過後、累積値を半減期 decayHalfLifeMs の
   * 指数減衰で 0 へ近づける。トラックパッド慣性の端数が後で発火するのを防ぐ。
   */
  private decay(now: number): void {
    if (
      this.lastInputAt === null ||
      this.accPx === 0 ||
      this.config.decayHalfLifeMs <= 0
    ) {
      return;
    }
    const idleMs = now - this.lastInputAt - this.config.decayDelayMs;
    if (idleMs <= 0) {
      return;
    }
    this.accPx *= Math.pow(0.5, idleMs / this.config.decayHalfLifeMs);
    if (Math.abs(this.accPx) < ACC_EPSILON_PX) {
      this.accPx = 0;
    }
  }

  /**
   * 1 秒あたりコマ数の上限をトークンバケットで適用する。
   * 上限を超えた分のコマは捨てる（キューに残すと操作停止後も送り続けるため）。
   * バケット容量は maxStepsPerSecond で、閑散後の先頭バーストを許容する。
   */
  private applyRateLimit(frames: number, now: number): number {
    const max = this.config.maxStepsPerSecond;
    if (max <= 0) {
      return frames;
    }
    if (this.lastRefillAt !== null) {
      const refill = ((now - this.lastRefillAt) / 1000) * max;
      this.tokenBudget = Math.min(max, this.tokenBudget + refill);
    }
    this.lastRefillAt = now;

    const emitted = Math.trunc(
      Math.sign(frames) * Math.min(Math.abs(frames), this.tokenBudget),
    );
    this.tokenBudget -= Math.abs(emitted);
    return emitted;
  }

  /** テストと後続フェーズの診断用: 現在の未消化累積量(px)。 */
  get pendingPx(): number {
    return this.accPx;
  }
}
