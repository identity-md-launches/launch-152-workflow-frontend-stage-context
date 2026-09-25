import { createConfig, fallback, http, type Config, type CreateConnectorFn, type Transport } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain, type Chain } from 'viem';
import type { Deployment } from './deployment';

/** Build the viem chain description from the manifest's network block (never hard-coded). */
export function chainFromDeployment(deployment: Deployment): Chain {
  const n = deployment.network;
  return defineChain({
    id: n.chainId,
    name: n.name,
    testnet: n.testnet,
    nativeCurrency: n.nativeCurrency,
    rpcUrls: { default: { http: n.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: n.explorer } },
  });
}

/**
 * wagmi config: reads go through the manifest's public RPC list with fallback; signing stays in the
 * visitor's browser wallet. Only injected (EIP-1193 / EIP-6963) connectors are configured because no
 * WalletConnect project id was supplied (see `config.ts`).
 */
export interface WagmiOptions {
  /** Test hook: replace the public RPC transport (e.g. with a stubbed `custom()` transport). */
  transport?: Transport;
  /** Test hook: replace the connectors. */
  connectors?: CreateConnectorFn[];
}

export function createWagmiConfig(deployment: Deployment, options: WagmiOptions = {}): Config {
  const chain = chainFromDeployment(deployment);
  return createConfig({
    chains: [chain],
    connectors: options.connectors ?? [injected()],
    multiInjectedProviderDiscovery: !options.connectors,
    transports: {
      [chain.id]:
        options.transport ??
        fallback(
          deployment.network.rpcUrls.map((url) => http(url, { batch: true, retryCount: 1 })),
          { rank: false },
        ),
    },
  });
}
