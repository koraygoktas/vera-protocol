// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProofBindingLib
 * @notice Cryptographic binding library linking ZK proofs to specific vault, epoch, chain, and NAV
 */
library ProofBindingLib {
    error InvalidProofBinding();

    function computeProofBindingHash(
        address vaultAddress,
        uint256 epochId,
        uint256 chainId,
        uint256 targetNAV
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(vaultAddress, epochId, chainId, targetNAV));
    }

    function verifyProofBinding(
        bytes32 computedHash,
        bytes32 providedHash
    ) internal pure returns (bool) {
        return computedHash == providedHash;
    }

    function verifyProofBindingWithRevert(
        bytes32 computedHash,
        bytes32 providedHash
    ) internal pure {
        if (computedHash != providedHash) {
            revert InvalidProofBinding();
        }
    }
}
