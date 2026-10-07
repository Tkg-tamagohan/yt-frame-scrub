# Chrome Web Store 掲載物

`docs/decision-records.md` の仕様決定 G に基づく、Chrome Web Store 公開用の素材と文言をまとめた文書である。
ストアへの登録自体は拡張の管理者がデベロッパーダッシュボードで行う。

## ストア掲載用アイコン

`icons/` 配下の PNG をそのまま使う。

| 用途 | サイズ | ファイル |
|------|--------|----------|
| 拡張アイコン・ストア小アイコン | 16 / 32 / 48 / 128 px | `icons/icon-*.png` |

ストアの「ストアアイコン」欄は 128 px 版を登録する。

## 説明文（日本語）

### 簡単な説明（132 文字以内）

一時停止中の YouTube 動画をマウスホイールでコマ送り・コマ戻しする拡張機能。フレーム番号とタイムコードをオーバーレイ表示します。

### 詳細な説明

一時停止中の YouTube 動画を、マウスホイールのスクロールで 1 フレーム単位に送り・戻しできる Chrome 拡張です。

YouTube 標準のコマ送り（`,`・`.` キー）はキーボード操作が前提です。この拡張は一時停止中のプレイヤー上でのホイールスクロールをコマ送りに変換し、マウスだけで操作を完結させます。コマ送り操作中はフレーム番号・タイムコード・推定 fps がプレイヤー内のオーバーレイに表示され、操作が止まると自動で消えます。

主な機能:

- 一時停止中のスクロールでコマ送り・コマ戻し（再生中は従来どおりページスクロール）
- マウスホイールの 1 ノッチで 1 コマ。トラックパッドの小刻みな入力は蓄積して処理し、慣性による誤操作を抑止
- Shift 併用で 1 ノッチ複数コマの移動
- ホイール蓄積の閾値、スクロール方向の反転、捕捉に必要な修飾キーなどを設定画面で調整可能
- 動画の fps を自動検出（「統計情報」の表記・フレーム数の実測から取得。失敗時は手動指定または既定 30fps）
- ツールバーのアイコンクリックで機能の有効/無効を即時切り替え
- watch ページと YouTube Shorts の両方に対応。広告再生中とライブ配信では自動的に無効化

対応言語: 日本語・英語（ブラウザの言語に追従します）。

## Description (English)

### Short description (within 132 chars)

Step through paused YouTube videos frame by frame with the mouse wheel. Shows frame number and timecode in an overlay.

### Detailed description

A Chrome extension that lets you step forward and backward one frame at a time by scrolling the mouse wheel over a paused YouTube video.

YouTube's built-in frame stepping (`,` and `.` keys) requires the keyboard. This extension converts wheel scrolls over the paused player into frame steps so the whole operation can be done with the mouse alone. While stepping, a small overlay inside the player shows the frame number, timecode, and estimated fps, and fades out a few seconds after you stop.

Features:

- Scroll to step forward/backward while paused (normal page scroll is preserved while playing)
- One wheel notch = one frame; accumulates small trackpad deltas and suppresses inertial drift
- Shift+scroll to move multiple frames per notch
- Adjustable accumulation threshold, direction inversion, and a modifier-key requirement in the options page
- Automatic fps detection (from Stats for nerds text or measured frame counts, with a manual fallback)
- Toolbar icon toggles the feature on/off instantly
- Works on both watch pages and YouTube Shorts; automatically disabled during ads and live streams

Languages: Japanese and English (follows the browser language).

## プライバシー表明

ストアのプライバシーに関する回答欄（データの取り扱いの表明）に記載する内容:

- この拡張機能はユーザーデータを収集・送信・保存（外部サーバーへの）しません。
- 外部への通信を一切行いません。動作は youtube.com 上のコンテンツスクリプトとブラウザ内の設定保存（chrome.storage.sync）のみで完結します。
- 要求する権限は `storage`（設定の同期保存）と `https://*.youtube.com/` へのコンテンツスクリプトのみです。

## スクリーンショット

1280×800 または 640×400 の PNG/JPEG が必要。撮影は実機の Chrome で行い、以下の構図を推奨する（本環境では撮影未実施のため、撮影自体はユーザー側の作業）。

| # | 構図 | 目的 |
|---|------|------|
| 1 | 一時停止中の動画上でオーバーレイが出ている状態（フレーム番号・タイムコード・fps が見える） | 機能の一目での理解 |
| 2 | 設定画面全体 | 調整可能な項目の提示 |
| 3 | Shorts での動作（可能なら） | 対応範囲の提示 |
| 4 | ツールバーアイコンとバッジ（無効状態） | トグルの存在の提示 |

## カテゴリ等

- カテゴリ: 「仕事効率化」または「機能拡張」を想定
- 言語: 日本語（既定）・英語
