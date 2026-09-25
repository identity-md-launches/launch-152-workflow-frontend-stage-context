import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { loadDeployment, type Deployment } from './lib/deployment';
import { createWagmiConfig, type WagmiOptions } from './lib/wagmi';
import { DeploymentContext } from './lib/context';
import { logActivity } from './lib/activity';
import { WalletBar } from './components/WalletBar';
import { ContractsPanel } from './components/ContractsPanel';
import { CounterPanel } from './components/CounterPanel';
import { TokenPanel } from './components/TokenPanel';
import { SwapPanel } from './components/SwapPanel';
import { ActivityPanel } from './components/ActivityPanel';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; deployment: Deployment };

export interface AppProps {
  /** Test hook: skip fetching imd-deployment.json. */
  deployment?: Deployment;
  /** Test hook: transport / connector overrides. */
  wagmiOptions?: WagmiOptions;
}

export function App({ deployment: preloaded, wagmiOptions }: AppProps = {}) {
  const [state, setState] = useState<LoadState>(
    preloaded ? { status: 'ready', deployment: preloaded } : { status: 'loading' },
  );

  useEffect(() => {
    if (preloaded) return;
    let cancelled = false;
    loadDeployment()
      .then((deployment) => {
        if (cancelled) return;
        const unverified = Object.values(deployment.contracts).filter((c) => !c.abiVerified);
        logActivity(
          unverified.length ? 'warn' : 'success',
          'deployment',
          unverified.length
            ? `Loaded imd-deployment.json; ABI hash mismatch for ${unverified.map((c) => c.name).join(', ')}`
            : `Loaded imd-deployment.json for ${deployment.network.name} (chain ${deployment.network.chainId})`,
        );
        setState({ status: 'ready', deployment });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        logActivity('error', 'deployment', message);
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [preloaded]);

  if (state.status === 'loading') {
    return (
      <main className="shell" aria-busy="true">
        <p role="status">Loading deployment configuration…</p>
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="shell">
        <div role="alert" className="callout error">
          <strong>Could not load the deployment configuration.</strong>
          <p>{state.message}</p>
          <p>Reload the page. If the problem persists, the export is incomplete: rebuild it with <code>npm run build</code>.</p>
        </div>
      </main>
    );
  }
  return <Ready deployment={state.deployment} wagmiOptions={wagmiOptions} />;
}

function Ready({ deployment, wagmiOptions }: { deployment: Deployment; wagmiOptions?: WagmiOptions }) {
  const config = useMemo(() => createWagmiConfig(deployment, wagmiOptions), [deployment, wagmiOptions]);
  const queryClient = useMemo(() => new QueryClient(), []);
  const network = deployment.network;

  return (
    <DeploymentContext.Provider value={deployment}>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <a className="skip-link" href="#main">
            Skip to main content
          </a>
          <header className="topbar">
            <div className="topbar-inner">
              <div className="brand">
                <h1 className="title">OwnableCounter</h1>
                <p className="subtitle">
                  A smoke-test counter on <span translate="no">{network.name}</span>
                  {network.testnet ? ' (testnet)' : ''}. Anyone can increment or decrement; the owner can reset.
                </p>
              </div>
              <WalletBar />
            </div>
          </header>
          <main id="main" className="shell" tabIndex={-1}>
            <div className="grid">
              <CounterPanel />
              <TokenPanel />
              <SwapPanel />
              <ContractsPanel />
              <ActivityPanel />
            </div>
          </main>
          <footer className="footer">
            <p>
              Launch <code translate="no">{deployment.manifest.launchId}</code> · source commit{' '}
              <code translate="no">{deployment.manifest.sourceCommit.slice(0, 12)}</code> · configuration read from{' '}
              <a href="imd-deployment.json">imd-deployment.json</a>.
            </p>
          </footer>
        </QueryClientProvider>
      </WagmiProvider>
    </DeploymentContext.Provider>
  );
}
