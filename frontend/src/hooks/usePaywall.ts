/**
 * usePaywall Hook
 * Custom hook for paywall functionality
 */

import { useState, useCallback } from 'react';
import axios from 'axios';
import { useAccount, useContractWrite, usePrepareContractWrite } from 'wagmi';
import { parseUnits, keccak256, toUtf8Bytes } from 'viem';
import { toast } from 'react-hot-toast';

interface CreateCryptoPaymentParams {
  contentId: string;
  deviceFingerprint: string;
  priceUSDC: number;
  userAddress: string;
}

interface CreateMpesaPaymentParams {
  contentId: string;
  deviceFingerprint: string;
  phoneNumber: string;
  amountKES: number;
}

interface PaymentResult {
  paymentId: string;
  paymentHash: string;
  sessionId?: string;
  ussdCode?: string;
  accessToken: string;
}

interface PaymentStatus {
  completed: boolean;
  failed: boolean;
  expired: boolean;
  errorMessage?: string;
  accessToken?: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// PaywallCore contract ABI (simplified)
const PAYWALL_CORE_ABI = [
  {
    name: 'createPayment',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'paymentHash', type: 'bytes32' },
      { name: 'contentId', type: 'uint256' },
      { name: 'expiryMinutes', type: 'uint256' }
    ],
    outputs: [{ name: 'paymentId', type: 'bytes32' }]
  },
  {
    name: 'completePayment',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'preimage', type: 'bytes32' },
      { name: 'deviceFingerprint', type: 'bytes32' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'verifyAccess',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'contentId', type: 'uint256' },
      { name: 'deviceFingerprint', type: 'bytes32' },
      { name: 'user', type: 'address' }
    ],
    outputs: [
      { name: 'hasAccess', type: 'bool' },
      { name: 'expiresAt', type: 'uint256' }
    ]
  }
] as const;

