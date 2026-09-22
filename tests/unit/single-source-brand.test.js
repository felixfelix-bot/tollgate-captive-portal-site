// "Drop the hard-coded branding" guard.
//
// This repo used to keep its own copy of the brand identity: rasters under
// src/assets/logo/, a hand-written public/manifest.json, and code that imported
// the in-tree logo. The upstream theme layer now owns identity, so the repo must
// keep exactly ONE source for it -- overlay/ -- and derive everything else from
// the descriptor. These tests fail if a second copy grows back.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_DIR, SLOT_ASSETS, readDescriptors } from '../../scripts/overlay-contract.mjs';
import { generateManifest, serialize, MANIFEST_PATH } from '../../scripts/gen-manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Every file under dir, recursively (relative paths). */
const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p).map((f) => path.join(entry.name, f)));
    else out.push(entry.name);
  }
  return out;
};

const slotHashes = new Map(SLOT_ASSETS.map((a) => [sha256(path.join(ASSET_DIR, a)), a]));

describe('brand identity has a single source', () => {
  it('no code-tree asset duplicates a brand slot file', () => {
    const srcDir = path.join(REPO_ROOT, 'src');
    const duplicates = walk(srcDir)
      .filter((rel) => /\.(png|svg|ico|jpe?g|webp)$/i.test(rel))
      .map((rel) => path.join('src', rel))
      .filter((rel) => {
        const p = path.join(REPO_ROOT, rel);
        return statSync(p).size > 0 && slotHashes.has(sha256(p));
      });
    expect(duplicates).toEqual([]);
  });

  it('no source file references a legacy in-tree brand asset path', () => {
    const suspects = ['src', 'index.html', 'balance.html'];
    const offenders = [];
    for (const target of suspects) {
      const p = path.join(REPO_ROOT, target);
      if (!existsSync(p)) continue;
      const files = statSync(p).isDirectory()
        ? walk(p).map((rel) => path.join(target, rel))
        : [target];
      for (const rel of files) {
        if (!/\.(jsx?|tsx?|html|scss|css|json)$/i.test(rel)) continue;
        if (/assets\/logo\//.test(readFileSync(path.join(REPO_ROOT, rel), 'utf8'))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the app logo comes from the overlay slot', () => {
    const app = readFileSync(path.join(REPO_ROOT, 'src/App.jsx'), 'utf8');
    const match = app.match(/^import\s+logoWhite\s+from\s+'([^']+)'/m);
    expect(match, 'App.jsx must import the brand logo').not.toBeNull();
    const imported = path.resolve(REPO_ROOT, 'src', match[1]);
    expect(imported).toBe(path.join(ASSET_DIR, 'logo-white.png'));
  });

  it('public/manifest.json is exactly the descriptor-generated manifest', () => {
    const [entry] = readDescriptors();
    const wanted = serialize(generateManifest(entry.descriptor));
    expect(readFileSync(MANIFEST_PATH, 'utf8')).toBe(wanted);
  });

  it('the committed manifest carries the descriptor name and theme colour', () => {
    const [entry] = readDescriptors();
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    expect(manifest.name).toBe(entry.descriptor.name);
    expect(manifest.short_name).toBe(entry.descriptor.name);
    expect(manifest.theme_color).toBe(entry.descriptor.themeColor);
  });
});
