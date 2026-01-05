/**
 * MpesaPayment Component
 * Handles M-Pesa payments via Element Pay integration
 */

'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Smartphone, Clock, CheckCircle, AlertCircle, Copy, QrCode } from 'lucide-react';
import { toast } from 'react-hot-toast';
import QRCodeLib from 'qrcode';

interface MpesaPaymentProps {
  onPayment: (phoneNumber: string) => Promise<void>;
  priceKES: number;
  disabled: boolean;
  sessionId?: string; // If already in payment flow
}

export function MpesaPayment({ onPayment, priceKES, disabled, sessionId }: MpesaPaymentProps) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isValidPhone, setIsValidPhone] = useState(false);
  const [ussdCode, setUssdCode] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState<'input' | 'processing' | 'awaiting' | 'completed' | 'failed'>('input');

  // Validate Kenyan phone number
  useEffect(() => {
    const cleanPhone = phoneNumber.replace(/\s+/g, '');
    const kenyaPhoneRegex = /^(\+254|254|0)?([17][0-9]{8})$/;
    setIsValidPhone(kenyaPhoneRegex.test(cleanPhone));
  }, [phoneNumber]);

  // Mock USSD code generation (in real implementation, this comes from Element Pay API)
  useEffect(() => {
    if (sessionId) {
      // Simulate USSD code from Element Pay response
      setUssdCode('*665*313#');
      setPaymentStatus('awaiting');
      setTimeRemaining(15 * 60); // 15 minutes
      generateQRCode();
    }
  }, [sessionId]);

  // Countdown timer
  useEffect(() => {
    if (timeRemaining > 0 && paymentStatus === 'awaiting') {
      const timer = setTimeout(() => {
        setTimeRemaining(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (timeRemaining === 0 && paymentStatus === 'awaiting') {
      setPaymentStatus('failed');
      toast.error('Payment session expired');
    }
  }, [timeRemaining, paymentStatus]);

  const generateQRCode = async () => {
    try {
      // In a real implementation, this would be a deep link to M-Pesa app
      const mpesaDeepLink = `mpesa://pay?phone=${encodeURIComponent(phoneNumber)}&amount=${priceKES}&reference=${sessionId}`;
      const qrDataUrl = await QRCodeLib.toDataURL(mpesaDeepLink, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });
      setQrCodeDataUrl(qrDataUrl);
    } catch (error) {
      console.error('Failed to generate QR code:', error);
    }
  };

  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    let formatted = cleaned;
    
    if (cleaned.startsWith('254')) {
      formatted = '+254 ' + cleaned.slice(3, 6) + ' ' + cleaned.slice(6, 12);
    } else if (cleaned.startsWith('0')) {
      formatted = cleaned.slice(0, 4) + ' ' + cleaned.slice(4, 10);
    } else if (cleaned.length <= 9) {
      formatted = cleaned.slice(0, 3) + ' ' + cleaned.slice(3, 9);
    }
    
    return formatted;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPhoneNumber(formatPhoneNumber(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPhone || disabled) return;

    setPaymentStatus('processing');
    try {
      const cleanPhone = phoneNumber.replace(/\s+/g, '').replace(/^\+/, '');
      await onPayment(cleanPhone);
    } catch (error: any) {
      setPaymentStatus('failed');
      toast.error(error.message || 'Failed to initiate M-Pesa payment');
    }
  };

  const copyUSSDCode = () => {
    navigator.clipboard.writeText(ussdCode);
    toast.success('USSD code copied to clipboard');
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        {paymentStatus === 'input' && (
          <motion.div
            key="input"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <div className="text-center mb-6">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4 dark:bg-green-900">
                <Smartphone className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                Pay with M-Pesa
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Enter your M-Pesa number to complete payment
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  M-Pesa Phone Number
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    id="phone"
                    value={phoneNumber}
                    onChange={handlePhoneChange}
                    placeholder="0712 345 678"
                    className={`w-full rounded-lg border px-4 py-3 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 dark:border-gray-600 ${
                      phoneNumber && !isValidPhone 
                        ? 'border-red-300 dark:border-red-600' 
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                    disabled={disabled}
                  />
                  {phoneNumber && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {isValidPhone ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-red-500" />
                      )}
                    </div>
                  )}
                </div>
                {phoneNumber && !isValidPhone && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    Please enter a valid Kenyan phone number
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Supports: 07XX XXX XXX, 01XX XXX XXX, or +254 7XX XXX XXX
                </p>
              </div>

              {/* Amount Display */}
              <div className="rounded-lg bg-green-50 p-4 dark:bg-green-950/20">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-green-800 dark:text-green-200">
                    Amount to Pay
                  </span>
                  <span className="text-lg font-bold text-green-900 dark:text-green-100">
                    KES {priceKES.toLocaleString()}
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={!isValidPhone || disabled}
                className="w-full rounded-lg bg-green-600 px-4 py-3 font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Continue with M-Pesa
              </button>
            </form>
          </motion.div>
        )}

        {paymentStatus === 'processing' && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="text-center py-8"
          >
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4 dark:bg-blue-900">
              <Clock className="h-8 w-8 text-blue-600 animate-pulse dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              Processing Request
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              Setting up your M-Pesa payment...
            </p>
          </motion.div>
        )}

        {paymentStatus === 'awaiting' && (
          <motion.div
            key="awaiting"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Timer */}
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4 dark:bg-orange-900">
                <Clock className="h-8 w-8 text-orange-600 dark:text-orange-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                Complete Payment
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Use the USSD code below to complete your payment
              </p>
              <div className="text-2xl font-mono font-bold text-red-600 dark:text-red-400">
                {formatTime(timeRemaining)}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Time remaining
              </p>
            </div>

            {/* USSD Code */}
            <div className="rounded-lg border-2 border-green-200 bg-green-50 p-6 dark:bg-green-950/20 dark:border-green-800">
              <div className="text-center">
                <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-3">
                  Dial this USSD code on your phone:
                </p>
                <div className="flex items-center justify-center gap-2 mb-4">
                  <code className="text-3xl font-bold text-green-900 dark:text-green-100 bg-white dark:bg-gray-800 px-4 py-2 rounded-lg">
                    {ussdCode}
                  </code>
                  <button
                    onClick={copyUSSDCode}
                    className="p-2 text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
                    title="Copy USSD code"
                  >
                    <Copy className="h-5 w-5" />
                  </button>
                </div>
                <p className="text-xs text-green-700 dark:text-green-300">
                  Follow the prompts to complete payment of KES {priceKES.toLocaleString()}
                </p>
              </div>
            </div>

            {/* QR Code Alternative */}
            {qrCodeDataUrl && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 dark:bg-gray-800 dark:border-gray-700">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <QrCode className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      Or scan with M-Pesa app
                    </span>
                  </div>
                  <img
                    src={qrCodeDataUrl}
                    alt="M-Pesa QR Code"
                    className="mx-auto mb-3 rounded-lg"
                    width={150}
                    height={150}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Scan this QR code with your M-Pesa app
                  </p>
                </div>
              </div>
            )}

            {/* Instructions */}
            <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-950/20">
              <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                Payment Instructions:
              </h4>
              <ol className="text-sm text-blue-700 dark:text-blue-300 space-y-1 list-decimal list-inside">
                <li>Dial {ussdCode} on your M-Pesa registered phone</li>
                <li>Enter your M-Pesa PIN when prompted</li>
                <li>Confirm payment of KES {priceKES.toLocaleString()}</li>
                <li>Wait for confirmation SMS</li>
              </ol>
            </div>

            {/* Status */}
            <div className="text-center">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Waiting for payment confirmation...
              </p>
              <div className="mt-2 flex justify-center">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {paymentStatus === 'failed' && (
          <motion.div
            key="failed"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="text-center py-8"
          >
            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4 dark:bg-red-900">
              <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="text-lg font-medium text-red-600 dark:text-red-400 mb-2">
              Payment Failed
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {timeRemaining === 0 ? 'Payment session expired' : 'Payment could not be processed'}
            </p>
            <button
              onClick={() => setPaymentStatus('input')}
              className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
            >
              Try Again
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}