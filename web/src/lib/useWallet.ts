import { useCallback, useState } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useDeployment } from './context';
import { switchOrAddChain, describeError, type Eip1193Provider } from './chain';
import { logActivity } from './activity';

export interface WalletState {
  address?: `0x${string}`;
  isConnected: boolean;
  /** Wallet is connected and on the deployment chain. */
  isReady: boolean;
  wrongChain: boolean;
  walletChainId?: number;
  switching: boolean;
  switchError?: string;
  switchToDeploymentChain: () => Promise<void>;
}

/** Connection + chain state relative to the deployment chain, with switch/add handling. */
export function useWallet(): WalletState {
  const deployment = useDeployment();
  const { address, isConnected, chainId: accountChainId, connector } = useAccount();
  const configChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string>();

  const target = deployment.network.chainId;
  const walletChainId = accountChainId ?? (isConnected ? configChainId : undefined);
  const wrongChain = isConnected && walletChainId !== target;

  const switchToDeploymentChain = useCallback(async () => {
    setSwitching(true);
    setSwitchError(undefined);
    try {
      const provider = (await connector?.getProvider?.()) as Eip1193Provider | undefined;
      if (provider && typeof provider.request === 'function') {
        const outcome = await switchOrAddChain(provider, deployment.walletAddChain);
        logActivity(
          'success',
          'wallet',
          outcome === 'added-and-switched'
            ? `Added ${deployment.network.name} to the wallet and switched to it`
            : `Switched wallet to ${deployment.network.name}`,
        );
      } else {
        await switchChainAsync({ chainId: target });
        logActivity('success', 'wallet', `Switched wallet to ${deployment.network.name}`);
      }
    } catch (err) {
      const message = describeError(err);
      setSwitchError(message);
      logActivity('error', 'wallet', `Switch to ${deployment.network.name} failed: ${message}`);
    } finally {
      setSwitching(false);
    }
  }, [connector, deployment, switchChainAsync, target]);

  return {
    address,
    isConnected,
    isReady: isConnected && !wrongChain,
    wrongChain,
    walletChainId,
    switching,
    switchError,
    switchToDeploymentChain,
  };
}
