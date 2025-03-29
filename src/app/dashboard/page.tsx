"use client";

import { useState, useEffect } from "react";
import { useTurnkey } from "@turnkey/sdk-react";
import { useRouter } from "next/navigation";
import { Enclave, SignMode } from 'enclavemoney';
import { formatUnits, parseUnits, isAddress, ethers, getBytes } from 'ethers';
import { TurnkeySigner } from "@turnkey/ethers";

const formatUSDC = (amount: string): string => {
  try {
    return formatUnits(amount, 6);
  } catch (error) {
    console.error('Error formatting USDC amount:', error);
    return '0.00';
  }
};

export default function Dashboard() {
  const { turnkey, getActiveClient } = useTurnkey();
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [enclaveAddress, setEnclaveAddress] = useState<string>("");
  const [balance, setBalance] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const router = useRouter();
  const [recipientAddress, setRecipientAddress] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [txnHash, setTxnHash] = useState<string | null>(null);

  const enclave = new Enclave(process.env.NEXT_PUBLIC_ENCLAVE_KEY!);

  useEffect(() => {
    const fetchWalletInfo = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const client = await getActiveClient();
        if (!client || !turnkey) {
          router.push("/");
          return;
        }

        // Get the user's organization ID
        const user = await turnkey.getCurrentUser();
        if (!user?.organization?.organizationId) {
          router.push("/");
          return;
        }

        const organizationId = user.organization.organizationId;

        // Get the user's wallets
        const wallets = await client.getWallets({
          organizationId,
        });

        if (!wallets?.wallets?.[0]) {
          console.error("No wallet found");
          return;
        }

        const walletId = wallets.wallets[0].walletId;

        // Get the wallet accounts
        const accounts = await client.getWalletAccounts({
          organizationId,
          walletId,
        });

        if (!accounts?.accounts?.[0]) {
          console.error("No account found");
          return;
        }

        const address = accounts.accounts[0].address;
        setWalletAddress(address);

        // After getting the wallet address, initialize Enclave and create/fetch smart account
        if (address) {
          
          try {
            // This will either create a new smart account or fetch an existing one
            const account = await enclave.createSmartAccount(address);
            setEnclaveAddress(account.wallet.scw_address);
            
            // Optionally fetch the smart account balance
            const smartBalance = await enclave.getSmartBalance(account.wallet.scw_address);
            setBalance(smartBalance.toString());
          } catch (error) {
            console.error("Error creating/fetching Enclave account:", error);
            setError("Failed to create or fetch Enclave account. Please try again later.");
          }
        }
      } catch (error) {
        console.error("Error fetching wallet info:", error);
        setError("Failed to fetch wallet information. Please try again later.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchWalletInfo();
  }, [turnkey, getActiveClient, router]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const pollBalance = async () => {
      if (!enclaveAddress) return;
      console.log("Fetching balance: ", new Date())
      try {
        const smartBalance = await enclave.getSmartBalance(enclaveAddress);
        console.log("Balance: ", smartBalance.toString());
        setBalance(smartBalance.toString());
      } catch (error) {
        console.error("Error polling balance:", error);
      }
    };

    if (enclaveAddress && !isPolling) {
      setIsPolling(true);
      pollBalance();
      intervalId = setInterval(pollBalance, 2000);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        setIsPolling(false);
      }
    };
  }, []);

  const isValidTransfer = () => {
    if (!recipientAddress || !transferAmount) return false;
    if (!isAddress(recipientAddress)) return false;
    try {
      const amountInUSDC = parseUnits(transferAmount, 6);
      return amountInUSDC > 0;
    } catch {
      return false;
    }
  };

  const handleTransfer = async () => {
    if (!isValidTransfer()) return;
    
    setTransferError(null);
    setIsTransferring(true);

    try {
      // Convert amount to USDC units (6 decimals)
      const amountInUSDC = parseUnits(transferAmount, 6);

      // USDC contract address on Base
      const baseUsdcAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

      // Create the call data for the ERC20 transfer
      const erc20Interface = new ethers.Interface([
        'function transfer(address to, uint256 amount)'
      ]);
      const encodedData = erc20Interface.encodeFunctionData('transfer', [recipientAddress, amountInUSDC]);

      // Create the transaction details
      const transactionDetails = [{
        encodedData: encodedData,
        targetContractAddress: baseUsdcAddress,
        value: 0
      }];

      // Define the order data
      const orderData = {
        amount:  parseUnits(transferAmount, 6).toString(),
        type: 'AMOUNT_OUT'
      };

      // Build the transaction for Base (chainId: 8453)
      const builtTxn = await enclave.buildTransaction(
        transactionDetails,
        8453, // Base network
        enclaveAddress,
        orderData,
        undefined,
        SignMode.ECDSA
      );

      // Get the active client for signing
      const client = await getActiveClient();
      if (!client) {
        throw new Error("No active Turnkey client");
      }

      // Get the user's organization ID and wallet
      const user = await turnkey?.getCurrentUser();
      if (!user?.organization?.organizationId) {
        throw new Error("No organization ID found");
      }

      const wallets = await client.getWallets({
        organizationId: user.organization.organizationId,
      }); 

      if (!wallets?.wallets?.[0]) {
        throw new Error("No wallet found");
      }

      const accounts = await client.getWalletAccounts({
        organizationId: user.organization.organizationId,
        walletId: wallets.wallets[0].walletId,
      });

      if (!accounts?.accounts?.[0]) {
        throw new Error("No account found");
      }
      const turnkeySigner = new TurnkeySigner({
        client: client,
        organizationId: user.organization.organizationId,
        signWith: accounts.accounts[0].address,
      }) 
      console.log("UserOpHash To Sign: ", builtTxn.messageToSign);

      const msgBytes = getBytes(builtTxn.messageToSign);
      const sign0 = await turnkeySigner.signMessage(msgBytes);

      const txnResult = await enclave.submitTransaction(
        sign0,
        builtTxn.userOp,
        8453, // Base network chainId
        enclaveAddress,
        SignMode.ECDSA
      );

      console.log('Transaction Hash:', txnResult);
      setTransferError(null);
      setTxnHash(txnResult.txnHash);
      setRecipientAddress("");
      setTransferAmount("");
      
    } catch (error) {
      console.error('Transfer error:', error);
      setTransferError('Failed to process transfer. Please try again.');
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
        
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}
        
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Wallet Information</h2>
          
          {isLoading ? (
            <div className="space-y-4">
              <div className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-2"></div>
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
              </div>
              
              <div className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2"></div>
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
              </div>
              
              <div className="animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-2"></div>
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Turnkey Wallet Address
                </label>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100 font-mono break-all">
                  {walletAddress}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Enclave Smart Account Address
                </label>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100 font-mono break-all">
                  {enclaveAddress}
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Smart Account Balance
                </label>
                <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                  {balance ? `${formatUSDC(balance)} USDC` : '0.00 USDC'}
                </p>
              </div>
            </div>
          )}
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Transfer USDC</h2>
          
          {transferError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {transferError}
            </div>
          )}

          {txnHash && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
              Transaction successful! Hash: <span className="font-mono break-all">{txnHash}</span>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="recipient" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Recipient Address
              </label>
              <input
                id="recipient"
                type="text"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                placeholder="0x..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                disabled={isTransferring}
              />
              {recipientAddress && !isAddress(recipientAddress) && (
                <p className="mt-1 text-sm text-red-600">Invalid Ethereum address</p>
              )}
            </div>

            <div>
              <label htmlFor="amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Amount (USDC)
              </label>
              <input
                id="amount"
                type="number"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                disabled={isTransferring}
              />
            </div>

            <button
              onClick={handleTransfer}
              disabled={!isValidTransfer() || isTransferring}
              className={`w-full py-2 px-4 rounded-md text-white font-medium ${
                !isValidTransfer() || isTransferring
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isTransferring ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </span>
              ) : (
                'Transfer USDC'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 