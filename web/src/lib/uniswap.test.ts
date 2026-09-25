import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, parseEther } from 'viem';
import { applySlippage, buildPoolKey, encodeV4ExactInputSingle, poolId, priceFromSqrtX96, V4_ACTIONS, ZERO_ADDRESS } from './uniswap';
import { TOKEN_ADDRESS } from '../test/fixtures';

const key = buildPoolKey({ pairedCurrency: ZERO_ADDRESS, token: TOKEN_ADDRESS, fee: 3000, tickSpacing: 60 });

describe('pool key', () => {
  it('puts native ETH first and the token second, hookless', () => {
    expect(key).toEqual({ currency0: ZERO_ADDRESS, currency1: TOKEN_ADDRESS, fee: 3000, tickSpacing: 60, hooks: ZERO_ADDRESS });
  });
  it('sorts two ERC-20 currencies ascending', () => {
    const k = buildPoolKey({ pairedCurrency: '0xffffffffffffffffffffffffffffffffffffffff', token: TOKEN_ADDRESS, fee: 500, tickSpacing: 10 });
    expect(k.currency0).toBe(TOKEN_ADDRESS);
    expect(k.currency1).toBe('0xffffffffffffffffffffffffffffffffffffffff');
  });
  it('computes the on-chain pool id (cross-checked with cast keccak of the abi-encoded key)', () => {
    expect(poolId(key)).toBe('0x081a6cca2055fd8849bfed9931eb9aa176819f57fd95249d3cdc2e24867bf8ff');
  });
});

describe('slippage', () => {
  it('applies basis points and clamps', () => {
    expect(applySlippage(10_000n, 50)).toBe(9_950n);
    expect(applySlippage(10_000n, 0)).toBe(10_000n);
    expect(applySlippage(10_000n, 99_999)).toBe(0n);
  });
});

describe('encodeV4ExactInputSingle', () => {
  it('encodes V4_SWAP with SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL and sends ETH as value', () => {
    const amountIn = parseEther('0.01');
    const minOut = 123n;
    const swap = encodeV4ExactInputSingle({ poolKey: key, zeroForOne: true, amountIn, amountOutMinimum: minOut });
    expect(swap.commands).toBe('0x10');
    expect(swap.value).toBe(amountIn);
    expect(swap.inputCurrency).toBe(ZERO_ADDRESS);
    expect(swap.outputCurrency).toBe(TOKEN_ADDRESS);
    const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], swap.inputs[0]!);
    expect(actions).toBe(V4_ACTIONS);
    expect(params).toHaveLength(3);
    const [settle] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1]!);
    const [take, takeMin] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[2]!);
    expect(settle.toLowerCase()).toBe(ZERO_ADDRESS);
    expect(take.toLowerCase()).toBe(TOKEN_ADDRESS);
    expect(takeMin).toBe(minOut);
    const [p] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            {
              name: 'poolKey',
              type: 'tuple',
              components: [
                { name: 'currency0', type: 'address' },
                { name: 'currency1', type: 'address' },
                { name: 'fee', type: 'uint24' },
                { name: 'tickSpacing', type: 'int24' },
                { name: 'hooks', type: 'address' },
              ],
            },
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'hookData', type: 'bytes' },
          ],
        },
      ],
      params[0]!,
    );
    expect(p.zeroForOne).toBe(true);
    expect(p.amountIn).toBe(amountIn);
    expect(p.amountOutMinimum).toBe(minOut);
    expect(p.poolKey.currency1.toLowerCase()).toBe(TOKEN_ADDRESS);
    expect(p.hookData).toBe('0x');
  });
  it('sends no value when the input is the token', () => {
    const swap = encodeV4ExactInputSingle({ poolKey: key, zeroForOne: false, amountIn: 5n, amountOutMinimum: 1n });
    expect(swap.value).toBe(0n);
    expect(swap.inputCurrency).toBe(TOKEN_ADDRESS);
  });
});

describe('priceFromSqrtX96', () => {
  it('returns 1 for the 1:1 opening price with equal decimals', () => {
    expect(priceFromSqrtX96(2n ** 96n, 18, 18)).toBeCloseTo(1, 9);
  });
});
