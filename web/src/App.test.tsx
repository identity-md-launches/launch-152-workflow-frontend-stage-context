import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { custom, parseEther } from 'viem';
import { injected } from 'wagmi/connectors';
import { App } from './App';
import { buildDeployment, ACCOUNT, COUNTER_ADDRESS, OTHER, TOKEN_ADDRESS, network } from './test/fixtures';
import { createFakeChain, createFakeRpc, type FakeChain } from './test/fakeRpc';
import { createFakeWallet, type FakeWallet } from './test/fake-wallet.js';
import { clearActivity } from './lib/activity';

const SEPOLIA_HEX = '0xaa36a7';
const SELECTORS = { increment: '0xd09de08a', decrement: '0x2baeceb7', reset: '0xd826f88f', transfer: '0xa9059cbb', execute: '0x3593564c' };

function setup(chainOverrides: Partial<FakeChain> = {}, walletChain = '0x1') {
  const chain = createFakeChain(chainOverrides);
  const rpc = createFakeRpc(chain);
  const wallet = createFakeWallet({ accounts: [ACCOUNT], chainId: walletChain, knownChains: ['0x1'], rpc });
  (window as unknown as { ethereum?: FakeWallet }).ethereum = wallet;
  const deployment = buildDeployment();
  render(
    <App
      deployment={deployment}
      wagmiOptions={{
        transport: custom({ request: ({ method, params }) => rpc(method, params as unknown[]) }),
        connectors: [injected({ target: () => ({ id: 'fake', name: 'Fake Wallet', provider: wallet as never }) })],
      }}
    />,
  );
  return { chain, wallet, user: userEvent.setup() };
}

async function connectAndSwitch(user: ReturnType<typeof userEvent.setup>, wallet: FakeWallet) {
  await user.click(await screen.findByRole('button', { name: /connect fake wallet/i }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/wallet is on chain 1/i);
  await user.click(within(alert).getByRole('button', { name: `Switch to ${network.name}` }));
  await waitFor(() => expect(wallet.state.chainId()).toBe(SEPOLIA_HEX));
  await waitFor(() => expect(screen.queryByText(/wallet is on chain 1/i)).not.toBeInTheDocument());
}

beforeEach(() => {
  clearActivity();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { ethereum?: FakeWallet }).ethereum;
});

describe('disconnected state', () => {
  it('shows live contract state and keeps every action disabled', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('42'));
    await waitFor(() => expect(screen.getByTestId('owner')).toHaveTextContent('0x1111…1111'));
    expect(screen.getByRole('button', { name: /connect fake wallet/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decrement' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset to 0' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Transfer Ownership' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /swap eth for cntr/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send Tokens' })).toBeDisabled();
    expect(screen.getAllByText(/connect a wallet to send transactions/i).length).toBeGreaterThan(0);
    // Deployed contracts table shows the manifest addresses and explorer links.
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: COUNTER_ADDRESS })).toHaveAttribute('href', `${network.explorer}/address/${COUNTER_ADDRESS}`);
    expect(within(table).getByRole('link', { name: TOKEN_ADDRESS })).toBeInTheDocument();
    expect(within(table).getAllByText('hash verified')).toHaveLength(2);
    expect(await screen.findByText(/Counter Test \(CNTR\)/)).toBeInTheDocument();
    expect(screen.getByText(/1,000,000,000 CNTR/)).toBeInTheDocument();
  });
});

describe('wallet connection and chain switching', () => {
  it('connects, offers wallet_addEthereumChain after switch fails with 4902, then enables actions', async () => {
    const { wallet, user } = setup();
    await connectAndSwitch(user, wallet);
    expect(wallet.state.added).toHaveLength(1);
    expect(wallet.state.added[0]).toMatchObject({ chainId: SEPOLIA_HEX, chainName: network.name, rpcUrls: network.rpcUrls });
    expect(wallet.state.switched).toEqual([SEPOLIA_HEX]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Increment' })).toBeEnabled());
    expect(screen.getAllByRole('link', { name: '0x1111…1111' }).length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByTestId('token-balance')).toHaveTextContent('1,000 CNTR');
    const log = screen.getByTestId('activity-log');
    expect(log).toHaveTextContent(/Added Sepolia to the wallet and switched to it/);
  });

  it('switches directly when the wallet already knows the chain', async () => {
    const { wallet, user } = setup({}, '0x1');
    await wallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId: SEPOLIA_HEX }] });
    wallet.state.added.length = 0;
    await user.click(await screen.findByRole('button', { name: /connect fake wallet/i }));
    await user.click(await screen.findByRole('button', { name: `Switch to ${network.name}` }));
    await waitFor(() => expect(wallet.state.chainId()).toBe(SEPOLIA_HEX));
    expect(wallet.state.added).toHaveLength(0);
  });
});

