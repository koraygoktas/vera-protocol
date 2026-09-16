// ============================================================================
// VERA Protocol - Web3 Application & Simulation Engine
// Built for ERC-4626 Vault, ZK-ML Valuation, and Async EpochQueue
// ============================================================================

// 1. CONFIGURABLE CONTRACT ADDRESSES
// Adjust these addresses to target local Anvil, Hardhat, Sepolia, or Mainnet deployments.
const CONTRACT_ADDRESSES = {
    vault: "0x3615383F786427E9f8709DCEd092517E682642B7",
    epochQueue: "0x221b4b625f92C11E8FED1aEf6EfbfB508b96934f",
    usdc: "0xAaC468B927c2DfC39A151cD453aC92Ef16652f9B",
    compliance: "0xdC119f1a1d9DA01083573B928e8DcE00bEd965Bc",
    verifier: "0x24CCB4f4c7C8a34686eF5aA93F2fBcFF1595983C"
};

// 2. CONTRACT ABIS (Synchronized with contracts under src/)
const VAULT_ABI = [
    "function currentNAV() view returns (uint256)",
    "function currentEpoch() view returns (uint256)",
    "function MAX_NAV_DELTA_BPS() view returns (uint256)",
    "function PROOF_DEADLINE() view returns (uint256)",
    "function totalAssets() view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function paused() view returns (bool)",
    "function owner() view returns (address)",
    "function asset() view returns (address)",
    "function epochQueue() view returns (address)",
    "function complianceRegistry() view returns (address)",
    "function deposit(uint256 assets, address receiver) returns (uint256)",
    "function mint(uint256 shares, address receiver) returns (uint256)",
    "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
    "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
    "function previewDeposit(uint256 assets) view returns (uint256)",
    "function previewWithdraw(uint256 assets) view returns (uint256)",
    "function previewRedeem(uint256 shares) view returns (uint256)",
    "function convertToShares(uint256 assets) view returns (uint256)",
    "function convertToAssets(uint256 shares) view returns (uint256)",
    "function updateValuationWithProof(bytes proof, uint256 newNAV, uint256 epochId, uint256 proofBlockNumber)",
    "function pause()",
    "function unpause()"
];

const EPOCH_QUEUE_ABI = [
    "function nextRequestId() view returns (uint256)",
    "function currentEpoch() view returns (uint256)",
    "function vault() view returns (address)",
    "function assetToken() view returns (address)",
    "function owner() view returns (address)",
    "function epochTotalShares(uint256 epochId) view returns (uint256)",
    "function epochAllocatedLiquidity(uint256 epochId) view returns (uint256)",
    "function requests(uint256 requestId) view returns (address user, uint256 shares, uint256 epochRequested, bool claimed)",
    "function getRequest(uint256 requestId) view returns (tuple(address user, uint256 shares, uint256 epochRequested, bool claimed))",
    "function enqueueRedeem(address user, uint256 shares) returns (uint256)",
    "function processEpoch(uint256 epochId, uint256 availableLiquidity)",
    "function setCurrentEpoch(uint256 _epoch)",
    "function claim(uint256 requestId)"
];

const USDC_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)"
];

const COMPLIANCE_ABI = [
    "function isCompliant(address target) view returns (bool)",
    "function setCompliance(address target, bool status)",
    "function owner() view returns (address)"
];

// ============================================================================
// MAIN APPLICATION CLASS
// ============================================================================
class VERAProtocolApp {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.userAddress = null;
        this.currentAccount = null;
        this.chainId = 31337; // Default Anvil/Local chain ID
        this.isLiveWeb3 = false;
        
        this.contracts = {};
        this.pollingInterval = null;
        
        // Protocol Constants
        this.MAX_NAV_DELTA_BPS = 500; // 5.00%
        this.PROOF_DEADLINE = 50;     // 50 blocks
        this.DECIMALS = 6;            // USDC & Vault decimals
        
        this.activeRedeemMode = "redeem"; // "redeem" (shares) or "withdraw" (assets)

