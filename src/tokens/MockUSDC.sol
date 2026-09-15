// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockUSDC is ERC20, ERC20Permit, Ownable {
    constructor() ERC20("USD Coin", "USDC") ERC20Permit("USD Coin") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000_000 * 10**6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
