import { useCallback, useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import type { Log } from 'viem';
import { useDeployment } from '../lib/context';
import { ACTIVITY_LOOKBACK_BLOCKS, COUNTER_CONTRACT_NAME } from '../config';
import { explorerTx } from '../lib/format';

interface EventRow {
  key: string;
  name: string;
  detail: string;
  block: bigint;
  txHash: `0x${string}`;
}

function describe(log: Log & { eventName?: string; args?: Record<string, unknown> }): EventRow {
  const args = log.args ?? {};
  const name = log.eventName ?? 'Unknown';
  const parts = Object.entries(args).map(([k, v]) => `${k}=${String(v)}`);
  return {
    key: `${log.transactionHash}-${log.logIndex}`,
    name,
    detail: parts.join(' '),
    block: log.blockNumber ?? 0n,
    txHash: log.transactionHash as `0x${string}`,
  };
}

/** Recent Incremented / Decremented / Reset / OwnershipTransferred events from the public RPC. */
export function RecentEvents() {
  const deployment = useDeployment();
  const counter = deployment.contracts[COUNTER_CONTRACT_NAME];
  const client = usePublicClient({ chainId: deployment.network.chainId });
  const [rows, setRows] = useState<EventRow[]>();
  const [range, setRange] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!client || !counter) return;
    setLoading(true);
    setError(undefined);
    try {
      const latest = await client.getBlockNumber();
      const fromBlock = latest > ACTIVITY_LOOKBACK_BLOCKS ? latest - ACTIVITY_LOOKBACK_BLOCKS : 0n;
      const logs = await client.getContractEvents({ address: counter.address, abi: counter.abi, fromBlock, toBlock: latest });
      setRows(logs.map((l) => describe(l as never)).reverse().slice(0, 25));
      setRange(`blocks ${fromBlock}–${latest}`);
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : String(err));
    } finally {
      setLoading(false);
    }
  }, [client, counter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="card-head">
        <h3>Recent Counter Events {range && <span className="muted small-text">({range})</span>}</h3>
        <button type="button" className="btn ghost small" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Reload Events'}
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          Could not fetch events: {error}. Try again or use another RPC.
        </p>
      )}
      {rows && rows.length === 0 && <p className="muted">No events in the scanned range.</p>}
      {rows && rows.length > 0 && (
        <ul className="log" data-testid="recent-events">
          {rows.map((r) => (
            <li key={r.key}>
              <span className="log-source">{r.name}</span> <span className="mono break" translate="no">{r.detail}</span> · block{' '}
              {r.block.toString()} ·{' '}
              <a href={explorerTx(deployment.network.explorer, r.txHash)} target="_blank" rel="noreferrer" translate="no">
                tx
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
