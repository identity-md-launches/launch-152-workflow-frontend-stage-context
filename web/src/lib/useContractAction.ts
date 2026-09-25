import { useCallback, useState } from 'react';
import { useConfig, usePublicClient } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';
import type { Abi, Address } from 'viem';
import { useDeployment } from './context';
import { describeError } from './chain';
import { logActivity } from './activity';
import { idleTx, type TxState } from '../components/TxStatus';

export interface ActionRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  /** Human description shown in the activity log, e.g. "increment()" */
  label: string;
}

/**
 * Simulate → sign → wait for receipt, reporting each phase. Every write on the page goes through this
 * so the wallet is only asked to sign calls that succeeded in simulation, and revert reasons are shown.
 */
export function useContractAction(source: string, onConfirmed?: () => void) {
  const deployment = useDeployment();
  const publicClient = usePublicClient({ chainId: deployment.network.chainId });
  const config = useConfig();
  const [state, setState] = useState<TxState>(idleTx);

  const run = useCallback(
    async (req: ActionRequest): Promise<boolean> => {
      if (!publicClient) {
        setState({ phase: 'error', message: 'No RPC client available. Reload the page.' });
        return false;
      }
      try {
        // Resolved on demand (not via useWalletClient) so a wallet that just switched chains is picked
        // up immediately instead of a cached chain-mismatch error.
        const walletClient = await getWalletClient(config, { chainId: deployment.network.chainId }).catch(() => undefined);
        if (!walletClient) {
          setState({ phase: 'error', message: `Connect a wallet on ${deployment.network.name} first.` });
          return false;
        }
        setState({ phase: 'simulating' });
        logActivity('info', source, `Simulating ${req.label}`);
        const { request } = await publicClient.simulateContract({
          account: walletClient.account,
          address: req.address,
          abi: req.abi,
          functionName: req.functionName,
          args: req.args as never,
          value: req.value,
        } as never);
        setState({ phase: 'signing' });
        const hash = await walletClient.writeContract(request as never);
        setState({ phase: 'pending', hash });
        logActivity('info', source, `Sent ${req.label}`, hash);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
          setState({ phase: 'error', hash, message: 'Transaction reverted on chain.' });
          logActivity('error', source, `${req.label} reverted on chain`, hash);
          return false;
        }
        setState({ phase: 'confirmed', hash });
        logActivity('success', source, `${req.label} confirmed in block ${receipt.blockNumber}`, hash);
        onConfirmed?.();
        return true;
      } catch (err) {
        const message = describeError(err);
        setState({ phase: 'error', message });
        logActivity('error', source, `${req.label} failed: ${message}`);
        return false;
      }
    },
    [publicClient, config, deployment.network, source, onConfirmed],
  );

  const reset = useCallback(() => setState(idleTx), []);
  const busy = state.phase === 'simulating' || state.phase === 'signing' || state.phase === 'pending';
  return { state, run, reset, busy };
}
