/**
 * コマ送りコア（FR-1、要件定義書「コマ送りの実現方式」）。
 *
 * フレーム番号を整数で内部管理し、目標番号を `(番号 + 0.5) / fps` で時刻へ
 * 換算して video.currentTime へシークする。フレーム中央を狙うのは、
 * 境界ちょうどの指定が丸め誤差で前のフレームに留まるのを避けるため。
 *
 * 目標番号の更新は即時に行い、実際のシーク代入は一定間隔
 * （DEFAULT_SEEK_INTERVAL_MS）にまとめて最新の目標だけを適用する。
 *
 * fps は外部から getter で受け取る（後続フェーズの自動検出層に差し替え可能）。
 * video 要素やタイマーは依存注入でき、DOM なしで単体テストできる。
 */

/** シーク適用の間引き間隔(ms)。仕様は「一定間隔（数 10 ミリ秒）」。 */
export const DEFAULT_SEEK_INTERVAL_MS = 40;

/** 自動検出が未実装の間の既定 fps（要件定義書「fps の検出」第 3 段）。 */
export const DEFAULT_FPS = 30;

/** コマ送り 1 回分の通知内容（オーバーレイ等の後続モジュール向け）。 */
export interface StepInfo {
  /** 現在の目標フレーム番号（整数、推定値）。 */
  frame: number;
  /** 目標フレームに対応するシーク時刻(秒)。 */
  timeSec: number;
  /** 換算に用いた fps。 */
  fps: number;
  /** 今回加算されたコマ数（符号付き）。 */
  delta: number;
}

/** stepper が必要とする video 要素の最小インターフェース。 */
export interface StepperVideo {
  /** 現在の再生位置(秒)。 */
  currentTime: number;
  /** 動画の長さ(秒)。未確定なら NaN / Infinity。 */
  duration: number;
}

export interface FrameStepperOptions {
  video: StepperVideo;
  /**
   * fps の取得関数。呼び出しのたびに評価されるため、
   * 設定変更や検出結果の変化をそのまま反映できる。
   */
  getFps: () => number;
  /** シーク適用の間引き間隔(ms)。省略時 DEFAULT_SEEK_INTERVAL_MS。 */
  seekIntervalMs?: number;
  /**
   * 実際のシーク代入。省略時は video.currentTime への代入。
   * テストでは観測用の関数を注入する。
   */
  seek?: (timeSec: number) => void;
  /** タイマー登録。省略時は setTimeout。テストでは手動発火の関数を注入する。 */
  schedule?: (fn: () => void, ms: number) => unknown;
  /** タイマー解除。省略時は clearTimeout。 */
  cancelSchedule?: (handle: unknown) => void;
  /**
   * シーク適用の直前チェック。false を返すとき保留中のシークは捨てる。
   * 省略時は常に許可（= 常に一時停止中という前提のテスト等向け）。
   * 実装側では video.paused を渡し、再生開始との順序競合を防ぐ（FR-5）。
   */
  shouldSeek?: () => boolean;
  /** コマ送りが発生したときの通知（オーバーレイ配線用の差し込み口）。 */
  onStep?: (info: StepInfo) => void;
}

/**
 * フレーム番号の管理とシーク適用を行うクラス。
 * DOM イベントとは切り離し、video の seeked / pause は
 * notifySeeked / notifyPaused として呼び出し側から通知する。
 */
export class FrameStepper {
  private readonly video: StepperVideo;
  private readonly getFps: () => number;
  private readonly seekIntervalMs: number;
  private readonly seek: (timeSec: number) => void;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancelSchedule: (handle: unknown) => void;
  private readonly shouldSeek: () => boolean;
  private readonly onStep?: (info: StepInfo) => void;

  /** 目標フレーム番号。整数で管理する。 */
  private targetFrame: number;
  /** targetFrame の基準となった fps。getFps() が変化したら再同期する。 */
  private lastFps: number;
  /** 直前にシークを発行した目標フレーム番号。未発行は null。 */
  private appliedFrame: number | null = null;
  /** 発行済みシークと着地のズレ許容幅（フレーム）。 */
  private static readonly SEEK_TOLERANCE_FRAMES = 1;
  private flushHandle: unknown = null;

  constructor(options: FrameStepperOptions) {
    this.video = options.video;
    this.getFps = options.getFps;
    this.seekIntervalMs =
      options.seekIntervalMs ?? DEFAULT_SEEK_INTERVAL_MS;
    this.seek =
      options.seek ?? ((t) => void (this.video.currentTime = t));
    this.schedule =
      options.schedule ??
      ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.cancelSchedule =
      options.cancelSchedule ??
      ((h) => clearTimeout(h as Parameters<typeof clearTimeout>[0]));
    this.shouldSeek = options.shouldSeek ?? (() => true);
    this.onStep = options.onStep;
    this.targetFrame = this.currentFrameEstimate();
    this.lastFps = this.fpsOrFallback();
  }

  /**
   * 目標フレーム番号を delta コマ分更新し、シークを予約する。
   * 実際の currentTime 代入は間引き間隔ごとに最新目標だけ適用される。
   */
  stepBy(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    const fps = this.syncFps();
    this.targetFrame = this.clampFrame(this.targetFrame + delta, fps);
    this.onStep?.({
      frame: this.targetFrame,
      timeSec: this.frameToTime(this.targetFrame, fps),
      fps,
      delta,
    });
    if (this.flushHandle === null) {
      this.flushHandle = this.schedule(() => {
        this.flushHandle = null;
        this.flush();
      }, this.seekIntervalMs);
    }
  }

