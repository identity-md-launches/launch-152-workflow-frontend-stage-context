import type { Abi } from 'viem';
import handoff from '../../handoff/deployment.json';
import networkFile from '../../handoff/network.json';
import counterAbi from '../../public/abi/OwnableCounter.json';
import tokenAbi from '../../public/abi/CounterToken.json';
import { abiHashOf, toWalletAddChain, type Deployment, type DeploymentManifest, type NetworkBlock } from '../lib/deployment';

export const network = networkFile.network as NetworkBlock;

export function buildManifest(): DeploymentManifest {
  return {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((c) => ({
      name: c.name,
      address: c.address as `0x${string}`,
      abiHash: c.abiHash,
      abiPath: `abi/${c.name}.json`,
    })),
    assets: [{ path: 'index.html', sha256: '0'.repeat(64) }],
    network,
  };
}

export const abis: Record<string, Abi> = {
  CounterToken: tokenAbi as Abi,
  OwnableCounter: counterAbi as Abi,
};

export function buildDeployment(): Deployment {
  const manifest = buildManifest();
  const contracts = Object.fromEntries(
    manifest.contracts.map((c) => [c.name, { ...c, abi: abis[c.name]!, abiVerified: abiHashOf(abis[c.name]) === c.abiHash }]),
  );
  return { manifest, network, contracts, walletAddChain: toWalletAddChain(network) };
}

export const COUNTER_ADDRESS = handoff.contracts.find((c) => c.name === 'OwnableCounter')!.address.toLowerCase() as `0x${string}`;
export const TOKEN_ADDRESS = handoff.contracts.find((c) => c.name === 'CounterToken')!.address.toLowerCase() as `0x${string}`;
export const ACCOUNT = '0x1111111111111111111111111111111111111111' as const;
export const OTHER = '0x2222222222222222222222222222222222222222' as const;
