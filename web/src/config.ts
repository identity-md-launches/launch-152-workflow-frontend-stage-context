/**
 * Single place for everything the app needs to find the deployment.
 *
 * Contract addresses, chain id, ABI paths, public RPC URLs and the Uniswap v4 addresses are NOT
 * kept here: they live in `dist/imd-deployment.json`, which is generated from the workflow handoff
 * by `scripts/manifest.mjs` and loaded at runtime (see `lib/deployment.ts`). Keeping one source of
 * truth means the page can never disagree with the attested handoff.
 */

/** Runtime deployment configuration, relative to the exported `index.html`. */
export const DEPLOYMENT_MANIFEST_PATH = 'imd-deployment.json';

/**
 * Optional WalletConnect Cloud project id. Not supplied for this launch, so only browser (EIP-1193 /
 * EIP-6963) wallets are offered. Set `VITE_WALLETCONNECT_PROJECT_ID` at build time and add the
 * `walletConnect` connector in `lib/wagmi.ts` to enable mobile wallets. A project id is public, not a
 * secret; no private credentials belong in this repository.
 */
export const WALLETCONNECT_PROJECT_ID: string | undefined =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || undefined;

/** How often live contract state is re-read while the page is open (milliseconds). */
export const POLL_INTERVAL_MS = 12_000;

/** Default slippage tolerance for swaps, in basis points (50 = 0.5%). */
export const DEFAULT_SLIPPAGE_BPS = 50;

/** How long a Permit2 allowance granted for a swap stays valid (seconds). */
export const PERMIT2_EXPIRATION_SECONDS = 30 * 60;

/** Deadline applied to universal router swaps (seconds from now). */
export const SWAP_DEADLINE_SECONDS = 20 * 60;

/** Block window scanned for the recent activity feed. */
export const ACTIVITY_LOOKBACK_BLOCKS = 5_000n;

/**
 * Uniswap v4 pool the launch token trades in, as described by the attested launch manifest
 * (`launch.json` at the pinned source commit): paired against native ETH (zero address), fee 3000,
 * tick spacing 60, no hook. Router, quoter, state view and Permit2 addresses come from the runtime
 * manifest's `network.uniswapV4` block, never from here.
 */
export const LAUNCH_POOL = {
  pairedCurrency: '0x0000000000000000000000000000000000000000',
  fee: 3000,
  tickSpacing: 60,
  hooks: '0x0000000000000000000000000000000000000000',
} as const;

/** Name of the launch token contract and of the application contract inside the manifest. */
export const TOKEN_CONTRACT_NAME = 'CounterToken';
export const COUNTER_CONTRACT_NAME = 'OwnableCounter';
