import { describe, expect, it, vi } from 'vitest';
import { describeError, isUnknownChainError, switchOrAddChain } from './chain';
import { toWalletAddChain } from './deployment';
import { network } from '../test/fixtures';
import { createFakeWallet } from '../test/fake-wallet.js';

const params = toWalletAddChain(network);

describe('switchOrAddChain', () => {
  it('switches directly when the wallet knows the chain', async () => {
    const wallet = createFakeWallet({ accounts: [], chainId: '0x1', knownChains: ['0x1', '0xaa36a7'], rpc: async () => null });
    await expect(switchOrAddChain(wallet, params)).resolves.toBe('switched');
    expect(wallet.state.added).toHaveLength(0);
    expect(wallet.state.chainId()).toBe('0xaa36a7');
  });

  it('adds the chain with the exact wallet_addEthereumChain params on 4902, then switches', async () => {
    const wallet = createFakeWallet({ accounts: [], chainId: '0x1', rpc: async () => null });
    await expect(switchOrAddChain(wallet, params)).resolves.toBe('added-and-switched');
    expect(wallet.state.added).toEqual([params]);
    expect(wallet.state.switched).toEqual(['0xaa36a7']);
    expect(wallet.state.chainId()).toBe('0xaa36a7');
  });

  it('rethrows other switch errors without adding', async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
    });
    await expect(switchOrAddChain({ request }, params)).rejects.toThrow(/rejected/);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('error helpers', () => {
  it('recognises unknown-chain errors in several shapes', () => {
    expect(isUnknownChainError({ code: 4902 })).toBe(true);
    expect(isUnknownChainError({ code: -32603, data: { originalError: { code: 4902 } } })).toBe(true);
    expect(isUnknownChainError(new Error('Unrecognized chain ID "0xaa36a7"'))).toBe(true);
    expect(isUnknownChainError({ code: 4001 })).toBe(false);
  });
  it('describes rejections and revert details', () => {
    expect(describeError({ code: 4001, message: 'User rejected' })).toMatch(/rejected in the wallet/);
    expect(describeError({ shortMessage: 'Execution reverted', details: 'NotOwner(0xabc)' })).toBe('Execution reverted — NotOwner(0xabc)');
  });
});
