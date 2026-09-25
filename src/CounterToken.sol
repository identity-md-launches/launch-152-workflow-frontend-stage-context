// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Counter Test (CNTR)
/// @notice Fixed-supply ERC-20 launch token for the OwnableCounter project.
/// @dev The whole supply, exactly 1,000,000,000 * 10^18 minor units, is minted once to `msg.sender`
/// in the constructor. When ProjectFactory deploys this contract the factory is `msg.sender`, so the
/// factory holds the full supply it later splits per policy. There is no owner, no mint, no burn, no
/// pause, no upgrade path and no constructor argument.
contract CounterToken {
    string public constant name = "Counter Test";
    string public constant symbol = "CNTR";
    uint8 public constant decimals = 18;

    /// @notice 1,000,000,000 tokens with 18 decimals (10^27 minor units).
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;

    uint256 public immutable totalSupply;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error TransferToZeroAddress();
    error ApproveToZeroAddress();
    error InsufficientBalance(uint256 available, uint256 requested);
    error InsufficientAllowance(uint256 available, uint256 requested);

    constructor() {
        totalSupply = TOTAL_SUPPLY;
        balanceOf[msg.sender] = TOTAL_SUPPLY;
        emit Transfer(address(0), msg.sender, TOTAL_SUPPLY);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert ApproveToZeroAddress();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance(allowed, amount);
            unchecked {
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert TransferToZeroAddress();
        uint256 fromBalance = balanceOf[from];
        if (fromBalance < amount) revert InsufficientBalance(fromBalance, amount);
        unchecked {
            balanceOf[from] = fromBalance - amount;
            // Total supply is fixed, so the sum of balances can never exceed 2^256 - 1.
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
