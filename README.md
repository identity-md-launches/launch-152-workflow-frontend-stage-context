# OwnableCounter (Sepolia IMD evm_project)

A deliberately small smoke-test project for the IMD swarm pay-client: one application contract,
`OwnableCounter`, plus the mandatory fixed-supply launch token `CounterToken` ("Counter Test", `CNTR`).
No upgradeability, no hooks, no fee routers, no pause, no ETH custody.

## Layout

| Path | Purpose |
| --- | --- |
| `src/CounterToken.sol` | Launch token. Zero-argument constructor, 18 decimals, mints exactly `10^27` minor units (1,000,000,000 CNTR) to `msg.sender`. |
| `src/OwnableCounter.sol` | The counter. `increment()`, `decrement()`, owner-only `reset()`, `transferOwnership(address)`. |
| `test/CounterToken.t.sol` | Token behaviour: supply, transfer/allowance success and failure paths, absent admin surface, opcode scan. |
| `test/OwnableCounter.t.sol` | Counter behaviour: constructor guards, increment/decrement bounds, ownership gating, transfer of ownership, ETH rejection, opcode scan. |
| `test/LaunchFloor.t.sol` | Mirrors the protocol deployment floor: a CREATE2 factory deploys both contracts, holds the whole supply afterwards, and the `$owner` argument, not the factory, is the owner. |
| `docs/abi/CounterToken.json`, `docs/abi/OwnableCounter.json` | ABI exports (`forge inspect <Contract> abi --json`). |
| `lib/forge-std` | Vendored forge-std 1.16.2 (source only, no submodule). The only dependency. |

## Build and test (offline)

```
forge build
forge test
forge fmt --check
```

`foundry.toml` pins `solc_version = "0.8.26"`, `evm_version = "cancun"`, `bytecode_hash = "none"`,
`cbor_metadata = false`, `ffi = false`, `fs_permissions = []`, `offline = true`. No script or test
uses ffi, filesystem access or network.

## Contract behaviour

### CounterToken

- `name() = "Counter Test"`, `symbol() = "CNTR"`, `decimals() = 18`.
- `totalSupply() = 1_000_000_000 * 10^18 = 1000000000000000000000000000` (exactly `10^27`). The
  constructor mints all of it to `msg.sender` and emits `Transfer(0, msg.sender, 10^27)`.
- Standard `transfer`, `approve`, `transferFrom`, `balanceOf`, `allowance`. Transfers move exactly the
  requested amount; there is no fee, no rebasing, no hook.
- Infinite allowance (`type(uint256).max`) is not decremented.
- Reverts: `TransferToZeroAddress`, `ApproveToZeroAddress`, `InsufficientBalance(available, requested)`,
  `InsufficientAllowance(available, requested)`.
- There is no owner, mint, burn, pause, blacklist, upgrade or initializer function. Supply is immutable
  after construction. The contract has no `receive`/`fallback`, so plain ETH transfers revert.

### OwnableCounter

- `constructor(address initialOwner)`: reverts with `ZeroAddressOwner` if zero. Emits
  `OwnershipTransferred(0, initialOwner)`. `count` starts at 0.
- `increment()`: anyone. Adds 1. Emits `Incremented(caller, newCount)`. Reverts `CounterOverflow` at
  `2^256 - 1` (unreachable in practice, tested via storage write).
- `decrement()`: anyone. Subtracts 1. Emits `Decremented(caller, newCount)`. Reverts `CounterUnderflow`
  at 0.
- `reset()`: owner only. Sets `count = 0`. Emits `Reset(owner, previousCount)`. Reverts
  `NotOwner(caller)` otherwise.
- `transferOwnership(address newOwner)`: owner only, single-step, immediate. Zero address rejected with
  `ZeroAddressOwner`, so ownership can never be burned and `reset()` can never be bricked. There is
  deliberately no `renounceOwnership`.
- No `receive`/`fallback`; all functions are nonpayable, so any ETH sent reverts.

## Deployment parameters (for the manifest node)

This assignment does not write `launch.json`; the manifest assignment does. The facts it needs:

| Item | Value |
| --- | --- |
| Chain | Sepolia, chainId 11155111 |
| Launch token | `CounterToken` (`src/CounterToken.sol`), constructor takes no arguments, decimals 18 |
| Expected supply | `1000000000000000000000000000` (10^27) minted to the factory as `msg.sender` |
| Application contracts | exactly one: `OwnableCounter` (`src/OwnableCounter.sol`) |
| `OwnableCounter` constructorArgs | `["$owner"]` (the single `address initialOwner` parameter) |
| Dependency order | `OwnableCounter` has no dependency on the token or other contracts |
| Pool / hook | none configured by the contracts; the factory supplies LP and MerkleDistributor per policy |

Notes for the manifest and review:

- The factory is `msg.sender` in both constructors. `CounterToken` relies on that to hand the factory the
  full supply (avoids `SupplyMismatch`). `OwnableCounter` must **not** use `msg.sender` as owner; it takes
  `$owner` explicitly so the policy-defined project owner, not the immutable factory, controls `reset()`.
- Do not put `totalSupply` or allocation bps in `launch.json`; policy owns splits.
- Neither contract reads or transfers the token during construction, so the factory's post-constructor
  supply check sees the untouched 10^27.
- Both runtimes are far under the EIP-170 limit and contain no `DELEGATECALL`, `CALLCODE` or
  `SELFDESTRUCT` (asserted by the tests using the same PUSH-skipping scan as the protocol floor).

## Assumptions

- The project owner address is supplied by policy via `$owner`. This repository never hard-codes a
  privileged wallet and never accesses a wallet key or broadcasts transactions.
- Supported constructor types only: the one argument is an `address`.
- Solidity 0.8.26 with the Cancun EVM target; Sepolia supports Cancun opcodes. The contracts use none
  of the Cancun-specific opcodes, so an earlier target would also work.
- The site (label `ownable-counter`) is a separate frontend stage. It should show the live token and
  counter addresses with Sepolia explorer links and how to call `increment()` (selector `0xd09de08a`,
  no arguments, no value).

## Operational responsibilities

- **Owner** (`$owner`): the only privileged role. Can `reset()` the counter and `transferOwnership`.
  Losing the owner key means `reset()` is no longer callable; the counter itself keeps working for
  everyone. Transferring to a wrong non-zero address is irreversible from the original owner's side.
- **Anyone**: `increment()` / `decrement()` are permissionless by design; there is no rate limit, and a
  third party can drive the count to zero and cause `decrement()` reverts for others. That is expected
  for a smoke test and holds no funds.
- **Token holders**: `CounterToken` has no admin. Nobody can mint, burn, pause or freeze. Lost tokens
  are simply lost.
- **Services** publish source, attest, admit and deploy after this stage. Tests passing here is not a
  security audit; the independent adversarial review is a separate assignment.

## Calling `increment()` from a wallet or script

```
cast send <OwnableCounter address> "increment()" --rpc-url <sepolia rpc> --private-key <key>
cast call <OwnableCounter address> "count()(uint256)" --rpc-url <sepolia rpc>
```

## Unresolved deployment choices

- Which wallet becomes `$owner` is decided by policy, not here.
- Pool pairing, fee, tick spacing and opening price come from the pinned Sepolia policy (v5: 20 ETH
  opening FDV). The contracts impose no constraints on them.
