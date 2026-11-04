import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 前端：src/web 是 Vite 根目錄，build 到 dist/client（wrangler.toml 的 assets.directory）。
// 開發時 /api 轉給 `npm run dev:api`（wrangler dev, port 8787）。

interface Release {
  version: string;
  date: string;
  notes: string[];
}

/**
 * 版本與更新內容：版本號讀 package.json，日期與「給使用者看的更新內容」讀 CHANGELOG.md 該版段落裡 `> - ` 開頭的行。
 * CHANGELOG 沒有這一版就 build 失敗（避免改了版本號忘記寫 CHANGELOG）。
 */
function readRelease(): Release {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  const log = readFileSync(new URL('./CHANGELOG.md', import.meta.url), 'utf8');
  const head = new RegExp(`^## \\[${pkg.version.replace(/\./g, '\\.')}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$`, 'm').exec(log);
  if (!head) throw new Error(`CHANGELOG.md 找不到 ## [${pkg.version}] - YYYY-MM-DD 的段落（package.json 的版本）`);
  const section = log.slice(head.index + head[0].length).split(/^## /m)[0];
  const notes = section
    .split('\n')
    .filter((line) => line.startsWith('> - '))
    .map((line) => line.slice(4).replace(/\*\*|`/g, '').trim());
  return { version: pkg.version, date: head[1], notes };
}

/**
 * build 時多產生 /version.json：{ version, date, notes, entry }。
 * entry 是這次 build 的入口 JS 檔名（內容雜湊），開著的頁面拿它跟自己載入的檔案比，不一樣就是有新版（src/web/version.ts）。
 * 只改文件、程式沒變時雜湊不變，不會白白提醒更新。
 */
function versionFile(release: Release): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((f) => f.type === 'chunk' && f.isEntry);
      if (!entry) this.error('找不到入口 JS，無法產生 version.json');
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ ...release, entry: `/${entry.fileName}` }),
      });
    },
  };
}

const release = readRelease();

export default defineConfig({
  root: 'src/web',
  plugins: [react(), versionFile(release)],
  define: {
    __APP_VERSION__: JSON.stringify(release.version),
  },
  build: {
    outDir: '../../dist/client',
    // 3D 醫生（three.js）是 lazy 載入的獨立檔案，比較大是正常的
    chunkSizeWarningLimit: 1000,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