describe('counter actions', () => {
  it('simulates then sends increment and shows confirmation and the refreshed count', async () => {
    const { chain, wallet, user } = setup();
    await connectAndSwitch(user, wallet);
    const increment = await screen.findByRole('button', { name: 'Increment' });
    await waitFor(() => expect(increment).toBeEnabled());
    chain.count = 43n; // the stub reports the post-increment value on the next read
    await user.click(increment);
    await waitFor(() => expect(wallet.state.sent).toHaveLength(1));
    const tx = wallet.state.sent[0]!;
    expect(tx.to?.toLowerCase()).toBe(COUNTER_ADDRESS);
    expect(tx.data).toBe(SELECTORS.increment);
    expect(await screen.findByText(/Confirmed\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('43'));
    expect(screen.getByRole('link', { name: 'View transaction' })).toHaveAttribute('href', `${network.explorer}/tx/${tx.hash}`);
    const simulated = chain.calls.filter((c) => c.method === 'eth_call' && (c.params[0] as { data: string }).data === SELECTORS.increment);
    expect(simulated.length).toBeGreaterThan(0);
  });

  it('shows the wallet rejection without sending', async () => {
    const { wallet, user } = setup();
    await connectAndSwitch(user, wallet);
    const increment = await screen.findByRole('button', { name: 'Increment' });
    await waitFor(() => expect(increment).toBeEnabled());
    wallet.state.rejectNext = true;
    await user.click(increment);
    expect((await screen.findAllByText(/rejected in the wallet/i)).length).toBeGreaterThan(0);
    expect(wallet.state.sent).toHaveLength(0);
  });

  it('disables decrement at zero and reset for non-owners', async () => {
    const { wallet, user } = setup({ count: 0n, owner: OTHER });
    await connectAndSwitch(user, wallet);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Increment' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Decrement' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset to 0' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Transfer Ownership' })).toBeDisabled();
    expect(screen.getByText(/Reset is owner-only/)).toBeInTheDocument();
  });

  it('lets the owner reset after confirmation and transfer ownership with a valid address', async () => {
    const { wallet, user } = setup();
    await connectAndSwitch(user, wallet);
    const reset = await screen.findByRole('button', { name: 'Reset to 0' });
    await waitFor(() => expect(reset).toBeEnabled());
    await user.click(reset);
    expect(wallet.state.sent).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Confirm Reset' }));
    await waitFor(() => expect(wallet.state.sent).toHaveLength(1));
    expect(wallet.state.sent[0]!.data).toBe(SELECTORS.reset);

    const input = screen.getByLabelText('Transfer ownership to');
    await user.type(input, 'not-an-address');
    await user.click(screen.getByRole('button', { name: 'Transfer Ownership' }));
    expect(await screen.findByText(/Enter a valid 0x address/)).toBeInTheDocument();
    expect(wallet.state.sent).toHaveLength(1);
    await user.clear(input);
    await user.type(input, OTHER);
    await user.click(screen.getByRole('button', { name: 'Transfer Ownership' }));
    expect(wallet.state.sent).toHaveLength(1); // confirmation step first
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm Transfer' }));
    await waitFor(() => expect(wallet.state.sent).toHaveLength(2));
    expect(wallet.state.sent[1]!.data).toMatch(new RegExp(`^0xf2fde38b0{24}${OTHER.slice(2)}$`));
  });
});

