// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title OwnableCounter
/// @notice A minimal counter anyone can increment or decrement, with an owner-only reset and
/// single-step ownership transfer.
/// @dev Fully configured by its nonpayable constructor: the initial owner is passed explicitly
/// because ProjectFactory deploys application contracts with itself as `msg.sender`, and a factory
/// cannot exercise ownership. The manifest fills the argument with `$owner`.
///
/// There is no upgrade path, no pause, no self-destruct and no ETH handling. Ownership can only be
/// transferred to a non-zero address, so `reset()` can never be permanently disabled.
contract OwnableCounter {
    /// @notice Current counter value.
    uint256 public count;

    /// @notice Account allowed to call `reset()` and `transferOwnership()`.
    address public owner;

    event Incremented(address indexed by, uint256 newCount);
    event Decremented(address indexed by, uint256 newCount);
    event Reset(address indexed by, uint256 previousCount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner(address caller);
    error ZeroAddressOwner();
    error CounterUnderflow();
    error CounterOverflow();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /// @param initialOwner Account that receives ownership. Must not be the zero address.
    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddressOwner();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    /// @notice Adds one to the counter. Callable by anyone.
    function increment() external {
        uint256 current = count;
        if (current == type(uint256).max) revert CounterOverflow();
        unchecked {
            current += 1;
        }
        count = current;
        emit Incremented(msg.sender, current);
    }

    /// @notice Subtracts one from the counter. Callable by anyone; reverts at zero.
    function decrement() external {
        uint256 current = count;
        if (current == 0) revert CounterUnderflow();
        unchecked {
            current -= 1;
        }
        count = current;
        emit Decremented(msg.sender, current);
    }

    /// @notice Sets the counter back to zero. Owner only.
    function reset() external onlyOwner {
        uint256 previous = count;
        count = 0;
        emit Reset(msg.sender, previous);
    }

    /// @notice Hands ownership to `newOwner` immediately. Owner only; zero address rejected.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddressOwner();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }
}
