import type { WalletAddChainParams } from './deployment';

/** Minimal EIP-1193 surface used for chain switching. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export type SwitchOutcome = 'switched' | 'added-and-switched';

function errorCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { code?: unknown; data?: { originalError?: { code?: unknown } }; cause?: unknown };
  if (typeof e.data?.originalError?.code === 'number') return e.data.originalError.code;
  if (typeof e.code === 'number') return e.code;
  if (e.cause) return errorCode(e.cause);
  return undefined;
}

/** True when the wallet reported that it does not know the requested chain. */
export function isUnknownChainError(err: unknown): boolean {
  const code = errorCode(err);
  if (code === 4902) return true;
  // MetaMask mobile / some wallets report -32603 with an "Unrecognized chain" message.
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /unrecognized chain|unknown chain|chain.*not (been )?added|4902/i.test(message);
}

/**
 * Switch the wallet to the deployment chain. When the wallet does not know the chain (EIP-3326 code
 * 4902 or equivalent), add it with the exact `wallet_addEthereumChain` parameters and switch again.
 */
export async function switchOrAddChain(
  provider: Eip1193Provider,
  params: WalletAddChainParams,
): Promise<SwitchOutcome> {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: params.chainId }] });
    return 'switched';
  } catch (err) {
    if (!isUnknownChainError(err)) throw err;
  }
  await provider.request({ method: 'wallet_addEthereumChain', params: [params] });
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: params.chainId }] });
  return 'added-and-switched';
}

/** Human-readable message for wallet / RPC errors, including revert reasons where viem exposes them. */
export function describeError(err: unknown): string {
  if (!err) return 'Unknown error';
  const e = err as { shortMessage?: string; details?: string; message?: string; cause?: unknown; code?: number };
  if (e.code === 4001 || /user rejected|user denied/i.test(e.shortMessage ?? e.message ?? '')) {
    return 'Request rejected in the wallet. Nothing was sent.';
  }
  const parts = [e.shortMessage ?? e.message];
  if (e.details && e.details !== e.shortMessage) parts.push(e.details);
  const text = parts.filter(Boolean).join(' — ');
  return text || 'Unknown error';
}
