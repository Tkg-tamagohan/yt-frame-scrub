# yt-frame-scrub

[![ci](https://github.com/Tkg-tamagohan/yt-frame-scrub/actions/workflows/ci.yml/badge.svg)](https://github.com/Tkg-tamagohan/yt-frame-scrub/actions/workflows/ci.yml)

一時停止中の YouTube 動画をマウスホイールでコマ送りやコマ戻しする Chrome 拡張です。
フレーム番号とタイムコードをオーバーレイ表示します。

## 対象

- youtube.com の動画視聴ページ（watch）と YouTube Shorts
- 広告再生中とライブ配信では無効化されます

## インストール

開発者モードでの読み込み:

1. このリポジトリをクローンし、次のコマンドでビルドします。

   ```bash
   npm install
   npm run build
   ```

2. Chrome で `chrome://extensions` を開き、「デベロッパーモード」を有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」で `dist/` フォルダを選択します。

GitHub Release の zip を展開して同様に読み込むこともできます。
zip は `npm run pack` で生成します（後述）。

## 使い方

- YouTube の動画を一時停止し、プレイヤー上でホイールスクロールすると 1 ノッチにつき 1 コマ移動します（既定は上スクロールで送り、下で戻し）。
- Shift を押しながらスクロールすると 1 ノッチで複数コマ（既定 10）移動します。
- ツールバーの拡張アイコンをクリックすると機能の有効/無効を切り替えられます。
- スクロール方向の反転、捕捉に必要な修飾キー、蓄積の閾値、オーバーレイ表示、手動 fps などは拡張のオプション画面（`chrome://extensions` → 詳細 → 拡張機能オプション）で設定できます。設定はブラウザ間で同期されます。

## 開発

- `npm run build`: `dist/` に読み込み可能な拡張一式を生成
- `npm run test`: vitest による単体テスト
- `npm run typecheck`: 型チェック
- `npm run pack`: `dist/` を zip 化し `yt-frame-scrub-<version>.zip` を生成（GitHub Release 用。リリース手順は [docs/release.md](docs/release.md) を参照）
- `scripts/gen-icons.py`: `icons/` のアイコンを再生成するスクリプト。Pillow（PIL）が必要で、`pip install Pillow` のうえ `python3 scripts/gen-icons.py` を実行する

TypeScript + esbuild + vitest。Manifest V3 準拠。

## ドキュメント

- [要件定義書](docs/requirements-definition.md)
- [決定記録](docs/decision-records.md)
- [実装計画](docs/implementation-plan.md)
- [手動確認手順](docs/manual-test.md)
- [Chrome Web Store 掲載物](docs/store-listing.md)
- [リリース手順](docs/release.md)

## ライセンス

MIT License。
`LICENSE` を参照してください。
