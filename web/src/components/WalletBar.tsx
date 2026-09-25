import { useEffect, useState } from 'react';
import { useConnect, useDisconnect } from 'wagmi';
import { useDeployment } from '../lib/context';
import { useWallet } from '../lib/useWallet';
import { shortAddress, explorerAddress } from '../lib/format';
import { describeError } from '../lib/chain';
import { logActivity } from '../lib/activity';

/** Connect / disconnect, connected address, and the single wrong-network control. */
export function WalletBar() {
  const deployment = useDeployment();
  const wallet = useWallet();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [connectError, setConnectError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const hasWallet = connectors.length > 0;

  async function connect(connectorId: string) {
    const connector = connectors.find((c) => c.uid === connectorId) ?? connectors[0];
    if (!connector) return;
    setConnectError(undefined);
    try {
      const result = await connectAsync({ connector });
      logActivity('success', 'wallet', `Connected ${shortAddress(result.accounts[0])} via ${connector.name}`);
    } catch (err) {
      const message = describeError(err);
      setConnectError(message);
      logActivity('error', 'wallet', `Connect failed: ${message}`);
    }
  }

  if (!wallet.isConnected) {
    return (
      <div className="walletbar">
        {hasWallet ? (
          <div className="wallet-connectors">
            {connectors.map((c) => (
              <button
                key={c.uid}
                type="button"
                className="btn primary"
                onClick={() => connect(c.uid)}
                disabled={isPending}
                aria-busy={isPending}
              >
                {isPending ? 'Connecting…' : `Connect ${c.name}`}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted" role="status">
            No browser wallet detected. Install{' '}
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              MetaMask
            </a>{' '}
            or another EIP-1193 wallet, then reload. Reads still work without a wallet.
          </p>
        )}
        {connectError && (
          <p className="inline-error" role="alert">
            {connectError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="walletbar">
      <div className="wallet-identity">
        <span className={`dot ${wallet.wrongChain ? 'warn' : 'ok'}`} aria-hidden="true" />
        <a
          className="mono"
          translate="no"
          href={explorerAddress(deployment.network.explorer, wallet.address ?? '')}
          target="_blank"
          rel="noreferrer"
          title={wallet.address}
        >
          {wallet.address ? shortAddress(wallet.address) : ''}
        </a>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            if (wallet.address) void navigator.clipboard?.writeText(wallet.address).then(() => setCopied(true));
          }}
          aria-label="Copy connected address"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn ghost small" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
      {wallet.wrongChain && (
        <div className="wrong-chain" role="alert">
          <span>
            Wallet is on chain {wallet.walletChainId ?? 'unknown'}; this app needs {deployment.network.name} (
            {deployment.network.chainId}).
          </span>
          <button
            type="button"
            className="btn primary"
            onClick={() => void wallet.switchToDeploymentChain()}
            disabled={wallet.switching}
            aria-busy={wallet.switching}
          >
            {wallet.switching ? 'Switching…' : `Switch to ${deployment.network.name}`}
          </button>
          {wallet.switchError && <p className="inline-error">{wallet.switchError}</p>}
        </div>
      )}
    </div>
  );
}
