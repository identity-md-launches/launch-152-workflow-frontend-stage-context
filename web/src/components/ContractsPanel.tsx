import { useDeployment } from '../lib/context';
import { explorerAddress } from '../lib/format';

/** Every configured contract with its address, explorer link, ABI file and attestation binding. */
export function ContractsPanel() {
  const { manifest, network, contracts } = useDeployment();
  return (
    <section className="card" aria-labelledby="contracts-heading">
      <h2 id="contracts-heading">Deployed Contracts</h2>
      <p className="muted">
        Read at runtime from <a href="imd-deployment.json">imd-deployment.json</a>, chain {network.chainId} ({network.name}).
      </p>
      <div className="table-wrap">
        <table className="contracts">
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">Address</th>
              <th scope="col">ABI</th>
            </tr>
          </thead>
          <tbody>
            {manifest.contracts.map((c) => {
              const loaded = contracts[c.name];
              return (
                <tr key={c.name}>
                  <th scope="row">{c.name}</th>
                  <td>
                    <a className="mono break" translate="no" href={explorerAddress(network.explorer, c.address)} target="_blank" rel="noreferrer">
                      {c.address}
                    </a>
                  </td>
                  <td>
                    <a href={c.abiPath} translate="no">
                      {c.abiPath}
                    </a>{' '}
                    <span className={`badge ${loaded?.abiVerified ? 'ok' : 'warn'}`}>
                      {loaded?.abiVerified ? 'hash verified' : 'hash mismatch'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <dl className="kv">
        <div>
          <dt>Attestation</dt>
          <dd className="mono break" translate="no">{manifest.attestationHash}</dd>
        </div>
        <div>
          <dt>Source commit</dt>
          <dd className="mono break" translate="no">{manifest.sourceCommit}</dd>
        </div>
        <div>
          <dt>Public RPCs</dt>
          <dd>
            <ul className="plain">
              {network.rpcUrls.map((u) => (
                <li key={u} className="mono break" translate="no">{u}</li>
              ))}
            </ul>
          </dd>
        </div>
        {network.testnet && network.faucets.length > 0 && (
          <div>
            <dt>Faucets</dt>
            <dd>
              <ul className="plain">
                {network.faucets.map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noreferrer" className="break">{u}</a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
