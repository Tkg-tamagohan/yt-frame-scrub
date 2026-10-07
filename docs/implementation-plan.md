# 実装計画

`docs/requirements-definition.md`（確定仕様）を実装へ分解した計画書である。
進捗は各フェーズのチェックリスト（`[ ]` / `[x]`）で管理し、別セッションが本書だけで作業を再開できる粒度にする。

## 前提と環境

- 対象プラットフォームは Chrome（Manifest V3）である。
- ビルドと単体テストは Linux の Devin VM 上で完結する。
- YouTube 実機での確認は Chrome で `chrome://extensions` から開発者モード読み込みを行い、youtube.com の watch ページと Shorts で実施する。
  Devin VM の Chrome でも検証可能であり、実機確認が環境上困難な場合はユーザー側の Chrome での確認を依頼する。

## 構成

リポジトリの現行構成は次の通りである。

```
yt-frame-scrub/
├── manifest.json            # MV3 マニフェスト（build.mjs が dist/ へコピーして同梱）
├── build.mjs                # esbuild バンドルと dist/ 生成（manifest・icons・_locales・options の複写）
├── package.json             # 依存ツールとスクリプト（build / test / typecheck / pack）
├── package-lock.json        # 依存のロックファイル
├── tsconfig.json            # TypeScript strict 設定
├── README.md                # 概要と docs への導線
├── LICENSE                  # MIT ライセンス
├── src/
│   ├── content/             # コンテンツスクリプト本体
│   │   ├── index.ts         # エントリ。動画検出と初期化、ナビゲーション追従
│   │   ├── session.ts       # プレイヤーごとの配線一式（入力・fps・オーバーレイの結合と解除）
│   │   ├── players.ts       # watch・Shorts・ミニプレイヤーの対象要素の検出
│   │   ├── stepper.ts       # コマ送り。フレーム番号と currentTime の換算、シークの間引き
│   │   ├── wheel-accumulator.ts  # deltaY 累積、閾値、慣性減衰、レート上限
│   │   ├── fps.ts           # fps 検出（統計情報→実測→手動値の 3 段）
│   │   ├── gating.ts        # 広告・ライブ・再生中の無効化ゲート
│   │   └── overlay.ts       # Shadow DOM オーバーレイ（フレーム番号、タイムコード、fps）
│   ├── options/             # 設定画面
│   │   ├── options.html     # 設定画面のマークアップ
│   │   ├── options.css      # 設定画面のスタイル
│   │   └── options.ts       # 設定の読み書きと反映
│   ├── background.ts        # MV3 サービスワーカー（アイコントグルとバッジ表示）
│   └── shared/
│       ├── settings.ts      # chrome.storage.sync の設定スキーマと既定値
│       └── i18n.ts          # 日英の文言管理
├── _locales/
│   ├── ja/messages.json     # 日本語メッセージ
│   └── en/messages.json     # 英語メッセージ
├── icons/                   # 拡張とアクションのアイコン（icon-16/32/48/128.png）
├── scripts/
│   ├── gen-icons.py         # icons/ の生成スクリプト
│   └── pack.mjs             # dist/ を GitHub Release 用 zip へ梱包
├── tests/                   # vitest による単体テスト
│   ├── wheel-accumulator.test.ts
│   ├── stepper.test.ts
│   ├── fps.test.ts
│   ├── gating.test.ts
│   └── overlay-format.test.ts
├── docs/
│   ├── requirements-definition.md  # 要件定義書（確定仕様）
│   ├── decision-records.md         # 仕様決定の記録
│   ├── implementation-plan.md      # 本書
│   ├── manual-test.md              # 手動確認手順と既知の制約
│   └── store-listing.md            # Chrome Web Store 掲載素材
└── dist/                    # ビルド出力（git 管理外）
```

依存方向は `content/`、`options/`、`background.ts` が `shared/` を参照する一方向とする。
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

- [x] `manifest.json`（MV3、`storage` 権限、`https://*.youtube.com/` のコンテンツスクリプト、アクションアイコン）
- [x] `package.json`、TypeScript、esbuild、vitest のセットアップ
- [x] `chrome://extensions` で開発者モード読み込みできる空の拡張がビルドできる
- [x] 受け入れ条件：watch ページでコンテンツスクリプトが読み込まれコンソールに初期化ログが出る

