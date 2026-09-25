import { keccak256, stringToBytes, type Abi, type Address, type Hex } from 'viem';
import { DEPLOYMENT_MANIFEST_PATH } from '../config';

/** Shape of `dist/imd-deployment.json`, the app's only deployment configuration. */
export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: ManifestContract[];
  assets: { path: string; sha256: string }[];
  network: NetworkBlock;
}

export interface ManifestContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets: string[];
  uniswapV4: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
  };
}

export interface LoadedContract extends ManifestContract {
  abi: Abi;
  /** True when the fetched ABI's canonical keccak equals the handoff `abiHash`. */
  abiVerified: boolean;
}

export interface Deployment {
  manifest: DeploymentManifest;
  network: NetworkBlock;
  contracts: Record<string, LoadedContract>;
  /** EIP-3085 parameters derived from the network block, for `wallet_addEthereumChain`. */
  walletAddChain: WalletAddChainParams;
}

export interface WalletAddChainParams {
  chainId: Hex;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}

/** Deterministic JSON: object keys sorted recursively, no whitespace (matches the handoff hashing). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Canonical keccak-256 of an ABI, as 64 lowercase hex characters without `0x`. */
export function abiHashOf(abi: unknown): string {
  return keccak256(stringToBytes(canonicalJson(abi))).slice(2);
}

export function toWalletAddChain(network: NetworkBlock): WalletAddChainParams {
  return {
    chainId: `0x${network.chainId.toString(16)}` as Hex,
    chainName: network.name,
    rpcUrls: network.rpcUrls,
    nativeCurrency: network.nativeCurrency,
    blockExplorerUrls: [network.explorer],
  };
}

function assertManifest(value: unknown): asserts value is DeploymentManifest {
  const m = value as Partial<DeploymentManifest>;
  if (!m || m.version !== 1) throw new Error('imd-deployment.json: unsupported version');
  if (typeof m.chainId !== 'number') throw new Error('imd-deployment.json: chainId missing');
  if (!Array.isArray(m.contracts) || m.contracts.length === 0) {
    throw new Error('imd-deployment.json: contracts missing');
  }
  for (const c of m.contracts) {
    if (!c.name || !/^0x[0-9a-fA-F]{40}$/.test(c.address) || !/^[0-9a-f]{64}$/.test(c.abiHash)) {
      throw new Error(`imd-deployment.json: malformed contract entry ${JSON.stringify(c)}`);
    }
    if (!c.abiPath || c.abiPath.startsWith('/') || c.abiPath.includes('..') || c.abiPath.includes('://')) {
      throw new Error(`imd-deployment.json: abiPath must be relative to dist/: ${c.abiPath}`);
    }
  }
  if (!m.network || m.network.chainId !== m.chainId) {
    throw new Error('imd-deployment.json: network block missing or chainId mismatch');
  }
  if (!m.network.uniswapV4?.universalRouter || !m.network.uniswapV4.quoter || !m.network.uniswapV4.permit2) {
    throw new Error('imd-deployment.json: network.uniswapV4 addresses missing');
  }
}

/** Resolve a dist-relative path against the page URL, so gateway subpaths keep working. */
export function resolveAsset(path: string, base: string = document.baseURI): string {
  return new URL(path, base).toString();
}

export async function loadDeployment(
  fetchImpl: typeof fetch = fetch,
  manifestPath: string = DEPLOYMENT_MANIFEST_PATH,
): Promise<Deployment> {
  const res = await fetchImpl(resolveAsset(manifestPath), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${manifestPath} (HTTP ${res.status})`);
  const manifest: unknown = await res.json();
  assertManifest(manifest);

  const contracts: Record<string, LoadedContract> = {};
  for (const entry of manifest.contracts) {
    const abiRes = await fetchImpl(resolveAsset(entry.abiPath), { cache: 'no-cache' });
    if (!abiRes.ok) throw new Error(`Could not load ABI ${entry.abiPath} (HTTP ${abiRes.status})`);
    const abi = (await abiRes.json()) as unknown;
    if (!Array.isArray(abi)) throw new Error(`ABI ${entry.abiPath} is not a JSON array`);
    contracts[entry.name] = {
      ...entry,
      address: entry.address.toLowerCase() as Address,
      abi: abi as Abi,
      abiVerified: abiHashOf(abi) === entry.abiHash,
    };
  }

  return {
    manifest,
    network: manifest.network,
    contracts,
    walletAddChain: toWalletAddChain(manifest.network),
  };
}
