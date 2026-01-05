/**
 * WalletConnect Component
 * Handles crypto wallet connection and USDC payments
 */

'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Wallet, ExternalLink, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { useAccount, useBalance, useContractWrite, usePrepareContractWrite } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { formatUnits, parseUnits } from 'viem';
import { toast } from 'react-hot-toast';

interface WalletConnectProps {
  onPayment: () => Promise<void>;
  priceUSDC: number;
  disabled: boolean;
}

export function WalletConnect({ onPayment, priceUSDC, disabled }: WalletConnectProps) {
  const [isApproving, setIsApproving] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [allowance, setAllowance] = useState<bigint>(0n);

  const { address, isConnected } = useAccount();
  
  // USDC balance
  const { data: usdcBalance, isLoading: balanceLoading } = useBalance({
    address,
    token: process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}`,
  });

  // ETH balance for gas
  const { data: ethBalance } = useBalance({
    address,
  });

  // USDC contract ABI (simplified)
  const usdcAbi = [
    {
      name: 'approve',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'spender', type: 'address' },
        { name: 'amount', type: 'uint256' }
      ],
      outputs: [{ name: '', type: 'bool' }]
    },
    {
      name: 'allowance',
      type: 'function',
      stateMutability: 'view',
      inputs: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' }
      ],
      outputs: [{ name: '', type: 'uint256' }]
    }
  ] as const;

  const priceWei = parseUnits(priceUSDC.toString(), 6); // USDC has 6 decimals

  // Prepare USDC approval transaction
  const { config: approveConfig } = usePrepareContractWrite({
    address: process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}`,
    abi: usdcAbi,
    functionName: 'approve',
    args: [
      process.env.NEXT_PUBLIC_PAYWALL_CORE_ADDRESS as `0x${string}`,
      priceWei
    ],
    enabled: isConnected && !!address
  });

  const { write: approveUSDC, isLoading: approveLoading } = useContractWrite({
    ...approveConfig,
    onSuccess: () => {
      setIsApproved(true);
      setIsApproving(false);
      toast.success('USDC approval successful!');
    },
    onError: (error) => {
      setIsApproving(false);
      toast.error('USDC approval failed');
      console.error('Approval failed:', error);
    }
  });

  // Check USDC allowance
  useEffect(() => {
    checkAllowance();
  }, [address, isConnected]);

  const checkAllowance = async () => {
    if (!address || !isConnected) return;

    try {
      // In a real implementation, you would call the contract directly
      // For now, we'll simulate this
      const currentAllowance = 0n; // Would get from contract
      setAllowance(currentAllowance);
      setIsApproved(currentAllowance >= priceWei);
    } catch (error) {
      console.error('Failed to check allowance:', error);
    }
  };

  const handleApprove = async () => {
    if (!approveUSDC) return;
    
    setIsApproving(true);
    try {
      approveUSDC();
    } catch (error) {
      setIsApproving(false);
      console.error('Approval failed:', error);
    }
  };

  const handlePayment = async () => {
    if (!isApproved) {
      toast.error('Please approve USDC spending first');
      return;
    }

    try {
      await onPayment();
    } catch (error) {
      console.error('Payment failed:', error);
    }
  };

  const hasInsufficientBalance = () => {
    if (!usdcBalance) return true;
    return parseFloat(formatUnits(usdcBalance.value, 6)) < priceUSDC;
  };

  const hasInsufficientGas = () => {
    if (!ethBalance) return true;
    return parseFloat(formatUnits(ethBalance.value, 18)) < 0.001; // Rough estimate
  };

  if (!isConnected) {
    return (
      <div className="space-y-4">
        <div className="text-center">
          <Wallet className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            Connect Your Wallet
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Connect your wallet to pay with USDC
          </p>
        </div>
        
        <ConnectButton.Custom>
          {({ openConnectModal, connectModalOpen }) => (
            <button
              onClick={openConnectModal}
              disabled={connectModalOpen || disabled}
              className="w-full rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Connect Wallet
            </button>
          )}
        </ConnectButton.Custom>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Wallet Info */}
      <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Connected Wallet
          </span>
          <ConnectButton.Custom>
            {({ openAccountModal }) => (
              <button
                onClick={openAccountModal}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
              >
                {`${address?.slice(0, 6)}...${address?.slice(-4)}`}
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </ConnectButton.Custom>
        </div>
        
        {/* Balances */}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">USDC Balance:</span>
            <span className={`font-medium ${hasInsufficientBalance() ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
              {balanceLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                `${usdcBalance ? formatUnits(usdcBalance.value, 6) : '0'} USDC`
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">ETH Balance:</span>
            <span className={`font-medium ${hasInsufficientGas() ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
              {`${ethBalance ? parseFloat(formatUnits(ethBalance.value, 18)).toFixed(4) : '0'} ETH`}
            </span>
          </div>
        </div>
      </div>

      {/* Warnings */}
      {hasInsufficientBalance() && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg bg-red-50 p-3 dark:bg-red-950/20"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-red-800 dark:text-red-200">
                Insufficient USDC Balance
              </p>
              <p className="text-red-700 dark:text-red-300">
                You need at least {priceUSDC} USDC to make this payment.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {hasInsufficientGas() && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg bg-yellow-50 p-3 dark:bg-yellow-950/20"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-yellow-800 dark:text-yellow-200">
                Low ETH Balance
              </p>
              <p className="text-yellow-700 dark:text-yellow-300">
                You may not have enough ETH for transaction gas fees.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Payment Steps */}
      <div className="space-y-3">
        {/* Step 1: Approve USDC */}
        <div className="flex items-center justify-between rounded-lg border p-3 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              isApproved 
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
            }`}>
              {isApproved ? <CheckCircle className="h-4 w-4" /> : '1'}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Approve USDC Spending
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Allow PayShield to spend {priceUSDC} USDC
              </p>
            </div>
          </div>
          
          {!isApproved && (
            <button
              onClick={handleApprove}
              disabled={isApproving || approveLoading || hasInsufficientBalance() || disabled}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isApproving || approveLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                'Approve'
              )}
            </button>
          )}
        </div>

        {/* Step 2: Pay */}
        <div className="flex items-center justify-between rounded-lg border p-3 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              isApproved 
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' 
                : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
            }`}>
              2
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Complete Payment
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Pay {priceUSDC} USDC for content access
              </p>
            </div>
          </div>
          
          <button
            onClick={handlePayment}
            disabled={!isApproved || hasInsufficientBalance() || hasInsufficientGas() || disabled}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Pay Now
          </button>
        </div>
      </div>

      {/* Security Notice */}
      <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950/20">
        <div className="flex items-start gap-2">
          <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-blue-800 dark:text-blue-200">
              Secure Payment
            </p>
            <p className="text-blue-700 dark:text-blue-300">
              Your payment is processed directly on the blockchain. No sensitive information is stored.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}