export function usePaywall() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { address } = useAccount();

  // Create crypto payment
  const createCryptoPayment = useCallback(async ({
    contentId,
    deviceFingerprint,
    priceUSDC,
    userAddress
  }: CreateCryptoPaymentParams): Promise<PaymentResult> => {
    setLoading(true);
    setError(null);
    
    try {
      // Generate payment preimage and hash
      const preimage = crypto.getRandomValues(new Uint8Array(32));
      const preimageHex = Array.from(preimage).map(b => b.toString(16).padStart(2, '0')).join('');
      const paymentHash = keccak256(toUtf8Bytes(preimageHex));

      // Create payment on blockchain via API
      const response = await axios.post(`${API_BASE_URL}/api/v1/payments/create`, {
        payment_hash: paymentHash,
        content_id: parseInt(contentId),
        device_fingerprint: deviceFingerprint,
        user_address: userAddress,
        price_usdc: priceUSDC,
        payment_method: 'crypto',
        expiry_minutes: 60
      });

      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to create payment');
      }

      // Store preimage for later completion
      localStorage.setItem(`payment_preimage_${paymentHash}`, preimageHex);

      return {
        paymentId: response.data.payment_id,
        paymentHash: paymentHash,
        accessToken: response.data.access_token
      };

    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Payment creation failed';
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Create M-Pesa payment
  const createMpesaPayment = useCallback(async ({
    contentId,
    deviceFingerprint,
    phoneNumber,
    amountKES
  }: CreateMpesaPaymentParams): Promise<PaymentResult> => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/v1/payments/mpesa/initiate`, {
        content_id: parseInt(contentId),
        device_fingerprint: deviceFingerprint,
        phone_number: phoneNumber,
        amount_kes: amountKES,
        metadata: {
          content_id: contentId,
          device_fingerprint: deviceFingerprint,
          user_address: address
        }
      });

      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to initiate M-Pesa payment');
      }

      return {
        paymentId: response.data.payment_id,
        paymentHash: response.data.payment_hash,
        sessionId: response.data.session_id,
        ussdCode: response.data.ussd_code,
        accessToken: response.data.access_token
      };

    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'M-Pesa payment failed';
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Verify payment completion
  const verifyPayment = useCallback(async (paymentIdOrSessionId: string): Promise<PaymentStatus> => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/v1/payments/${paymentIdOrSessionId}/status`);

      return {
        completed: response.data.status === 'completed',
        failed: response.data.status === 'failed',
        expired: response.data.status === 'expired',
        errorMessage: response.data.error_message,
        accessToken: response.data.access_token
      };

    } catch (error: any) {
      console.error('Payment verification failed:', error);
      return {
        completed: false,
        failed: true,
        expired: false,
        errorMessage: 'Verification failed'
      };
    }
  }, []);

  // Check if user already has access to content
  const checkAccess = useCallback(async (
    contentId: string, 
    deviceFingerprint: string, 
    userAddress: string
  ): Promise<boolean> => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/v1/access/verify`, {
        content_id: parseInt(contentId),
        device_fingerprint: deviceFingerprint,
        user_address: userAddress
      });

      return response.data.has_access;

    } catch (error) {
      console.error('Access check failed:', error);
      return false;
    }
  }, []);

  // Complete crypto payment on blockchain
  const completeBlockchainPayment = useCallback(async (
    paymentHash: string,
    deviceFingerprint: string
  ): Promise<boolean> => {
    try {
      // Retrieve stored preimage
      const preimageHex = localStorage.getItem(`payment_preimage_${paymentHash}`);
      if (!preimageHex) {
        throw new Error('Payment preimage not found');
      }

      // Convert to bytes32
      const preimage = `0x${preimageHex}` as `0x${string}`;
      const deviceFingerprintBytes = keccak256(toUtf8Bytes(deviceFingerprint));

      // Call smart contract completion via API
      const response = await axios.post(`${API_BASE_URL}/api/v1/payments/complete`, {
        preimage: preimage,
        device_fingerprint: deviceFingerprintBytes,
        user_address: address
      });

      if (response.data.success) {
        // Clean up stored preimage
        localStorage.removeItem(`payment_preimage_${paymentHash}`);
        return true;
      }

      return false;

    } catch (error) {
      console.error('Blockchain payment completion failed:', error);
      return false;
    }
  }, [address]);

  // Get content information
  const getContentInfo = useCallback(async (contentId: string) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/v1/content/${contentId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch content info:', error);
      return null;
    }
  }, []);

  // Register new content (for creators)
  const registerContent = useCallback(async (contentData: {
    title: string;
    description: string;
    price_usdc: number;
    access_duration: number;
    max_devices: number;
    content_type: string;
    content_hash: string;
  }) => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/v1/content`, {
        ...contentData,
        creator_address: address
      });

      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to register content');
      }

      toast.success('Content registered successfully!');
      return response.data;

    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Content registration failed';
      setError(message);
      toast.error(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Get creator dashboard data
  const getCreatorData = useCallback(async (creatorAddress: string) => {
    try {
      const [statsResponse, contentResponse, earningsResponse] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/v1/creator/stats`, {
          params: { creator_address: creatorAddress }
        }),
        axios.get(`${API_BASE_URL}/api/v1/creator/content`, {
          params: { creator_address: creatorAddress }
        }),
        axios.get(`${API_BASE_URL}/api/v1/creator/earnings`, {
          params: { creator_address: creatorAddress }
        })
      ]);

      return {
        stats: statsResponse.data,
        content: contentResponse.data,
        earnings: earningsResponse.data
      };

    } catch (error) {
      console.error('Failed to fetch creator data:', error);
      return null;
    }
  }, []);

  // Withdraw creator earnings
  const withdrawEarnings = useCallback(async (amount?: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/v1/creator/withdraw`, {
        creator_address: address,
        amount: amount // If not provided, withdraws all available
      });

      if (!response.data.success) {
        throw new Error(response.data.message || 'Withdrawal failed');
      }

      toast.success('Withdrawal successful!');
      return response.data;

    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Withdrawal failed';
      setError(message);
      toast.error(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Revoke device access
  const revokeDeviceAccess = useCallback(async (
    contentId: string,
    deviceFingerprint: string
  ) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/v1/access/revoke`, {
        content_id: parseInt(contentId),
        device_fingerprint: deviceFingerprint,
        creator_address: address
      });

      if (response.data.success) {
        toast.success('Device access revoked successfully');
        return true;
      }

      return false;

    } catch (error: any) {
      const message = error.response?.data?.message || 'Failed to revoke device access';
      toast.error(message);
      return false;
    }
  }, [address]);

  return {
    // State
    loading,
    error,
    
    // Payment functions
    createCryptoPayment,
    createMpesaPayment,
    verifyPayment,
    checkAccess,
    completeBlockchainPayment,
    
    // Content functions
    getContentInfo,
    registerContent,
    
    // Creator functions
    getCreatorData,
    withdrawEarnings,
    revokeDeviceAccess
  };
}