### Phase 2: コマ送りコア

- [x] watch ページで `video` 要素を検出し、一時停止中のみ wheel を捕捉（`preventDefault` 付き）
- [x] フレーム番号の管理と `(番号 + 0.5) / fps` への換算、`currentTime` シーク
- [x] シークの間引き（一定間隔で最新目標のみ適用）
- [x] fps は手動値のみ（既定 30）
- [x] 受け入れ条件：一時停止中にホイールスクロールで前後のコマへ移動し、再生中はスクロールが素通りする

### Phase 3: ホイール蓄積と修飾キー

- [x] `deltaY` 累積、閾値消化、方向ごとの符号処理、`deltaMode` の正規化
- [x] 入力停止時の累積減衰と 1 秒あたりコマ数の上限
- [x] Shift 併用の複数コマ移動
- [x] `wheel-accumulator` の単体テスト
- [x] 受け入れ条件：マウス 1 ノッチで 1 コマ、トラックパッドの慣性で誤爆しない

### Phase 4: fps 検出

- [x] 「統計情報」の解像度表記の読み取り（実装済みで、実在形式での実機検証は `docs/manual-test.md`「既知の制約」で継続管理）
- [x] `totalVideoFrames` と `currentTime` の差分による実測
- [x] 手動指定値へのフォールバック
- [x] 受け入れ条件：60fps 動画と 30fps 動画でコマ送りの刻み幅が正しい（オーバーレイまたはログで確認）

### Phase 5: オーバーレイ

- [x] Shadow DOM によるオーバーレイ（フレーム番号、タイムコード、推定 fps）
- [x] 操作中のみ表示し、停止から数秒でフェードアウト
- [x] `seeked` イベントでの表示更新
- [x] 受け入れ条件：コマ送り中にフレーム番号と時刻が追従して見える

### Phase 6: 設定画面と永続化

- [x] オプションページ（上記スキーマの全項目）、`chrome.storage.sync` への保存と反映
- [x] アクションアイコンからの有効/無効トグル
- [x] 修飾キーゲート設定と方向反転設定
- [x] `_locales`（ja、en）による文言の多言語化
- [x] 受け入れ条件：設定変更がリロードなしで挙動に反映される

### Phase 7: Shorts 対応と遷移追従

- [x] `/shorts/` ページのプレイヤー検出と同一操作系の提供
- [x] `yt-navigate-finish` 等のナビゲーションイベントでの再初期化
- [x] 全画面やシアターモード、ミニプレイヤーでのオーバーレイ追従
- [x] 広告再生中とライブ配信での無効化（実装済みで、実広告とライブ配信での検証は MT-20 と MT-21 として `docs/manual-test.md`「既知の制約」で継続管理）
- [x] 受け入れ条件：watch と Shorts の往復、全画面遷移で機能が壊れない

### Phase 8: テストとリリース準備

- [x] ホイール蓄積とフレーム番号換算の単体テストを仕上げる
- [x] 手動確認手順書（`docs/manual-test.md`）を作成
- [x] GitHub Release 用 zip のビルド手順
- [x] Chrome Web Store 掲載物：アイコン、説明文（日英）、プライバシー表明（`docs/store-listing.md` に作成）
- [ ] ストア用スクリーンショットの撮影（撮影はユーザー作業。構図案は `docs/store-listing.md`）
- [x] 受け入れ条件：zip がローカル読み込みで動作し、ストア申請に必要な素材が揃う

## 引き継ぎ手順

- 現在地の確認は本書のチェックリストとマージ済み PR で行う。
- ブランチは `devin/<unix 秒>-<短いスラグ>` で作成する。
- 実装セッションの再開プロンプト例：`@Tkg-tamagohan/yt-frame-scrub docs/implementation-plan.md の Phase N を実施してください`。
- 実機確認が必要なフェーズでは、Devin VM の Chrome での検証を優先し、困難ならユーザー側での確認手順を依頼に含める。
- 要件や決定に矛盾を見つけた場合はコードではなく `docs/requirements-definition.md` または `docs/decision-records.md` 側を先に修正するか、ユーザーに確認する。
