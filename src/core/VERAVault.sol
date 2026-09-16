// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IVERAVault.sol";
import "../interfaces/IZKVerifier.sol";
import "../libraries/ProofBindingLib.sol";
import "./EpochQueue.sol";

interface IComplianceRegistry {
    function isCompliant(address target) external view returns (bool);
}

/**
 * @title VERAVault
 * @notice ZK-ML driven ERC-4626 yield vault with Circuit Breakers and async redemption queue
 */
contract VERAVault is ERC4626, Pausable, ReentrancyGuardTransient, Ownable, IVERAVault {
    using Math for uint256;

    error InvalidEpoch();
    error ProofExpired();
    error InvalidProofBinding();
    error CircuitBreakerTriggered();
    error NotCompliant(address target);
    error ZeroAddress();

    uint256 public currentNAV;
    uint256 public currentEpoch;
    uint256 public constant MAX_NAV_DELTA_BPS = 500; // 5% maximum NAV deviation per epoch
    uint256 public constant PROOF_DEADLINE = 50; // Proof valid for at most 50 blocks

    IZKVerifier public immutable verifier;
    EpochQueue public immutable epochQueue;
    IComplianceRegistry public immutable complianceRegistry;

    event ValuationUpdated(uint256 epochId, uint256 newNAV, uint256 proofBlockNumber);
    event CircuitBreakerTriggeredEvent(uint256 oldNAV, uint256 newNAV, uint256 deltaBPS);

    constructor(
        IERC20 _asset,
        IZKVerifier _verifier,
        address _epochQueue,
        address _complianceRegistry
    ) ERC4626(_asset) ERC20("VERA Vault Share", "VERA") Ownable(msg.sender) {
        if (address(_asset) == address(0)) revert ZeroAddress();
        if (address(_verifier) == address(0)) revert ZeroAddress();
        if (_epochQueue == address(0)) revert ZeroAddress();
        if (_complianceRegistry == address(0)) revert ZeroAddress();

        verifier = _verifier;
        epochQueue = EpochQueue(_epochQueue);
        complianceRegistry = IComplianceRegistry(_complianceRegistry);
    }

    /// @notice Compliance verification for all share transfers (minting, burning, secondary transfers)
    function _update(address from, address to, uint256 value) internal virtual override {
        if (from != address(0) && !complianceRegistry.isCompliant(from)) revert NotCompliant(from);
        if (to != address(0) && !complianceRegistry.isCompliant(to)) revert NotCompliant(to);
        super._update(from, to, value);
    }

    /// @notice Updates off-chain asset valuation with a zero-knowledge Groth16 proof
    function updateValuationWithProof(
        bytes calldata proof,
        uint256 newNAV,
        uint256 epochId,
        uint256 proofBlockNumber
    ) external nonReentrant onlyOwner whenNotPaused {
        if (epochId != currentEpoch + 1) revert InvalidEpoch();
        if (block.number > proofBlockNumber + PROOF_DEADLINE) revert ProofExpired();

        bytes32 computedHash = ProofBindingLib.computeProofBindingHash(
            address(this),
            epochId,
            block.chainid,
            newNAV
        );

        uint256[] memory publicInputs = new uint256[](1);
        publicInputs[0] = uint256(computedHash);

        if (!verifier.verifyProof(proof, publicInputs)) revert InvalidProofBinding();

        // Circuit Breaker: Halt if single-epoch valuation change exceeds 5%
        if (currentNAV > 0) {
            uint256 delta = newNAV > currentNAV
                ? ((newNAV - currentNAV) * 10000) / currentNAV
                : ((currentNAV - newNAV) * 10000) / currentNAV;

            if (delta > MAX_NAV_DELTA_BPS) {
                emit CircuitBreakerTriggeredEvent(currentNAV, newNAV, delta);
                _pause();
                revert CircuitBreakerTriggered();
            }
        }

        currentNAV = newNAV;
        currentEpoch = epochId;
        epochQueue.setCurrentEpoch(epochId);

        emit ValuationUpdated(epochId, newNAV, proofBlockNumber);
    }

    /// @notice Total assets managed by vault: liquid token balance + off-chain real-world asset NAV
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + currentNAV;
    }

    /// @dev Ensures 1:1 conversion for initial depositors when totalSupply is zero,
    /// preventing share minting from rounding down to 0 due to pre-existing off-chain NAV.
    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view virtual override returns (uint256) {
        uint256 supply = totalSupply();
        return (supply == 0)
            ? assets
            : assets.mulDiv(supply + 10 ** _decimalsOffset(), totalAssets() + 1, rounding);
    }

    /// @dev Ensures 1:1 conversion for initial shares when totalSupply is zero.
    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view virtual override returns (uint256) {
        uint256 supply = totalSupply();
        return (supply == 0)
            ? shares
            : shares.mulDiv(totalAssets() + 1, supply + 10 ** _decimalsOffset(), rounding);
    }

    function deposit(uint256 assets, address receiver) public override whenNotPaused returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override whenNotPaused returns (uint256) {
        return super.mint(shares, receiver);
    }

    /// @notice Asynchronous withdrawal: burns vault shares and enqueues redemption ticket in EpochQueue
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public override nonReentrant whenNotPaused returns (uint256) {
        uint256 shares = previewWithdraw(assets);
        address caller = _msgSender();
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        _burn(owner, shares);

        epochQueue.enqueueRedeem(receiver, shares);
        emit Withdraw(caller, receiver, owner, assets, shares);
        return shares;
    }

    /// @notice Asynchronous redemption: burns vault shares and enqueues redemption ticket in EpochQueue
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public override nonReentrant whenNotPaused returns (uint256) {
        uint256 assets = previewRedeem(shares);
        address caller = _msgSender();
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }
        _burn(owner, shares);

        epochQueue.enqueueRedeem(receiver, shares);
        emit Withdraw(caller, receiver, owner, assets, shares);
        return assets;
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return paused() ? 0 : super.maxWithdraw(owner);
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        return paused() ? 0 : super.maxRedeem(owner);
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        return paused() ? 0 : super.maxDeposit(receiver);
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return paused() ? 0 : super.maxMint(receiver);
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function pause() external onlyOwner {
        _pause();
    }
}