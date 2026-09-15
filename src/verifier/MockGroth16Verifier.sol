// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IZKVerifier.sol";

contract MockGroth16Verifier is IZKVerifier {
    address public owner;
    bool public alwaysValid;

    constructor() {
        owner = msg.sender;
        alwaysValid = true;
    }

    function setAlwaysValid(bool _alwaysValid) external {
        require(msg.sender == owner, "Not owner");
        alwaysValid = _alwaysValid;
    }

    function verifyProof(
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external view override returns (bool) {
        return alwaysValid;
    }
}
