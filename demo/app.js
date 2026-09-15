// VERA Protocol Demo - Web3 Interface
// This demo uses Ethers.js v6 and MetaMask for blockchain interaction

class VERAProtocol {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.contracts = {};
        this.userAddress = null;
        this.pollingInterval = null;
        this.MAX_NAV_DELTA_BPS = 500; // 5%
        this.PROOF_DEADLINE = 50; // 50 blocks
    }

    // Initialize the application
    async init() {
        this.setupEventListeners();
        this.checkWalletConnection();
    }

    // Setup event listeners
    setupEventListeners() {
        document.getElementById('connectWallet').addEventListener('click', () => this.connectWallet());
        document.getElementById('disconnectWallet').addEventListener('click', () => this.disconnectWallet());
        document.getElementById('depositBtn').addEventListener('click', () => this.deposit());
        document.getElementById('withdrawBtn').addEventListener('click', () => this.withdraw());
        document.getElementById('updateValuationBtn').addEventListener('click', () => this.updateValuation());
        document.getElementById('processEpochBtn').addEventListener('click', () => this.processEpoch());
        document.getElementById('setEpochBtn').addEventListener('click', () => this.setEpoch());
        document.getElementById('pauseBtn').addEventListener('click', () => this.pauseVault());
        document.getElementById('unpauseBtn').addEventListener('click', () => this.unpauseVault());

        // Event delegation for claim buttons
        document.getElementById('withdrawalQueue').addEventListener('click', (e) => {
            if (e.target.classList.contains('claim-btn')) {
                const requestId = parseInt(e.target.dataset.requestId);
                this.claimWithdrawal(requestId);
            }
        });

        // Listen for account changes
        if (window.ethereum) {
            window.ethereum.on('accountsChanged', (accounts) => {
                if (accounts.length === 0) {
                    this.disconnectWallet();
                } else {
                    this.userAddress = accounts[0];
                    this.updateWalletUI();
                    this.loadUserData();
                }
            });

            window.ethereum.on('chainChanged', () => {
                window.location.reload();
            });
        }
    }

    // Check if wallet is already connected
    async checkWalletConnection() {
        if (window.ethereum) {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts.length > 0) {
                    this.userAddress = accounts[0];
                    this.provider = new ethers.BrowserProvider(window.ethereum);
                    this.signer = await this.provider.getSigner();
                    this.updateWalletUI();
                    await this.loadContracts();
                    this.startPolling();
                }
            } catch (error) {
                console.error('Error checking wallet connection:', error);
            }
        }
    }

    // Connect to MetaMask
    async connectWallet() {
        if (!window.ethereum) {
            this.showNotification('MetaMask not installed. Please install MetaMask to use this demo.', 'error');
            return;
        }

        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            this.userAddress = accounts[0];
            this.provider = new ethers.BrowserProvider(window.ethereum);
            this.signer = await this.provider.getSigner();

            this.updateWalletUI();
            await this.loadContracts();
            this.startPolling();

            this.showNotification('Wallet connected successfully!', 'success');
        } catch (error) {
            console.error('Error connecting wallet:', error);
            this.showNotification('Failed to connect wallet: ' + error.message, 'error');
        }
    }

    // Disconnect wallet
    disconnectWallet() {
        this.userAddress = null;
        this.provider = null;
        this.signer = null;
        this.contracts = {};
        this.stopPolling();
        this.updateWalletUI();
        this.showNotification('Wallet disconnected', 'success');
    }

    // Update wallet UI
    updateWalletUI() {
        const connectBtn = document.getElementById('connectWallet');
        const walletInfo = document.getElementById('walletInfo');
        const walletAddress = document.getElementById('walletAddress');

        if (this.userAddress) {
            connectBtn.classList.add('hidden');
            walletInfo.classList.remove('hidden');
            walletAddress.textContent = `${this.userAddress.substring(0, 6)}...${this.userAddress.substring(38)}`;
        } else {
            connectBtn.classList.remove('hidden');
            walletInfo.classList.add('hidden');
        }
    }

    // Load smart contracts
    async loadContracts() {
        // In a real deployment, these would be the actual deployed contract addresses
        // For demo purposes, we'll use placeholder addresses
        const contractAddresses = {
            vault: '0x0000000000000000000000000000000000000001', // Replace with actual vault address
            usdc: '0x0000000000000000000000000000000000000002', // Replace with actual USDC address
            verifier: '0x0000000000000000000000000000000000000003', // Replace with actual verifier address
            epochQueue: '0x0000000000000000000000000000000000000004' // Replace with actual epoch queue address
        };

        // Contract ABIs (simplified for demo)
        const vaultABI = [
            'function currentNAV() view returns (uint256)',
            'function currentEpoch() view returns (uint256)',
            'function totalAssets() view returns (uint256)',
            'function totalSupply() view returns (uint256)',
            'function balanceOf(address) view returns (uint256)',
            'function paused() view returns (bool)',
            'function deposit(uint256 assets, address receiver) returns (uint256)',
            'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
            'function updateValuationWithProof(bytes proof, uint256 newNAV, uint256 epochId, uint256 proofBlockNumber)',
            'function processEpoch(uint256 epochId, uint256 availableLiquidity)',
            'function setEpochQueueEpoch(uint256 epochId)',
            'function pause()',
            'function unpause()'
        ];

        const usdcABI = [
            'function balanceOf(address) view returns (uint256)',
            'function decimals() view returns (uint8)',
            'function approve(address spender, uint256 amount) returns (bool)',
            'function allowance(address owner, address spender) view returns (uint256)'
        ];

        const epochQueueABI = [
            'function nextRequestId() view returns (uint256)',
            'function currentEpoch() view returns (uint256)',
            'function getRequest(uint256 requestId) view returns (tuple(address user, uint256 shares, uint256 epochRequested, bool claimed))',
            'function claim(uint256 requestId)'
        ];

        try {
            // In demo mode, we'll use mock data since contracts aren't deployed
            this.showNotification('Demo mode: Using mock data since contracts are not deployed', 'warning');
            this.loadMockData();
        } catch (error) {
            console.error('Error loading contracts:', error);
            this.showNotification('Failed to load contracts: ' + error.message, 'error');
        }
    }

    // Load mock data for demo purposes
    loadMockData() {
        this.mockData = {
            currentNAV: ethers.parseUnits('50000', 6), // 50,000 USDC
            currentEpoch: 1,
            liquidReserve: ethers.parseUnits('10000', 6), // 10,000 USDC
            totalAssets: ethers.parseUnits('60000', 6), // 60,000 USDC
            totalSupply: ethers.parseUnits('50000', 6), // 50,000 shares
            paused: false,
            userBalance: ethers.parseUnits('1000', 6), // 1,000 USDC
            userShares: ethers.parseUnits('500', 6), // 500 shares
            isCompliant: true,
            pendingRequests: [
                { id: 0, user: '0x123...456', shares: ethers.parseUnits('100', 6), epoch: 1, claimed: false },
                { id: 1, user: '0x789...012', shares: ethers.parseUnits('50', 6), epoch: 1, claimed: false }
            ]
        };

        this.updateDashboard();
    }

    // Update dashboard with current data
    updateDashboard() {
        if (!this.mockData) return;

        const nav = ethers.formatUnits(this.mockData.currentNAV, 6);
        const epoch = this.mockData.currentEpoch;
        const liquid = ethers.formatUnits(this.mockData.liquidReserve, 6);
        const totalAssets = ethers.formatUnits(this.mockData.totalAssets, 6);
        const totalSupply = ethers.formatUnits(this.mockData.totalSupply, 6);
        const sharePrice = this.mockData.totalSupply > 0
            ? (parseFloat(totalAssets) / parseFloat(totalSupply)).toFixed(6)
            : '1.00';

        document.getElementById('currentNAV').textContent = `${nav} USDC`;
        document.getElementById('currentEpoch').textContent = epoch;
        document.getElementById('liquidReserve').textContent = `${liquid} USDC`;
        document.getElementById('sharePrice').textContent = `${sharePrice} USDC`;
        document.getElementById('totalAssets').textContent = `${totalAssets} USDC`;

        const statusEl = document.getElementById('vaultStatus');
        if (this.mockData.paused) {
            statusEl.textContent = 'Paused';
            statusEl.className = 'value status-paused';
        } else {
            statusEl.textContent = 'Active';
            statusEl.className = 'value status-active';
        }

        // Update user data
        const userBalance = ethers.formatUnits(this.mockData.userBalance, 6);
        const userShares = ethers.formatUnits(this.mockData.userShares, 6);

        document.getElementById('usdcBalance').textContent = `${userBalance} USDC`;
        document.getElementById('vaultShares').textContent = `${userShares} VERA`;

        const complianceEl = document.getElementById('complianceStatus');
        if (this.mockData.isCompliant) {
            complianceEl.textContent = 'Compliant';
            complianceEl.className = 'value status-compliant';
        } else {
            complianceEl.textContent = 'Non-Compliant';
            complianceEl.className = 'value status-non-compliant';
        }

        // Update withdrawal queue
        this.updateWithdrawalQueue();
    }

    // Update withdrawal queue display
    updateWithdrawalQueue() {
        const queueList = document.getElementById('withdrawalQueue');
        const pendingCount = this.mockData.pendingRequests.length;

        document.getElementById('pendingRequests').textContent = pendingCount;

        if (pendingCount === 0) {
            queueList.innerHTML = '<p class="empty-state">No pending withdrawal requests</p>';
            return;
        }

        queueList.innerHTML = this.mockData.pendingRequests.map(req => {
            const shares = ethers.formatUnits(req.shares, 6);
            const isClaimable = !req.claimed && req.epoch < this.mockData.currentEpoch;
            const claimableClass = isClaimable ? 'claimable' : '';
            const claimButton = isClaimable
                ? `<button class="btn btn-success claim-btn" data-request-id="${req.id}">Claim</button>`
                : '';

            return `
                <div class="queue-item ${claimableClass}">
                    <div class="queue-info">
                        <span>Request #${req.id}</span>
                        <span>${shares} USDC</span>
                    </div>
                    <div class="queue-details">
                        User: ${req.user} | Epoch: ${req.epoch} | Status: ${req.claimed ? 'Claimed' : 'Pending'}
                    </div>
                    ${claimButton}
                </div>
            `;
        }).join('');
    }

    // Deposit USDC into vault
    async deposit() {
        if (!this.userAddress) {
            this.showNotification('Please connect wallet first', 'error');
            return;
        }

        const amountInput = document.getElementById('depositAmount');
        const amount = amountInput.value;

        if (!amount || amount <= 0) {
            this.showNotification('Please enter a valid deposit amount', 'error');
            return;
        }

        try {
            this.showNotification('Processing deposit...', 'info');

            // Simulate deposit in demo mode
            const depositAmount = ethers.parseUnits(amount, 6);
            this.mockData.userBalance -= depositAmount;
            this.mockData.liquidReserve += depositAmount;
            this.mockData.totalAssets += depositAmount;
            this.mockData.userShares += depositAmount;
            this.mockData.totalSupply += depositAmount;

            this.updateDashboard();
            amountInput.value = '';
            this.showNotification(`Successfully deposited ${amount} USDC!`, 'success');
        } catch (error) {
            console.error('Deposit error:', error);
            this.showNotification('Deposit failed: ' + error.message, 'error');
        }
    }

    // Request withdrawal
    async withdraw() {
        if (!this.userAddress) {
            this.showNotification('Please connect wallet first', 'error');
            return;
        }

        const amountInput = document.getElementById('withdrawAmount');
        const amount = amountInput.value;

        if (!amount || amount <= 0) {
            this.showNotification('Please enter a valid withdrawal amount', 'error');
            return;
        }

        try {
            this.showNotification('Processing withdrawal request...', 'info');

            // Simulate withdrawal in demo mode
            const withdrawAmount = ethers.parseUnits(amount, 6);
            if (withdrawAmount > this.mockData.userShares) {
                this.showNotification('Insufficient vault shares', 'error');
                return;
            }

            this.mockData.userShares -= withdrawAmount;
            this.mockData.totalSupply -= withdrawAmount;
            this.mockData.pendingRequests.push({
                id: this.mockData.pendingRequests.length,
                user: `${this.userAddress.substring(0, 6)}...${this.userAddress.substring(38)}`,
                shares: withdrawAmount,
                epoch: this.mockData.currentEpoch,
                claimed: false
            });

            this.updateDashboard();
            amountInput.value = '';
            this.showNotification(`Withdrawal request created for ${amount} USDC!`, 'success');
        } catch (error) {
            console.error('Withdrawal error:', error);
            this.showNotification('Withdrawal failed: ' + error.message, 'error');
        }
    }

    // Claim withdrawal
    async claimWithdrawal(requestId) {
        try {
            this.showNotification('Processing claim...', 'info');

            // Simulate claim in demo mode
            const request = this.mockData.pendingRequests.find(req => req.id === requestId);
            if (request && !request.claimed) {
                request.claimed = true;
                this.mockData.liquidReserve -= request.shares;
                this.mockData.userBalance += request.shares;
                this.updateDashboard();
                this.showNotification('Successfully claimed withdrawal!', 'success');
            }
        } catch (error) {
            console.error('Claim error:', error);
            this.showNotification('Claim failed: ' + error.message, 'error');
        }
    }

    // Update valuation with ZK proof simulation
    async updateValuation() {
        if (!this.userAddress) {
            this.showNotification('Please connect wallet first', 'error');
            return;
        }

        const navInput = document.getElementById('newNAV');
        const epochInput = document.getElementById('newEpoch');
        const newNAV = navInput.value;
        const newEpoch = epochInput.value;

        if (!newNAV || newNAV <= 0) {
            this.showNotification('Please enter a valid NAV value', 'error');
            return;
        }

        if (!newEpoch || newEpoch <= 0) {
            this.showNotification('Please enter a valid epoch ID', 'error');
            return;
        }

        try {
            this.showNotification('Processing valuation update...', 'info');

            const newNAVValue = ethers.parseUnits(newNAV, 6);
            const newEpochId = parseInt(newEpoch);

            // Check circuit breaker
            if (this.mockData.currentNAV > 0) {
                const delta = Math.abs(
                    (parseFloat(newNAV) - parseFloat(ethers.formatUnits(this.mockData.currentNAV, 6))) /
                    parseFloat(ethers.formatUnits(this.mockData.currentNAV, 6)) * 10000
                );

                if (delta > this.MAX_NAV_DELTA_BPS) {
                    this.mockData.paused = true;
                    this.updateDashboard();
                    this.showNotification(
                        `CIRCUIT BREAKER TRIGGERED! NAV change of ${(delta / 100).toFixed(2)}% exceeds 5% limit. Vault paused.`,
                        'error'
                    );
                    return;
                }
            }

            // Update valuation in demo mode
            this.mockData.currentNAV = newNAVValue;
            this.mockData.currentEpoch = newEpochId;
            this.mockData.totalAssets = this.mockData.liquidReserve + newNAVValue;

            this.updateDashboard();
            navInput.value = '';
            epochInput.value = '';
            this.showNotification(`Valuation updated to ${newNAV} USDC for epoch ${newEpoch}!`, 'success');
        } catch (error) {
            console.error('Valuation update error:', error);
            this.showNotification('Valuation update failed: ' + error.message, 'error');
        }
    }

    // Process epoch
    async processEpoch() {
        if (!this.userAddress) {
            this.showNotification('Please connect wallet first', 'error');
            return;
        }

        const epochIdInput = document.getElementById('epochProcessId');
        const liquidityInput = document.getElementById('availableLiquidity');
        const epochId = epochIdInput.value;
        const liquidity = liquidityInput.value;

        if (!epochId || epochId < 0) {
            this.showNotification('Please enter a valid epoch ID', 'error');
            return;
        }

        if (!liquidity || liquidity < 0) {
            this.showNotification('Please enter valid liquidity amount', 'error');
            return;
        }

        try {
            this.showNotification('Processing epoch...', 'info');

            // Simulate epoch processing in demo mode
            const epochIdNum = parseInt(epochId);
            const liquidityAmount = ethers.parseUnits(liquidity, 6);

            // Mark requests in this epoch as claimable
            this.mockData.pendingRequests.forEach(req => {
                if (req.epoch === epochIdNum && !req.claimed) {
                    // They can now be claimed
                }
            });

            this.updateDashboard();
            epochIdInput.value = '';
            liquidityInput.value = '';
            this.showNotification(`Epoch ${epochId} processed with ${liquidity} USDC liquidity!`, 'success');
        } catch (error) {
            console.error('Epoch processing error:', error);
            this.showNotification('Epoch processing failed: ' + error.message, 'error');
        }
    }

    // Set current epoch
    async setEpoch() {
        if (!this.userAddress) {
            this.showNotification('Please connect wallet first', 'error');
            return;
        }

        const epochInput = document.getElementById('epochSetId');
        const epoch = epochInput.value;

        if (!epoch || epoch < 0) {
            this.showNotification('Please enter a valid epoch ID', 'error');
            return;
        }

        try {
            this.showNotification('Setting epoch...', 'info');

            // Simulate epoch setting in demo mode
            this.mockData.currentEpoch = parseInt(epoch);
            this.updateDashboard();
            epochInput.value = '';
            this.showNotification(`Current epoch set to ${epoch}!`, 'success');
        } catch (error) {
            console.error('Epoch setting error:', error);
            this.showNotification('Epoch setting failed: ' + error.message, 'error');
        }
    }

    // Pause vault
    async pauseVault() {
        if (!this.userAddress) {
            this.showNotification('Please connect wallet first', 'error');
            return;
        }

        try {
            this.showNotification('Pausing vault...', 'info');
            this.mockData.paused = true;
            this.updateDashboard();
            this.showNotification('Vault paused successfully!', 'success');
        } catch (error) {
            console.error('Pause error:', error);
            this.showNotification('Pause failed: ' + error.message, 'error');
        }
    }

    // Unpause vault
    async unpauseVault() {
        if (!this.userAddress) {
            this.showNotification('Please connect wallet first', 'error');
            return;
        }

        try {
            this.showNotification('Unpausing vault...', 'info');
            this.mockData.paused = false;
            this.updateDashboard();
            this.showNotification('Vault unpaused successfully!', 'success');
        } catch (error) {
            console.error('Unpause error:', error);
            this.showNotification('Unpause failed: ' + error.message, 'error');
        }
    }

    // Show notification
    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;

        // Remove hidden class to show notification
        notification.classList.remove('hidden');

        // Auto-hide after 5 seconds
        setTimeout(() => {
            notification.classList.add('hidden');
        }, 5000);
    }

    // Start polling for updates
    startPolling() {
        this.pollingInterval = setInterval(() => {
            this.updateDashboard();
        }, 5000); // Poll every 5 seconds
    }

    // Stop polling
    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    // Load user-specific data
    async loadUserData() {
        // In a real implementation, this would fetch user-specific data from contracts
        this.updateDashboard();
    }
}

// Initialize the application
let veraProtocol;
document.addEventListener('DOMContentLoaded', () => {
    veraProtocol = new VERAProtocol();
    veraProtocol.init();
});