  /**
   * video の seeked イベントに対応する。
   * 自前のシークの着地（appliedFrame の前後 1 フレーム以内）なら、
   * 待機中の目標を上書きしないよう、目標が発行済みと一致するときだけ
   * 実測値へ補正する。それより大きくずれた着地は外部シーク（ユーザーが
   * シークバーや , . キーで動かした等）とみなし、目標を実測へ追従させる。
   */
  notifySeeked(): void {
    const fps = this.syncFps();
    const actual = this.currentFrameEstimate(fps);
    if (
      this.appliedFrame === null ||
      Math.abs(actual - this.appliedFrame) >
        FrameStepper.SEEK_TOLERANCE_FRAMES
    ) {
      this.targetFrame = this.clampFrame(actual, fps);
      this.appliedFrame = null;
      return;
    }
    if (this.targetFrame === this.appliedFrame) {
      this.targetFrame = this.clampFrame(actual, fps);
    }
  }

  /**
   * video の pause イベントに対応する。
   * 再生で currentTime が進んだあと一時停止したので、
   * 目標フレームを実位置へ再同期する。
   */
  notifyPaused(): void {
    const fps = this.syncFps();
    this.targetFrame = this.clampFrame(this.currentFrameEstimate(fps), fps);
    this.appliedFrame = null;
  }

  /**
   * video の play イベントに対応する。
   * 再生が始まったら保留中のシークを破棄する（FR-5: 再生中はコマ送りしない）。
   * ホイール操作直後に再生ボタンが押されると、間引きで待機していた
   * タイマーが再生中に発火して位置を巻き戻すのを防ぐ。
   */
  notifyPlay(): void {
    this.dispose();
    this.appliedFrame = null;
  }

  /** 保留中のシーク予約を捨てる。video 要素の差し替えや破棄時に呼ぶ。 */
  dispose(): void {
    if (this.flushHandle !== null) {
      this.cancelSchedule(this.flushHandle);
      this.flushHandle = null;
    }
  }

  /** 診断・後続フェーズ（オーバーレイ）向けの現在状態。 */
  getState(): { targetFrame: number; fps: number } {
    return { targetFrame: this.targetFrame, fps: this.fpsOrFallback() };
  }

  /**
   * 間引き間隔が来たら最新の目標だけをシークへ適用する。
   * 発火時点でシーク不許可（再生開始済み等）なら保留分を捨てる。
   */
  private flush(): void {
    const fps = this.syncFps();
    if (!this.shouldSeek()) {
      this.appliedFrame = null;
      return;
    }
    this.appliedFrame = this.targetFrame;
    this.seek(this.frameToTime(this.targetFrame, fps));
  }

  /** (番号 + 0.5) / fps。フレーム中央を狙う換算（要件定義書どおり）。 */
  private frameToTime(frame: number, fps: number): number {
    return (frame + 0.5) / fps;
  }

  /**
   * currentTime から現在フレーム番号の推定値を求める。
   * 「currentTime が含まれるフレーム番号」なので切り捨て（floor）を使う。
   * シーク先のフレーム中央 (N+0.5)/fps に着地すると currentTime*fps は
   * N+0.5 になり、四捨五入（round）だと N+1 に丸められて目標が 1 コマ
   * 先行してしまう（実機検証で確認。先頭では frame=0 不可達のループになる）。
   */
  private currentFrameEstimate(fps = this.fpsOrFallback()): number {
    return Math.floor(this.video.currentTime * fps);
  }

  /**
   * 目標番号を [0, 末尾フレーム] に収める。duration 不明なら上限なし。
   * 末尾フレームは「中央時刻 (f+0.5)/fps が duration 未満」となる
   * 最大の整数番号で、f < duration*fps - 0.5 の上限を満たす。
   */
  private clampFrame(frame: number, fps: number): number {
    let maxFrame = Number.POSITIVE_INFINITY;
    const duration = this.video.duration;
    if (Number.isFinite(duration) && duration > 0) {
      maxFrame = Math.max(0, Math.ceil(duration * fps - 0.5) - 1);
    }
    return Math.min(Math.max(Math.trunc(frame), 0), maxFrame);
  }

  /**
   * fps が取得不能（0・非数・負）のとき既定 30 にフォールバックする。
   * 要件定義書「fps の検出」第 3 段のフォールバック規則どおり。
   */
  private fpsOrFallback(): number {
    const fps = this.getFps();
    return Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS;
  }

  /**
   * 現在の fps を返す。fps が変化していれば targetFrame を現在位置で
   * 再同期してから返す（フレーム番号は fps 基準のため、旧基準の番号を
   * 新 fps で換算すると再生位置が大きく飛ぶ）。
   */
  private syncFps(): number {
    const fps = this.fpsOrFallback();
    if (fps !== this.lastFps) {
      this.lastFps = fps;
      this.targetFrame = this.clampFrame(this.currentFrameEstimate(fps), fps);
      this.appliedFrame = null;
    }
    return fps;
  }
}
