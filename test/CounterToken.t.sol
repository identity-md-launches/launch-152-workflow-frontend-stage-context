// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CounterToken} from "../src/CounterToken.sol";

contract CounterTokenTest is Test {
    uint256 internal constant SUPPLY = 1_000_000_000_000_000_000_000_000_000; // 10^27

    CounterToken internal token;
    address internal deployer = address(this);
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function setUp() public {
        token = new CounterToken();
    }

    // ---------------------------------------------------------------- metadata & supply

    function test_metadata() public view {
        assertEq(token.name(), "Counter Test");
        assertEq(token.symbol(), "CNTR");
        assertEq(token.decimals(), 18);
    }

    function test_supplyIsExactlyTenToTheTwentySeven() public view {
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.totalSupply(), 1_000_000_000 * 10 ** 18);
        assertEq(token.TOTAL_SUPPLY(), SUPPLY);
    }

    function test_wholeSupplyMintedToDeployer() public view {
        assertEq(token.balanceOf(deployer), SUPPLY);
    }

    function test_constructorEmitsMintTransfer() public {
        vm.expectEmit(true, true, true, true);
        emit Transfer(address(0), alice, SUPPLY);
        vm.prank(alice);
        CounterToken fresh = new CounterToken();
        assertEq(fresh.balanceOf(alice), SUPPLY);
        assertEq(fresh.balanceOf(deployer), 0);
    }

    function test_deployedFromFactoryLikeContractHoldsSupply() public {
        FactoryStandIn factory = new FactoryStandIn();
        CounterToken fromFactory = factory.deployToken();
        assertEq(fromFactory.balanceOf(address(factory)), SUPPLY);
        assertEq(fromFactory.balanceOf(address(this)), 0);
    }

    // ---------------------------------------------------------------- transfer

    function test_transferMovesExactAmount() public {
        uint256 amount = 12_345e18;
        vm.expectEmit(true, true, true, true);
        emit Transfer(deployer, alice, amount);
        assertTrue(token.transfer(alice, amount));
        assertEq(token.balanceOf(alice), amount);
        assertEq(token.balanceOf(deployer), SUPPLY - amount);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_transferZeroAmountSucceeds() public {
        assertTrue(token.transfer(alice, 0));
        assertEq(token.balanceOf(alice), 0);
    }

    function test_transferToSelfKeepsBalance() public {
        assertTrue(token.transfer(deployer, 1e18));
        assertEq(token.balanceOf(deployer), SUPPLY);
    }

    function test_transferRevertsOnInsufficientBalance() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CounterToken.InsufficientBalance.selector, 0, 1));
        token.transfer(bob, 1);
    }

    function test_transferRevertsToZeroAddress() public {
        vm.expectRevert(CounterToken.TransferToZeroAddress.selector);
        token.transfer(address(0), 1);
    }

    function testFuzz_transferConservesSupply(address to, uint256 amount) public {
        vm.assume(to != address(0));
        amount = bound(amount, 0, SUPPLY);
        token.transfer(to, amount);
        assertEq(token.balanceOf(to) + (to == deployer ? 0 : token.balanceOf(deployer)), SUPPLY);
        assertEq(token.totalSupply(), SUPPLY);
    }

    // ---------------------------------------------------------------- approve / transferFrom

    function test_approveSetsAllowanceAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit Approval(deployer, alice, 5e18);
        assertTrue(token.approve(alice, 5e18));
        assertEq(token.allowance(deployer, alice), 5e18);
    }

    function test_approveRevertsForZeroSpender() public {
        vm.expectRevert(CounterToken.ApproveToZeroAddress.selector);
        token.approve(address(0), 1);
    }

    function test_transferFromConsumesAllowance() public {
        token.approve(alice, 10e18);
        vm.prank(alice);
        assertTrue(token.transferFrom(deployer, bob, 4e18));
        assertEq(token.balanceOf(bob), 4e18);
        assertEq(token.allowance(deployer, alice), 6e18);
        assertEq(token.balanceOf(deployer), SUPPLY - 4e18);
    }

    function test_transferFromInfiniteAllowanceIsNotDecremented() public {
        token.approve(alice, type(uint256).max);
        vm.prank(alice);
        token.transferFrom(deployer, bob, 1e18);
        assertEq(token.allowance(deployer, alice), type(uint256).max);
    }

    function test_transferFromRevertsBeyondAllowance() public {
        token.approve(alice, 1e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CounterToken.InsufficientAllowance.selector, 1e18, 2e18));
        token.transferFrom(deployer, bob, 2e18);
    }

    function test_transferFromRevertsWithoutAllowance() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CounterToken.InsufficientAllowance.selector, 0, 1));
        token.transferFrom(deployer, bob, 1);
    }

    function test_transferFromRevertsBeyondBalanceEvenWithAllowance() public {
        token.transfer(alice, 1e18);
        vm.prank(alice);
        token.approve(bob, 5e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CounterToken.InsufficientBalance.selector, 1e18, 2e18));
        token.transferFrom(alice, bob, 2e18);
    }

    // ---------------------------------------------------------------- no admin surface

    function test_noMintOrAdminSelectorChangesSupply() public {
        address attacker = makeAddr("attacker");
        string[12] memory signatures = [
            "mint(address,uint256)",
            "mint(uint256)",
            "mint()",
            "issue(uint256)",
            "burn(uint256)",
            "setOwner(address)",
            "transferOwnership(address)",
            "upgradeTo(address)",
            "initialize(address)",
            "pause()",
            "unpause()",
            "setMinter(address)"
        ];
        for (uint256 i; i < signatures.length; ++i) {
            bytes memory data = abi.encodeWithSignature(signatures[i], attacker, type(uint128).max);
            vm.prank(attacker);
            (bool ok,) = address(token).call(data);
            assertFalse(ok, signatures[i]);
            assertEq(token.totalSupply(), SUPPLY, signatures[i]);
            assertEq(token.balanceOf(attacker), 0, signatures[i]);
        }
        // Even the deployer (the factory in production) cannot mint.
        (bool deployerOk,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", deployer, 1));
        assertFalse(deployerOk);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_rejectsPlainEther() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(token).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(token).balance, 0);
    }

    function test_runtimeHasNoForbiddenOpcodes() public view {
        _assertNoForbiddenOpcodes(address(token).code);
    }

    function _assertNoForbiddenOpcodes(bytes memory code) internal pure {
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xf4, "DELEGATECALL");
            assertTrue(op != 0xf2, "CALLCODE");
            assertTrue(op != 0xff, "SELFDESTRUCT");
        }
    }
}

/// @dev Stands in for ProjectFactory: a contract that deploys the token and therefore is `msg.sender`
/// in the token constructor.
contract FactoryStandIn {
    function deployToken() external returns (CounterToken) {
        return new CounterToken();
    }
}
