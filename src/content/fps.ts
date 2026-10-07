/**
 * fps 検出モジュール。
 * 要件定義書「fps の検出」の 3 段優先順位を実装する。
 *
 *   1. 「統計情報」(Stats for nerds) の解像度表記から読み取る
 *   2. getVideoPlaybackQuality().totalVideoFrames と currentTime の差分から実測する
 *   3. 手動指定値。0 または未指定なら既定値 30 にフォールバックする
 *
 * パース・実測計算・優先順位選択は DOM 非依存の純粋関数として export し、
 * DOM 参照とイベント購読を持つ生成部は createFpsResolver に集約する。
 * 呼び出し側(index.ts/stepper.ts)への配線は Phase 7 の統合で行う。
 */

/** 手動値未指定時のフォールバック fps(要件定義書の既定値) */
export const DEFAULT_FPS = 30;

/** 検出元の識別タグ。推定値の出どころを呼び出し側が区別できるようにする。 */
export type FpsSource = "stats" | "measured" | "manual" | "default";

export interface FpsEstimate {
  fps: number;
  source: FpsSource;
}

/** 実測サンプル 1 点分。totalVideoFrames は累積値、currentTime はメディア時刻(秒)。 */
export interface FrameSample {
  totalVideoFrames: number;
  currentTime: number;
}

