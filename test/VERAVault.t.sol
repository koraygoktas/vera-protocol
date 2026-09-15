// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/core/VERAVault.sol";
import "../src/core/EpochQueue.sol";
import "../src/verifier/MockGroth16Verifier.sol";
import "../src/tokens/MockUSDC.sol";
import "../src/tokens/AssetToken.sol";
import "../src/libraries/ProofBindingLib.sol";

/**
 * @title VERAVaultComprehensiveTest
 * @notice Comprehensive unit test suite covering ERC-4626 mechanics, ZK valuation, MEV protection, async queue, and compliance
 */
contract VERAVaultComprehensiveTest is Test {
    VERAVault public vault;
    EpochQueue public epochQueue;
    MockGroth16Verifier public verifier;
    MockUSDC public usdc;
    AssetToken public complianceToken;

    address public owner = address(this);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public charlie = address(0xCC);
    address public attacker = address(0xBAD);

    uint256 constant INITIAL_BALANCE = 1_000_000 * 1e6; // 1M USDC
    uint256 constant INITIAL_NAV = 50_000 * 1e6;        // 50k USDC

    function setUp() public {
        usdc = new MockUSDC();
        verifier = new MockGroth16Verifier();
        complianceToken = new AssetToken("Compliance Token", "CMP");

        // Compliance whitelist setup
        complianceToken.setCompliance(owner, true);
        complianceToken.setCompliance(alice, true);
        complianceToken.setCompliance(bob, true);
        complianceToken.setCompliance(charlie, true);
        // attacker is intentionally not compliant

        epochQueue = new EpochQueue(address(usdc));
        vault = new VERAVault(
            IERC20(address(usdc)),
            IZKVerifier(address(verifier)),
            address(epochQueue),
            address(complianceToken)
        );

        epochQueue.setVault(address(vault));
        complianceToken.setCompliance(address(vault), true);

        // Distribute initial funds
        usdc.transfer(alice, INITIAL_BALANCE);
        usdc.transfer(bob, INITIAL_BALANCE);
        usdc.transfer(charlie, INITIAL_BALANCE);
        usdc.transfer(attacker, INITIAL_BALANCE);
    }

    // =========================================================================
    // 1. ERC-4626 CORE & INFLATION ATTACK RESILIENCE TESTS
    // =========================================================================

    function test_InitialDepositExchangeRateOneToOne() public {
        uint256 depositAmount = 10_000 * 1e6;
        vm.startPrank(alice);
        usdc.approve(address(vault), depositAmount);
        uint256 shares = vault.deposit(depositAmount, alice);
        vm.stopPrank();

        assertEq(shares, depositAmount, "Initial deposit must yield 1:1 share to asset ratio");
        assertEq(vault.totalAssets(), depositAmount, "Total assets must match deposit amount");
        assertEq(vault.balanceOf(alice), shares, "Alice must hold correct shares");
    }

    function test_InflationAttackResilience() public {
        // Attacker deposits minimal 1 wei
        vm.startPrank(alice);
        usdc.approve(address(vault), 1);
        vault.deposit(1, alice);

        // Attacker attempts inflation attack by directly donating 10,000 USDC to vault
        usdc.transfer(address(vault), 10_000 * 1e6);
        vm.stopPrank();

        // Legitimate user Bob deposits 20,000 USDC
        vm.startPrank(bob);
        usdc.approve(address(vault), 20_000 * 1e6);
        uint256 bobShares = vault.deposit(20_000 * 1e6, bob);
        vm.stopPrank();

        // Bob's shares must not be rounded down to zero
        assertTrue(bobShares > 0, "Inflation attack must not zero-out subsequent depositor shares");
    }

    // =========================================================================
    // 2. ZK VALUATION & CIRCUIT BREAKER TESTS
    // =========================================================================

    function test_ValidValuationUpdateWithinBounds() public {
        // Epoch 1 initial valuation (50k NAV)
        bytes32 initHash = ProofBindingLib.computeProofBindingHash(address(vault), 1, block.chainid, INITIAL_NAV);
        vault.updateValuationWithProof(abi.encodePacked(initHash), INITIAL_NAV, 1, block.number);

        // Valid 3% NAV increase: Epoch 2 (51.5k NAV, within 5% limit)
        uint256 validNAV = INITIAL_NAV + (INITIAL_NAV * 3 / 100);
        bytes32 validHash = ProofBindingLib.computeProofBindingHash(address(vault), 2, block.chainid, validNAV);

        vault.updateValuationWithProof(abi.encodePacked(validHash), validNAV, 2, block.number);

        assertEq(vault.currentNAV(), validNAV, "NAV should update to new valid valuation");
        assertEq(vault.currentEpoch(), 2, "Epoch should increment to 2");
        assertFalse(vault.paused(), "Vault must remain active for valid valuation updates");
    }

    function test_CircuitBreakerOnDownwardCrash() public {
        // Epoch 1 initial valuation (50k NAV)
        bytes32 initHash = ProofBindingLib.computeProofBindingHash(address(vault), 1, block.chainid, INITIAL_NAV);
        vault.updateValuationWithProof(abi.encodePacked(initHash), INITIAL_NAV, 1, block.number);

        // 6% downward crash attempt: Epoch 2 (exceeds MAX_NAV_DELTA_BPS = 500)
        uint256 crashedNAV = INITIAL_NAV - (INITIAL_NAV * 6 / 100);
        bytes32 crashHash = ProofBindingLib.computeProofBindingHash(address(vault), 2, block.chainid, crashedNAV);

        vm.expectRevert(VERAVault.CircuitBreakerTriggered.selector);
        vault.updateValuationWithProof(abi.encodePacked(crashHash), crashedNAV, 2, block.number);

        // Security response: Vault can be paused to freeze all operations
        vault.pause();
        assertTrue(vault.paused(), "Vault must be paused upon circuit breaker trip");

        // Paused vault rejects subsequent deposits
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000 * 1e6);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.deposit(1_000 * 1e6, alice);
        vm.stopPrank();
    }

    function test_CircuitBreakerOnUpwardSpike() public {
        // Epoch 1 initial valuation (50k NAV)
        bytes32 initHash = ProofBindingLib.computeProofBindingHash(address(vault), 1, block.chainid, INITIAL_NAV);
        vault.updateValuationWithProof(abi.encodePacked(initHash), INITIAL_NAV, 1, block.number);

        // 6% upward spike attempt: Epoch 2
        uint256 spikedNAV = INITIAL_NAV + (INITIAL_NAV * 6 / 100);
        bytes32 spikeHash = ProofBindingLib.computeProofBindingHash(address(vault), 2, block.chainid, spikedNAV);

        vm.expectRevert(VERAVault.CircuitBreakerTriggered.selector);
        vault.updateValuationWithProof(abi.encodePacked(spikeHash), spikedNAV, 2, block.number);
    }

    // =========================================================================
    // 3. MEV, PROOF DEADLINE & BINDING INTEGRITY TESTS
    // =========================================================================

    function test_ProofExpiredAfterDeadline() public {
        bytes32 initHash = ProofBindingLib.computeProofBindingHash(address(vault), 1, block.chainid, INITIAL_NAV);
        uint256 proofBlock = block.number;

        // Advance 51 blocks past PROOF_DEADLINE (50)
        vm.roll(block.number + 51);

        vm.expectRevert(VERAVault.ProofExpired.selector);
        vault.updateValuationWithProof(abi.encodePacked(initHash), INITIAL_NAV, 1, proofBlock);
    }

    function test_CrossChainProofReplayBlocked() public {
        // Proof generated for a different chain ID (999999)
        bytes32 foreignChainHash = ProofBindingLib.computeProofBindingHash(address(vault), 1, 999999, INITIAL_NAV);

        verifier.setAlwaysValid(false);
        vm.expectRevert(VERAVault.InvalidProofBinding.selector);
        vault.updateValuationWithProof(abi.encodePacked(foreignChainHash), INITIAL_NAV, 1, block.number);
    }

    function test_ForeignVaultProofBindingBlocked() public {
        // Proof generated for a different vault address
        bytes32 wrongVaultHash = ProofBindingLib.computeProofBindingHash(address(0xDEAD), 1, block.chainid, INITIAL_NAV);

        verifier.setAlwaysValid(false);
        vm.expectRevert(VERAVault.InvalidProofBinding.selector);
        vault.updateValuationWithProof(abi.encodePacked(wrongVaultHash), INITIAL_NAV, 1, block.number);
    }

    function test_CannotSkipEpochSequencing() public {
        bytes32 initHash = ProofBindingLib.computeProofBindingHash(address(vault), 1, block.chainid, INITIAL_NAV);
        vault.updateValuationWithProof(abi.encodePacked(initHash), INITIAL_NAV, 1, block.number);

        // Attempting to skip to Epoch 3 directly must revert
        bytes32 skipHash = ProofBindingLib.computeProofBindingHash(address(vault), 3, block.chainid, INITIAL_NAV);

        vm.expectRevert(VERAVault.InvalidEpoch.selector);
        vault.updateValuationWithProof(abi.encodePacked(skipHash), INITIAL_NAV, 3, block.number);
    }

    // =========================================================================
    // 4. ASYNCHRONOUS REDEMPTION QUEUE (EPOCH QUEUE) TESTS
    // =========================================================================

    function test_MultiUserProRataRedemption() public {
        // Alice and Bob deposit into vault
        vm.startPrank(alice);
        usdc.approve(address(vault), 10_000 * 1e6);
        vault.deposit(10_000 * 1e6, alice);
        vm.stopPrank();

        vm.startPrank(bob);
        usdc.approve(address(vault), 30_000 * 1e6);
        vault.deposit(30_000 * 1e6, bob);
        vm.stopPrank();

        // Both initiate redemptions in Epoch 0 (Total 40k shares queued)
        vm.prank(alice);
        vault.redeem(10_000 * 1e6, alice, alice); // Request ID 0

        vm.prank(bob);
        vault.redeem(30_000 * 1e6, bob, bob);     // Request ID 1

        // Off-chain asset returns 20,000 USDC of available liquidity (50% coverage)
        usdc.transfer(address(epochQueue), 20_000 * 1e6);
        epochQueue.processEpoch(0, 20_000 * 1e6);

        // Alice claims pro-rata share: (10k / 40k) * 20k = 5,000 USDC
        uint256 aliceBalBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        epochQueue.claim(0);
        assertEq(usdc.balanceOf(alice) - aliceBalBefore, 5_000 * 1e6, "Alice should receive 5k USDC");

        // Bob claims pro-rata share: (30k / 40k) * 20k = 15,000 USDC
        uint256 bobBalBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        epochQueue.claim(1);
        assertEq(usdc.balanceOf(bob) - bobBalBefore, 15_000 * 1e6, "Bob should receive 15k USDC");
    }

    function test_CannotDoubleClaimAlreadyClaimed() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000 * 1e6);
        vault.deposit(1_000 * 1e6, alice);
        vault.withdraw(1_000 * 1e6, alice, alice);
        vm.stopPrank();

        usdc.transfer(address(epochQueue), 1_000 * 1e6);
        epochQueue.processEpoch(0, 1_000 * 1e6);

        // Alice claims once
        vm.prank(alice);
        epochQueue.claim(0);

        // Alice attempts to claim again with same ticket
        vm.prank(alice);
        vm.expectRevert(EpochQueue.AlreadyClaimed.selector);
        epochQueue.claim(0);
    }

    function test_CannotClaimUnprocessedEpoch() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000 * 1e6);
        vault.deposit(1_000 * 1e6, alice);
        vault.withdraw(1_000 * 1e6, alice, alice);

        // Attempting to claim before processEpoch has been executed
        vm.expectRevert(EpochQueue.EpochNotProcessed.selector);
        epochQueue.claim(0);
        vm.stopPrank();
    }

    function test_CannotClaimOtherUsersRequest() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000 * 1e6);
        vault.deposit(1_000 * 1e6, alice);
        vault.withdraw(1_000 * 1e6, alice, alice);
        vm.stopPrank();

        usdc.transfer(address(epochQueue), 1_000 * 1e6);
        epochQueue.processEpoch(0, 1_000 * 1e6);

        // Bob attempts to steal Alice's redemption request
        vm.startPrank(bob);
        vm.expectRevert(EpochQueue.NotOwnerOfRequest.selector);
        epochQueue.claim(0);
        vm.stopPrank();
    }

    function test_DirectEnqueueRedeemBlockedForNonVault() public {
        // Attacker tries to inject tickets directly into EpochQueue
        vm.startPrank(attacker);
        vm.expectRevert(EpochQueue.OnlyVault.selector);
        epochQueue.enqueueRedeem(attacker, 1_000 * 1e6);
        vm.stopPrank();
    }

    // =========================================================================
    // 5. REGULATORY COMPLIANCE TESTS
    // =========================================================================

    function test_NonCompliantCannotDeposit() public {
        vm.startPrank(attacker);
        usdc.approve(address(vault), 5_000 * 1e6);

        // Non-compliant attacker cannot deposit to mint shares
        vm.expectRevert(abi.encodeWithSelector(VERAVault.NotCompliant.selector, attacker));
        vault.deposit(5_000 * 1e6, attacker);
        vm.stopPrank();
    }

    function test_NonCompliantCannotReceiveViaTransfer() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 5_000 * 1e6);
        vault.deposit(5_000 * 1e6, alice);

        // Alice cannot transfer shares to non-compliant attacker
        vm.expectRevert(abi.encodeWithSelector(VERAVault.NotCompliant.selector, attacker));
        vault.transfer(attacker, 1_000 * 1e6);
        vm.stopPrank();
    }

    function test_NonCompliantSenderBlockedOnTransfer() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 5_000 * 1e6);
        vault.deposit(5_000 * 1e6, alice);
        vm.stopPrank();

        // Revoke Alice's compliance status
        complianceToken.setCompliance(alice, false);

        // Alice can no longer transfer her shares to compliant Bob
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(VERAVault.NotCompliant.selector, alice));
        vault.transfer(bob, 1_000 * 1e6);
        vm.stopPrank();
    }

    // =========================================================================
    // 6. THIRD-PARTY ALLOWANCE TESTS
    // =========================================================================

    function test_ThirdPartyWithdrawRequiresAllowance() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000 * 1e6);
        vault.deposit(1_000 * 1e6, alice);
        vm.stopPrank();

        // Bob tries to withdraw Alice's shares without allowance
        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, bob, 0, 1_000 * 1e6));
        vault.withdraw(1_000 * 1e6, bob, alice);
        vm.stopPrank();
    }

    function test_ThirdPartyWithdrawWithAllowance() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), 1_000 * 1e6);
        vault.deposit(1_000 * 1e6, alice);
        // Alice approves Bob to spend her vault shares
        vault.approve(bob, 1_000 * 1e6);
        vm.stopPrank();

        // Bob withdraws Alice's shares on her behalf
        vm.startPrank(bob);
        vault.withdraw(1_000 * 1e6, bob, alice);
        vm.stopPrank();

        assertEq(vault.allowance(alice, bob), 0, "Bob's allowance should be consumed");
        assertEq(vault.balanceOf(alice), 0, "Alice's shares should be burned");
    }
}