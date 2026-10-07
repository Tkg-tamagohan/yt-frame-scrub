# 実装計画

`docs/requirements-definition.md`（確定仕様）を実装へ分解した計画書である。
進捗は各フェーズのチェックリスト（`[ ]` / `[x]`）で管理し、別セッションが本書だけで作業を再開できる粒度にする。

## 前提と環境

- 対象プラットフォームは Chrome（Manifest V3）である。
- ビルドと単体テストは Linux の Devin VM 上で完結する。
- YouTube 実機での確認は Chrome で `chrome://extensions` から開発者モード読み込みを行い、youtube.com の watch ページと Shorts で実施する。
  Devin VM の Chrome でも検証可能であり、実機確認が環境上困難な場合はユーザー側の Chrome での確認を依頼する。

## 構成

リポジトリ構成の想定は次の通りである。

```
yt-frame-scrub/
├── manifest.json            # MV3 マニフェスト（esbuild の出力先 dist/ へ同梱して生成）
├── src/
│   ├── content/             # コンテンツスクリプト本体
│   │   ├── index.ts         # エントリ。動画検出と初期化、ナビゲーション追従
│   │   ├── stepper.ts       # コマ送り。フレーム番号と currentTime の換算、シークの間引き
│   │   ├── wheel-accumulator.ts  # deltaY 累積、閾値、慣性減衰、レート上限
│   │   ├── fps.ts           # fps 検出（統計情報→実測→手動値の 3 段）
│   │   └── overlay.ts       # Shadow DOM オーバーレイ（フレーム番号、タイムコード、fps）
│   ├── options/             # 設定画面（HTML+TS）
│   ├── shared/settings.ts   # chrome.storage.sync の設定スキーマと既定値
│   └── shared/i18n.ts       # 日英の文言管理
├── _locales/                # chrome.i18n 用メッセージ（ja, en）
├── tests/                   # vitest による単体テスト
├── docs/                    # 本ディレクトリ
└── dist/                    # ビルド出力（git 管理外）
```

依存方向は `content/` と `options/` が `shared/` を参照する一方向とする。
中核ロジック（ホイール蓄積、フレーム番号換算）は DOM 非依存の純粋モジュールに分け、単体テスト可能にする。

設定スキーマ（`chrome.storage.sync`）の想定キーは次の通りである。

| キー | 型 | 既定 | 内容 |
|------|-----|------|------|
| `enabled` | boolean | true | 機能の有効/無効 |
| `invertDirection` | boolean | false | スクロール方向とコマ送り方向の反転 |
| `captureModifier` | `"none" \| "alt" \| "ctrl" \| "shift"` | `"none"` | 捕捉に必須とする修飾キー |
| `stepThreshold` | number | 100 | 1 コマ化する `deltaY` 累積閾値（px） |
| `shiftStepSize` | number | 10 | Shift 併用時のコマ数 |
| `overlayEnabled` | boolean | true | オーバーレイの表示/非表示 |
| `manualFps` | number | 0 | 手動 fps。0=自動検出＋既定 30 フォールバック |

`captureModifier` と Shift 併用複数コマの競合について：`captureModifier` が `"shift"` の場合は Shift が捕捉条件を兼ねるため複数コマ機能は使えず、設定画面でその旨を示す。

## フェーズ別タスク

各フェーズはおおむね 1 PR を想定する。

### Phase 1: リポジトリ初期構成と骨格

- [ ] `manifest.json`（MV3、`storage` 権限、`https://*.youtube.com/` のコンテンツスクリプト、アクションアイコン）
- [ ] `package.json`、TypeScript、esbuild、vitest のセットアップ
- [ ] `chrome://extensions` で開発者モード読み込みできる空の拡張がビルドできる
- [ ] 受け入れ条件：watch ページでコンテンツスクリプトが読み込まれコンソールに初期化ログが出る

### Phase 2: コマ送りコア

- [ ] watch ページで `video` 要素を検出し、一時停止中のみ wheel を捕捉（`preventDefault` 付き）
- [ ] フレーム番号の管理と `(番号 + 0.5) / fps` への換算、`currentTime` シーク
- [ ] シークの間引き（一定間隔で最新目標のみ適用）
- [ ] fps は手動値のみ（既定 30）
- [ ] 受け入れ条件：一時停止中にホイールスクロールで前後のコマへ移動し、再生中はスクロールが素通りする

### Phase 3: ホイール蓄積と修飾キー

- [ ] `deltaY` 累積、閾値消化、方向ごとの符号処理、`deltaMode` の正規化
- [ ] 入力停止時の累積減衰と 1 秒あたりコマ数の上限
- [ ] Shift 併用の複数コマ移動
- [ ] `wheel-accumulator` の単体テスト
- [ ] 受け入れ条件：マウス 1 ノッチで 1 コマ、トラックパッドの慣性で誤爆しない

### Phase 4: fps 検出

- [ ] 「統計情報」の解像度表記の読み取り（実在形式を実機で確認してから実装）
- [ ] `totalVideoFrames` と `currentTime` の差分による実測
- [ ] 手動指定値へのフォールバック
- [ ] 受け入れ条件：60fps 動画と 30fps 動画でコマ送りの刻み幅が正しい（オーバーレイまたはログで確認）

### Phase 5: オーバーレイ

- [ ] Shadow DOM によるオーバーレイ（フレーム番号、タイムコード、推定 fps）
- [ ] 操作中のみ表示し、停止から数秒でフェードアウト
- [ ] `seeked` イベントでの表示更新
- [ ] 受け入れ条件：コマ送り中にフレーム番号と時刻が追従して見える

### Phase 6: 設定画面と永続化

- [ ] オプションページ（上記スキーマの全項目）、`chrome.storage.sync` への保存と反映
- [ ] アクションアイコンからの有効/無効トグル
- [ ] 修飾キーゲート設定と方向反転設定
- [ ] `_locales`（ja、en）による文言の多言語化
- [ ] 受け入れ条件：設定変更がリロードなしで挙動に反映される

### Phase 7: Shorts 対応と遷移追従

- [ ] `/shorts/` ページのプレイヤー検出と同一操作系の提供
- [ ] `yt-navigate-finish` 等のナビゲーションイベントでの再初期化
- [ ] 全画面やシアターモード、ミニプレイヤーでのオーバーレイ追従
- [ ] 広告再生中とライブ配信での無効化（検出方法は実機で確認）
- [ ] 受け入れ条件：watch と Shorts の往復、全画面遷移で機能が壊れない

### Phase 8: テストとリリース準備

- [ ] ホイール蓄積とフレーム番号換算の単体テストを仕上げる
- [ ] 手動確認手順書（`docs/manual-test.md`）を作成
- [ ] GitHub Release 用 zip のビルド手順
- [ ] Chrome Web Store 掲載物：アイコン、スクリーンショット、説明文（日英）、プライバシー表明
- [ ] 受け入れ条件：zip がローカル読み込みで動作し、ストア申請に必要な素材が揃う

## 引き継ぎ手順

- 現在地の確認は本書のチェックリストとマージ済み PR で行う。
- ブランチは `devin/<unix 秒>-<短いスラグ>` で作成する。
- 実装セッションの再開プロンプト例：`@Tkg-tamagohan/yt-frame-scrub docs/implementation-plan.md の Phase N を実施してください`。
- 実機確認が必要なフェーズでは、Devin VM の Chrome での検証を優先し、困難ならユーザー側での確認手順を依頼に含める。
- 要件や決定に矛盾を見つけた場合はコードではなく `docs/requirements-definition.md` または `docs/decision-records.md` 側を先に修正するか、ユーザーに確認する。
