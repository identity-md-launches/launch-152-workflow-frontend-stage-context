import { useEffect, useId, useMemo, useState } from 'react';
import { useBalance, usePublicClient, useReadContract, useReadContracts } from 'wagmi';
import { parseUnits, type Address } from 'viem';
import { useDeployment } from '../lib/context';
import { useWallet } from '../lib/useWallet';
import { useContractAction } from '../lib/useContractAction';
import { describeError } from '../lib/chain';
import { logActivity } from '../lib/activity';
import { formatAmount, formatNumber, explorerAddress } from '../lib/format';
import {
  applySlippage,
  buildPoolKey,
  encodeV4ExactInputSingle,
  erc20AllowanceAbi,
  permit2Abi,
  poolId,
  priceFromSqrtX96,
  quoterAbi,
  stateViewAbi,
  universalRouterAbi,
  ZERO_ADDRESS,
} from '../lib/uniswap';
import {
  DEFAULT_SLIPPAGE_BPS,
  LAUNCH_POOL,
  PERMIT2_EXPIRATION_SECONDS,
  POLL_INTERVAL_MS,
  SWAP_DEADLINE_SECONDS,
  TOKEN_CONTRACT_NAME,
} from '../config';
import { TxStatus } from './TxStatus';

type Direction = 'buy' | 'sell'; // buy = ETH -> CNTR, sell = CNTR -> ETH

interface Quote {
  amountIn: bigint;
  amountOut: bigint;
  minimumOut: bigint;
}

