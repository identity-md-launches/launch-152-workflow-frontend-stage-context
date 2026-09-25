import { useActivity, clearActivity } from '../lib/activity';
import { useDeployment } from '../lib/context';
import { formatTime, explorerTx } from '../lib/format';
import { RecentEvents } from './RecentEvents';

/** Observability: what the app did (RPC, wallet, transactions) plus recent on-chain events. */
export function ActivityPanel() {
  const entries = useActivity();
  const { network } = useDeployment();
  return (
    <section className="card wide" aria-labelledby="activity-heading">
      <div className="card-head">
        <h2 id="activity-heading">Activity</h2>
        <button type="button" className="btn ghost small" onClick={clearActivity} disabled={entries.length === 0}>
          Clear Log
        </button>
      </div>
      <h3>Session Log</h3>
      <ol className="log" aria-live="polite" aria-relevant="additions" data-testid="activity-log">
        {entries.length === 0 && <li className="muted">Nothing yet. Wallet, RPC and transaction events appear here.</li>}
        {entries.map((e) => (
          <li key={e.id} className={`log-${e.level}`}>
            <time dateTime={e.at.toISOString()}>{formatTime(e.at)}</time> <span className="log-source">{e.source}</span>{' '}
            <span className="break">{e.message}</span>{' '}
            {e.txHash && (
              <a href={explorerTx(network.explorer, e.txHash)} target="_blank" rel="noreferrer" translate="no">
                tx
              </a>
            )}
          </li>
        ))}
      </ol>
      <RecentEvents />
    </section>
  );
}