function isValidFps(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 「統計情報」の解像度表記文字列から fps を抽出する。
 *
 * 想定形式は `1920x1080@30`。実在形式は未検証のため、次の表記揺れを許容する。
 *   - `1920x1080@30`(整数 fps)
 *   - `1920x1080@29.97`(小数 fps)
 *   - `1920 x 1080 @ 30` / `1920×1080@30`(空白・乗算記号の揺れ)
 *   - `@30` のように解像度を欠く表記(フォールバック)
 * 1 行に `@fps` が複数並ぶ形式(現在値/最適値の併記)では先頭を採用する。
 * fps が 0 以下・非数値・形式不一致なら null を返す。
 */
export function parseFpsFromResolutionText(
  text: string | null | undefined,
): number | null {
  if (!text) {
    return null;
  }
  const resolutionMatch = /\d+\s*[x×]\s*\d+\s*@\s*(\d+(?:\.\d+)?)/.exec(text);
  const bareMatch = /@\s*(\d+(?:\.\d+)?)/.exec(text);
  // `@` の出現位置が先の候補(先頭=現在値)を採用する
  const raw =
    resolutionMatch !== null &&
    bareMatch !== null &&
    bareMatch.index < resolutionMatch.index
      ? bareMatch[1]
      : (resolutionMatch?.[1] ?? bareMatch?.[1]);
  if (raw === undefined) {
    return null;
  }
  const fps = Number.parseFloat(raw);
  return isValidFps(fps) ? fps : null;
}

/**
 * totalVideoFrames と currentTime の差分から fps を算出する。
 * メディア時刻で割るため再生速度(playbackRate)の影響を受けない。
 * フレーム差・時刻差が 0 以下、または非有限値なら null を返す。
 */
export function computeMeasuredFps(
  first: FrameSample,
  last: FrameSample,
): number | null {
  const dFrames = last.totalVideoFrames - first.totalVideoFrames;
  const dTime = last.currentTime - first.currentTime;
  if (dFrames <= 0 || dTime <= 0) {
    return null;
  }
  const fps = dFrames / dTime;
  return Number.isFinite(fps) ? fps : null;
}

export interface FpsSelectionInput {
  /** 「統計情報」からの検出値(未検出は null か省略) */
  statsFps?: number | null;
  /** 実測値(未確定は null か省略) */
  measuredFps?: number | null;
  /** 手動指定値。0・未指定・不正値は「未指定」として扱う */
  manualFps?: number | null;
  /** フォールバック既定値。省略時は DEFAULT_FPS(30) */
  defaultFps?: number;
}

/**
 * 3 段優先順位に従って採用 fps を選ぶ。
 * 無効値(0 以下・非有限)は各段でスキップし、どれも得られなければ既定値を返す。
 * 戻り値の source でどの段の値かを判別できる。
 */
export function selectFpsEstimate(input: FpsSelectionInput): FpsEstimate {
  if (isValidFps(input.statsFps)) {
    return { fps: input.statsFps, source: "stats" };
  }
  if (isValidFps(input.measuredFps)) {
    return { fps: input.measuredFps, source: "measured" };
  }
  if (isValidFps(input.manualFps)) {
    return { fps: input.manualFps, source: "manual" };
  }
  const defaultFps = isValidFps(input.defaultFps)
    ? input.defaultFps
    : DEFAULT_FPS;
  return { fps: defaultFps, source: "default" };
}

/**
 * createFpsResolver が要求する video の最小インターフェース。
 * HTMLVideoElement はこの形を満たす。テストではスタブを差せるよう DOM 型へ依存を限定する。
 */
export interface FpsMeasurableVideo {
  readonly currentTime: number;
  readonly paused: boolean;
  readonly seeking: boolean;
  getVideoPlaybackQuality(): { totalVideoFrames: number };
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void;
}

export interface FpsResolverOptions {
  /** 手動指定 fps。0 または未指定は「未指定」(自動検出＋既定 30 フォールバック) */
  manualFps?: number;
  /**
   * 「統計情報」の解像度表記を読み取る DOM アクセス。
   * detectFromStatsText 呼び出し時に評価される。未指定なら統計情報段は常に未検出。
   */
  readStatsResolutionText?: () => string | null;
  /**
   * 実測を確定するメディア経過秒数の下限(既定 1.0)。
   * フレーム差・時刻差のどちらかの下限を超えた時点で確定する。
   */
  minMeasureSeconds?: number;
  /** 実測を確定するフレーム差の下限(既定 30) */
  minMeasureFrames?: number;
}

export interface FpsResolver {
  /**
   * 現時点の最良推定値を返す。
   * 確定済みの統計情報値 → 確定済みの実測値 → 手動値 → 既定 30 の順で選ばれる。
   */
  getEstimate(): FpsEstimate;
  /**
   * 「統計情報」段の検出を試行する。
   * readStatsResolutionText で得た表記をパースし、成功すれば確定値として保持する。
   * 読み取り関数未指定・表記なし・パース失敗なら null を返す(既存の確定値は維持)。
   */
  detectFromStatsText(): FpsEstimate | null;
  /** 手動指定値を更新する(設定変更の反映用)。 */
  setManualFps(value: number): void;
  /**
   * 確定値と測定中状態をすべて初期化する。
   * newVideo を渡した場合は旧要素へのイベント購読を解除して新要素へ登録し直す
   * (YouTube のページ遷移で動画要素が作り直されるケースに対応)。
   * 現在再生中なら実測を再開する。
   */
  reset(newVideo?: FpsMeasurableVideo): void;
  /** video へのイベント購読を解除する。 */
  dispose(): void;
}

/**
 * fps 検出リゾルバを生成する。
 *
 * 実測はイベント駆動で、ポーリングループを持たない。
 *   - playing でサンプリング開始(一時停止のみの利用では発火せず次段へフォールバック)
 *   - timeupdate ごとに差分を確認し、一定時間または十分なフレーム数で確定
 *   - pause / seeking / ended で未確定のサンプルを破棄(シークによる時刻跳躍で
 *     フレーム差と時刻差が不整合になるのを防ぐ)。シーク中の timeupdate は無視し、
 *     seeked で必ずシーク後の状態から測定をやり直す
 *   - 動画要素の差し替えは reset(newVideo) でイベント購読を付け替える
 * 確定値はリセットまでキャッシュされる。
 */
export function createFpsResolver(
  initialVideo: FpsMeasurableVideo,
  options: FpsResolverOptions = {},
): FpsResolver {
  const minMeasureSeconds = options.minMeasureSeconds ?? 1.0;
  const minMeasureFrames = options.minMeasureFrames ?? 30;

  let video = initialVideo;
  let manualFps = options.manualFps ?? 0;
  let statsFps: number | null = null;
  let measuredFps: number | null = null;
  let sampleStart: FrameSample | null = null;

  const takeSample = (): FrameSample => ({
    totalVideoFrames: video.getVideoPlaybackQuality().totalVideoFrames,
    currentTime: video.currentTime,
  });

  const beginSampling = (): void => {
    if (measuredFps !== null || sampleStart !== null) {
      return;
    }
    sampleStart = takeSample();
  };

  const onTimeUpdate = (): void => {
    // シーク中の timeupdate は開始点の作成も確定も行わない
    // (シーク完了前のメディア時刻・フレーム数は未確定で、差分を取ると誤った fps になる)
    if (measuredFps !== null || video.paused || video.seeking) {
      return;
    }
    if (sampleStart === null) {
      // 中断後(一時停止からの再開など)に再生中のまま戻った経路をここで再武装する
      sampleStart = takeSample();
      return;
    }
    const last = takeSample();
    const dFrames = last.totalVideoFrames - sampleStart.totalVideoFrames;
    const dTime = last.currentTime - sampleStart.currentTime;
    if (dTime < minMeasureSeconds && dFrames < minMeasureFrames) {
      return;
    }
    const fps = computeMeasuredFps(sampleStart, last);
    if (fps === null) {
      // 時刻だけ進んでフレームが増えない区間(停滞等)は窓をずらして測り直す
      sampleStart = last;
      return;
    }
    measuredFps = fps;
    sampleStart = null;
  };

  const abortSampling = (): void => {
    sampleStart = null;
  };

  const onSeeked = (): void => {
    if (measuredFps !== null || video.paused) {
      return;
    }
    // シーク中に作成された開始点も含め、必ずシーク完了後の状態で取り直す
    sampleStart = takeSample();
  };

  const attach = (target: FpsMeasurableVideo): void => {
    target.addEventListener("playing", beginSampling);
    target.addEventListener("timeupdate", onTimeUpdate);
    target.addEventListener("pause", abortSampling);
    target.addEventListener("seeking", abortSampling);
    target.addEventListener("seeked", onSeeked);
    target.addEventListener("ended", abortSampling);
  };

  const detach = (target: FpsMeasurableVideo): void => {
    target.removeEventListener("playing", beginSampling);
    target.removeEventListener("timeupdate", onTimeUpdate);
    target.removeEventListener("pause", abortSampling);
    target.removeEventListener("seeking", abortSampling);
    target.removeEventListener("seeked", onSeeked);
    target.removeEventListener("ended", abortSampling);
  };

  attach(video);

  // 生成時点で既に再生中なら直ちにサンプリングを始める
  if (!video.paused) {
    beginSampling();
  }

  return {
    getEstimate: () =>
      selectFpsEstimate({ statsFps, measuredFps, manualFps }),

    detectFromStatsText: () => {
      const text = options.readStatsResolutionText?.();
      const fps = parseFpsFromResolutionText(text);
      if (fps === null) {
        return null;
      }
      statsFps = fps;
      return { fps, source: "stats" };
    },

    setManualFps: (value: number): void => {
      manualFps = value;
    },

    reset: (newVideo?: FpsMeasurableVideo): void => {
      statsFps = null;
      measuredFps = null;
      sampleStart = null;
      if (newVideo !== undefined && newVideo !== video) {
        detach(video);
        video = newVideo;
        attach(video);
      }
      if (!video.paused) {
        beginSampling();
      }
    },

    dispose: (): void => {
      detach(video);
      sampleStart = null;
    },
  };
}
