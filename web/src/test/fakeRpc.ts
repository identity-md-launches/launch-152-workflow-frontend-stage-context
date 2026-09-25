import { decodeFunctionData, encodeFunctionResult, encodeAbiParameters, parseEther, type Abi, type Hex } from 'viem';
import { abis, ACCOUNT, COUNTER_ADDRESS, TOKEN_ADDRESS, network } from './fixtures';
import { erc20AllowanceAbi, permit2Abi, quoterAbi, stateViewAbi } from '../lib/uniswap';

/** Mutable chain state for the stubbed RPC. */
export interface FakeChain {
  count: bigint;
  owner: `0x${string}`;
  balances: Record<string, bigint>;
  ethBalances: Record<string, bigint>;
  erc20AllowanceToPermit2: bigint;
  permit2Allowance: [bigint, number, number];
  quoteOut: bigint;
  quoteRevert?: string;
  receipts: Record<string, 'success' | 'reverted'>;
  calls: { method: string; params: unknown[] }[];
}

export function createFakeChain(overrides: Partial<FakeChain> = {}): FakeChain {
  return {
    count: 42n,
    owner: ACCOUNT,
    balances: { [ACCOUNT]: parseEther('1000') },
    ethBalances: { [ACCOUNT]: parseEther('2') },
    erc20AllowanceToPermit2: 0n,
    permit2Allowance: [0n, 0, 0],
    quoteOut: parseEther('150'),
    receipts: {},
    calls: [],
    ...overrides,
  };
}

const uni = network.uniswapV4;
const hex = (v: bigint) => `0x${v.toString(16)}`;

function handleCall(chain: FakeChain, to: string, data: Hex): Hex {
  const target = to.toLowerCase();
  let abi: Abi;
  if (target === COUNTER_ADDRESS) abi = abis.OwnableCounter!;
  else if (target === TOKEN_ADDRESS) abi = [...abis.CounterToken!, ...erc20AllowanceAbi] as Abi;
  else if (target === uni.quoter.toLowerCase()) abi = quoterAbi;
  else if (target === uni.stateView.toLowerCase()) abi = stateViewAbi;
  else if (target === uni.permit2.toLowerCase()) abi = permit2Abi;
  else if (target === uni.universalRouter.toLowerCase()) return '0x';
  else throw Object.assign(new Error('execution reverted: unknown contract'), { code: 3, data: '0x' });

  const { functionName, args = [] } = decodeFunctionData({ abi, data });
  const result = (value: unknown) => encodeFunctionResult({ abi, functionName, result: value } as never);
  switch (functionName) {
    case 'count':
      return result(chain.count);
    case 'owner':
      return result(chain.owner);
    case 'increment':
    case 'decrement':
    case 'reset':
    case 'transferOwnership':
      return '0x';
    case 'name':
      return result('Counter Test');
    case 'symbol':
      return result('CNTR');
    case 'decimals':
      return result(18);
    case 'totalSupply':
      return result(10n ** 27n);
    case 'balanceOf':
      return result(chain.balances[(args[0] as string).toLowerCase()] ?? chain.balances[args[0] as string] ?? 0n);
    case 'allowance':
      if (target === TOKEN_ADDRESS) return result(chain.erc20AllowanceToPermit2);
      return result(chain.permit2Allowance);
    case 'approve':
    case 'transfer':
    case 'transferFrom':
      return result(true);
    case 'getSlot0':
      return result([560227709747861399187319382274582n, 177284, 0, 3000]);
    case 'getLiquidity':
      return result(1_000_000n);
    case 'quoteExactInputSingle': {
      if (chain.quoteRevert) {
        throw Object.assign(new Error(`execution reverted: ${chain.quoteRevert}`), {
          code: 3,
          data: encodeAbiParameters([{ type: 'bytes4' }], ['0x08c379a0']),
        });
      }
      return result([chain.quoteOut, 50_000n]);
    }
    default:
      throw new Error(`fake rpc: unhandled ${functionName}`);
  }
}

/** JSON-RPC handler backed by `chain`; wallet methods are handled by the fake wallet, not here. */
export function createFakeRpc(chain: FakeChain) {
  return async (method: string, params: unknown[] = []): Promise<unknown> => {
    chain.calls.push({ method, params });
    switch (method) {
      case 'eth_chainId':
        return `0x${network.chainId.toString(16)}`;
      case 'eth_blockNumber':
        return '0xb3b3b3';
      case 'eth_gasPrice':
        return '0x3b9aca00';
      case 'eth_maxPriorityFeePerGas':
        return '0x3b9aca00';
      case 'eth_estimateGas':
        return '0x186a0';
      case 'eth_getBalance':
        return hex(chain.ethBalances[(params[0] as string).toLowerCase()] ?? 0n);
      case 'eth_getBlockByNumber':
        return { number: '0xb3b3b3', baseFeePerGas: '0x3b9aca00', timestamp: hex(BigInt(Math.floor(Date.now() / 1000))), gasLimit: '0x1c9c380', transactions: [] };
      case 'eth_getLogs':
        return [];
      case 'eth_call': {
        const tx = params[0] as { to: string; data: Hex };
        return handleCall(chain, tx.to, tx.data);
      }
      case 'eth_getTransactionReceipt': {
        const h = params[0] as string;
        const status = chain.receipts[h] ?? 'success';
        return {
          transactionHash: h,
          status: status === 'success' ? '0x1' : '0x0',
          blockNumber: '0xb3b3b4',
          blockHash: `0x${'11'.repeat(32)}`,
          transactionIndex: '0x0',
          from: ACCOUNT,
          to: COUNTER_ADDRESS,
          cumulativeGasUsed: '0x5208',
          gasUsed: '0x5208',
          effectiveGasPrice: '0x3b9aca00',
          logs: [],
          logsBloom: `0x${'00'.repeat(256)}`,
          type: '0x2',
        };
      }
      case 'eth_getTransactionCount':
        return '0x1';
      default:
        throw new Error(`fake rpc: unhandled method ${method}`);
    }
  };
}
