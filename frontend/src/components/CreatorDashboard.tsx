/**
 * CreatorDashboard Component
 * Main dashboard for content creators
 */

'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3,
  DollarSign,
  Eye,
  Users,
  Plus,
  Settings,
  Download,
  Shield,
  Smartphone,
  AlertTriangle,
  TrendingUp,
  Calendar,
  ExternalLink
} from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

interface CreatorDashboardProps {
  creatorAddress: string;
}

interface ContentItem {
  id: string;
  title: string;
  type: 'video' | 'document' | 'livestream' | 'api' | 'software';
  price: number;
  views: number;
  revenue: number;
  devices: number;
  maxDevices: number;
  status: 'active' | 'paused' | 'archived';
  createdAt: string;
}

interface DeviceActivity {
  fingerprintHash: string;
  accessCount: number;
  lastAccess: string;
  suspicionScore: number;
  isBlacklisted: boolean;
  linkedContent: string[];
}

interface AnalyticsData {
  totalRevenue: number;
  totalViews: number;
  totalSubscribers: number;
  activeContent: number;
  revenueChart: Array<{ date: string; revenue: number; views: number }>;
  deviceStats: {
    totalDevices: number;
    suspiciousDevices: number;
    blacklistedDevices: number;
  };
}

export function CreatorDashboard({ creatorAddress }: CreatorDashboardProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [devices, setDevices] = useState<DeviceActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, [creatorAddress]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      // Mock data - in real implementation, fetch from API
      const mockAnalytics: AnalyticsData = {
        totalRevenue: 2847.50,
        totalViews: 15420,
        totalSubscribers: 342,
        activeContent: 12,
        revenueChart: [
          { date: '2024-01-01', revenue: 245, views: 1200 },
          { date: '2024-01-02', revenue: 312, views: 1450 },
          { date: '2024-01-03', revenue: 189, views: 980 },
          { date: '2024-01-04', revenue: 423, views: 1890 },
          { date: '2024-01-05', revenue: 356, views: 1650 },
          { date: '2024-01-06', revenue: 498, views: 2100 },
          { date: '2024-01-07', revenue: 624, views: 2300 },
        ],
        deviceStats: {
          totalDevices: 1247,
          suspiciousDevices: 23,
          blacklistedDevices: 5
        }
      };

      const mockContent: ContentItem[] = [
        {
          id: '1',
          title: 'Liverpool vs Chelsea - Match Highlights',
          type: 'video',
          price: 5.0,
          views: 3420,
          revenue: 1247.50,
          devices: 287,
          maxDevices: 3,
          status: 'active',
          createdAt: '2024-01-15'
        },
        {
          id: '2',
          title: 'Football Analysis Premium Report',
          type: 'document',
          price: 2.5,
          views: 1890,
          revenue: 423.75,
          devices: 156,
          maxDevices: 2,
          status: 'active',
          createdAt: '2024-01-14'
        },
        {
          id: '3',
          title: 'Live Commentary Stream',
          type: 'livestream',
          price: 10.0,
          views: 890,
          revenue: 1156.00,
          devices: 89,
          maxDevices: 1,
          status: 'paused',
          createdAt: '2024-01-13'
        }
      ];

      const mockDevices: DeviceActivity[] = [
        {
          fingerprintHash: 'abc123...def',
          accessCount: 45,
          lastAccess: '2024-01-15T10:30:00Z',
          suspicionScore: 15,
          isBlacklisted: false,
          linkedContent: ['1', '2']
        },
        {
          fingerprintHash: 'xyz789...ghi',
          accessCount: 23,
          lastAccess: '2024-01-15T09:15:00Z',
          suspicionScore: 85,
          isBlacklisted: false,
          linkedContent: ['1', '3']
        },
        {
          fingerprintHash: 'def456...jkl',
          accessCount: 156,
          lastAccess: '2024-01-15T08:45:00Z',
          suspicionScore: 95,
          isBlacklisted: true,
          linkedContent: ['1', '2', '3']
        }
      ];

      setAnalytics(mockAnalytics);
      setContent(mockContent);
      setDevices(mockDevices);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateContent = () => {
    // Navigate to content creation page
    console.log('Create new content');
  };

  const handleWithdraw = async () => {
    try {
      // Implement withdrawal logic
      console.log('Withdraw earnings');
    } catch (error) {
      console.error('Withdrawal failed:', error);
    }
  };

  const handleRevokeDevice = async (fingerprintHash: string) => {
    try {
      // Implement device revocation
      console.log('Revoke device:', fingerprintHash);
    } catch (error) {
      console.error('Device revocation failed:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Creator Dashboard
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage your content and track earnings
          </p>
        </div>
        <button
          onClick={handleCreateContent}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Create Content
        </button>
      </div>

      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        {/* Tab Navigation */}
        <Tabs.List className="flex space-x-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800 mb-8">
          <Tabs.Trigger
            value="overview"
            className="rounded-md px-4 py-2 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-gray-700 dark:data-[state=active]:text-gray-100"
          >
            Overview
          </Tabs.Trigger>
          <Tabs.Trigger
            value="content"
            className="rounded-md px-4 py-2 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-gray-700 dark:data-[state=active]:text-gray-100"
          >
            Content
          </Tabs.Trigger>
          <Tabs.Trigger
            value="earnings"
            className="rounded-md px-4 py-2 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-gray-700 dark:data-[state=active]:text-gray-100"
          >
            Earnings
          </Tabs.Trigger>
          <Tabs.Trigger
            value="devices"
            className="rounded-md px-4 py-2 text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-gray-700 dark:data-[state=active]:text-gray-100"
          >
            Devices
          </Tabs.Trigger>
        </Tabs.List>

        {/* Overview Tab */}
        <Tabs.Content value="overview" className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Total Revenue</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    ${analytics?.totalRevenue.toFixed(2)}
                  </p>
                </div>
                <div className="bg-green-100 dark:bg-green-900 p-3 rounded-full">
                  <DollarSign className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <div className="flex items-center mt-2 text-xs">
                <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
                <span className="text-green-600 dark:text-green-400">+12.5% from last month</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Total Views</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {analytics?.totalViews.toLocaleString()}
                  </p>
                </div>
                <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded-full">
                  <Eye className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
              <div className="flex items-center mt-2 text-xs">
                <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
                <span className="text-green-600 dark:text-green-400">+8.2% from last week</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Subscribers</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {analytics?.totalSubscribers}
                  </p>
                </div>
                <div className="bg-purple-100 dark:bg-purple-900 p-3 rounded-full">
                  <Users className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
              </div>
              <div className="flex items-center mt-2 text-xs">
                <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
                <span className="text-green-600 dark:text-green-400">+15 new this week</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Active Content</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {analytics?.activeContent}
                  </p>
                </div>
                <div className="bg-orange-100 dark:bg-orange-900 p-3 rounded-full">
                  <BarChart3 className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                </div>
              </div>
              <div className="flex items-center mt-2 text-xs">
                <Calendar className="h-3 w-3 text-gray-400 mr-1" />
                <span className="text-gray-600 dark:text-gray-400">2 created this week</span>
              </div>
            </motion.div>
          </div>

          {/* Revenue Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700"
          >
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
              Revenue Overview
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={analytics?.revenueChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>

          {/* Device Security Overview */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700"
          >
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
              Device Security
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {analytics?.deviceStats.totalDevices}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Total Devices</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                  {analytics?.deviceStats.suspiciousDevices}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Suspicious</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {analytics?.deviceStats.blacklistedDevices}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Blacklisted</div>
              </div>
            </div>
          </motion.div>
        </Tabs.Content>

        {/* Content Tab */}
        <Tabs.Content value="content" className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                Your Content
              </h3>
              <div className="space-y-4">
                {content.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
                  >
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900 dark:text-gray-100">
                        {item.title}
                      </h4>
                      <div className="flex items-center gap-4 mt-1 text-sm text-gray-600 dark:text-gray-400">
                        <span>${item.price} USDC</span>
                        <span>{item.views} views</span>
                        <span>{item.devices}/{item.maxDevices} devices</span>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          item.status === 'active' 
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        ${item.revenue}
                      </span>
                      <button className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <Settings className="h-4 w-4" />
                      </button>
                      <button className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <ExternalLink className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Tabs.Content>

        {/* Earnings Tab */}
        <Tabs.Content value="earnings" className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                Available Balance
              </h3>
              <button
                onClick={handleWithdraw}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
              >
                <Download className="h-4 w-4" />
                Withdraw
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="text-center p-6 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  $2,847.50
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Available to withdraw
                </div>
              </div>
              <div className="text-center p-6 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  $156.30
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Pending settlement
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-3">
                Withdrawal Options
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="bg-blue-100 dark:bg-blue-900 p-2 rounded-full">
                      <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      USDC to Wallet
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Withdraw directly to your connected wallet
                  </p>
                </div>
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="bg-green-100 dark:bg-green-900 p-2 rounded-full">
                      <Smartphone className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      M-Pesa Cashout
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Convert to KES and send to M-Pesa
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Tabs.Content>

        {/* Devices Tab */}
        <Tabs.Content value="devices" className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-6">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                Device Activity Monitor
              </h3>
              <div className="space-y-4">
                {devices.map((device) => (
                  <div
                    key={device.fingerprintHash}
                    className={`p-4 border rounded-lg ${
                      device.isBlacklisted
                        ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20'
                        : device.suspicionScore > 70
                        ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono text-gray-700 dark:text-gray-300">
                            {device.fingerprintHash}
                          </code>
                          {device.isBlacklisted && (
                            <span className="px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full dark:bg-red-900 dark:text-red-200">
                              Blacklisted
                            </span>
                          )}
                          {!device.isBlacklisted && device.suspicionScore > 70 && (
                            <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full dark:bg-yellow-900 dark:text-yellow-200">
                              Suspicious
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-gray-600 dark:text-gray-400">
                          <span>{device.accessCount} accesses</span>
                          <span>Suspicion: {device.suspicionScore}%</span>
                          <span>Content: {device.linkedContent.length} items</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!device.isBlacklisted && (
                          <button
                            onClick={() => handleRevokeDevice(device.fingerprintHash)}
                            className="flex items-center gap-1 px-3 py-1 text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                          >
                            <Shield className="h-3 w-3" />
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}