/** Swap ETH ↔ CNTR through the vetted Uniswap v4 router, with quote, slippage and explicit approvals. */
export function SwapPanel() {
  const deployment = useDeployment();
  const wallet = useWallet();
  const { network } = deployment;
  const uni = network.uniswapV4;
  const token = deployment.contracts[TOKEN_CONTRACT_NAME];
  const chainId = network.chainId;
  const publicClient = usePublicClient({ chainId });
  const ids = { amount: useId(), slippage: useId(), direction: useId() };

  const [direction, setDirection] = useState<Direction>('buy');
  const [amountText, setAmountText] = useState('');
  const [slippageText, setSlippageText] = useState((DEFAULT_SLIPPAGE_BPS / 100).toString());
  const [quote, setQuote] = useState<Quote>();
  const [quoteError, setQuoteError] = useState<string>();
  const [quoting, setQuoting] = useState(false);

  const nativeDecimals = network.nativeCurrency.decimals;
  const nativeSymbol = network.nativeCurrency.symbol;
  const tokenDecimals = 18; // CounterToken is fixed at 18 decimals (also read live below).
  const tokenSymbol = 'CNTR';

  const key = useMemo(
    () =>
      token
        ? buildPoolKey({
            pairedCurrency: LAUNCH_POOL.pairedCurrency,
            token: token.address,
            fee: LAUNCH_POOL.fee,
            tickSpacing: LAUNCH_POOL.tickSpacing,
            hooks: LAUNCH_POOL.hooks,
          })
        : undefined,
    [token],
  );
  const id = key ? poolId(key) : undefined;
  const tokenIsCurrency1 = !!key && !!token && key.currency1 === token.address;
  // zeroForOne = input is currency0. Buying the token means ETH (currency0 when native) is the input.
  const zeroForOne = direction === 'buy' ? tokenIsCurrency1 : !tokenIsCurrency1;
  const inputCurrency: Address = direction === 'buy' ? (LAUNCH_POOL.pairedCurrency as Address) : (token?.address ?? ZERO_ADDRESS);
  const inputIsNative = inputCurrency === ZERO_ADDRESS;
  const inDecimals = direction === 'buy' ? nativeDecimals : tokenDecimals;
  const outDecimals = direction === 'buy' ? tokenDecimals : nativeDecimals;
  const inSymbol = direction === 'buy' ? nativeSymbol : tokenSymbol;
  const outSymbol = direction === 'buy' ? tokenSymbol : nativeSymbol;

  const slippageBps = Math.round((Number.parseFloat(slippageText) || 0) * 100);
  const slippageValid = Number.isFinite(slippageBps) && slippageBps >= 0 && slippageBps <= 5000;

  const amountIn = useMemo(() => {
    try {
      const v = parseUnits(amountText.trim() as `${number}`, inDecimals);
      return v > 0n ? v : undefined;
    } catch {
      return undefined;
    }
  }, [amountText, inDecimals]);

  const pool = useReadContracts({
    contracts: id
      ? [
          { address: uni.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [id], chainId },
          { address: uni.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [id], chainId },
        ]
      : [],
    query: { enabled: !!id, refetchInterval: POLL_INTERVAL_MS },
  });
  const slot0 = pool.data?.[0]?.result as readonly [bigint, number, number, number] | undefined;
  const liquidity = pool.data?.[1]?.result as bigint | undefined;
  const initialized = !!slot0 && slot0[0] !== 0n;

  const ethBalance = useBalance({ address: wallet.address, chainId, query: { enabled: !!wallet.address, refetchInterval: POLL_INTERVAL_MS } });
  const tokenBalance = useReadContract({
    address: token?.address,
    abi: token?.abi,
    functionName: 'balanceOf',
    args: wallet.address ? [wallet.address] : undefined,
    chainId,
    query: { enabled: !!token && !!wallet.address, refetchInterval: POLL_INTERVAL_MS },
  });
  const erc20Allowance = useReadContract({
    address: token?.address,
    abi: erc20AllowanceAbi,
    functionName: 'allowance',
    args: wallet.address ? [wallet.address, uni.permit2] : undefined,
    chainId,
    query: { enabled: !!token && !!wallet.address && !inputIsNative },
  });
  const permit2Allowance = useReadContract({
    address: uni.permit2,
    abi: permit2Abi,
    functionName: 'allowance',
    args: wallet.address && token ? [wallet.address, token.address, uni.universalRouter] : undefined,
    chainId,
    query: { enabled: !!token && !!wallet.address && !inputIsNative },
  });

  const refreshAll = () => {
    void ethBalance.refetch();
    void tokenBalance.refetch();
    void erc20Allowance.refetch();
    void permit2Allowance.refetch();
    void pool.refetch();
  };
  const approveAction = useContractAction('swap', () => void erc20Allowance.refetch());
  const permitAction = useContractAction('swap', () => void permit2Allowance.refetch());
  const swapAction = useContractAction('swap', refreshAll);

  // Quote via simulateContract on the quoter (never a transaction), debounced on input.
  useEffect(() => {
    setQuote(undefined);
    setQuoteError(undefined);
    if (!publicClient || !key || !amountIn || !slippageValid) return;
    if (amountIn > 2n ** 128n - 1n) {
      setQuoteError('Amount exceeds the uint128 limit of single swaps.');
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const { result } = await publicClient.simulateContract({
          address: uni.quoter,
          abi: quoterAbi,
          functionName: 'quoteExactInputSingle',
          args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: '0x' }],
        });
        if (cancelled) return;
        const amountOut = result[0];
        setQuote({ amountIn, amountOut, minimumOut: applySlippage(amountOut, slippageBps) });
        logActivity('info', 'quote', `${formatAmount(amountIn, inDecimals)} ${inSymbol} → ${formatAmount(amountOut, outDecimals)} ${outSymbol}`);
      } catch (err) {
        if (cancelled) return;
        const message = describeError(err);
        setQuoteError(message);
        logActivity('warn', 'quote', `Quote failed: ${message}`);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
      setQuoting(false);
    };
  }, [publicClient, key, amountIn, zeroForOne, slippageBps, slippageValid, uni.quoter, inDecimals, outDecimals, inSymbol, outSymbol]);

  if (!token) {
    return (
      <section className="card" aria-labelledby="swap-heading">
        <h2 id="swap-heading">Swap</h2>
        <p role="alert" className="inline-error">The deployment manifest has no {TOKEN_CONTRACT_NAME} entry.</p>
      </section>
    );
  }

  const inBalance = direction === 'buy' ? ethBalance.data?.value : (tokenBalance.data as bigint | undefined);
  const insufficient = !!amountIn && inBalance !== undefined && amountIn > inBalance;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const needsErc20Approval = !inputIsNative && !!amountIn && ((erc20Allowance.data as bigint | undefined) ?? 0n) < amountIn;
  const p2 = permit2Allowance.data as readonly [bigint, number, number] | undefined;
  const needsPermit2Approval = !inputIsNative && !!amountIn && (!p2 || p2[0] < amountIn || BigInt(p2[1]) <= now);
  const anyBusy = approveAction.busy || permitAction.busy || swapAction.busy;
  const baseReady = wallet.isReady && token.abiVerified && !anyBusy && !!amountIn && slippageValid && !insufficient;
  const canSwap = baseReady && !!quote && quote.amountIn === amountIn && !needsErc20Approval && !needsPermit2Approval;

  const disabledReason = !token.abiVerified
    ? 'ABI hash mismatch; swaps are disabled.'
    : !wallet.isConnected
      ? 'Connect a wallet to swap.'
      : wallet.wrongChain
        ? `Switch the wallet to ${network.name} to swap.`
        : !initialized && pool.isFetched
          ? 'The pool is not initialized on chain; swaps would revert.'
          : insufficient
            ? `Insufficient ${inSymbol} balance.`
            : undefined;

  async function approveErc20() {
    if (!amountIn) return;
    await approveAction.run({
      address: token!.address,
      abi: erc20AllowanceAbi,
      functionName: 'approve',
      args: [uni.permit2, amountIn],
      label: `${tokenSymbol}.approve(permit2, ${formatAmount(amountIn, tokenDecimals)})`,
    });
  }

  async function approvePermit2() {
    if (!amountIn) return;
    const expiration = Number(now) + PERMIT2_EXPIRATION_SECONDS;
    await permitAction.run({
      address: uni.permit2,
      abi: permit2Abi,
      functionName: 'approve',
      args: [token!.address, uni.universalRouter, amountIn, expiration],
      label: `permit2.approve(${tokenSymbol}, universalRouter, ${formatAmount(amountIn, tokenDecimals)}, ${expiration})`,
    });
  }

  async function swap() {
    if (!quote || !key) return;
    const encoded = encodeV4ExactInputSingle({ poolKey: key, zeroForOne, amountIn: quote.amountIn, amountOutMinimum: quote.minimumOut });
    const deadline = now + BigInt(SWAP_DEADLINE_SECONDS);
    const ok = await swapAction.run({
      address: uni.universalRouter,
      abi: universalRouterAbi,
      functionName: 'execute',
      args: [encoded.commands, encoded.inputs, deadline],
      value: encoded.value,
      label: `universalRouter.execute V4_SWAP ${formatAmount(quote.amountIn, inDecimals)} ${inSymbol} → ≥ ${formatAmount(quote.minimumOut, outDecimals)} ${outSymbol}`,
    });
    if (ok) {
      setAmountText('');
      setQuote(undefined);
    }
  }

  const price = slot0 ? priceFromSqrtX96(slot0[0], nativeDecimals, tokenDecimals) : undefined; // CNTR per ETH when ETH is currency0
  const tokenPerEth = price !== undefined && tokenIsCurrency1 ? price : price ? 1 / price : undefined;

  return (
    <section className="card" aria-labelledby="swap-heading">
      <div className="card-head">
        <h2 id="swap-heading">Swap</h2>
        <button type="button" className="btn ghost small" onClick={refreshAll} disabled={pool.isFetching}>
          {pool.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <dl className="stats">
        <div>
          <dt>Pool</dt>
          <dd>
            {nativeSymbol}/{tokenSymbol} · fee {LAUNCH_POOL.fee / 10_000}% · Uniswap v4 ·{' '}
            {pool.isLoading ? 'Loading…' : initialized ? 'initialized' : pool.isFetched ? 'not initialized' : '—'}
          </dd>
        </div>
        <div>
          <dt>Pool price</dt>
          <dd aria-live="polite">
            {tokenPerEth !== undefined && initialized
              ? `1 ${nativeSymbol} ≈ ${formatNumber(tokenPerEth)} ${tokenSymbol}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Active liquidity</dt>
          <dd>{liquidity !== undefined ? (liquidity === 0n ? '0 at the current tick (one-sided launch liquidity; some directions may not quote)' : liquidity.toString()) : '—'}</dd>
        </div>
      </dl>
      {pool.error && (
        <p className="inline-error" role="alert">
          Could not read the pool: {pool.error.message.split('\n')[0]}.
        </p>
      )}

      <form className="stack" onSubmit={(e) => { e.preventDefault(); void swap(); }} noValidate>
        <fieldset className="field-row">
          <legend id={ids.direction}>Direction</legend>
          <div className="segmented" role="radiogroup" aria-labelledby={ids.direction}>
            <label className={direction === 'buy' ? 'on' : ''}>
              <input type="radio" name="direction" value="buy" checked={direction === 'buy'} onChange={() => setDirection('buy')} />
              {nativeSymbol} → {tokenSymbol}
            </label>
            <label className={direction === 'sell' ? 'on' : ''}>
              <input type="radio" name="direction" value="sell" checked={direction === 'sell'} onChange={() => setDirection('sell')} />
              {tokenSymbol} → {nativeSymbol}
            </label>
          </div>
        </fieldset>
        <div className="field-row">
          <label htmlFor={ids.amount}>
            You pay ({inSymbol})
            {inBalance !== undefined && (
              <span className="muted small-text"> · balance {formatAmount(inBalance, inDecimals)} {inSymbol}</span>
            )}
          </label>
          <input
            id={ids.amount}
            name="amountIn"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.01…"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-invalid={!!amountText && !amountIn}
            aria-describedby={`${ids.amount}-help`}
          />
          <p id={`${ids.amount}-help`} className="muted small-text">
            {amountText && !amountIn ? `Enter a positive ${inSymbol} amount.` : `Exact input; you receive at least the minimum shown below.`}
          </p>
        </div>
        <div className="field-row">
          <label htmlFor={ids.slippage}>Slippage tolerance (%)</label>
          <input
            id={ids.slippage}
            name="slippage"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.5…"
            value={slippageText}
            onChange={(e) => setSlippageText(e.target.value)}
            aria-invalid={!slippageValid}
            aria-describedby={`${ids.slippage}-help`}
          />
          <p id={`${ids.slippage}-help`} className={slippageValid ? 'muted small-text' : 'inline-error'}>
            {slippageValid ? 'Between 0 and 50. Applied to the quoted output.' : 'Enter a percentage between 0 and 50.'}
          </p>
        </div>

        <dl className="stats" aria-live="polite">
          <div>
            <dt>Quoted output</dt>
            <dd data-testid="quote-out">
              {quoting ? 'Quoting…' : quote ? `${formatAmount(quote.amountOut, outDecimals)} ${outSymbol}` : '—'}
            </dd>
          </div>
          <div>
            <dt>Minimum after slippage</dt>
            <dd>{quote ? `${formatAmount(quote.minimumOut, outDecimals)} ${outSymbol}` : '—'}</dd>
          </div>
          <div>
            <dt>Rate</dt>
            <dd>
              {quote && quote.amountOut > 0n
                ? `1 ${inSymbol} ≈ ${formatNumber(Number(quote.amountOut) / 10 ** outDecimals / (Number(quote.amountIn) / 10 ** inDecimals))} ${outSymbol}`
                : '—'}
            </dd>
          </div>
        </dl>
        {quoteError && (
          <p className="inline-error" role="alert">
            Quote failed: {quoteError} Try a smaller amount or wait for liquidity.
          </p>
        )}

        {!inputIsNative && wallet.isReady && amountIn && (
          <ol className="steps" aria-label="Approval steps">
            <li className={needsErc20Approval ? '' : 'done'}>
              <span>1. Approve {tokenSymbol} for Permit2 {needsErc20Approval ? '' : '(done)'}</span>
              {needsErc20Approval && (
                <button type="button" className="btn" onClick={() => void approveErc20()} disabled={!baseReady}>
                  Approve {tokenSymbol}
                </button>
              )}
            </li>
            <li className={needsPermit2Approval ? '' : 'done'}>
              <span>2. Allow the universal router via Permit2 {needsPermit2Approval ? '' : '(done)'}</span>
              {needsPermit2Approval && (
                <button type="button" className="btn" onClick={() => void approvePermit2()} disabled={!baseReady || needsErc20Approval}>
                  Approve Router
                </button>
              )}
            </li>
            <li>3. Swap</li>
          </ol>
        )}
        <TxStatus state={approveAction.state} label="Token approval" />
        <TxStatus state={permitAction.state} label="Permit2 approval" />

        <div className="actions">
          <button type="submit" className="btn primary" disabled={!canSwap}>
            {swapAction.busy ? 'Swapping…' : `Swap ${inSymbol} for ${outSymbol}`}
          </button>
        </div>
        {disabledReason && (
          <p className="muted" role="status">
            {disabledReason}
          </p>
        )}
        {quote && canSwap && (
          <p className="muted small-text">
            Sends {formatAmount(quote.amountIn, inDecimals)} {inSymbol}
            {inputIsNative ? ' as transaction value' : ' via Permit2'} to the universal router; the swap reverts if fewer than{' '}
            {formatAmount(quote.minimumOut, outDecimals)} {outSymbol} would be received. Simulated before signing.
          </p>
        )}
        <TxStatus state={swapAction.state} label="Swap" />
      </form>
      <p className="muted small-text">
        Router{' '}
        <a href={explorerAddress(network.explorer, uni.universalRouter)} target="_blank" rel="noreferrer" className="mono" translate="no">
          {uni.universalRouter}
        </a>
        , quoter{' '}
        <a href={explorerAddress(network.explorer, uni.quoter)} target="_blank" rel="noreferrer" className="mono" translate="no">
          {uni.quoter}
        </a>
        , Permit2{' '}
        <a href={explorerAddress(network.explorer, uni.permit2)} target="_blank" rel="noreferrer" className="mono" translate="no">
          {uni.permit2}
        </a>
        , all from the manifest's network block.
      </p>
    </section>
  );
}
