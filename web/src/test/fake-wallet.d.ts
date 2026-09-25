export interface FakeWalletState {
  chainId(): string;
  sent: { to?: string; data?: string; value?: string; from?: string; hash: string }[];
  added: unknown[];
  switched: string[];
  rejectNext: boolean;
  authorized(): boolean;
}
export interface FakeWallet {
  isMetaMask: true;
  isFakeWallet: true;
  state: FakeWalletState;
  on(event: string, listener: (payload: unknown) => void): FakeWallet;
  removeListener(event: string, listener: (payload: unknown) => void): FakeWallet;
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
export function createFakeWallet(options: {
  accounts: string[];
  chainId?: string;
  knownChains?: string[];
  authorized?: boolean;
  rpc: (method: string, params?: unknown[]) => Promise<unknown>;
}): FakeWallet;
