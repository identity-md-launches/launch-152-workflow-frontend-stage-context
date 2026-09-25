// Generates dist/imd-deployment.json from the workflow handoff after `vite build`.
//
// - identifiers, chain, contract set and ABI hashes come from the handoff (deployment.json)
// - the `network` block is copied unchanged from network.json
// - each ABI in dist/abi/ is verified against the handoff abiHash (canonical keccak-256)
// - every exported file except the manifest itself is listed with its SHA-256
//
// Inputs are read from ../.imd/reads/ when present (the workflow-supplied copies), otherwise from
// ./handoff/, which holds byte-identical copies committed with the frontend source.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256 } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const repoRoot = resolve(webRoot, '..');
const distDir = resolve(repoRoot, 'dist');
const MANIFEST = 'imd-deployment.json';
const MAX_ASSETS = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const TARGET_TOTAL_BYTES = 24 * 1024 * 1024; // well under half of the checker's 64 MiB budget

function readInput(name) {
  const candidates = [join(repoRoot, '.imd', 'reads', name), join(webRoot, 'handoff', name)];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Missing ${name}; looked in ${candidates.join(', ')}`);
  return JSON.parse(readFileSync(found, 'utf8'));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function abiHash(abi) {
  return keccak256(Buffer.from(canonicalJson(abi), 'utf8')).slice(2);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const handoff = readInput('deployment.json');
const { network } = readInput('network.json');

if (!existsSync(join(distDir, 'index.html'))) throw new Error('dist/index.html missing: run vite build first');
if (network.chainId !== handoff.chainId) throw new Error('network.json chainId differs from deployment.json');

const contracts = handoff.contracts.map((c) => {
  const abiPath = `abi/${c.name}.json`;
  const file = join(distDir, abiPath);
  if (!existsSync(file)) throw new Error(`ABI export missing: ${abiPath}`);
  const abi = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(abi)) throw new Error(`${abiPath} is not a raw JSON array`);
  const actual = abiHash(abi);
  if (actual !== c.abiHash) throw new Error(`ABI hash mismatch for ${c.name}: ${actual} != ${c.abiHash}`);
  // Also confirm dist/abi matches the pinned docs/abi export byte for byte when it is present.
  const pinned = join(repoRoot, 'docs', 'abi', `${c.name}.json`);
  if (existsSync(pinned) && !readFileSync(pinned).equals(readFileSync(file))) {
    throw new Error(`${abiPath} differs from docs/abi/${c.name}.json at the pinned source commit`);
  }
  return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath };
});

const files = walk(distDir)
  .map((f) => relative(distDir, f).split('\\').join('/'))
  .filter((p) => p !== MANIFEST)
  .sort();
let total = 0;
const assets = files.map((path) => {
  const buf = readFileSync(join(distDir, path));
  if (buf.length > MAX_FILE_BYTES) throw new Error(`${path} exceeds 8 MiB`);
  total += buf.length;
  return { path, sha256: sha256(buf) };
});
if (assets.length > MAX_ASSETS) throw new Error(`${assets.length} assets exceed the limit of ${MAX_ASSETS}`);
if (total > TARGET_TOTAL_BYTES) throw new Error(`export is ${total} bytes, above the ${TARGET_TOTAL_BYTES} byte target`);
if (!assets.some((a) => a.path === 'index.html')) throw new Error('index.html not found in export');

const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  network,
};

writeFileSync(join(distDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote dist/${MANIFEST}: ${contracts.length} contracts, ${assets.length} assets, ${total} bytes`);
