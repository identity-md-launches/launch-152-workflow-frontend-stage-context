// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OwnableCounter} from "../src/OwnableCounter.sol";

contract OwnableCounterTest is Test {
    OwnableCounter internal counter;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event Incremented(address indexed by, uint256 newCount);
    event Decremented(address indexed by, uint256 newCount);
    event Reset(address indexed by, uint256 previousCount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    function setUp() public {
        counter = new OwnableCounter(owner);
    }

    // ---------------------------------------------------------------- constructor

    function test_constructorSetsOwnerAndZeroCount() public view {
        assertEq(counter.owner(), owner);
        assertEq(counter.count(), 0);
    }

    function test_constructorEmitsOwnershipTransferred() public {
        vm.expectEmit(true, true, true, true);
        emit OwnershipTransferred(address(0), alice);
        new OwnableCounter(alice);
    }

    function test_constructorRejectsZeroOwner() public {
        vm.expectRevert(OwnableCounter.ZeroAddressOwner.selector);
        new OwnableCounter(address(0));
    }

    function test_deployerIsNotOwnerWhenExplicitOwnerGiven() public {
        // Mirrors the factory: the deployer (this contract) is msg.sender but ownership goes to `owner`.
        assertEq(counter.owner(), owner);
        assertTrue(counter.owner() != address(this));
        vm.expectRevert(abi.encodeWithSelector(OwnableCounter.NotOwner.selector, address(this)));
        counter.reset();
    }

    // ---------------------------------------------------------------- increment / decrement

    function test_anyoneCanIncrement() public {
        vm.expectEmit(true, true, true, true);
        emit Incremented(alice, 1);
        vm.prank(alice);
        counter.increment();
        assertEq(counter.count(), 1);

        vm.prank(bob);
        counter.increment();
        assertEq(counter.count(), 2);

        vm.prank(owner);
        counter.increment();
        assertEq(counter.count(), 3);
    }

    function test_anyoneCanDecrementAboveZero() public {
        vm.prank(alice);
        counter.increment();
        vm.prank(alice);
        counter.increment();

        vm.expectEmit(true, true, true, true);
        emit Decremented(bob, 1);
        vm.prank(bob);
        counter.decrement();
        assertEq(counter.count(), 1);
    }

    function test_decrementAtZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(OwnableCounter.CounterUnderflow.selector);
        counter.decrement();
        assertEq(counter.count(), 0);
    }

    function test_decrementBackToZeroThenRevertsAgain() public {
        vm.prank(alice);
        counter.increment();
        vm.prank(alice);
        counter.decrement();
        assertEq(counter.count(), 0);
        vm.prank(alice);
        vm.expectRevert(OwnableCounter.CounterUnderflow.selector);
        counter.decrement();
    }

    function test_incrementAtMaxReverts() public {
        vm.store(address(counter), bytes32(uint256(0)), bytes32(type(uint256).max));
        assertEq(counter.count(), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(OwnableCounter.CounterOverflow.selector);
        counter.increment();
        assertEq(counter.count(), type(uint256).max);
    }

    function testFuzz_incrementsAndDecrementsNetOut(uint8 ups, uint8 downs) public {
        vm.assume(downs <= ups);
        for (uint256 i; i < ups; ++i) {
            vm.prank(alice);
            counter.increment();
        }
        for (uint256 i; i < downs; ++i) {
            vm.prank(bob);
            counter.decrement();
        }
        assertEq(counter.count(), uint256(ups) - uint256(downs));
    }

    // ---------------------------------------------------------------- reset

    function test_ownerCanReset() public {
        vm.prank(alice);
        counter.increment();
        vm.prank(alice);
        counter.increment();

        vm.expectEmit(true, true, true, true);
        emit Reset(owner, 2);
        vm.prank(owner);
        counter.reset();
        assertEq(counter.count(), 0);
    }

    function test_resetAtZeroIsANoOpForOwner() public {
        vm.prank(owner);
        counter.reset();
        assertEq(counter.count(), 0);
    }

    function test_nonOwnerCannotReset() public {
        vm.prank(alice);
        counter.increment();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OwnableCounter.NotOwner.selector, alice));
        counter.reset();
        assertEq(counter.count(), 1);
    }

    function testFuzz_onlyOwnerCanReset(address caller) public {
        vm.assume(caller != owner);
        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(OwnableCounter.NotOwner.selector, caller));
        counter.reset();
    }

    function test_counterKeepsWorkingAfterReset() public {
        vm.prank(alice);
        counter.increment();
        vm.prank(owner);
        counter.reset();
        vm.prank(bob);
        counter.increment();
        assertEq(counter.count(), 1);
    }

    // ---------------------------------------------------------------- ownership

    function test_ownerCanTransferOwnership() public {
        vm.expectEmit(true, true, true, true);
        emit OwnershipTransferred(owner, alice);
        vm.prank(owner);
        counter.transferOwnership(alice);
        assertEq(counter.owner(), alice);
    }

    function test_newOwnerGainsResetAndOldOwnerLosesIt() public {
        vm.prank(owner);
        counter.transferOwnership(alice);

        vm.prank(bob);
        counter.increment();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(OwnableCounter.NotOwner.selector, owner));
        counter.reset();

        vm.prank(alice);
        counter.reset();
        assertEq(counter.count(), 0);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(OwnableCounter.NotOwner.selector, owner));
        counter.transferOwnership(owner);
    }

    function test_nonOwnerCannotTransferOwnership() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OwnableCounter.NotOwner.selector, alice));
        counter.transferOwnership(alice);
        assertEq(counter.owner(), owner);
    }

    function test_transferOwnershipRejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(OwnableCounter.ZeroAddressOwner.selector);
        counter.transferOwnership(address(0));
        assertEq(counter.owner(), owner);
    }

    function test_transferOwnershipToSelfIsAllowed() public {
        vm.prank(owner);
        counter.transferOwnership(owner);
        assertEq(counter.owner(), owner);
    }

    function test_noRenounceOwnershipSelector() public {
        vm.prank(owner);
        (bool ok,) = address(counter).call(abi.encodeWithSignature("renounceOwnership()"));
        assertFalse(ok);
        assertEq(counter.owner(), owner);
    }

    // ---------------------------------------------------------------- misc surface

    function test_rejectsPlainEther() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(counter).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(counter).balance, 0);
    }

    function test_rejectsEtherOnIncrement() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(counter).call{value: 1 wei}(abi.encodeCall(OwnableCounter.increment, ()));
        assertFalse(ok);
        assertEq(counter.count(), 0);
    }

    function test_unknownSelectorReverts() public {
        (bool ok,) = address(counter).call(abi.encodeWithSignature("setCount(uint256)", 5));
        assertFalse(ok);
        assertEq(counter.count(), 0);
    }

    function test_runtimeHasNoForbiddenOpcodes() public view {
        bytes memory code = address(counter).code;
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
