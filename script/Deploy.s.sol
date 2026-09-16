// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import "../src/core/VERAVault.sol";
import "../src/core/EpochQueue.sol";
import "../src/verifier/MockGroth16Verifier.sol";
import "../src/tokens/MockUSDC.sol";
import "../src/tokens/AssetToken.sol";
import "../src/libraries/ProofBindingLib.sol";

/**
 * @title DeployScript
 * @notice Automated deployment and configuration script for the VERA Protocol
 * @dev Compatible with local Anvil testnet and remote networks (Sepolia, etc.)
 */
contract DeployScript is Script {
    function run() external {
        // Read PRIVATE_KEY from environment or fall back to default Anvil Account #0
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerPrivateKey);

        console.log("==================================================");
        console.log("Deploying VERA Protocol...");
        console.log("Deployer Address:", deployer);
        console.log("Chain ID:        ", block.chainid);
        console.log("==================================================");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MockUSDC as underlying asset
        MockUSDC usdc = new MockUSDC();
        console.log("1. MockUSDC deployed at:           ", address(usdc));

        // 2. Deploy AssetToken as compliance whitelist registry
        AssetToken complianceToken = new AssetToken("Compliance Token", "CMP");
        console.log("2. AssetToken (Compliance) at:     ", address(complianceToken));

        // 3. Deploy MockGroth16Verifier
        MockGroth16Verifier verifier = new MockGroth16Verifier();
        console.log("3. MockGroth16Verifier deployed at:", address(verifier));

        // 4. Deploy EpochQueue
        EpochQueue epochQueue = new EpochQueue(address(usdc));
        console.log("4. EpochQueue deployed at:         ", address(epochQueue));

        // 5. Deploy VERAVault (ERC-4626 + ZK Valuation + Circuit Breaker)
        VERAVault vault = new VERAVault(
            IERC20(address(usdc)),
            IZKVerifier(address(verifier)),
            address(epochQueue),
            address(complianceToken)
        );
        console.log("5. VERAVault deployed at:          ", address(vault));

        // 6. Authorizations & Initial Configurations
        // Bind Vault to EpochQueue
        epochQueue.setVault(address(vault));
        console.log("-> Configured: EpochQueue.setVault(vault)");

        // Whitelist Vault and Deployer in Compliance Registry
        complianceToken.setCompliance(address(vault), true);
        complianceToken.setCompliance(deployer, true);
        console.log("-> Configured: Whitelisted Vault and Deployer on Compliance Token");

        // Initialize Epoch 1 with starting NAV (50,000 USDC)
        uint256 initialNAV = 50_000 * 1e6;
        bytes32 initHash = ProofBindingLib.computeProofBindingHash(
            address(vault),
            1,
            block.chainid,
            initialNAV
        );
        vault.updateValuationWithProof(abi.encodePacked(initHash), initialNAV, 1, block.number);
        console.log("-> Initialized: Vault Epoch 1 with NAV 50,000 USDC");

        vm.stopBroadcast();

        console.log("==================================================");
        console.log("VERA Protocol Deployment Summary:");
        console.log("MockUSDC:        ", address(usdc));
        console.log("AssetToken:      ", address(complianceToken));
        console.log("Verifier:        ", address(verifier));
        console.log("EpochQueue:      ", address(epochQueue));
        console.log("VERAVault:       ", address(vault));
        console.log("==================================================");
    }
}

contract Deploy is DeployScript {}

