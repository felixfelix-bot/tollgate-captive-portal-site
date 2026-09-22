#!/usr/bin/env node
//
// Verify that a build produced by scripts/build-net4sats-portal.sh really is a
// net4sats-branded build of the upstream theme layer — i.e. the descriptor was
// selected, its assets were shipped, and no other brand leaked into the
// artifact. Exits non-zero with a specific reason on any failure.
//
// Usage: node scripts/verify-branded-build.mjs <dist-dir> [brand-id]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] || 'dist-net4sats';
const brandId = process.argv[3] || 'net4sats';
const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');

const failures = [];
const notes = [];
const ok = (cond, msg) => { if (cond) notes.push(`ok   ${msg}`); else failures.push(msg); };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// the descriptor the overlay declares
const descriptorPath = path.join(repoRoot, 'overlay', 'brand', `${brandId}.json`);
if (!existsSync(descriptorPath)) {
  console.error(`FAIL descriptor missing: ${descriptorPath}`);
  process.exit(2);
}
const desc = readJson(descriptorPath);

// 1. the manifest is descriptor-driven, not vendor-hardcoded
const manifestPath = path.join(outDir, 'admin', 'manifest.json');
ok(existsSync(manifestPath), `admin manifest exists (${path.relative(process.cwd(), manifestPath)})`);
if (existsSync(manifestPath)) {
  const m = readJson(manifestPath);
  ok(m.name === desc.name, `manifest.name is the descriptor name ("${m.name}" == "${desc.name}")`);
  ok(m.short_name === desc.name, `manifest.short_name is the descriptor name ("${m.short_name}")`);
  const iconSrcs = (m.icons || []).map((i) => i.src).join(',');
  ok(iconSrcs.includes(`assets/brand/${brandId}/icon-colour.png`),
     `manifest icons point at the ${brandId} brand slot (${iconSrcs || 'none'})`);
  ok(m.theme_color === desc.themeColor,
     `manifest.theme_color is the descriptor themeColor ("${m.theme_color}" == "${desc.themeColor}")`);
}

// 2. the logo/icon slot shipped into the build
for (const f of ['logo-colour.png', 'logo-white.png', 'icon-colour.png', 'icon-white.png']) {
  const p = path.join(outDir, 'admin', 'assets', 'brand', brandId, f);
  ok(existsSync(p) && statSync(p).size > 0, `brand asset shipped: assets/brand/${brandId}/${f}`);
}

// 3. the rendered shell references this brand's icon and no other brand's
const indexHtml = path.join(outDir, 'admin', 'index.html');
if (existsSync(indexHtml)) {
  const html = readFileSync(indexHtml, 'utf8');
  ok(html.includes(`assets/brand/${brandId}/icon-colour.png`),
     'admin index.html references the brand icon slot');
  const foreign = [...html.matchAll(/assets\/brand\/([^/"']+)\//g)].map((m) => m[1])
    .filter((id) => id !== brandId);
  ok(foreign.length === 0, `no foreign brand referenced in index.html (found: ${foreign.join(',') || 'none'})`);
} else {
  failures.push('admin/index.html missing');
}

// 4. the descriptor was actually compiled into the app bundle
const assetsDir = path.join(outDir, 'admin', 'assets');
let bundled = false;
if (existsSync(assetsDir)) {
  for (const f of readdirSync(assetsDir)) {
    if (!f.endsWith('.js')) continue;
    const js = readFileSync(path.join(assetsDir, f), 'utf8');
    if (js.includes(desc.sessionKey) && js.includes(desc.sessionUser)) bundled = true;
  }
}
ok(bundled, `descriptor compiled into the admin bundle (sessionKey "${desc.sessionKey}" present)`);

for (const n of notes) console.log(n);
if (failures.length) {
  console.error(`\nFAILED ${failures.length} check(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nPASS: ${outDir} is a valid "${brandId}" branded build of the upstream theme layer.`);
