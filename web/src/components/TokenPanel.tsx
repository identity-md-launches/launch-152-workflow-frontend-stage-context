import { useId, useState, type FormEvent } from 'react';
import { useReadContract, useReadContracts } from 'wagmi';
import { isAddress, parseUnits } from 'viem';
import { useDeployment } from '../lib/context';
import { useWallet } from '../lib/useWallet';
import { useContractAction } from '../lib/useContractAction';
import { formatAmount, explorerAddress } from '../lib/format';
import { POLL_INTERVAL_MS, TOKEN_CONTRACT_NAME } from '../config';
import { TxStatus } from './TxStatus';

type Mode = 'transfer' | 'approve' | 'transferFrom';

/** CounterToken (CNTR): metadata, live balance, and the ERC-20 actions transfer / approve / transferFrom. */
export function TokenPanel() {
  const deployment = useDeployment();
  const wallet = useWallet();
  const token = deployment.contracts[TOKEN_CONTRACT_NAME];
  const chainId = deployment.network.chainId;
  const ids = { mode: useId(), to: useId(), from: useId(), amount: useId() };
  const [mode, setMode] = useState<Mode>('transfer');
  const [to, setTo] = useState('');
  const [from, setFrom] = useState('');
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState<string>();

  const meta = useReadContracts({
    contracts: token
      ? (['name', 'symbol', 'decimals', 'totalSupply'] as const).map((functionName) => ({
          address: token.address,
          abi: token.abi,
          functionName,
          chainId,
        }))
      : [],
    query: { enabled: !!token },
  });
  const balance = useReadContract({
    address: token?.address,
    abi: token?.abi,
    functionName: 'balanceOf',
    args: wallet.address ? [wallet.address] : undefined,
    chainId,
    query: { enabled: !!token && !!wallet.address, refetchInterval: POLL_INTERVAL_MS },
  });
  const action = useContractAction('token', () => void balance.refetch());

  if (!token) {
    return (
      <section className="card" aria-labelledby="token-heading">
        <h2 id="token-heading">Launch Token</h2>
        <p role="alert" className="inline-error">The deployment manifest has no {TOKEN_CONTRACT_NAME} entry.</p>
      </section>
    );
  }

  const [name, symbol, decimalsRaw, totalSupply] = (meta.data ?? []).map((r) => r?.result) as [
    string | undefined,
    string | undefined,
    number | undefined,
    bigint | undefined,
  ];
  const decimals = decimalsRaw ?? 18;
  const sym = symbol ?? 'CNTR';
  const canWrite = wallet.isReady && token.abiVerified && !action.busy;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    let raw: bigint;
    try {
      raw = parseUnits(amount.trim() as `${number}`, decimals);
      if (raw <= 0n) throw new Error('zero');
    } catch {
      setFormError(`Enter a positive ${sym} amount, e.g. 1.5`);
      (form.elements.namedItem('amount') as HTMLInputElement | null)?.focus();
      return;
    }
    if (!isAddress(to.trim())) {
      setFormError(mode === 'approve' ? 'Enter a valid spender address.' : 'Enter a valid recipient address.');
      (form.elements.namedItem('to') as HTMLInputElement | null)?.focus();
      return;
    }
    if (mode === 'transferFrom' && !isAddress(from.trim())) {
      setFormError('Enter a valid source address that approved you.');
      (form.elements.namedItem('from') as HTMLInputElement | null)?.focus();
      return;
    }
    setFormError(undefined);
    const args = mode === 'transferFrom' ? [from.trim(), to.trim(), raw] : [to.trim(), raw];
    const ok = await action.run({
      address: token!.address,
      abi: token!.abi,
      functionName: mode,
      args,
      label: `${mode}(${args.map(String).join(', ')})`,
    });
    if (ok) {
      setAmount('');
      setTo('');
      setFrom('');
    }
  }

  const modeLabel: Record<Mode, string> = { transfer: 'Send Tokens', approve: 'Approve Spender', transferFrom: 'Pull Tokens' };
  const toLabel = mode === 'approve' ? 'Spender' : 'Recipient';

  return (
    <section className="card" aria-labelledby="token-heading">
      <h2 id="token-heading">Launch Token</h2>
      <dl className="stats">
        <div>
          <dt>Token</dt>
          <dd translate="no">
            {name ?? (meta.isLoading ? 'Loading…' : '—')} {symbol ? `(${symbol})` : ''}
          </dd>
        </div>
        <div>
          <dt>Total supply</dt>
          <dd>{totalSupply !== undefined ? `${formatAmount(totalSupply, decimals)} ${sym}` : meta.isLoading ? 'Loading…' : '—'}</dd>
        </div>
        <div>
          <dt>Your balance</dt>
          <dd aria-live="polite" data-testid="token-balance">
            {!wallet.isConnected
              ? 'Connect a wallet'
              : balance.data !== undefined
                ? `${formatAmount(balance.data as bigint, decimals)} ${sym}`
                : balance.isLoading
                  ? 'Loading…'
                  : '—'}
          </dd>
        </div>
      </dl>
      {meta.error && (
        <p className="inline-error" role="alert">
          Could not read token metadata: {meta.error.message.split('\n')[0]}.
        </p>
      )}
      <p className="muted">
        Fixed supply, {decimals} decimals, no owner or mint.{' '}
        <a href={explorerAddress(deployment.network.explorer, token.address)} target="_blank" rel="noreferrer">
          View on explorer
        </a>
      </p>

      <form onSubmit={(e) => void submit(e)} noValidate className="stack">
        <div className="field-row">
          <label htmlFor={ids.mode}>Action</label>
          <select id={ids.mode} name="mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} disabled={!canWrite}>
            <option value="transfer">transfer — send {sym} to an address</option>
            <option value="approve">approve — let a spender move your {sym}</option>
            <option value="transferFrom">transferFrom — move {sym} that was approved to you</option>
          </select>
        </div>
        {mode === 'transferFrom' && (
          <div className="field-row">
            <label htmlFor={ids.from}>From (approved you)</label>
            <input id={ids.from} name="from" type="text" autoComplete="off" spellCheck={false} placeholder="0x1234…" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!canWrite} />
          </div>
        )}
        <div className="field-row">
          <label htmlFor={ids.to}>{toLabel}</label>
          <input id={ids.to} name="to" type="text" autoComplete="off" spellCheck={false} placeholder="0x1234…" value={to} onChange={(e) => setTo(e.target.value)} disabled={!canWrite} />
        </div>
        <div className="field-row">
          <label htmlFor={ids.amount}>Amount ({sym})</label>
          <input
            id={ids.amount}
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="1.5…"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-describedby={formError ? `${ids.amount}-error` : undefined}
            aria-invalid={!!formError}
            disabled={!canWrite}
          />
        </div>
        {formError && (
          <p id={`${ids.amount}-error`} className="inline-error" role="alert">
            {formError}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="btn primary" disabled={!canWrite}>
            {modeLabel[mode]}
          </button>
        </div>
        {!wallet.isConnected && <p className="muted" role="status">Connect a wallet to send, approve or pull {sym}.</p>}
        {wallet.wrongChain && <p className="muted" role="status">Switch the wallet to {deployment.network.name} first.</p>}
      </form>
      <TxStatus state={action.state} />
    </section>
  );
}
