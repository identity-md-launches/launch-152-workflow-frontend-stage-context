import { useId, useState, type FormEvent } from 'react';
import { useReadContract } from 'wagmi';
import { isAddress, type Address } from 'viem';
import { useDeployment } from '../lib/context';
import { useWallet } from '../lib/useWallet';
import { useContractAction } from '../lib/useContractAction';
import { formatCount, shortAddress, explorerAddress } from '../lib/format';
import { COUNTER_CONTRACT_NAME, POLL_INTERVAL_MS } from '../config';
import { TxStatus } from './TxStatus';

/** Live OwnableCounter state and its four actions: increment, decrement, reset, transferOwnership. */
export function CounterPanel() {
  const deployment = useDeployment();
  const wallet = useWallet();
  const counter = deployment.contracts[COUNTER_CONTRACT_NAME];
  const chainId = deployment.network.chainId;
  const newOwnerId = useId();
  const [newOwner, setNewOwner] = useState('');
  const [newOwnerError, setNewOwnerError] = useState<string>();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState(false);

  const countRead = useReadContract({
    address: counter?.address,
    abi: counter?.abi,
    functionName: 'count',
    chainId,
    query: { enabled: !!counter, refetchInterval: POLL_INTERVAL_MS },
  });
  const ownerRead = useReadContract({
    address: counter?.address,
    abi: counter?.abi,
    functionName: 'owner',
    chainId,
    query: { enabled: !!counter, refetchInterval: POLL_INTERVAL_MS },
  });

  const refetch = () => {
    void countRead.refetch();
    void ownerRead.refetch();
  };
  const action = useContractAction('counter', refetch);

  if (!counter) {
    return (
      <section className="card" aria-labelledby="counter-heading">
        <h2 id="counter-heading">Counter</h2>
        <p role="alert" className="inline-error">
          The deployment manifest has no {COUNTER_CONTRACT_NAME} entry.
        </p>
      </section>
    );
  }

  const count = countRead.data as bigint | undefined;
  const owner = ownerRead.data as Address | undefined;
  const isOwner = !!wallet.address && !!owner && wallet.address.toLowerCase() === owner.toLowerCase();
  const canWrite = wallet.isReady && counter.abiVerified && !action.busy;
  const readError = countRead.error ?? ownerRead.error;

  const disabledReason = !counter.abiVerified
    ? 'ABI hash does not match the attested handoff; transactions are disabled.'
    : !wallet.isConnected
      ? 'Connect a wallet to send transactions.'
      : wallet.wrongChain
        ? `Switch the wallet to ${deployment.network.name} to send transactions.`
        : undefined;

  const call = (functionName: string, args: readonly unknown[] = []) =>
    action.run({
      address: counter.address,
      abi: counter.abi,
      functionName,
      args,
      label: `${functionName}(${args.join(', ')})`,
    });

  async function submitTransfer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = newOwner.trim();
    if (!isAddress(value)) {
      setNewOwnerError('Enter a valid 0x address (40 hex characters).');
      (e.currentTarget.elements.namedItem('newOwner') as HTMLInputElement | null)?.focus();
      return;
    }
    if (BigInt(value) === 0n) {
      setNewOwnerError('The zero address is rejected by the contract. Enter a real account.');
      return;
    }
    setNewOwnerError(undefined);
    if (!confirmTransfer) {
      // Irreversible: ask once more before simulating and signing.
      setConfirmTransfer(true);
      return;
    }
    setConfirmTransfer(false);
    const ok = await call('transferOwnership', [value]);
    if (ok) setNewOwner('');
  }

  return (
    <section className="card" aria-labelledby="counter-heading">
      <div className="card-head">
        <h2 id="counter-heading">Counter</h2>
        <button type="button" className="btn ghost small" onClick={refetch} disabled={countRead.isFetching}>
          {countRead.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <dl className="stats">
        <div>
          <dt>Current count</dt>
          <dd className="big-number" aria-live="polite" data-testid="count">
            {count === undefined ? (countRead.isLoading ? 'Loading…' : '—') : formatCount(count)}
          </dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd translate="no" data-testid="owner">
            {owner ? (
              <a href={explorerAddress(deployment.network.explorer, owner)} target="_blank" rel="noreferrer" className="mono" title={owner}>
                {shortAddress(owner)}
              </a>
            ) : ownerRead.isLoading ? (
              'Loading…'
            ) : (
              '—'
            )}
            {isOwner && <span className="badge"> you</span>}
          </dd>
        </div>
      </dl>
      {readError && (
        <p className="inline-error" role="alert">
          Could not read the contract: {readError.message.split('\n')[0]}. Check your connection and refresh.
        </p>
      )}

      <div className="actions">
        <button type="button" className="btn primary" disabled={!canWrite} onClick={() => void call('increment')}>
          Increment
        </button>
        <button
          type="button"
          className="btn"
          disabled={!canWrite || count === 0n}
          onClick={() => void call('decrement')}
          title={count === 0n ? 'The counter is 0; decrement() would revert with CounterUnderflow.' : undefined}
        >
          Decrement
        </button>
        {!confirmReset ? (
          <button
            type="button"
            className="btn danger"
            disabled={!canWrite || !isOwner}
            onClick={() => setConfirmReset(true)}
            title={!isOwner ? 'Only the owner can reset; reset() reverts with NotOwner otherwise.' : undefined}
          >
            Reset to 0
          </button>
        ) : (
          <span className="confirm" role="group" aria-label="Confirm reset">
            <span>Reset the counter from {count === undefined ? '…' : formatCount(count)} to 0?</span>
            <button type="button" className="btn danger" disabled={!canWrite} onClick={() => { setConfirmReset(false); void call('reset'); }}>
              Confirm Reset
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </span>
        )}
      </div>
      {count === 0n && wallet.isReady && <p className="muted">Decrement is disabled at 0 because the contract reverts below zero.</p>}
      {disabledReason && (
        <p className="muted" role="status">
          {disabledReason}
        </p>
      )}
      {wallet.isReady && !isOwner && <p className="muted">Reset is owner-only. Increment and decrement are open to anyone.</p>}

      <form className="field-row" onSubmit={(e) => void submitTransfer(e)} noValidate>
        <label htmlFor={newOwnerId}>Transfer ownership to</label>
        <div className="field-inline">
          <input
            id={newOwnerId}
            name="newOwner"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x1234…"
            value={newOwner}
            onChange={(e) => {
              setNewOwner(e.target.value);
              setConfirmTransfer(false);
            }}
            aria-describedby={newOwnerError ? `${newOwnerId}-error` : `${newOwnerId}-help`}
            aria-invalid={!!newOwnerError}
            disabled={!canWrite || !isOwner}
          />
          <button type="submit" className={`btn ${confirmTransfer ? 'danger' : ''}`} disabled={!canWrite || !isOwner}>
            {confirmTransfer ? 'Confirm Transfer' : 'Transfer Ownership'}
          </button>
          {confirmTransfer && (
            <button type="button" className="btn ghost" onClick={() => setConfirmTransfer(false)}>
              Cancel
            </button>
          )}
        </div>
        {confirmTransfer && (
          <p className="inline-error" role="alert">
            This hands control of reset() to {newOwner.trim()} immediately and cannot be undone. Confirm to continue.
          </p>
        )}
        {newOwnerError ? (
          <p id={`${newOwnerId}-error`} className="inline-error" role="alert">
            {newOwnerError}
          </p>
        ) : (
          <p id={`${newOwnerId}-help`} className="muted">
            Owner only. Single step and immediate; the zero address is rejected so reset can never be bricked.
          </p>
        )}
      </form>

      <TxStatus state={action.state} />

      <details className="howto">
        <summary>How to call increment() yourself</summary>
        <p>
          Anyone can call <code>increment()</code> (selector <code translate="no">0xd09de08a</code>) on{' '}
          <code translate="no">{counter.address}</code>. With Foundry:
        </p>
        <pre translate="no">{`cast send ${counter.address} "increment()" \\
  --rpc-url ${deployment.network.rpcUrls[0]} --private-key <YOUR_KEY>
cast call ${counter.address} "count()(uint256)" --rpc-url ${deployment.network.rpcUrls[0]}`}</pre>
      </details>
    </section>
  );
}
