import { encodeAbiParameters, keccak256, parseAbi, type Address, type Hex } from 'viem';

/** Zero address: native ETH as a Uniswap v4 currency and "no hook". */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/** Minimal ABIs for the vetted Uniswap v4 periphery. Addresses always come from the manifest. */
export const quoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);

export const universalRouterAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);

export const permit2Abi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);

export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
]);

export const erc20AllowanceAbi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/**
 * Pool key for a launched token: paired currency (zero address for native ETH) and the token, sorted
 * ascending by address, with fee / tickSpacing from the manifest pool and the hook (zero for hookless).
 */
export function buildPoolKey(params: {
  pairedCurrency: Address;
  token: Address;
  fee: number;
  tickSpacing: number;
  hooks?: Address;
}): PoolKey {
  const a = params.pairedCurrency.toLowerCase() as Address;
  const b = params.token.toLowerCase() as Address;
  const [currency0, currency1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return { currency0, currency1, fee: params.fee, tickSpacing: params.tickSpacing, hooks: params.hooks ?? ZERO_ADDRESS };
}

export function poolId(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint24' },
        { type: 'int24' },
        { type: 'address' },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** Apply slippage (basis points) to a quoted output to get the minimum acceptable amount. */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(slippageBps))));
  return (amountOut * (10_000n - bps)) / 10_000n;
}

/** Universal router command and v4 actions used for a single exact-input swap. */
export const V4_SWAP_COMMAND = '0x10' as const; // Commands.V4_SWAP
export const V4_ACTIONS = '0x060c0f' as const; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL

const poolKeyComponents = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
] as const;

export interface EncodedSwap {
  commands: Hex;
  inputs: Hex[];
  /** Transaction value: `amountIn` when the input currency is native ETH, else 0. */
  value: bigint;
  inputCurrency: Address;
  outputCurrency: Address;
}

/** Encode `execute(commands, inputs, deadline)` arguments for one exact-input single-hop v4 swap. */
export function encodeV4ExactInputSingle(params: {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
  hookData?: Hex;
}): EncodedSwap {
  const { poolKey, zeroForOne, amountIn, amountOutMinimum } = params;
  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  const swapParams = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [{ poolKey, zeroForOne, amountIn, amountOutMinimum, hookData: params.hookData ?? '0x' }],
  );
  const settleAll = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [inputCurrency, amountIn]);
  const takeAll = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [outputCurrency, amountOutMinimum],
  );
  const v4Input = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [V4_ACTIONS, [swapParams, settleAll, takeAll]],
  );

  return {
    commands: V4_SWAP_COMMAND,
    inputs: [v4Input],
    value: inputCurrency === ZERO_ADDRESS ? amountIn : 0n,
    inputCurrency,
    outputCurrency,
  };
}

/** Price of currency1 in currency0 units implied by sqrtPriceX96, adjusted for decimals. */
export function priceFromSqrtX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  if (sqrtPriceX96 === 0n) return 0;
  const q96 = 2 ** 96;
  const sqrt = Number(sqrtPriceX96) / q96;
  // price = token1 per token0 in raw units; convert to human units.
  const raw = sqrt * sqrt;
  return raw * 10 ** (decimals0 - decimals1);
}
