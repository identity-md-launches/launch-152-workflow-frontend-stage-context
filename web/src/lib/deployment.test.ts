import { describe, expect, it, vi } from 'vitest';
import { abiHashOf, canonicalJson, loadDeployment, toWalletAddChain } from './deployment';
import { abis, buildManifest, network } from '../test/fixtures';
import handoff from '../../handoff/deployment.json';

describe('canonical ABI hashing', () => {
  it('sorts keys recursively and strips whitespace', () => {
    expect(canonicalJson({ b: [1, { z: 1, a: 'x' }], a: null })).toBe('{"a":null,"b":[1,{"a":"x","z":1}]}');
  });
  it('matches the handoff abiHash for every pinned ABI export', () => {
    for (const c of handoff.contracts) {
      expect(abiHashOf(abis[c.name])).toBe(c.abiHash);
    }
  });
});

describe('loadDeployment', () => {
  function fetchFor(files: Record<string, unknown>) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname.replace(/^.*\/site\//, '');
      if (!(path in files)) return new Response('missing', { status: 404 });
      return new Response(JSON.stringify(files[path]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
  }

  it('loads the manifest and ABIs relative to the page, verifying hashes', async () => {
    const manifest = buildManifest();
    const fetchImpl = fetchFor({
      'imd-deployment.json': manifest,
      'abi/CounterToken.json': abis.CounterToken,
      'abi/OwnableCounter.json': abis.OwnableCounter,
    });
    Object.defineProperty(document, 'baseURI', { value: 'https://gateway.example/ipfs/QmXYZ/site/', configurable: true });
    const d = await loadDeployment(fetchImpl);
    expect(d.network).toEqual(network);
    expect(Object.keys(d.contracts).sort()).toEqual(['CounterToken', 'OwnableCounter']);
    expect(d.contracts.OwnableCounter!.abiVerified).toBe(true);
    expect(d.walletAddChain.chainId).toBe('0xaa36a7');
    const urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe('https://gateway.example/ipfs/QmXYZ/site/imd-deployment.json');
    expect(urls).toContain('https://gateway.example/ipfs/QmXYZ/site/abi/OwnableCounter.json');
  });

  it('flags an ABI whose hash differs from the handoff', async () => {
    const manifest = buildManifest();
    const tampered = [...(abis.OwnableCounter as unknown[]), { type: 'function', name: 'mint', inputs: [], outputs: [], stateMutability: 'nonpayable' }];
    const d = await loadDeployment(
      fetchFor({ 'imd-deployment.json': manifest, 'abi/CounterToken.json': abis.CounterToken, 'abi/OwnableCounter.json': tampered }),
    );
    expect(d.contracts.OwnableCounter!.abiVerified).toBe(false);
    expect(d.contracts.CounterToken!.abiVerified).toBe(true);
  });

  it('rejects manifests with absolute or traversing abiPath, or a mismatched network chain', async () => {
    const bad = buildManifest();
    bad.contracts[0]!.abiPath = '../abi/CounterToken.json';
    await expect(loadDeployment(fetchFor({ 'imd-deployment.json': bad }))).rejects.toThrow(/relative to dist/);
    const wrongChain = { ...buildManifest(), network: { ...network, chainId: 1 } };
    await expect(loadDeployment(fetchFor({ 'imd-deployment.json': wrongChain }))).rejects.toThrow(/chainId mismatch/);
    await expect(loadDeployment(fetchFor({}))).rejects.toThrow(/HTTP 404/);
  });
});

describe('toWalletAddChain', () => {
  it('produces the EIP-3085 parameters from the network block', () => {
    expect(toWalletAddChain(network)).toEqual({
      chainId: '0xaa36a7',
      chainName: 'Sepolia',
      rpcUrls: network.rpcUrls,
      nativeCurrency: network.nativeCurrency,
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    });
  });
});
