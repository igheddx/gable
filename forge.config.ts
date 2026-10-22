import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Modules the Vite bundles leave external. They are copied into the package with their dependencies,
 * and unpacked from the asar archive so worker threads and native code can load them from disk.
 */
const EXTERNAL_RUNTIME_MODULES = ['better-sqlite3', 'tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng', 'pdfjs-dist', '@napi-rs/canvas'];

/** What to copy from each module. Large packages are trimmed to the files the app actually loads. */
function shouldCopy(name: string, rel: string, target: string): boolean {
  const r = rel.replace(/\\/g, '/').replace(/^\//, '');
  if (r === '') return true;
  switch (name) {
    case 'better-sqlite3':
      // Skip C/C++ sources and the SQLite amalgamation; ship only the prebuilt binary for this platform.
      if (/^(deps|src|build)(\/|$)/.test(r)) return false;
      return !(/^prebuilds\/.+\.node$/.test(r) && !r.endsWith(`${target}.node`));
    case 'pdfjs-dist':
      return r === 'package.json' || r === 'LICENSE' || /^legacy(\/build(\/(pdf|pdf\.worker)\.mjs)?)?$/.test(r) || /^(standard_fonts|wasm)(\/|$)/.test(r);
    case '@tesseract.js-data/eng':
      return r === 'package.json' || r === 'index.js' || /^4\.0\.0_best_int(\/|$)/.test(r);
    case 'tesseract.js':
      return !/^(dist|docs|examples|scripts)(\/|$)/.test(r);
    default:
      return true;
  }
}

function copyModuleTree(projectDir: string, buildPath: string, name: string, seen: Set<string>, target: string): void {
  if (seen.has(name)) return;
  const src = path.join(projectDir, 'node_modules', name);
  if (!fs.existsSync(src)) return; // an optional dependency for another platform
  seen.add(name);
  const dest = path.join(buildPath, 'node_modules', name);
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (f) => shouldCopy(name, f.slice(src.length), target),
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const [platform = '', arch = ''] = target.split('-');
  // better-sqlite3 lists node-addon-api only for compiling; it is not needed at runtime.
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (dep !== 'node-addon-api' && dep !== 'opencollective-postinstall') copyModuleTree(projectDir, buildPath, dep, seen, target);
  }
  // Per-platform native packages (for example @napi-rs/canvas-win32-x64-msvc): only this platform's is installed and copied.
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
    if (dep.includes(`-${platform}-${arch}`)) copyModuleTree(projectDir, buildPath, dep, seen, target);
  }
}

// E2E builds keep the inspect fuse on so Playwright can attach. Release builds turn it off.
const e2e = process.env.GABLE_E2E === '1';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Gable',
    executableName: 'Gable',
    appBundleId: 'com.gable.app',
    // Native addons, the OCR engine with its WASM and language data, and the worker script must be real files on disk.
    asar: { unpack: '{**/*.node,**/node_modules/**,**/.vite/build/ocrWorker.cjs}' },
    // Keep only the Vite output plus the external native modules (added in packageAfterCopy).
    ignore: (file: string) => !!file && !file.startsWith('/.vite') && file !== '/package.json',
  },
  // better-sqlite3 13 ships N-API prebuilt binaries (ABI-stable across Node/Electron), so no per-Electron
  // compile is needed or possible here (C sources are not copied). Verified by the e2e tests on the packaged app.
  rebuildConfig: { onlyModules: [] },
  makers: [
    // Windows installer: per-user Squirrel Setup.exe (no admin rights needed). Built on Windows only.
    new MakerSquirrel({ name: 'Gable', authors: 'Gable', description: 'Gable property ledger' }),
    new MakerZIP({}, ['darwin']),
  ],
  hooks: {
    packageAfterCopy: async (_config, buildPath, _electronVersion, platform, arch) => {
      const seen = new Set<string>();
      for (const m of EXTERNAL_RUNTIME_MODULES) copyModuleTree(process.cwd(), buildPath, m, seen, `${platform}-${arch}`);
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/main.ts', config: 'vite.main.config.mts', target: 'main' },
        { entry: 'src/preload/preload.ts', config: 'vite.preload.config.mts', target: 'preload' },
        { entry: 'src/workers/ocrWorker.ts', config: 'vite.worker.config.mts', target: 'main' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.mts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: e2e,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false, // enabled once signing/integrity is addressed
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
