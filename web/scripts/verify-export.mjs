// Offline + RPC verification of the committed export, mirroring what the publication checks look at:
//  - every file under dist/ (except the manifest) is listed with the correct SHA-256, nothing extra
//  - manifest identifiers, contract set and network block equal the handoff inputs
//  - each ABI is a raw JSON array whose canonical keccak equals the handoff abiHash
//  - index.html only references relative assets that exist, and loads from a gateway subpath
//  - the manifest's first reachable public RPC reports the manifest chainId and nonempty code at every
//    contract and Uniswap address (live network check; skipped with a warning when unreachable)
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256 } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const repoRoot = resolve(webRoot, '..');
const dist = resolve(repoRoot, 'dist');
const MANIFEST = 'imd-deployment.json';
let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

function readInput(name) {
  const candidates = [join(repoRoot, '.imd', 'reads', name), join(webRoot, 'handoff', name)];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Missing ${name}`);
  return JSON.parse(readFileSync(found, 'utf8'));
}
const canonicalJson = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonicalJson).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`
      : JSON.stringify(v);
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    statSync(f).isDirectory() ? walk(f, out) : out.push(f);
  }
  return out;
};

const handoff = readInput('deployment.json');
const { network } = readInput('network.json');
const manifest = JSON.parse(readFileSync(join(dist, MANIFEST), 'utf8'));

// 1. Manifest fields.
ok('manifest.version === 1', manifest.version === 1);
ok('launchId matches handoff', manifest.launchId === handoff.launchId);
ok('chainId matches handoff', manifest.chainId === handoff.chainId);
ok('sourceCommit matches handoff', manifest.sourceCommit === handoff.sourceCommit);
ok('attestationHash matches handoff', manifest.attestationHash === handoff.attestationHash);
ok('network block copied unchanged', JSON.stringify(manifest.network) === JSON.stringify(network));
ok(
  'contract set/name/address/abiHash match handoff',
  JSON.stringify(manifest.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash }))) ===
    JSON.stringify(handoff.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash }))),
);
for (const c of manifest.contracts) {
  ok(`${c.name}.abiPath is dist-relative`, !c.abiPath.startsWith('/') && !c.abiPath.includes('..') && !c.abiPath.includes('://'), c.abiPath);
  const abi = JSON.parse(readFileSync(join(dist, c.abiPath), 'utf8'));
  ok(`${c.name} ABI is a raw JSON array with the handoff keccak`, Array.isArray(abi) && keccak256(Buffer.from(canonicalJson(abi))).slice(2) === c.abiHash);
  ok(`${c.name} ABI listed in assets`, manifest.assets.some((a) => a.path === c.abiPath));
}

// 2. Asset inventory.
const files = walk(dist).map((f) => relative(dist, f).split('\\').join('/')).filter((p) => p !== MANIFEST).sort();
const listed = manifest.assets.map((a) => a.path).sort();
ok('assets list equals files on disk (excluding manifest)', JSON.stringify(files) === JSON.stringify(listed), `${files.length} files`);
ok('index.html listed', listed.includes('index.html'));
ok('at most 128 assets', manifest.assets.length <= 128);
let total = 0;
for (const a of manifest.assets) {
  const buf = readFileSync(join(dist, a.path));
  total += buf.length;
  const hash = createHash('sha256').update(buf).digest('hex');
  if (hash !== a.sha256 || !/^[0-9a-f]{64}$/.test(a.sha256)) ok(`sha256 ${a.path}`, false, `${hash} != ${a.sha256}`);
  if (buf.length > 8 * 1024 * 1024) ok(`${a.path} under 8 MiB`, false);
}
ok('all asset hashes verified', true, `${total} bytes total`);
ok('export well under half of the 64 MiB checker budget', total < 24 * 1024 * 1024);

// 3. index.html references only relative, existing assets and loads from a subpath.
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
ok('index.html has only relative asset references', refs.every((r) => r.startsWith('./') || !/^(https?:)?\/\//.test(r) && !r.startsWith('/')), refs.join(' '));
ok('referenced assets exist', refs.every((r) => existsSync(join(dist, r.replace(/^\.\//, '')))));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const SUB = '/ipfs/bafyfakecid/';
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (!p.startsWith(SUB)) return res.writeHead(404).end();
  const f = join(dist, p.slice(SUB.length) || 'index.html');
  if (!existsSync(f) || statSync(f).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': mime[extname(f)] || 'application/octet-stream' }).end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${SUB}`;
try {
  const page = await fetch(base).then((r) => r.text());
  ok('index.html served from subpath', page.includes('<div id="root">'));
  for (const r of refs) ok(`subpath resolves ${r}`, (await fetch(new URL(r, base))).ok);
  const m = await fetch(new URL(MANIFEST, base)).then((r) => r.json());
  ok('manifest fetchable relative to page', m.launchId === manifest.launchId);
  for (const c of manifest.contracts) ok(`ABI fetchable relative to page: ${c.abiPath}`, (await fetch(new URL(c.abiPath, base))).ok);
} finally {
  server.close();
}

// 4. Live RPC: chain id and nonempty code (as the control plane checks).
async function rpc(url, method, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
let reachable;
for (const url of manifest.network.rpcUrls) {
  try {
    const id = Number(await rpc(url, 'eth_chainId', []));
    ok(`RPC ${url} reports chainId ${manifest.chainId}`, id === manifest.chainId, `got ${id}`);
    reachable = url;
    break;
  } catch (e) {
    console.log(`WARN ${url} unreachable: ${e.message}`);
  }
}
if (reachable) {
  const targets = [...manifest.contracts.map((c) => [c.name, c.address]), ...Object.entries(manifest.network.uniswapV4)];
  for (const [name, address] of targets) {
    const code = await rpc(reachable, 'eth_getCode', [address, 'latest']);
    ok(`nonempty code at ${name} ${address}`, typeof code === 'string' && code.length > 2, `${(code.length - 2) / 2} bytes`);
  }
} else {
  ok('live RPC check', false, 'no configured RPC reachable');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall export checks passed');
process.exit(failures ? 1 : 0);
