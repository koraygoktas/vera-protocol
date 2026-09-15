// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/core/VERAVault.sol";
import "../../src/core/EpochQueue.sol";
import "../../src/verifier/MockGroth16Verifier.sol";
import "../../src/tokens/MockUSDC.sol";
import "../../src/tokens/AssetToken.sol";
import "../../src/libraries/ProofBindingLib.sol";
import "./VERAVaultHandler.sol";

/**
 * @title VERAVaultInvariants
 * @notice Formal invariant test suite verifying protocol solvency, compliance, monotonicity, and queue isolation
 */
contract VERAVaultInvariants is Test {
    VERAVault public vault;
    EpochQueue public queue;
    MockUSDC public usdc;
    MockGroth16Verifier public verifier;
    AssetToken public complianceToken;
    VERAVaultHandler public handler;

    address public owner = address(this);
    uint256 constant INITIAL_NAV = 100_000 * 1e6; // 100k USDC initial NAV

    function setUp() public {
        usdc = new MockUSDC();
        verifier = new MockGroth16Verifier();
        complianceToken = new AssetToken("Compliance Token", "CMP");

        // Set compliance for protocol components and owner
        complianceToken.setCompliance(owner, true);

        queue = new EpochQueue(address(usdc));
        vault = new VERAVault(
            IERC20(address(usdc)),
            IZKVerifier(address(verifier)),
            address(queue),
            address(complianceToken)
        );

        queue.setVault(address(vault));
        complianceToken.setCompliance(address(vault), true);

        // Initialize vault valuation with Epoch 1
        bytes32 initHash = ProofBindingLib.computeProofBindingHash(
            address(vault),
            1,
            block.chainid,
            INITIAL_NAV
        );
        vault.updateValuationWithProof(abi.encodePacked(initHash), INITIAL_NAV, 1, block.number);

        // Instantiate independent fuzzing handler
        handler = new VERAVaultHandler(
            vault,
            queue,
            usdc,
            verifier,
            complianceToken,
            owner
        );

        complianceToken.setCompliance(address(handler), true);

        // Direct fuzzer to interact exclusively through the handler
        targetContract(address(handler));
    }

    /// @notice Invariant 1: Vault total assets must never fall below total supply of shares
    function invariant_Solvency() public view {
        assertGe(
            vault.totalAssets(),
            vault.totalSupply(),
            "Solvency violation: totalAssets dropped below totalSupply"
        );
    }

    /// @notice Invariant 2: Non-compliant actors must never hold vault shares
    function invariant_NonCompliantAddressProtection() public view {
        address nonCompliant = handler.nonCompliantActor();
        assertEq(
            vault.balanceOf(nonCompliant),
            0,
            "Compliance violation: Non-compliant address holds shares"
        );
    }

    /// @notice Invariant 3: Epoch sequencing must be strictly monotonic non-decreasing
    function invariant_EpochMonotonicity() public view {
        uint256 ghostEpoch = handler.ghost_currentEpoch();
        assertGe(
            vault.currentEpoch(),
            ghostEpoch,
            "Monotonicity violation: Vault epoch reversed"
        );
        assertGe(
            queue.currentEpoch(),
            ghostEpoch,
            "Monotonicity violation: Queue epoch reversed"
        );
    }

    /// @notice Invariant 4: Direct enqueue into EpochQueue by any non-vault caller must always revert
    function invariant_IsolatedQueueProtection() public {
        address attacker = handler.nonCompliantActor();
        vm.prank(attacker);
        vm.expectRevert(EpochQueue.OnlyVault.selector);
        queue.enqueueRedeem(attacker, 1_000 * 1e6);
    }
}