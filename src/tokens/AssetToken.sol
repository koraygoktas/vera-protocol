// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title AssetToken
 * @notice Regulatory-compliant ERC20 token requiring sender & recipient whitelisting
 */
contract AssetToken is Ownable, ERC20 {
    error NotCompliant(address target);

    mapping(address => bool) public isCompliant;

    constructor(
        string memory name,
        string memory symbol
    ) Ownable(msg.sender) ERC20(name, symbol) {
        // Initialized with deployer as owner
    }

    function setCompliance(address target, bool status) external onlyOwner {
        isCompliant[target] = status;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && !isCompliant[from]) {
            revert NotCompliant(from);
        }
        if (to != address(0) && !isCompliant[to]) {
            revert NotCompliant(to);
        }
        super._update(from, to, value);
    }
}