describe('token actions', () => {
  it('validates the form and sends transfer(to, amount) with 18 decimals', async () => {
    const { wallet, user } = setup();
    await connectAndSwitch(user, wallet);
    const send = await screen.findByRole('button', { name: 'Send Tokens' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    expect(await screen.findByText(/Enter a positive CNTR amount/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Amount (CNTR)'), '1.5');
    await user.type(screen.getByLabelText('Recipient'), OTHER);
    await user.click(send);
    await waitFor(() => expect(wallet.state.sent).toHaveLength(1));
    const tx = wallet.state.sent[0]!;
    expect(tx.to?.toLowerCase()).toBe(TOKEN_ADDRESS);
    expect(tx.data).toBe(`${SELECTORS.transfer}${'0'.repeat(24)}${OTHER.slice(2)}${parseEther('1.5').toString(16).padStart(64, '0')}`);
  });
});

describe('swap', () => {
  it('quotes ETH → CNTR through the quoter, applies slippage, and sends execute() with the ETH value', async () => {
    const { chain, wallet, user } = setup();
    await connectAndSwitch(user, wallet);
    const amount = await screen.findByLabelText(/You pay \(ETH\)/);
    await user.type(amount, '0.01');
    await waitFor(() => expect(screen.getByTestId('quote-out')).toHaveTextContent('150 CNTR'));
    expect(screen.getByText('149.25 CNTR')).toBeInTheDocument(); // 0.5% slippage
    const quoteCalls = chain.calls.filter((c) => c.method === 'eth_call' && (c.params[0] as { to: string }).to.toLowerCase() === network.uniswapV4.quoter.toLowerCase());
    expect(quoteCalls.length).toBeGreaterThan(0);
    const swap = screen.getByRole('button', { name: /swap eth for cntr/i });
    await waitFor(() => expect(swap).toBeEnabled());
    await user.click(swap);
    await waitFor(() => expect(wallet.state.sent).toHaveLength(1));
    const tx = wallet.state.sent[0]!;
    expect(tx.to?.toLowerCase()).toBe(network.uniswapV4.universalRouter.toLowerCase());
    expect(BigInt(tx.value ?? '0x0')).toBe(parseEther('0.01'));
    expect(tx.data?.startsWith(SELECTORS.execute)).toBe(true);
    expect(tx.data).toContain('060c0f');
  });

  it('shows the quoter revert reason and keeps the swap disabled', async () => {
    const { wallet, user } = setup({ quoteRevert: 'NotEnoughLiquidity' });
    await connectAndSwitch(user, wallet);
    await user.type(await screen.findByLabelText(/You pay \(ETH\)/), '0.01');
    expect((await screen.findAllByText(/Quote failed:/, {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /swap eth for cntr/i })).toBeDisabled();
  });

  it('requires token approval and Permit2 approval before selling CNTR', async () => {
    const { chain, wallet, user } = setup();
    await connectAndSwitch(user, wallet);
    await user.click(await screen.findByLabelText('CNTR → ETH'));
    await user.type(screen.getByLabelText(/You pay \(CNTR\)/), '10');
    await waitFor(() => expect(screen.getByTestId('quote-out')).toHaveTextContent('150 ETH'));
    const approveToken = await screen.findByRole('button', { name: 'Approve CNTR' });
    expect(screen.getByRole('button', { name: 'Approve Router' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /swap cntr for eth/i })).toBeDisabled();
    chain.erc20AllowanceToPermit2 = parseEther('10'); // reported once the approval is re-read
    await user.click(approveToken);
    await waitFor(() => expect(wallet.state.sent).toHaveLength(1));
    expect(wallet.state.sent[0]!.to?.toLowerCase()).toBe(TOKEN_ADDRESS);
    expect(wallet.state.sent[0]!.data?.startsWith('0x095ea7b3')).toBe(true);
    const approveRouter = await screen.findByRole('button', { name: 'Approve Router' });
    await waitFor(() => expect(approveRouter).toBeEnabled());
    chain.permit2Allowance = [parseEther('10'), Math.floor(Date.now() / 1000) + 3600, 0];
    await user.click(approveRouter);
    await waitFor(() => expect(wallet.state.sent).toHaveLength(2));
    expect(wallet.state.sent[1]!.to?.toLowerCase()).toBe(network.uniswapV4.permit2.toLowerCase());
    const swap = screen.getByRole('button', { name: /swap cntr for eth/i });
    await waitFor(() => expect(swap).toBeEnabled());
    await user.click(swap);
    await waitFor(() => expect(wallet.state.sent).toHaveLength(3));
    expect(BigInt(wallet.state.sent[2]!.value ?? '0x0')).toBe(0n);
  });
});
