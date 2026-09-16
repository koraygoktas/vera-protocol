# VERA Protocol (Verifiable Evaluated Real-World Assets)

VERA is a next-generation RWA (Real-World Asset) tokenization and yield vault protocol that eliminates centralized oracles and multi-sig wallets for valuation updates using Zero-Knowledge proofs.

## Architecture

### Core Components

1. **VERAVault.sol** - Main vault contract implementing ERC4626 with ZK-based valuation updates
2. **EpochQueue.sol** - Async withdrawal queue for handling illiquid RWA assets
3. **AssetToken.sol** - Compliant ERC20 token with whitelist functionality
4. **ProofBindingLib.sol** - Library for proof-binding to prevent MEV attacks
5. **MockGroth16Verifier.sol** - Mock ZK verifier for testing

### Key Features

- **ZK-Based Valuation**: Off-chain AI/ML models compute NAV and submit ZK-SNARK proofs for on-chain verification
- **Proof-Binding**: Prevents MEV attacks by binding proofs to specific vault, epoch, chain, and NAV values
- **Circuit Breaker**: Pauses vault if NAV changes by more than 5% in a single epoch
- **Compliance**: Built-in whitelist mechanism for regulatory compliance
- **Epoch-Based Withdrawals**: Prevents bank runs through period-based withdrawal queue

## Sepolia Deployments

The protocol contracts are deployed and verified on the Ethereum Sepolia Testnet (Chain ID: `11155111`):

| Contract | Description | Address | Etherscan Link |
| :--- | :--- | :--- | :--- |
| **VERAVault** | ERC-4626 Vault + ZK Valuation + Circuit Breakers | `0x3615383F786427E9f8709DCEd092517E682642B7` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x3615383F786427E9f8709DCEd092517E682642B7#code) |
| **EpochQueue** | Asynchronous Redemption & Settlement Queue | `0x221b4b625f92C11E8FED1aEf6EfbfB508b96934f` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x221b4b625f92C11E8FED1aEf6EfbfB508b96934f#code) |
| **MockUSDC** | Underlying Asset (6 Decimals) | `0xAaC468B927c2DfC39A151cD453aC92Ef16652f9B` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0xAaC468B927c2DfC39A151cD453aC92Ef16652f9B#code) |
| **AssetToken** | Compliance Whitelist Registry | `0xdC119f1a1d9DA01083573B928e8DcE00bEd965Bc` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0xdC119f1a1d9DA01083573B928e8DcE00bEd965Bc#code) |
| **MockGroth16Verifier** | ZK-SNARK Groth16 Proof Verifier | `0x24CCB4f4c7C8a34686eF5aA93F2fBcFF1595983C` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x24CCB4f4c7C8a34686eF5aA93F2fBcFF1595983C#code) |

All contracts have been verified on both **Etherscan** and **Sourcify**.

## Installation

```bash
# Install Foundry (if not already installed)
curl -L https://foundry.paradigm.xyz | bash

# Initialize the project (if starting fresh)
forge init vera-protocol

# Install OpenZeppelin Contracts
cd lib
git submodule add https://github.com/OpenZeppelin/openzeppelin-contracts.git
```

## Project Structure

```
vera-protocol/
├── src/
│   ├── interfaces/          # Contract interfaces
│   │   ├── IVERAVault.sol
│   │   └── IZKVerifier.sol
│   ├── verifier/            # ZK verifier implementations
│   │   └── MockGroth16Verifier.sol
│   ├── tokens/              # Token contracts
│   │   ├── AssetToken.sol
│   │   └── MockUSDC.sol
│   ├── core/                # Core vault logic
│   │   ├── VERAVault.sol
│   │   └── EpochQueue.sol
│   └── libraries/           # Utility libraries
│       └── ProofBindingLib.sol
├── test/                    # Foundry tests
│   ├── VERAVault.t.sol
│   └── invariants/
│       └── VERAVaultInvariants.t.sol
├── demo/                    # Web interface demo
│   ├── index.html
│   ├── style.css
│   └── app.js
├── lib/                     # Dependencies
│   └── openzeppelin-contracts/
└── foundry.toml             # Foundry configuration
```

## Testing

```bash
# Run all tests
forge test

# Run tests with gas reporting
forge test --gas-report

# Run specific test file
forge test --match-path test/VERAVault.t.sol

# Run invariant tests
forge test --match-test invariant_

# Build contracts
forge build
```

## Web Demo

The project includes a browser-based demo interface for testing the protocol without deployment:

```bash
# Open the demo in your browser
# Simply open demo/index.html in your web browser
```

### Demo Features

- **MetaMask Integration**: Connect your wallet for blockchain interaction
- **Protocol Dashboard**: View current NAV, epoch, liquid reserves, and share prices
- **User Operations**: Deposit USDC, request withdrawals, view compliance status
- **Async Withdrawal Queue**: Monitor and claim pending withdrawal requests
- **ZK-ML Valuation Simulator**: Simulate ZK-based valuation updates
- **Circuit Breaker Alerts**: Visual warnings when NAV changes exceed safety limits
- **Admin Controls**: Pause/unpause vault, process epochs, set current epoch

### Demo Mode

The demo runs in "mock mode" by default since contracts are not deployed. To use with real contracts:

1. Deploy contracts to a testnet
2. Update contract addresses in `demo/app.js`
3. Remove mock data initialization
4. Connect to the same network in MetaMask

## Contract Constants

- **MAX_NAV_DELTA_BPS**: 500 (5% maximum NAV change per epoch)
- **PROOF_DEADLINE**: 50 blocks (proofs older than 50 blocks are invalid)

## Security Features

1. **Proof Binding**: Prevents replay attacks and MEV front-running
2. **Circuit Breaker**: Automatically pauses on suspicious NAV changes
3. **Compliance Checks**: Enforces whitelist before any token transfers
4. **Reentrancy Protection**: Uses OpenZeppelin's ReentrancyGuardTransient
5. **Pausable**: Emergency pause functionality for owner

## Technical Details

### Solidity Version
- **solc_version**: 0.8.24
- **evm_version**: cancun

### Dependencies
- OpenZeppelin Contracts v5.0.0
- Foundry Framework

## License

MIT
