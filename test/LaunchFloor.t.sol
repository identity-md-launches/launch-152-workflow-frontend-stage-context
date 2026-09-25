// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CounterToken} from "../src/CounterToken.sol";
import {OwnableCounter} from "../src/OwnableCounter.sol";

/// @dev Same shape as the protocol's deployment floor: a factory contract deploys the token and the
/// application contract with CREATE2, so the factory is `msg.sender` in both constructors. The token
/// supply must sit entirely with the factory afterwards and the application constructor must not
/// move it. The owner argument is what the manifest fills with `$owner`.
contract Create2Factory {
    function deploy(bytes memory code, bytes32 salt) external returns (address deployed) {
        assembly ("memory-safe") {
            deployed := create2(0, add(code, 32), mload(code), salt)
        }
        require(deployed != address(0) && deployed.code.length > 0, "constructor failed");
    }
}

contract LaunchFloorTest is Test {
    uint256 internal constant SUPPLY = 1e27;
    address internal projectOwner = makeAddr("projectOwner");

    Create2Factory internal factory;
    CounterToken internal token;
    OwnableCounter internal counter;

    function setUp() public {
        vm.chainId(11_155_111);
        factory = new Create2Factory();
        token = CounterToken(factory.deploy(type(CounterToken).creationCode, bytes32(uint256(1))));
        bytes memory appCode = abi.encodePacked(type(OwnableCounter).creationCode, abi.encode(projectOwner));
        counter = OwnableCounter(factory.deploy(appCode, bytes32(uint256(2))));
    }

    function test_factoryHoldsWholeSupplyAfterBothConstructors() public view {
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(factory)), SUPPLY);
        assertEq(token.balanceOf(address(counter)), 0);
        assertEq(token.balanceOf(projectOwner), 0);
    }

    function test_ownerIsTheManifestOwnerNotTheFactory() public {
        assertEq(counter.owner(), projectOwner);
        vm.prank(address(factory));
        vm.expectRevert(abi.encodeWithSelector(OwnableCounter.NotOwner.selector, address(factory)));
        counter.reset();
        vm.prank(projectOwner);
        counter.reset();
    }

    function test_constructorArgIsASingleAddress() public {
        // A wrong-length argument blob must not silently deploy.
        vm.expectRevert("constructor failed");
        factory.deploy(type(OwnableCounter).creationCode, bytes32(uint256(3)));
    }

    function test_zeroOwnerFailsAtTheFactory() public {
        bytes memory appCode = abi.encodePacked(type(OwnableCounter).creationCode, abi.encode(address(0)));
        vm.expectRevert("constructor failed");
        factory.deploy(appCode, bytes32(uint256(4)));
    }

    function test_runtimesAreBoundedAndFreeOfEscapeOpcodes() public view {
        _scan(address(token).code);
        _scan(address(counter).code);
    }

    function _scan(bytes memory code) internal pure {
        assertGt(code.length, 0, "missing runtime");
        assertLe(code.length, 24_576, "runtime exceeds EIP-170");
        for (uint256 j; j < code.length; ++j) {
            uint8 op = uint8(code[j]);
            if (op >= 0x60 && op <= 0x7f) {
                j += op - 0x5f;
                continue;
            }
            assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff, "forbidden project opcode");
        }
    }
}
