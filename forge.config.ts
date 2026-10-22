import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs';
import path from 'node:path';

/** Native/runtime modules the Vite bundle leaves external. Copied into the package with their dependencies. */
const EXTERNAL_RUNTIME_MODULES = ['better-sqlite3'];

function copyModuleTree(
  projectDir: string,
  buildPath: string,
  name: string,
  seen: Set<string>,
  target: string,
): void {
  if (seen.has(name)) return;
  seen.add(name);
  const src = path.join(projectDir, 'node_modules', name);
  const dest = path.join(buildPath, 'node_modules', name);
  // Skip C/C++ sources and the bundled SQLite amalgamation; keep JS and the .node prebuilds.
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (f) => {
      const rel = f.slice(src.length);
      if (/[\\/](deps|src|build)([\\/]|$)/.test(rel)) return false;
      // Ship only the prebuilt binary for the platform/arch being packaged.
      return !(/[\\/]prebuilds[\\/].+\.node$/.test(rel) && !rel.endsWith(`${target}.node`));
    },
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  // better-sqlite3 lists node-addon-api only for compiling; not needed at runtime.
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (dep !== 'node-addon-api') copyModuleTree(projectDir, buildPath, dep, seen, target);
  }
}

// E2E builds keep the inspect fuse on so Playwright can attach. Release builds turn it off.
const e2e = process.env.GABLE_E2E === '1';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Gable',
    executableName: 'Gable',
    appBundleId: 'com.gable.app',
    asar: { unpack: '**/*.node' },
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
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.mts' }],
    }),
    new AutoUnpackNativesPlugin({}),
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
