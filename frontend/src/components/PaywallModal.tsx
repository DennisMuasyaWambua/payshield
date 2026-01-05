/**
 * PaywallModal Component
 * Main paywall interface for content access payments
 */

'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, Smartphone, CreditCard, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';

import { fingerprintGenerator } from '../services/fingerprint';
import { WalletConnect } from './WalletConnect';
import { MpesaPayment } from './MpesaPayment';
import { usePaywall } from '../hooks/usePaywall';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  contentId: string;
  contentTitle: string;
  contentPreview: string;
  priceUSDC: number;
  priceKES: number;
  accessDuration: number; // seconds, 0 = lifetime
  maxDevices: number;
  onSuccess: (accessToken: string) => void;
}

type PaymentMethod = 'crypto' | 'mpesa';
type PaymentState = 
  | 'idle'
  | 'connecting_wallet'
  | 'generating_fingerprint'
  | 'awaiting_approval'
  | 'processing_crypto'
  | 'awaiting_mpesa'
  | 'verifying'
  | 'success'
  | 'error';

export function PaywallModal({
  isOpen,
  onClose,
  contentId,
  contentTitle,
  contentPreview,
  priceUSDC,
  priceKES,
  accessDuration,
  maxDevices,
  onSuccess
}: PaywallModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('crypto');
  const [paymentState, setPaymentState] = useState<PaymentState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [deviceFingerprint, setDeviceFingerprint] = useState<string>('');
  const [paymentHash, setPaymentHash] = useState<string>('');
  
  const { address, isConnected } = useAccount();
  const { data: usdcBalance } = useBalance({
    address,
    token: process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}`,
  });

  const {
    createCryptoPayment,
    createMpesaPayment,
    verifyPayment,
    checkAccess
  } = usePaywall();

  // Generate device fingerprint on modal open
  useEffect(() => {
    if (isOpen && !deviceFingerprint) {
      generateDeviceFingerprint();
    }
  }, [isOpen]);

  // Check if user already has access
  useEffect(() => {
    if (isOpen && deviceFingerprint && address) {
      checkExistingAccess();
    }
  }, [isOpen, deviceFingerprint, address]);

  const generateDeviceFingerprint = async () => {
    try {
      setPaymentState('generating_fingerprint');
      const fingerprint = await fingerprintGenerator.getFingerprintForBlockchain();
      setDeviceFingerprint(fingerprint);
      setPaymentState('idle');
    } catch (error) {
      console.error('Failed to generate device fingerprint:', error);
      setErrorMessage('Failed to verify device. Please refresh and try again.');
      setPaymentState('error');
    }
  };

  const checkExistingAccess = async () => {
    try {
      const hasAccess = await checkAccess(contentId, deviceFingerprint, address!);
      if (hasAccess) {
        setPaymentState('success');
        onSuccess('existing-access');
        return;
      }
    } catch (error) {
      console.warn('Failed to check existing access:', error);
    }
  };

  const handleCryptoPayment = async () => {
    if (!address || !deviceFingerprint) return;

    try {
      setPaymentState('awaiting_approval');
      setErrorMessage('');

      // Check USDC balance
      if (!usdcBalance || parseFloat(formatUnits(usdcBalance.value, 6)) < priceUSDC) {
        throw new Error('Insufficient USDC balance');
      }

      // Create payment
      setPaymentState('processing_crypto');
      const result = await createCryptoPayment({
        contentId,
        deviceFingerprint,
        priceUSDC,
        userAddress: address
      });

      setPaymentHash(result.paymentHash);

      // Verify payment
      setPaymentState('verifying');
      await verifyPayment(result.paymentId);

      setPaymentState('success');
      onSuccess(result.accessToken);

    } catch (error: any) {
      console.error('Crypto payment failed:', error);
      setErrorMessage(error.message || 'Payment failed. Please try again.');
      setPaymentState('error');
    }
  };

  const handleMpesaPayment = async (phoneNumber: string) => {
    if (!deviceFingerprint) return;

    try {
      setPaymentState('awaiting_mpesa');
      setErrorMessage('');

      const result = await createMpesaPayment({
        contentId,
        deviceFingerprint,
        phoneNumber,
        amountKES: priceKES
      });

      // Show USSD code to user
      setPaymentHash(result.sessionId);
      
      // Payment will complete via webhook
      // Poll for completion
      pollPaymentStatus(result.sessionId);

    } catch (error: any) {
      console.error('M-Pesa payment failed:', error);
      setErrorMessage(error.message || 'M-Pesa payment failed. Please try again.');
      setPaymentState('error');
    }
  };

  const pollPaymentStatus = async (sessionId: string) => {
    const maxAttempts = 60; // 5 minutes
    let attempts = 0;

    const poll = async () => {
      try {
        const status = await verifyPayment(sessionId);
        
        if (status.completed) {
          setPaymentState('success');
          onSuccess(status.accessToken);
          return;
        }

        if (status.failed || status.expired) {
          throw new Error(status.errorMessage || 'Payment failed or expired');
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000); // Poll every 5 seconds
        } else {
          throw new Error('Payment verification timed out');
        }

      } catch (error: any) {
        setErrorMessage(error.message || 'Payment verification failed');
        setPaymentState('error');
      }
    };

    poll();
  };

  const formatDuration = (seconds: number): string => {
    if (seconds === 0) return 'Lifetime access';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
    return `${Math.floor(seconds / 86400)} days`;
  };

  const resetModal = () => {
    setPaymentState('idle');
    setErrorMessage('');
    setPaymentHash('');
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="paywall-overlay fixed inset-0 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 focus:outline-none">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="payment-card w-full max-w-md rounded-2xl p-6 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Shield className="h-6 w-6 text-primary" />
                <h2 className="text-lg font-semibold">PayShield Access</h2>
              </div>
              <Dialog.Close asChild>
                <button className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800">
                  <X className="h-5 w-5" />
                </button>
              </Dialog.Close>
            </div>

            {/* Content Preview */}
            <div className="mb-6">
              <div className="aspect-video mb-3 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
                <img 
                  src={contentPreview} 
                  alt={contentTitle}
                  className="h-full w-full object-cover opacity-75 blur-sm"
                />
              </div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">
                {contentTitle}
              </h3>
              <div className="mt-2 flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                <span>📱 Max {maxDevices} devices</span>
                <span>⏱️ {formatDuration(accessDuration)}</span>
              </div>
            </div>

            {/* Payment States */}
            <AnimatePresence mode="wait">
              {paymentState === 'success' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center"
                >
                  <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-4" />
                  <h3 className="text-lg font-medium text-green-600 mb-2">
                    Access Granted!
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    You can now access this content on your verified device.
                  </p>
                </motion.div>
              )}

              {paymentState === 'error' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center"
                >
                  <AlertTriangle className="mx-auto h-12 w-12 text-red-500 mb-4" />
                  <h3 className="text-lg font-medium text-red-600 mb-2">
                    Payment Failed
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mb-4">
                    {errorMessage}
                  </p>
                  <button
                    onClick={resetModal}
                    className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
                  >
                    Try Again
                  </button>
                </motion.div>
              )}

              {['idle', 'generating_fingerprint', 'connecting_wallet', 'awaiting_approval', 'processing_crypto', 'awaiting_mpesa', 'verifying'].includes(paymentState) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  {/* Payment Method Selection */}
                  <div className="mb-6">
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                      <button
                        onClick={() => setPaymentMethod('crypto')}
                        className={`flex items-center justify-center gap-2 rounded-md py-2 px-3 text-sm font-medium transition-colors ${
                          paymentMethod === 'crypto'
                            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                            : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                        }`}
                      >
                        <CreditCard className="h-4 w-4" />
                        Crypto
                      </button>
                      <button
                        onClick={() => setPaymentMethod('mpesa')}
                        className={`flex items-center justify-center gap-2 rounded-md py-2 px-3 text-sm font-medium transition-colors ${
                          paymentMethod === 'mpesa'
                            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                            : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                        }`}
                      >
                        <Smartphone className="h-4 w-4" />
                        M-Pesa
                      </button>
                    </div>
                  </div>

                  {/* Price Display */}
                  <div className="mb-6 rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Total Price</span>
                      <div className="text-right">
                        <div className="text-lg font-bold">
                          {paymentMethod === 'crypto' ? `${priceUSDC} USDC` : `KES ${priceKES}`}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {paymentMethod === 'crypto' ? `≈ KES ${priceKES}` : `≈ ${priceUSDC} USDC`}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Loading States */}
                  {paymentState === 'generating_fingerprint' && (
                    <div className="text-center py-4">
                      <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary mb-2" />
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Verifying device...
                      </p>
                    </div>
                  )}

                  {paymentState === 'processing_crypto' && (
                    <div className="text-center py-4">
                      <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary mb-2" />
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Processing payment...
                      </p>
                    </div>
                  )}

                  {paymentState === 'verifying' && (
                    <div className="text-center py-4">
                      <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary mb-2" />
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Verifying access...
                      </p>
                    </div>
                  )}

                  {/* Payment Components */}
                  {paymentState === 'idle' && deviceFingerprint && (
                    <>
                      {paymentMethod === 'crypto' ? (
                        <WalletConnect
                          onPayment={handleCryptoPayment}
                          priceUSDC={priceUSDC}
                          disabled={paymentState !== 'idle'}
                        />
                      ) : (
                        <MpesaPayment
                          onPayment={handleMpesaPayment}
                          priceKES={priceKES}
                          disabled={paymentState !== 'idle'}
                        />
                      )}
                    </>
                  )}

                  {paymentState === 'awaiting_mpesa' && paymentHash && (
                    <MpesaPayment
                      sessionId={paymentHash}
                      onPayment={() => {}}
                      priceKES={priceKES}
                      disabled={true}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Device Security Info */}
            {deviceFingerprint && paymentState === 'idle' && (
              <div className="mt-6 rounded-lg bg-blue-50 p-3 dark:bg-blue-950/20">
                <div className="flex items-start gap-2">
                  <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-blue-800 dark:text-blue-200">
                      Device Verified
                    </p>
                    <p className="text-blue-700 dark:text-blue-300">
                      This device is registered for secure content access.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}