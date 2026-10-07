// dist/ を zip 化するリリース用スクリプト。
// 使い方: npm run pack（内部で npm run build を先に実行する）
// 外部依存を増やさないため、Node 標準の zlib で deflate 圧縮した
// 最小限の zip ライターを内蔵する。

import { deflateRawSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");
const dist = join(repoRoot, "dist");

// manifest.json と package.json の version が一致していることを先に確認する。
// タグ名と zip 名はこの値から生成するため、ずれたまま進めるとリリースが壊れる。
const manifest = JSON.parse(
  readFileSync(join(repoRoot, "manifest.json"), "utf8"),
);
const pkg = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
if (manifest.version !== pkg.version) {
  console.error(
    `manifest.json (${manifest.version}) と package.json (${pkg.version}) の version が一致しません。両方を同じ値に更新してください`,
  );
  process.exit(1);
}

// 常に最新の dist/ からパックするため、先にビルドを実行する
const buildResult = spawnSync("node", [join(repoRoot, "build.mjs")], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (buildResult.status !== 0) {
  console.error("ビルドに失敗したためパックを中止しました");
  process.exit(buildResult.status ?? 1);
}

const zipName = `yt-frame-scrub-${manifest.version}.zip`;
const zipPath = join(repoRoot, zipName);

if (!statSync(dist, { throwIfNotFound: false })?.isDirectory()) {
  console.error("dist/ がありません。先に npm run build を実行してください");
  process.exit(1);
}

// dist/ 配下のファイルを再帰列挙
const entries = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else entries.push(relative(dist, full).replaceAll("\\", "/"));
  }
})(dist);

if (entries.length === 0) {
  console.error("dist/ が空です。npm run build の出力を確認してください");
  process.exit(1);
}

// CRC32
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// zip を組み立てる（ローカルヘッダ + データ、末尾に中央ディレクトリ）
const localParts = [];
const central = [];
let offset = 0;
for (const name of entries) {
  const nameBuf = Buffer.from(name, "utf8");
  const data = readFileSync(join(dist, name));
  const compressed = deflateRawSync(data, { level: 9 });
  const useStore = compressed.length >= data.length;
  const payload = useStore ? data : compressed;
  const method = useStore ? 0 : 8;
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 フラグ
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(0, 10); // mod time
  local.writeUInt16LE(0, 12); // mod date
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28); // extra len
  localParts.push(local, nameBuf, payload);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4); // version made by
  cen.writeUInt16LE(20, 6); // version needed
  cen.writeUInt16LE(0x0800, 8); // UTF-8 フラグ
  cen.writeUInt16LE(method, 10);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(payload.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt32LE(offset, 42); // local header offset
  central.push(Buffer.concat([cen, nameBuf]));

  offset += local.length + nameBuf.length + payload.length;
}

const centralStart = offset;
const centralBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(centralStart, 16);

writeFileSync(zipPath, Buffer.concat([...localParts, centralBuf, eocd]));
console.log(`${zipName} を作成しました（${entries.length} ファイル）`);
console.log("");
console.log("次の手順（詳細は docs/release.md を参照）:");
console.log(`  git tag v${manifest.version}`);
console.log(`  git push origin v${manifest.version}`);
console.log(`  gh release create v${manifest.version} ${zipName}`);
