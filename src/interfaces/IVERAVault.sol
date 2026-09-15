// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVERAVault {
    function currentNAV() external view returns (uint256);
    function currentEpoch() external view returns (uint256);
    function updateValuationWithProof(
        bytes calldata proof,
        uint256 newNAV,
        uint256 epochId,
        uint256 proofBlockNumber
    ) external;
}
