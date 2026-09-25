// Browser validation of the committed export in dist/ with Playwright's bundled Chromium.
// Serves dist/ from a gateway-like subpath, injects the fake EIP-1193 wallet (reads are forwarded to
// the public RPC from the manifest), and exercises: load, live reads, wrong-chain → add chain →
// switch, increment simulation + signing request, a quote request, mobile/desktop overflow, console
// and resource failures. No real transaction is broadcast: eth_sendTransaction is answered locally.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', '..', 'dist');
const outDir = process.env.E2E_OUT || '/tmp/ownable-counter-e2e';
mkdirSync(outDir, { recursive: true });
const SUBPATH = '/ipfs/bafyfakecid/';
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const manifest = JSON.parse(readFileSync(join(dist, 'imd-deployment.json'), 'utf8'));
const rpcUrl = manifest.network.rpcUrls[0];
const counter = manifest.contracts.find((c) => c.name === 'OwnableCounter');

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith(SUBPATH)) {
    res.writeHead(404).end('not under subpath');
    return;
  }
  let rel = url.pathname.slice(SUBPATH.length) || 'index.html';
  const file = join(dist, rel);
  if (!existsSync(file)) {
    res.writeHead(404).end('missing');
    return;
  }
  res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${SUBPATH}`;

const fakeWalletSource = readFileSync(join(here, '..', 'src', 'test', 'fake-wallet.js'), 'utf8').replace('export function', 'function');
const initScript = `${fakeWalletSource}
window.ethereum = createFakeWallet({
  accounts: ['${ACCOUNT}'], chainId: '0x1', knownChains: ['0x1'],
  rpc: async (method, params) => {
    const r = await fetch('${rpcUrl}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await r.json(); if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data }); return j.result;
  },
});`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
try {
  for (const [label, viewport] of [['mobile', { width: 375, height: 812 }], ['desktop', { width: 1280, height: 900 }]]) {
    const context = await browser.newContext({ viewport, colorScheme: label === 'mobile' ? 'dark' : 'light' });
    await context.addInitScript(initScript);
    const page = await context.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText}`));
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(base)) failedRequests.push(`${r.url()} HTTP ${r.status()}`); });

    await page.goto(base, { waitUntil: 'networkidle' });
    check(`${label}: page served from subpath`, (await page.title()).includes('OwnableCounter'));
    const count = page.getByTestId('count');
    await count.filter({ hasNotText: 'Loading' }).waitFor({ timeout: 30_000 });
    const countText = await count.textContent();
    check(`${label}: live count read from ${manifest.network.name}`, /^[\d,]+$/.test(countText.trim()), `count=${countText.trim()}`);
    const ownerText = await page.getByTestId('owner').textContent();
    check(`${label}: live owner read`, /^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/.test(ownerText.trim()), ownerText.trim());
    check(`${label}: contracts table lists manifest addresses`, (await page.locator(`a[href$="${counter.address}"]`).count()) > 0);
    check(`${label}: token metadata read`, (await page.getByText('Counter Test (CNTR)').count()) > 0);
    check(`${label}: increment disabled while disconnected`, await page.getByRole('button', { name: 'Increment' }).isDisabled());

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${label}: no horizontal overflow`, overflow <= 0, `scrollWidth-clientWidth=${overflow}`);
    await page.screenshot({ path: join(outDir, `${label}-disconnected.png`), fullPage: true });

    // Connect → wrong chain → switch fails with 4902 → add chain → switch.
    await page.getByRole('button', { name: /^Connect/ }).first().click();
    const alert = page.getByRole('alert').filter({ hasText: 'Wallet is on chain 1' });
    await alert.waitFor({ timeout: 10_000 });
    check(`${label}: wrong-chain alert with a single switch control`, (await alert.getByRole('button', { name: `Switch to ${manifest.network.name}` }).count()) === 1);
    await alert.getByRole('button', { name: `Switch to ${manifest.network.name}` }).click();
    await alert.waitFor({ state: 'detached', timeout: 10_000 });
    const walletState = await page.evaluate(() => ({ chainId: window.ethereum.state.chainId(), added: window.ethereum.state.added, switched: window.ethereum.state.switched }));
    check(`${label}: wallet_addEthereumChain offered after 4902`, walletState.added.length === 1 && walletState.added[0].chainId === '0xaa36a7' && walletState.chainId === '0xaa36a7', JSON.stringify(walletState.added[0]?.rpcUrls));
    await page.getByRole('button', { name: 'Increment' }).isEnabled({ timeout: 10_000 });
    await page.waitForFunction(() => !document.querySelector('button')?.disabled || true);
    const inc = page.getByRole('button', { name: 'Increment' });
    await page.waitForFunction((sel) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === sel); return b && !b.disabled; }, 'Increment', { timeout: 15_000 });
    await inc.click();
    // Simulation runs against the real RPC (eth_call), then the fake wallet answers eth_sendTransaction.
    await page.waitForFunction(() => window.ethereum.state.sent.length === 1, null, { timeout: 30_000 });
    const sent = await page.evaluate(() => window.ethereum.state.sent[0]);
    check(`${label}: increment simulated on chain and sent to the wallet`, sent.to?.toLowerCase() === counter.address && sent.data === '0xd09de08a', `to=${sent.to} data=${sent.data}`);
    await page.getByText('Transaction sent, waiting for confirmation…').waitFor({ timeout: 10_000 });
    check(`${label}: pending status shown with explorer link`, (await page.getByRole('link', { name: 'View transaction' }).count()) > 0);

    // Quote request goes to the manifest quoter (result depends on live liquidity; both outcomes are handled).
    await page.getByLabel(/You pay \(ETH\)/).fill('0.001');
    await page.waitForFunction(() => { const q = document.querySelector('[data-testid=quote-out]')?.textContent || ''; return q !== '—' && !q.includes('Quoting'); }, null, { timeout: 30_000 }).catch(() => {});
    const quoteOut = await page.getByTestId('quote-out').textContent();
    const quoteErr = await page.getByText(/^Quote failed:/).count();
    check(`${label}: quoter consulted (quote or explicit failure shown)`, quoteOut !== '—' || quoteErr > 0, `quote="${quoteOut}" errors=${quoteErr}`);
    await page.screenshot({ path: join(outDir, `${label}-connected.png`), fullPage: true });

    const benignConsole = consoleErrors.filter((t) => !/ERR_BLOCKED_BY_CLIENT/.test(t));
    check(`${label}: no console errors`, benignConsole.length === 0, benignConsole.slice(0, 3).join(' || '));
    check(`${label}: no failed asset requests`, failedRequests.filter((f) => f.startsWith(base)).length === 0, failedRequests.slice(0, 3).join(' || '));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots and results.json in ${outDir}`);
if (failed.length) process.exit(1);
