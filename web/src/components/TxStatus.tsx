import { useDeployment } from '../lib/context';
import { explorerTx } from '../lib/format';

export type TxPhase = 'idle' | 'simulating' | 'signing' | 'pending' | 'confirmed' | 'error';

export interface TxState {
  phase: TxPhase;
  hash?: `0x${string}`;
  message?: string;
}

export const idleTx: TxState = { phase: 'idle' };

/** Shared transaction status line: simulation, wallet signing, pending, confirmed or error. */
export function TxStatus({ state, label }: { state: TxState; label?: string }) {
  const { network } = useDeployment();
  if (state.phase === 'idle') return null;
  const isError = state.phase === 'error';
  const text: Record<TxPhase, string> = {
    idle: '',
    simulating: 'Simulating…',
    signing: 'Confirm in your wallet…',
    pending: 'Transaction sent, waiting for confirmation…',
    confirmed: 'Confirmed.',
    error: state.message ?? 'Failed.',
  };
  return (
    <p className={`tx-status ${isError ? 'inline-error' : ''}`} role={isError ? 'alert' : 'status'}>
      {label ? `${label}: ` : ''}
      {text[state.phase]}{' '}
      {state.hash && (
        <a href={explorerTx(network.explorer, state.hash)} target="_blank" rel="noreferrer" translate="no">
          View transaction
        </a>
      )}
    </p>
  );
}