        // Realistic Simulated In-Memory State
        this.state = {
            currentNAV: ethers.parseUnits("50000", 6),       // 50,000 USDC RWA NAV
            currentEpoch: 1,
            liquidReserve: ethers.parseUnits("10000", 6),    // 10,000 USDC in vault
            totalAssets: ethers.parseUnits("60000", 6),      // 60,000 USDC total
            totalSupply: ethers.parseUnits("50000", 6),      // 50,000 VERA shares
            paused: false,
            
            // User state
            userUsdcBalance: ethers.parseUnits("10000", 6),  // 10,000 USDC
            userVaultShares: ethers.parseUnits("1000", 6),   // 1,000 VERA
            isCompliant: true,
            
            // EpochQueue state
            nextRequestId: 3,
            epochTotalShares: {
                0: ethers.parseUnits("40000", 6),
                1: ethers.parseUnits("1000", 6)
            },
            epochAllocatedLiquidity: {
                0: ethers.parseUnits("20000", 6), // 50% coverage
                1: 0n                             // Unsettled
            },
            requests: [
                {
                    id: 0,
                    user: "0xA11CE00000000000000000000000000000000000",
                    shares: ethers.parseUnits("10000", 6),
                    epochRequested: 0,
                    claimed: true
                },
                {
                    id: 1,
                    user: "0xB0B0000000000000000000000000000000000000",
                    shares: ethers.parseUnits("30000", 6),
                    epochRequested: 0,
                    claimed: false
                },
                {
                    id: 2,
                    user: "0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496",
                    shares: ethers.parseUnits("1000", 6),
                    epochRequested: 1,
                    claimed: false
                }
            ]
        };
    }

    // ------------------------------------------------------------------------
    // Initialization
    // ------------------------------------------------------------------------
    async init() {
        this.initAddressInputs();
        this.setupEventListeners();
        this.updateZKSimulatorPreview();
        this.updateUI();

        // Check if MetaMask is available and already connected (unless explicitly disconnected by user)
        if (window.ethereum && sessionStorage.getItem("vera_wallet_disconnected") !== "true") {
            try {
                const accounts = await window.ethereum.request({ method: "eth_accounts" });
                if (accounts && accounts.length > 0) {
                    await this.connectWallet();
                }
            } catch (err) {
                console.warn("Auto wallet connection check skipped:", err);
            }
        }
    }

    initAddressInputs() {
        const cfgVault = document.getElementById("cfgVault");
        const cfgQueue = document.getElementById("cfgQueue");
        const cfgUsdc = document.getElementById("cfgUsdc");
        const cfgCompliance = document.getElementById("cfgCompliance");
        const cfgVerifier = document.getElementById("cfgVerifier");

        if (cfgVault) cfgVault.value = CONTRACT_ADDRESSES.vault;
        if (cfgQueue) cfgQueue.value = CONTRACT_ADDRESSES.epochQueue;
        if (cfgUsdc) cfgUsdc.value = CONTRACT_ADDRESSES.usdc;
        if (cfgCompliance) cfgCompliance.value = CONTRACT_ADDRESSES.compliance;
        if (cfgVerifier) cfgVerifier.value = CONTRACT_ADDRESSES.verifier;
    }

    // ------------------------------------------------------------------------
    // Event Listeners
    // ------------------------------------------------------------------------
    setupEventListeners() {
        // Wallet connection & disconnection
        document.getElementById("connectWallet")?.addEventListener("click", () => this.connectWallet());
        
        const handleDisconnect = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            this.disconnectWallet();
        };
        document.getElementById("disconnectBtn")?.addEventListener("click", handleDisconnect);
        document.getElementById("disconnectWallet")?.addEventListener("click", handleDisconnect);

        // Address Config Drawer
        document.getElementById("toggleConfigBtn")?.addEventListener("click", () => {
            const drawer = document.getElementById("configDrawer");
            drawer.classList.toggle("hidden");
        });

        document.getElementById("saveConfigBtn")?.addEventListener("click", () => this.saveAddressConfig());
        document.getElementById("resetConfigBtn")?.addEventListener("click", () => this.resetAddressConfig());

        // Developer tools (Faucet & KYC toggle)
        document.getElementById("faucetBtn")?.addEventListener("click", () => this.mintFaucetUSDC());
        document.getElementById("toggleKycBtn")?.addEventListener("click", () => this.toggleCompliance());

        // Core Vault actions
        document.getElementById("depositBtn")?.addEventListener("click", () => this.handleDeposit());
        document.getElementById("withdrawBtn")?.addEventListener("click", () => this.handleRedeemOrWithdraw());

        // Tabs: Redeem shares vs Withdraw assets
        const tabRedeem = document.getElementById("tabRedeem");
        const tabWithdraw = document.getElementById("tabWithdraw");

        tabRedeem?.addEventListener("click", () => {
            this.activeRedeemMode = "redeem";
            tabRedeem.classList.add("active");
            tabWithdraw.classList.remove("active");
            document.getElementById("withdrawInputLabel").textContent = "Redeem Share Amount";
            document.getElementById("withdrawSymbol").textContent = "VERA";
            document.getElementById("withdrawAmount").placeholder = "0.00";
            document.getElementById("withdrawBtn").textContent = "Enqueue Redemption (VERA Shares)";
        });

        tabWithdraw?.addEventListener("click", () => {
            this.activeRedeemMode = "withdraw";
            tabWithdraw.classList.add("active");
            tabRedeem.classList.remove("active");
            document.getElementById("withdrawInputLabel").textContent = "Withdraw Asset Amount";
            document.getElementById("withdrawSymbol").textContent = "USDC";
            document.getElementById("withdrawAmount").placeholder = "0.00";
            document.getElementById("withdrawBtn").textContent = "Enqueue Withdrawal (USDC Assets)";
        });

        // Quick Percentage buttons (25%, 50%, 100%)
        document.querySelectorAll(".pct-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const targetId = e.target.dataset.target;
                const pct = parseInt(e.target.dataset.pct, 10);
                this.applyPercentageInput(targetId, pct);
            });
        });

        // Dynamic deposit preview calculation
        document.getElementById("depositAmount")?.addEventListener("input", async (e) => {
            const valStr = e.target.value.trim();
            const amount = parseFloat(valStr) || 0;
            const previewEl = document.getElementById("depositPreviewShares");
            if (!previewEl) return;
            if (amount <= 0) {
                previewEl.textContent = "0.00 VERA";
                return;
            }
            if (this.isLiveWeb3 && this.contracts.vault) {
                try {
                    const parsed = ethers.parseUnits(valStr, 6);
                    const shares = await this.contracts.vault.previewDeposit(parsed);
                    previewEl.textContent = `${this.formatNumber(ethers.formatUnits(shares, 6))} VERA`;
                    return;
                } catch (err) {
                    // Fall back to local calculation
                }
            }
            const sharePrice = this.calculateSharePrice();
            const expectedShares = sharePrice > 0 ? (amount / sharePrice).toFixed(4) : amount.toFixed(4);
            previewEl.textContent = `${expectedShares} VERA`;
        });

        // ZK Valuation inputs & real-time Circuit Breaker deviation meter
        document.getElementById("newNAV")?.addEventListener("input", () => this.updateZKSimulatorPreview());
        document.getElementById("updateValuationBtn")?.addEventListener("click", () => this.handleUpdateValuation());

        // Admin Epoch Settlement & Pausing
        document.getElementById("processEpochBtn")?.addEventListener("click", () => this.handleProcessEpoch());
        document.getElementById("pauseBtn")?.addEventListener("click", () => this.handlePauseVault(true));
        document.getElementById("unpauseBtn")?.addEventListener("click", () => this.handlePauseVault(false));

        // Queue claim delegation
        document.getElementById("withdrawalQueue")?.addEventListener("click", (e) => {
            const btn = e.target.closest(".claim-btn");
            if (btn) {
                const reqId = parseInt(btn.dataset.requestId, 10);
                this.handleClaim(reqId);
            }
        });

        // MetaMask chain/account listeners
        if (window.ethereum) {
            window.ethereum.on("accountsChanged", (accounts) => {
                if (accounts.length === 0) {
                    this.disconnectWallet();
                } else {
                    this.userAddress = accounts[0];
                    this.currentAccount = accounts[0];
                    this.updateWalletUI();
                    this.refreshBlockchainData();
                }
            });

            window.ethereum.on("chainChanged", () => {
                window.location.reload();
            });
        }
    }

    // ------------------------------------------------------------------------
    // Wallet & Web3 Management
    // ------------------------------------------------------------------------
    async connectWallet() {
        sessionStorage.removeItem("vera_wallet_disconnected");
        if (!window.ethereum) {
            this.showNotification("MetaMask not detected. Running in Interactive Simulation Mode.", "warning");
            this.userAddress = "0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496";
            this.currentAccount = this.userAddress;
            this.updateWalletUI();
            this.updateUI();
            return;
        }

        try {
            this.provider = new ethers.BrowserProvider(window.ethereum);
            const accounts = await this.provider.send("eth_requestAccounts", []);
            this.signer = await this.provider.getSigner();
            this.userAddress = accounts[0];
            this.currentAccount = accounts[0];

            const network = await this.provider.getNetwork();
            this.chainId = Number(network.chainId);

            // Verify if contracts are deployed at configured addresses
            await this.detectLiveContracts();

            this.updateWalletUI();
            this.showNotification(
                this.isLiveWeb3 
                    ? `Connected to on-chain contracts on Chain ID ${this.chainId}!` 
                    : `Connected as ${this.formatAddress(this.userAddress)} (Simulation Mode - Deploy contracts to enable full Web3 execution)`,
                "success"
            );

            this.updateUI();
            this.startPolling();
        } catch (error) {
            console.error("Wallet connection error:", error);
            this.showNotification("Failed to connect wallet: " + (error.shortMessage || error.message), "error");
        }
    }

    disconnectWallet() {
        sessionStorage.setItem("vera_wallet_disconnected", "true");
        this.userAddress = null;
        this.currentAccount = null;
        this.provider = null;
        this.signer = null;
        this.isLiveWeb3 = false;
        this.contracts = {};
        this.stopPolling();

        // Reset balances, shares, and tickets in state
        this.state.userUsdcBalance = 0n;
        this.state.userVaultShares = 0n;
        this.state.isCompliant = false;
        this.state.requests = [];

        // Clear active form inputs
        const depInput = document.getElementById("depositAmount");
        if (depInput) depInput.value = "";
        const depPreview = document.getElementById("depositPreviewShares");
        if (depPreview) depPreview.textContent = "0.00 VERA";

        const withInput = document.getElementById("withdrawAmount");
        if (withInput) withInput.value = "";

        this.updateWalletUI();
        this.updateUI();
        this.showNotification("Wallet disconnected. State and balances reset.", "info");
    }

    async detectLiveContracts() {
        try {
            const vaultCode = await this.provider.getCode(CONTRACT_ADDRESSES.vault);
            if (vaultCode && vaultCode !== "0x" && vaultCode !== "0x0") {
                // Live contracts exist on chain!
                this.contracts.vault = new ethers.Contract(CONTRACT_ADDRESSES.vault, VAULT_ABI, this.signer);
                this.contracts.epochQueue = new ethers.Contract(CONTRACT_ADDRESSES.epochQueue, EPOCH_QUEUE_ABI, this.signer);
                this.contracts.usdc = new ethers.Contract(CONTRACT_ADDRESSES.usdc, USDC_ABI, this.signer);
                this.contracts.compliance = new ethers.Contract(CONTRACT_ADDRESSES.compliance, COMPLIANCE_ABI, this.signer);
                this.isLiveWeb3 = true;
                await this.refreshBlockchainData();
            } else {
                this.isLiveWeb3 = false;
            }
        } catch (e) {
            console.warn("Could not reach on-chain contracts, continuing in simulation mode:", e);
            this.isLiveWeb3 = false;
        }
    }

    updateWalletUI() {
        const connectBtn = document.getElementById("connectWallet");
        const walletInfo = document.getElementById("walletInfo");
        const walletAddress = document.getElementById("walletAddress");
        const headerBal = document.getElementById("headerUsdcBal");
        const modeBadge = document.getElementById("appModeBadge");
        const modeText = document.getElementById("appModeText");

        const activeAccount = this.currentAccount || this.userAddress;

        if (activeAccount) {
            connectBtn?.classList.add("hidden");
            walletInfo?.classList.remove("hidden");
            if (walletAddress) walletAddress.textContent = this.formatAddress(activeAccount);
            if (headerBal) {
                const usdcFmt = ethers.formatUnits(this.state.userUsdcBalance, 6);
                headerBal.textContent = `${this.formatNumber(usdcFmt)} USDC`;
            }
        } else {
            connectBtn?.classList.remove("hidden");
            walletInfo?.classList.add("hidden");
            if (walletAddress) walletAddress.textContent = "0x00...000";
            if (headerBal) headerBal.textContent = "0.00 USDC";
        }

        if (modeBadge && modeText) {
            if (this.isLiveWeb3 && activeAccount) {
                modeText.textContent = `Live Web3 (Chain ${this.chainId})`;
                modeBadge.style.borderColor = "rgba(16, 185, 129, 0.4)";
                modeBadge.style.color = "#34d399";
            } else if (activeAccount) {
                modeText.textContent = "Simulation Mode";
                modeBadge.style.borderColor = "rgba(99, 102, 241, 0.3)";
                modeBadge.style.color = "#c7d2fe";
            } else {
                modeText.textContent = "Not Connected";
                modeBadge.style.borderColor = "rgba(156, 163, 175, 0.3)";
                modeBadge.style.color = "#9ca3af";
            }
        }
    }

    // ------------------------------------------------------------------------
    // Address Configuration Management
    // ------------------------------------------------------------------------
    saveAddressConfig() {
        CONTRACT_ADDRESSES.vault = document.getElementById("cfgVault").value.trim();
        CONTRACT_ADDRESSES.epochQueue = document.getElementById("cfgQueue").value.trim();
        CONTRACT_ADDRESSES.usdc = document.getElementById("cfgUsdc").value.trim();
        CONTRACT_ADDRESSES.compliance = document.getElementById("cfgCompliance").value.trim();
        CONTRACT_ADDRESSES.verifier = document.getElementById("cfgVerifier").value.trim();

        document.getElementById("configDrawer").classList.add("hidden");
        this.showNotification("Contract addresses updated! Re-evaluating connection...", "info");

        if (this.provider) {
            this.detectLiveContracts().then(() => this.updateUI());
        } else {
            this.updateUI();
        }
    }

    resetAddressConfig() {
        CONTRACT_ADDRESSES.vault = "0x3615383F786427E9f8709DCEd092517E682642B7";
        CONTRACT_ADDRESSES.epochQueue = "0x221b4b625f92C11E8FED1aEf6EfbfB508b96934f";
        CONTRACT_ADDRESSES.usdc = "0xAaC468B927c2DfC39A151cD453aC92Ef16652f9B";
        CONTRACT_ADDRESSES.compliance = "0xdC119f1a1d9DA01083573B928e8DcE00bEd965Bc";
        CONTRACT_ADDRESSES.verifier = "0x24CCB4f4c7C8a34686eF5aA93F2fBcFF1595983C";

        this.initAddressInputs();
        this.showNotification("Reset contract addresses to defaults.", "info");
    }

    // ------------------------------------------------------------------------
    // Developer & Sandbox Tools
    // ------------------------------------------------------------------------
    async mintFaucetUSDC() {
        const faucetAmount = ethers.parseUnits("10000", 6);
        if (this.isLiveWeb3 && this.contracts.usdc) {
            try {
                this.showNotification("Submitting faucet transaction...", "info");
                // Attempt standard mint or transfer if supported
                const tx = await this.contracts.usdc.transfer(this.userAddress, faucetAmount);
                await tx.wait();
                this.showNotification("Transferred 10,000 USDC to your wallet!", "success");
                await this.refreshBlockchainData();
                return;
            } catch (err) {
                console.warn("Live faucet transfer failed, updating simulation balance:", err);
            }
        }

        // Simulation Mode fallback
        this.state.userUsdcBalance += faucetAmount;
        this.updateUI();
        this.showNotification("Minted 10,000.00 USDC in simulation wallet!", "success");
    }

    async toggleCompliance() {
        const targetAddress = this.userAddress || "0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496";
        const newStatus = !this.state.isCompliant;

        if (this.isLiveWeb3 && this.contracts.compliance) {
            try {
                this.showNotification(`Setting compliance on-chain for ${this.formatAddress(targetAddress)} to ${newStatus}...`, "info");
                const tx = await this.contracts.compliance.setCompliance(targetAddress, newStatus);
                await tx.wait();
                this.showNotification(`On-chain compliance updated: ${newStatus ? "COMPLIANT" : "RESTRICTED"}`, "success");
                await this.refreshBlockchainData();
                return;
            } catch (err) {
                console.warn("On-chain setCompliance failed (may require contract owner):", err);
                this.showNotification("On-chain compliance call failed (only owner can modify whitelist). Toggled in simulator.", "warning");
            }
        }

        this.state.isCompliant = newStatus;
        this.updateUI();
        this.showNotification(`Wallet compliance set to: ${newStatus ? "COMPLIANT (Whitelisted)" : "NON-COMPLIANT (Blocked)"}`, newStatus ? "success" : "warning");
    }

    applyPercentageInput(targetId, pct) {
        let maxVal = 0;
        if (targetId === "depositAmount") {
            maxVal = parseFloat(ethers.formatUnits(this.state.userUsdcBalance, 6));
        } else if (targetId === "withdrawAmount") {
            if (this.activeRedeemMode === "redeem") {
                maxVal = parseFloat(ethers.formatUnits(this.state.userVaultShares, 6));
            } else {
                const sharePrice = this.calculateSharePrice();
                const totalAssetValue = parseFloat(ethers.formatUnits(this.state.userVaultShares, 6)) * sharePrice;
                maxVal = totalAssetValue;
            }
        }

        const calculated = (maxVal * (pct / 100)).toFixed(2);
        const input = document.getElementById(targetId);
        if (input) {
            input.value = calculated > 0 ? calculated : "";
            input.dispatchEvent(new Event("input"));
        }
    }

    // ------------------------------------------------------------------------
    // Core Vault Flows (Deposit & Redeem/Withdraw)
    // ------------------------------------------------------------------------
    async handleDeposit() {
        const input = document.getElementById("depositAmount");
        const valStr = input?.value.trim();
        if (!valStr || parseFloat(valStr) <= 0) {
            this.showNotification("Please specify a valid deposit amount.", "error");
            return;
        }

        if (!this.state.isCompliant) {
            this.showNotification("Regulatory Error: Address is not compliant (Whitelisting required by AssetToken).", "error");
            return;
        }

        if (this.state.paused) {
            this.showNotification("Vault Paused: Deposits are temporarily frozen.", "error");
            return;
        }

        const amount = ethers.parseUnits(valStr, 6);
        if (amount > this.state.userUsdcBalance) {
            this.showNotification("Insufficient USDC balance.", "error");
            return;
        }

        try {
            if (this.isLiveWeb3 && this.contracts.vault && this.contracts.usdc) {
                this.showNotification("Checking USDC allowance...", "info");
                const allowance = await this.contracts.usdc.allowance(this.userAddress, CONTRACT_ADDRESSES.vault);
                if (allowance < amount) {
                    this.showNotification("Approving USDC spend for VERAVault...", "info");
                    const approveTx = await this.contracts.usdc.approve(CONTRACT_ADDRESSES.vault, ethers.MaxUint256);
                    await approveTx.wait();
                }

                this.showNotification("Executing deposit on VERAVault...", "info");
                const depositTx = await this.contracts.vault.deposit(amount, this.userAddress);
                await depositTx.wait();

                this.showNotification(`Successfully deposited ${valStr} USDC on-chain!`, "success");
                input.value = "";
                await this.refreshBlockchainData();
                return;
            }

            // Simulator Deposit Flow
            const sharePrice = this.calculateSharePrice();
            const sharesToMint = ethers.parseUnits((parseFloat(valStr) / sharePrice).toFixed(6), 6);

            this.state.userUsdcBalance -= amount;
            this.state.liquidReserve += amount;
            this.state.totalAssets += amount;
            this.state.userVaultShares += sharesToMint;
            this.state.totalSupply += sharesToMint;

            input.value = "";
            document.getElementById("depositPreviewShares").textContent = "0.00 VERA";
            this.showNotification(`Successfully deposited ${valStr} USDC and minted ${ethers.formatUnits(sharesToMint, 6)} VERA shares!`, "success");
            this.updateUI();
        } catch (error) {
            console.error("Deposit execution error:", error);
            this.showNotification("Deposit failed: " + (error.shortMessage || error.message), "error");
        }
    }

    async handleRedeemOrWithdraw() {
        const input = document.getElementById("withdrawAmount");
        const valStr = input?.value.trim();
        if (!valStr || parseFloat(valStr) <= 0) {
            this.showNotification("Please enter an amount to exit.", "error");
            return;
        }

        if (this.state.paused) {
            this.showNotification("Vault Paused: Withdrawals and redemptions are paused.", "error");
            return;
        }

        const inputVal = ethers.parseUnits(valStr, 6);
        let sharesToBurn;
        let requestedAssetsPreview;

        if (this.activeRedeemMode === "redeem") {
            sharesToBurn = inputVal;
            if (sharesToBurn > this.state.userVaultShares) {
                this.showNotification("Insufficient VERA shares.", "error");
                return;
            }
            requestedAssetsPreview = (parseFloat(valStr) * this.calculateSharePrice()).toFixed(2);
        } else {
            // Withdraw by USDC assets requested
            const sharePrice = this.calculateSharePrice();
            sharesToBurn = ethers.parseUnits((parseFloat(valStr) / sharePrice).toFixed(6), 6);
            if (sharesToBurn > this.state.userVaultShares) {
                this.showNotification("Requested withdrawal amount exceeds your available share balance value.", "error");
                return;
            }
            requestedAssetsPreview = valStr;
        }

        try {
            const userAddr = this.userAddress || "0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496";

            if (this.isLiveWeb3 && this.contracts.vault) {
                this.showNotification(
                    this.activeRedeemMode === "redeem"
                        ? `Calling vault.redeem(${ethers.formatUnits(sharesToBurn, 6)} shares)...`
                        : `Calling vault.withdraw(${valStr} USDC)...`,
                    "info"
                );

                // Note: user burning their own shares requires NO allowance (caller == owner)
                let tx;
                if (this.activeRedeemMode === "redeem") {
                    tx = await this.contracts.vault.redeem(sharesToBurn, userAddr, userAddr);
                } else {
                    tx = await this.contracts.vault.withdraw(inputVal, userAddr, userAddr);
                }
                await tx.wait();

                this.showNotification("Redemption request enqueued in EpochQueue on-chain!", "success");
                input.value = "";
                await this.refreshBlockchainData();
                return;
            }

            // Simulator Async Exit Flow
            this.state.userVaultShares -= sharesToBurn;
            this.state.totalSupply -= sharesToBurn;

            // Enqueue ticket into EpochQueue for current epoch
            const newReqId = this.state.nextRequestId++;
            const currentEp = this.state.currentEpoch;

            this.state.requests.unshift({
                id: newReqId,
                user: userAddr,
                shares: sharesToBurn,
                epochRequested: currentEp,
                claimed: false
            });

            // Update epoch shares queued
            this.state.epochTotalShares[currentEp] = (this.state.epochTotalShares[currentEp] || 0n) + sharesToBurn;

            input.value = "";
            this.showNotification(
                `Redemption request #${newReqId} enqueued for Epoch ${currentEp}! (~${requestedAssetsPreview} USDC equivalent queued)`,
                "success"
            );
            this.updateUI();
        } catch (error) {
            console.error("Redemption error:", error);
            this.showNotification("Redemption request failed: " + (error.shortMessage || error.message), "error");
        }
    }

    // ------------------------------------------------------------------------
    // Claiming from EpochQueue
    // ------------------------------------------------------------------------
    async handleClaim(requestId) {
        try {
            const req = this.state.requests.find(r => r.id === requestId);
            if (!req) return;

            if (req.claimed) {
                this.showNotification("This ticket has already been claimed.", "warning");
                return;
            }

            const epochId = req.epochRequested;
            const allocatedLiquidity = this.state.epochAllocatedLiquidity[epochId] || 0n;

            if (allocatedLiquidity === 0n) {
                this.showNotification(`Epoch ${epochId} has not been processed with liquidity yet.`, "error");
                return;
            }

            if (this.isLiveWeb3 && this.contracts.epochQueue) {
                this.showNotification(`Claiming ticket #${requestId} on-chain...`, "info");
                const tx = await this.contracts.epochQueue.claim(requestId);
                await tx.wait();
                this.showNotification(`Ticket #${requestId} claimed successfully!`, "success");
                await this.refreshBlockchainData();
                return;
            }

            // Simulator Claim Calculation: (shares * allocatedLiquidity) / totalSharesInEpoch
            const totalSharesInEpoch = this.state.epochTotalShares[epochId] || req.shares;
            const payout = (req.shares * allocatedLiquidity) / totalSharesInEpoch;

            req.claimed = true;
            this.state.userUsdcBalance += payout;

            const payoutStr = ethers.formatUnits(payout, 6);
            this.showNotification(`Successfully claimed ${payoutStr} USDC for ticket #${requestId}!`, "success");
            this.updateUI();
        } catch (error) {
            console.error("Claim error:", error);
            this.showNotification("Claim failed: " + (error.shortMessage || error.message), "error");
        }
    }

    // ------------------------------------------------------------------------
    // ZK-ML Valuation Simulator & Circuit Breaker Logic
    // ------------------------------------------------------------------------
    updateZKSimulatorPreview() {
        const navInput = document.getElementById("newNAV");
        const epochInput = document.getElementById("newEpoch");
        const deltaText = document.getElementById("deltaBpsText");
        const meterBar = document.getElementById("meterBar");
        const proofHashDisplay = document.getElementById("proofBindingHashDisplay");
        const circuitNotice = document.getElementById("circuitBreakerNotice");

        if (epochInput && !epochInput.value) {
            epochInput.value = this.state.currentEpoch + 1;
        }

        const newNavStr = navInput?.value.trim();
        const currentNavNum = parseFloat(ethers.formatUnits(this.state.currentNAV, 6)) || 50000;
        const newNavNum = parseFloat(newNavStr) || currentNavNum;

        const deltaPct = ((newNavNum - currentNavNum) / currentNavNum) * 100;
        const deltaBps = Math.round(Math.abs(deltaPct) * 100);

        if (deltaText) {
            const sign = deltaPct >= 0 ? "+" : "";
            deltaText.textContent = `${sign}${deltaPct.toFixed(2)}% (${sign}${deltaBps} bps)`;
        }

        const fillWidth = Math.min((deltaBps / 1000) * 100, 100);
        if (meterBar) {
            meterBar.style.width = `${fillWidth}%`;
            if (deltaBps > this.MAX_NAV_DELTA_BPS) {
                meterBar.style.backgroundColor = "var(--danger)";
            } else if (deltaBps > 300) {
                meterBar.style.backgroundColor = "var(--warning)";
            } else {
                meterBar.style.backgroundColor = "var(--success)";
            }
        }

        if (circuitNotice) {
            if (deltaBps > this.MAX_NAV_DELTA_BPS) {
                circuitNotice.textContent = "⚠️ CIRCUIT BREAKER WILL TRIGGER (> 5.00% Deviation)";
                circuitNotice.className = "proof-v text-danger";
            } else {
                circuitNotice.textContent = "Safe: Within Monotonic Circuit Bounds (≤ 5.00%)";
                circuitNotice.className = "proof-v text-success";
            }
        }

        // Simulate Proof Binding Hash: keccak256(vaultAddress, epochId, chainId, targetNAV)
        try {
            const targetEpoch = parseInt(epochInput?.value, 10) || (this.state.currentEpoch + 1);
            const targetNavWei = ethers.parseUnits(newNavNum.toString(), 6);
            const vaultAddr = CONTRACT_ADDRESSES.vault;

            const bindingHash = ethers.solidityPackedKeccak256(
                ["address", "uint256", "uint256", "uint256"],
                [vaultAddr, targetEpoch, this.chainId, targetNavWei]
            );

            if (proofHashDisplay) {
                proofHashDisplay.textContent = bindingHash;
            }
        } catch (e) {
            if (proofHashDisplay) proofHashDisplay.textContent = "0x...";
        }
    }

    async handleUpdateValuation() {
        const navInput = document.getElementById("newNAV");
        const epochInput = document.getElementById("newEpoch");
        const newNavStr = navInput?.value.trim();
        const newEpochStr = epochInput?.value.trim();

        if (!newNavStr || parseFloat(newNavStr) <= 0) {
            this.showNotification("Please provide a valid NAV amount.", "error");
            return;
        }

        const newEpochId = parseInt(newEpochStr, 10);
        if (newEpochId !== this.state.currentEpoch + 1) {
            this.showNotification(`InvalidEpoch: Epoch sequencing must be strictly sequential (Must be ${this.state.currentEpoch + 1})`, "error");
            return;
        }

        const currentNavNum = parseFloat(ethers.formatUnits(this.state.currentNAV, 6));
        const newNavNum = parseFloat(newNavStr);
        const deltaBps = Math.round(Math.abs(((newNavNum - currentNavNum) / currentNavNum) * 10000));

        // Circuit Breaker Check
        if (deltaBps > this.MAX_NAV_DELTA_BPS) {
            this.state.paused = true;
            this.updateUI();
            this.showNotification(
                `🚨 CIRCUIT BREAKER TRIGGERED! NAV delta of ${(deltaBps / 100).toFixed(2)}% exceeds 5.00% max threshold. Vault has been PAUSED to protect protocol solvency!`,
                "error"
            );
            return;
        }

        try {
            const newNavWei = ethers.parseUnits(newNavStr, 6);

            if (this.isLiveWeb3 && this.contracts.vault) {
                this.showNotification("Generating simulated Groth16 proof binding on-chain...", "info");
                
                const bindingHash = ethers.solidityPackedKeccak256(
                    ["address", "uint256", "uint256", "uint256"],
                    [CONTRACT_ADDRESSES.vault, newEpochId, this.chainId, newNavWei]
                );
                const blockNum = await this.provider.getBlockNumber();

                const tx = await this.contracts.vault.updateValuationWithProof(
                    bindingHash,
                    newNavWei,
                    newEpochId,
                    blockNum
                );
                await tx.wait();

                this.showNotification(`Valuation updated on-chain for Epoch ${newEpochId}!`, "success");
                navInput.value = "";
                await this.refreshBlockchainData();
                return;
            }

            // Simulator Update
            this.state.currentNAV = newNavWei;
            this.state.currentEpoch = newEpochId;
            this.state.totalAssets = this.state.liquidReserve + newNavWei;

            navInput.value = "";
            epochInput.value = this.state.currentEpoch + 1;

            this.showNotification(`Valuation successfully updated to ${newNavStr} USDC for Epoch ${newEpochId}!`, "success");
            this.updateZKSimulatorPreview();
            this.updateUI();
        } catch (error) {
            console.error("Valuation update failed:", error);
            this.showNotification("Valuation update failed: " + (error.shortMessage || error.message), "error");
        }
    }

    // ------------------------------------------------------------------------
    // Admin Controls
    // ------------------------------------------------------------------------
    async handleProcessEpoch() {
        const epInput = document.getElementById("epochProcessId");
        const liqInput = document.getElementById("availableLiquidity");

        const epochId = parseInt(epInput?.value.trim(), 10);
        const liquidityStr = liqInput?.value.trim();

        if (isNaN(epochId) || epochId < 0) {
            this.showNotification("Please specify a valid epoch ID to settle.", "error");
            return;
        }

        if (!liquidityStr || parseFloat(liquidityStr) <= 0) {
            this.showNotification("Please specify the available liquidity to return.", "error");
            return;
        }

        const liquidityWei = ethers.parseUnits(liquidityStr, 6);

        try {
            if (this.isLiveWeb3 && this.contracts.epochQueue) {
                this.showNotification(`Calling epochQueue.processEpoch(${epochId}, ${liquidityStr} USDC)...`, "info");
                const tx = await this.contracts.epochQueue.processEpoch(epochId, liquidityWei);
                await tx.wait();

                this.showNotification(`Epoch ${epochId} settled with ${liquidityStr} USDC liquidity!`, "success");
                epInput.value = "";
                liqInput.value = "";
                await this.refreshBlockchainData();
                return;
            }

            // Simulator Processing
            this.state.epochAllocatedLiquidity[epochId] = liquidityWei;
            epInput.value = "";
            liqInput.value = "";

            this.showNotification(
                `Epoch ${epochId} settled! Allocated ${liquidityStr} USDC liquidity to EpochQueue. Eligible tickets can now be claimed.`,
                "success"
            );
            this.updateUI();
        } catch (error) {
            console.error("Epoch processing error:", error);
            this.showNotification("Epoch settlement failed: " + (error.shortMessage || error.message), "error");
        }
    }

    async handlePauseVault(freeze) {
        try {
            if (this.isLiveWeb3 && this.contracts.vault) {
                this.showNotification(freeze ? "Pausing vault on-chain..." : "Unpausing vault on-chain...", "info");
                const tx = freeze ? await this.contracts.vault.pause() : await this.contracts.vault.unpause();
                await tx.wait();
                this.showNotification(freeze ? "Vault paused on-chain!" : "Vault unpaused on-chain!", "success");
                await this.refreshBlockchainData();
                return;
            }

            this.state.paused = freeze;
            this.updateUI();
            this.showNotification(
                freeze ? "Vault operation PAUSED (Deposits and Withdrawals frozen)" : "Vault resumed (ACTIVE)",
                freeze ? "warning" : "success"
            );
        } catch (error) {
            console.error("Pause toggle error:", error);
            this.showNotification("Failed to toggle pause status: " + (error.shortMessage || error.message), "error");
        }
    }

    // ------------------------------------------------------------------------
    // UI Rendering & Dashboard Sync
    // ------------------------------------------------------------------------
    calculateSharePrice() {
        const totalA = parseFloat(ethers.formatUnits(this.state.totalAssets, 6));
        const totalS = parseFloat(ethers.formatUnits(this.state.totalSupply, 6));
        if (totalS <= 0 || totalA <= 0) return 1.0;
        return totalA / totalS;
    }

    updateUI() {
        // Metrics
        const navFmt = ethers.formatUnits(this.state.currentNAV, 6);
        const liquidFmt = ethers.formatUnits(this.state.liquidReserve, 6);
        const totalAssetsFmt = ethers.formatUnits(this.state.totalAssets, 6);
        const totalSharesFmt = ethers.formatUnits(this.state.totalSupply, 6);
        const sharePriceNum = this.calculateSharePrice();

        const currentNavEl = document.getElementById("currentNAV");
        const currentEpochEl = document.getElementById("currentEpoch");
        const liquidReserveEl = document.getElementById("liquidReserve");
        const totalAssetsEl = document.getElementById("totalAssets");
        const totalSupplyEl = document.getElementById("totalSupply");
        const sharePriceEl = document.getElementById("sharePrice");
        const vaultStatusEl = document.getElementById("vaultStatus");

        if (currentNavEl) currentNavEl.textContent = `${this.formatNumber(navFmt)} USDC`;
        if (currentEpochEl) currentEpochEl.textContent = this.state.currentEpoch;
        if (liquidReserveEl) liquidReserveEl.textContent = `${this.formatNumber(liquidFmt)} USDC`;
        if (totalAssetsEl) totalAssetsEl.textContent = `${this.formatNumber(totalAssetsFmt)} USDC`;
        if (totalSupplyEl) totalSupplyEl.textContent = `${this.formatNumber(totalSharesFmt)} VERA`;
        if (sharePriceEl) sharePriceEl.textContent = `${sharePriceNum.toFixed(4)} USDC`;

        if (vaultStatusEl) {
            if (this.state.paused) {
                vaultStatusEl.textContent = "Paused";
                vaultStatusEl.className = "status-pill status-paused";
            } else {
                vaultStatusEl.textContent = "Active";
                vaultStatusEl.className = "status-pill status-active";
            }
        }

        // Balances
        const usdcBalFmt = ethers.formatUnits(this.state.userUsdcBalance, 6);
        const vSharesFmt = ethers.formatUnits(this.state.userVaultShares, 6);

        const usdcBalEl = document.getElementById("usdcBalance");
        const vaultSharesEl = document.getElementById("vaultShares");
        const headerBalEl = document.getElementById("headerUsdcBal");

        if (usdcBalEl) usdcBalEl.textContent = `${this.formatNumber(usdcBalFmt)} USDC`;
        if (vaultSharesEl) vaultSharesEl.textContent = `${this.formatNumber(vSharesFmt)} VERA`;
        if (headerBalEl) headerBalEl.textContent = `${this.formatNumber(usdcBalFmt)} USDC`;

        // Compliance status badge
        const complianceEl = document.getElementById("complianceStatus");
        if (complianceEl) {
            const activeAccount = this.currentAccount || this.userAddress;
            if (activeAccount) {
                if (this.state.isCompliant) {
                    complianceEl.textContent = "✓ Compliant (Whitelisted)";
                    complianceEl.className = "user-compliance-badge status-compliant";
                } else {
                    complianceEl.textContent = "✕ Restricted (Not Whitelisted)";
                    complianceEl.className = "user-compliance-badge status-non-compliant";
                }
            } else {
                complianceEl.textContent = "✕ Restricted (Not Connected)";
                complianceEl.className = "user-compliance-badge status-non-compliant";
            }
        }

        // Target Epoch in withdrawal card
        const targetEpochLabel = document.getElementById("targetEpochLabel");
        if (targetEpochLabel) targetEpochLabel.textContent = this.state.currentEpoch;

        // Render queue list
        this.renderQueueTickets();
    }

    renderQueueTickets() {
        const queueContainer = document.getElementById("withdrawalQueue");
        const counterEl = document.getElementById("pendingRequests");
        if (!queueContainer) return;

        const tickets = this.state.requests || [];
        if (counterEl) counterEl.textContent = tickets.length;

        if (tickets.length === 0) {
            queueContainer.innerHTML = '<p class="empty-state">No redemption tickets found.</p>';
            return;
        }

        queueContainer.innerHTML = tickets.map(req => {
            const sharesFmt = this.formatNumber(ethers.formatUnits(req.shares, 6));
            const epochId = req.epochRequested;
            const allocated = this.state.epochAllocatedLiquidity[epochId] || 0n;
            const totalSharesInEpoch = this.state.epochTotalShares[epochId] || req.shares;

            let statusHtml = "";
            let actionHtml = "";
            let itemClass = "queue-item";

            if (req.claimed) {
                itemClass += " status-claimed";
                statusHtml = '<span class="queue-badge badge-claimed">Claimed</span>';
            } else if (allocated > 0n) {
                itemClass += " status-claimable";
                statusHtml = '<span class="queue-badge badge-claimable">Liquidity Allocated</span>';
                
                // Calculate pro-rata claimable USDC
                const claimableWei = (req.shares * allocated) / totalSharesInEpoch;
                const claimableFmt = this.formatNumber(ethers.formatUnits(claimableWei, 6));

                actionHtml = `
                    <div class="queue-action">
                        <span class="queue-claimable-amount">+${claimableFmt} USDC</span>
                        <button class="btn btn-success btn-sm claim-btn" data-request-id="${req.id}">
                            Claim USDC
                        </button>
                    </div>
                `;
            } else if (epochId === this.state.currentEpoch) {
                itemClass += " status-pending";
                statusHtml = '<span class="queue-badge badge-pending">Active Epoch</span>';
            } else {
                itemClass += " status-pending";
                statusHtml = '<span class="queue-badge badge-pending">Awaiting Settlement</span>';
            }

            return `
                <div class="${itemClass}">
                    <div class="queue-main-info">
                        <div class="queue-title-row">
                            <span class="queue-id">Ticket #${req.id}</span>
                            ${statusHtml}
                        </div>
                        <div class="queue-details">
                            <strong>${sharesFmt} VERA</strong> • Requested in Epoch ${epochId}
                        </div>
                    </div>
                    ${actionHtml}
                </div>
            `;
        }).join("");
    }

    async refreshBlockchainData() {
        if (!this.isLiveWeb3 || !this.contracts.vault) return;

        try {
            const [
                nav,
                epoch,
                totalA,
                totalS,
                isPaused,
                userUsdc,
                userShares,
                compliant
            ] = await Promise.all([
                this.contracts.vault.currentNAV(),
                this.contracts.vault.currentEpoch(),
                this.contracts.vault.totalAssets(),
                this.contracts.vault.totalSupply(),
                this.contracts.vault.paused(),
                this.contracts.usdc.balanceOf(this.userAddress),
                this.contracts.vault.balanceOf(this.userAddress),
                this.contracts.compliance.isCompliant(this.userAddress)
            ]);

            this.state.currentNAV = nav;
            this.state.currentEpoch = Number(epoch);
            this.state.totalAssets = totalA;
            this.state.totalSupply = totalS;
            this.state.liquidReserve = totalA > nav ? totalA - nav : 0n;
            this.state.paused = isPaused;
            this.state.userUsdcBalance = userUsdc;
            this.state.userVaultShares = userShares;
            this.state.isCompliant = compliant;

            // Synchronize on-chain EpochQueue redemption requests
            if (this.contracts.epochQueue) {
                try {
                    const nextReqId = await this.contracts.epochQueue.nextRequestId();
                    const totalReqs = Number(nextReqId);
                    const fetchedRequests = [];
                    const epochTotalShares = {};
                    const epochAllocatedLiquidity = {};

                    for (let i = 0; i < totalReqs; i++) {
                        const req = await this.contracts.epochQueue.requests(i);
                        const epId = Number(req.epochRequested);
                        fetchedRequests.push({
                            id: i,
                            user: req.user,
                            shares: req.shares,
                            epochRequested: epId,
                            claimed: req.claimed
                        });

                        if (epochTotalShares[epId] === undefined) {
                            epochTotalShares[epId] = await this.contracts.epochQueue.epochTotalShares(epId);
                            epochAllocatedLiquidity[epId] = await this.contracts.epochQueue.epochAllocatedLiquidity(epId);
                        }
                    }

                    fetchedRequests.reverse();
                    this.state.requests = fetchedRequests;
                    this.state.epochTotalShares = epochTotalShares;
                    this.state.epochAllocatedLiquidity = epochAllocatedLiquidity;
                    this.state.nextRequestId = totalReqs;
                } catch (queueErr) {
                    console.warn("Could not sync on-chain queue requests:", queueErr);
                }
            }

            this.updateUI();
        } catch (err) {
            console.warn("Error refreshing on-chain state:", err);
        }
    }

    startPolling() {
        this.stopPolling();
        this.pollingInterval = setInterval(() => {
            if (this.isLiveWeb3) {
                this.refreshBlockchainData();
            }
        }, 5000);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------
    showNotification(message, type = "info") {
        const notif = document.getElementById("notification");
        if (!notif) return;

        notif.textContent = message;
        notif.className = `notification ${type}`;
        notif.classList.remove("hidden");

        clearTimeout(this._notifTimeout);
        this._notifTimeout = setTimeout(() => {
            notif.classList.add("hidden");
        }, 6000);
    }

    formatAddress(addr) {
        if (!addr) return "0x00...000";
        return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
    }

    formatNumber(valStr) {
        const num = parseFloat(valStr);
        if (isNaN(num)) return "0.00";
        return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }
}

// ----------------------------------------------------------------------------
// Bootstrap Application on DOM Ready
// ----------------------------------------------------------------------------
let appInstance;
document.addEventListener("DOMContentLoaded", () => {
    appInstance = new VERAProtocolApp();
    appInstance.init();
});
