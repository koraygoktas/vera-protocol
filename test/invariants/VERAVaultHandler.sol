// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../../src/core/VERAVault.sol";
import "../../src/core/EpochQueue.sol";
import "../../src/verifier/MockGroth16Verifier.sol";
import "../../src/tokens/MockUSDC.sol";
import "../../src/tokens/AssetToken.sol";
import "../../src/libraries/ProofBindingLib.sol";

/**
 * @title VERAVaultHandler
 * @notice Independent stateful fuzzing handler managing protocol actors, state transitions, and edge cases
 */
contract VERAVaultHandler is Test {
    VERAVault public immutable vault;
    EpochQueue public immutable queue;
    MockUSDC public immutable usdc;
    MockGroth16Verifier public immutable verifier;
    AssetToken public immutable complianceToken;

    address public owner;
    address[] public actors;
    address public currentActor;
    address public nonCompliantActor;

    // Ghost variables for invariant tracking
    uint256 public ghost_expectedTotalDeposits;
    uint256 public ghost_expectedTotalQueuedShares;
    uint256 public ghost_lastValidNAV;
    uint256 public ghost_currentEpoch;
    uint256 public ghost_successfulDeposits;
    uint256 public ghost_successfulRedeems;

    modifier useActor(uint256 actorIndexSeed) {
        currentActor = actors[bound(actorIndexSeed, 0, actors.length - 1)];
        _;
    }

    constructor(
        VERAVault _vault,
        EpochQueue _queue,
        MockUSDC _usdc,
        MockGroth16Verifier _verifier,
        AssetToken _complianceToken,
        address _owner
    ) {
        vault = _vault;
        queue = _queue;
        usdc = _usdc;
        verifier = _verifier;
        complianceToken = _complianceToken;
        owner = _owner;

        // Compliant actors: Alice, Bob, Charlie
        actors.push(address(0x111));
        actors.push(address(0x222));
        actors.push(address(0x333));

        vm.startPrank(owner);
        for (uint256 i = 0; i < actors.length; i++) {
            complianceToken.setCompliance(actors[i], true);
            usdc.transfer(actors[i], 10_000_000 * 1e6); // 10M USDC each
        }

        // Non-compliant actor for compliance invariant verification
        nonCompliantActor = address(0xBAD);
        complianceToken.setCompliance(nonCompliantActor, false);
        usdc.transfer(nonCompliantActor, 1_000_000 * 1e6);
        vm.stopPrank();

        ghost_currentEpoch = vault.currentEpoch();
        ghost_lastValidNAV = vault.currentNAV();
    }

    /// @notice Random deposits by compliant actors
    function deposit(uint256 actorSeed, uint256 amount) external useActor(actorSeed) {
        if (vault.paused()) return;
        amount = bound(amount, 1e6, 250_000 * 1e6); // 1 - 250,000 USDC

        vm.startPrank(currentActor);
        usdc.approve(address(vault), amount);
        try vault.deposit(amount, currentActor) returns (uint256 shares) {
            ghost_expectedTotalDeposits += amount;
            ghost_successfulDeposits++;
        } catch {}
        vm.stopPrank();
    }

    /// @notice Random asynchronous redeem requests into EpochQueue
    function withdraw(uint256 actorSeed, uint256 shares) external useActor(actorSeed) {
        if (vault.paused()) return;
        uint256 maxShares = vault.balanceOf(currentActor);
        if (maxShares == 0) return;

        shares = bound(shares, 1, maxShares);

        vm.startPrank(currentActor);
        try vault.redeem(shares, currentActor, currentActor) returns (uint256) {
            ghost_expectedTotalQueuedShares += shares;
            ghost_successfulRedeems++;
        } catch {}
        vm.stopPrank();
    }

    /// @notice ZK valuation update stressing bounds (both within and beyond 5% Circuit Breaker threshold)
    function updateValuation(uint256 newNAVDeltaBps, bool isIncrease) external {
        if (vault.paused()) return;

        newNAVDeltaBps = bound(newNAVDeltaBps, 0, 1000); // 0% to 10% deviation
        uint256 baseNAV = vault.currentNAV() == 0 ? 100_000 * 1e6 : vault.currentNAV();
        uint256 calculatedNAV;

        if (isIncrease) {
            calculatedNAV = baseNAV + ((baseNAV * newNAVDeltaBps) / 10000);
        } else {
            calculatedNAV = baseNAV - ((baseNAV * newNAVDeltaBps) / 10000);
        }

        if (calculatedNAV == 0) calculatedNAV = 1e6;

        uint256 nextEpoch = vault.currentEpoch() + 1;
        bytes32 bindingHash = ProofBindingLib.computeProofBindingHash(
            address(vault),
            nextEpoch,
            block.chainid,
            calculatedNAV
        );

        bytes memory proof = abi.encodePacked(bindingHash);

        vm.prank(owner);
        try vault.updateValuationWithProof(proof, calculatedNAV, nextEpoch, block.number) {
            ghost_lastValidNAV = calculatedNAV;
            ghost_currentEpoch = nextEpoch;
        } catch {
            // Revert caught if delta > 5% (Circuit Breaker triggered) or proof invalid
        }
    }

    /// @notice Fuzzer attempts unauthorized direct entry into EpochQueue
    function attemptDirectQueueEnqueue(uint256 shares) external {
        shares = bound(shares, 1, 100_000 * 1e6);
        vm.prank(nonCompliantActor);
        try queue.enqueueRedeem(nonCompliantActor, shares) {
            // Should never succeed due to onlyVault modifier
        } catch {}
    }

    /// @notice Fuzzer attempts transfer from compliant actor to non-compliant actor
    function attemptNonCompliantTransfer(uint256 actorSeed, uint256 amount) external useActor(actorSeed) {
        uint256 bal = vault.balanceOf(currentActor);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);

        vm.startPrank(currentActor);
        try vault.transfer(nonCompliantActor, amount) {
            // Should never succeed due to compliance check
        } catch {}
        vm.stopPrank();
    }

    function getActors() external view returns (address[] memory) {
        return actors;
    }
}
