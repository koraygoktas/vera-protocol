// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/**
 * @title EpochQueue
 * @notice Asynchronous redemption queue for illiquid real-world assets
 */
contract EpochQueue is Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    error AlreadyClaimed();
    error InvalidRequest();
    error InsufficientLiquidity();
    error NotOwnerOfRequest();
    error EpochNotProcessed();
    error EpochAlreadyProcessed();
    error OnlyVault();
    error ZeroAddress();

    struct RedeemRequest {
        address user;
        uint256 shares;
        uint256 epochRequested;
        bool claimed;
    }

    IERC20 public immutable assetToken;
    address public vault;
    uint256 public nextRequestId;
    uint256 public currentEpoch;

    mapping(uint256 => RedeemRequest) public requests;
    mapping(uint256 => uint256) public epochTotalShares;
    mapping(uint256 => uint256) public epochAllocatedLiquidity;

    event RedeemEnqueued(uint256 indexed requestId, address indexed user, uint256 shares, uint256 epoch);
    event EpochProcessed(uint256 indexed epochId, uint256 totalSharesProcessed, uint256 liquidityAllocated);
    event RedeemClaimed(uint256 indexed requestId, address indexed user, uint256 shares, uint256 assetsReceived);
    event VaultSet(address indexed newVault);

    modifier onlyVault() {
        if (msg.sender != vault || vault == address(0)) revert OnlyVault();
        _;
    }

    modifier onlyVaultOrOwner() {
        if (msg.sender != vault && msg.sender != owner()) revert OnlyVault();
        _;
    }

    constructor(address _assetToken) Ownable(msg.sender) {
        if (_assetToken == address(0)) revert ZeroAddress();
        assetToken = IERC20(_assetToken);
    }

    function setVault(address _vault) external onlyOwner {
        if (_vault == address(0)) revert ZeroAddress();
        vault = _vault;
        emit VaultSet(_vault);
    }

    function setCurrentEpoch(uint256 _epoch) external onlyVaultOrOwner {
        if (_epoch < currentEpoch) revert InvalidRequest();
        currentEpoch = _epoch;
    }

    /// @notice Only the main vault contract can enqueue redemption tickets
    function enqueueRedeem(address user, uint256 shares) external onlyVault nonReentrant returns (uint256) {
        if (shares == 0 || user == address(0)) revert InvalidRequest();

        uint256 requestId = nextRequestId++;
        requests[requestId] = RedeemRequest({
            user: user,
            shares: shares,
            epochRequested: currentEpoch,
            claimed: false
        });

        epochTotalShares[currentEpoch] += shares;
        emit RedeemEnqueued(requestId, user, shares, currentEpoch);
        return requestId;
    }

    function processEpoch(uint256 epochId, uint256 availableLiquidity) external onlyOwner {
        if (epochId > currentEpoch) revert InvalidRequest();
        if (epochTotalShares[epochId] == 0) revert InvalidRequest();
        if (epochAllocatedLiquidity[epochId] != 0) revert EpochAlreadyProcessed();
        if (availableLiquidity == 0) revert InvalidRequest();

        epochAllocatedLiquidity[epochId] = availableLiquidity;
        emit EpochProcessed(epochId, epochTotalShares[epochId], availableLiquidity);
    }

    function claim(uint256 requestId) external nonReentrant {
        RedeemRequest storage request = requests[requestId];
        if (request.user == address(0)) revert InvalidRequest();
        if (request.user != msg.sender) revert NotOwnerOfRequest();
        if (request.claimed) revert AlreadyClaimed();

        uint256 epochId = request.epochRequested;
        if (epochAllocatedLiquidity[epochId] == 0) revert EpochNotProcessed();

        request.claimed = true;

        uint256 totalSharesInEpoch = epochTotalShares[epochId];
        uint256 allocatedLiquidity = epochAllocatedLiquidity[epochId];

        uint256 assetsToTransfer = (request.shares * allocatedLiquidity) / totalSharesInEpoch;
        if (assetToken.balanceOf(address(this)) < assetsToTransfer) {
            revert InsufficientLiquidity();
        }

        emit RedeemClaimed(requestId, msg.sender, request.shares, assetsToTransfer);
        assetToken.safeTransfer(msg.sender, assetsToTransfer);
    }

    function getRequest(uint256 requestId) external view returns (RedeemRequest memory) {
        return requests[requestId];
    }
}