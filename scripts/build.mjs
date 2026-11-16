/**
 * Builds dist/YT-PureStream-v<version>.zip containing ONLY the runtime files
 * (no tests, tooling, node_modules or store assets). The same ZIP is what you
 * upload to the Chrome Web Store / Edge Add-ons and attach to GitHub Releases.
 *
 * Usage: npm run build
 * Needs the `zip` command (preinstalled on macOS, Linux and GitHub runners).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Everything the extension needs at runtime.
const FILES = [
  'manifest.json',
  'rules_core.json',
  'rules_strict.json',
  'background.js',
  'common.js',
  'content.js',
  'styles.css',
  'popup.html',
  'popup.js',
  'icons',
  '_locales',
];

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// --- sanity checks -------------------------------------------------------
const problems = [];
for (const f of FILES) {
  if (!fs.existsSync(path.join(root, f))) problems.push(`missing file: ${f}`);
}
if (pkg.version !== manifest.version) {
  problems.push(`version mismatch: package.json ${pkg.version} vs manifest.json ${manifest.version}`);
}
// Every file the manifest points to must be shipped.
const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...(manifest.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  ...(manifest.declarative_net_request?.rule_resources || []).map((r) => r.path),
  ...Object.values(manifest.icons || {}),
].filter(Boolean);
for (const f of referenced) {
  if (!FILES.some((entry) => f === entry || f.startsWith(entry + '/'))) {
    problems.push(`manifest references "${f}" but it is not in the build list`);
  }
}
if (problems.length) {
  console.error('Build aborted:\n - ' + problems.join('\n - '));
  process.exit(1);
}

// --- zip -----------------------------------------------------------------
const outDir = path.join(root, 'dist');
const out = path.join(outDir, `YT-PureStream-v${manifest.version}.zip`);
fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(out, { force: true });

execFileSync('zip', ['-r', '-q', '-X', out, ...FILES], { cwd: root, stdio: 'inherit' });

const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`Built ${path.relative(root, out)} (${kb} KB)`);
