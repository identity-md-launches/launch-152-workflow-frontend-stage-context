// Self-contained fake EIP-1193 wallet used by unit tests (jsdom) and the Playwright run (injected
// as window.ethereum). Wallet-side methods are handled locally; everything else is forwarded to `rpc`.
export function createFakeWallet(options) {
  const accounts = options.accounts;
  let chainId = options.chainId || '0x1';
  const knownChains = new Set(options.knownChains || ['0x1']);
  const listeners = {};
  // Like a real wallet, eth_accounts is empty until the site was granted permission.
  let authorized = Boolean(options.authorized);
  const state = { chainId: () => chainId, sent: [], added: [], switched: [], rejectNext: false, authorized: () => authorized };
  let txCounter = 1;
  function emit(event, payload) {
    for (const l of listeners[event] || []) l(payload);
  }
  const provider = {
    isMetaMask: true,
    isFakeWallet: true,
    state,
    on(event, listener) {
      (listeners[event] ||= []).push(listener);
      return provider;
    },
    removeListener(event, listener) {
      listeners[event] = (listeners[event] || []).filter((l) => l !== listener);
      return provider;
    },
    async request({ method, params }) {
      switch (method) {
        case 'eth_requestAccounts':
          authorized = true;
          return accounts;
        case 'eth_accounts':
          return authorized ? accounts : [];
        case 'wallet_revokePermissions':
          authorized = false;
          return null;
        case 'eth_chainId':
          return chainId;
        case 'wallet_switchEthereumChain': {
          const target = params[0].chainId;
          if (!knownChains.has(target)) {
            const err = new Error('Unrecognized chain ID. Try adding the chain first.');
            err.code = 4902;
            throw err;
          }
          chainId = target;
          state.switched.push(target);
          emit('chainChanged', chainId);
          return null;
        }
        case 'wallet_addEthereumChain':
          state.added.push(params[0]);
          knownChains.add(params[0].chainId);
          return null;
        case 'wallet_getPermissions':
        case 'wallet_requestPermissions':
          return [{ parentCapability: 'eth_accounts' }];
        case 'eth_sendTransaction': {
          if (state.rejectNext) {
            state.rejectNext = false;
            const err = new Error('User rejected the request.');
            err.code = 4001;
            throw err;
          }
          const tx = params[0];
          const hash = `0x${(txCounter++).toString(16).padStart(64, '0')}`;
          state.sent.push({ ...tx, hash });
          return hash;
        }
        case 'personal_sign':
        case 'eth_signTypedData_v4':
          return `0x${'ab'.repeat(65)}`;
        default:
          return options.rpc(method, params);
      }
    },
  };
  return provider;
}
