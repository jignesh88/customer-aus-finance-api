// frontend/src/components/CDRAccounts.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { CDRAccount } from '@/services/api';
import apiClient from '@/services/api';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { formatCurrency } from '@/utils/formatters';

const CDRAccounts: React.FC = () => {
  const [accounts, setAccounts] = useState<CDRAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<string>('all');
  const [hideBalances, setHideBalances] = useState<boolean>(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setLoading(true);
    setError(null);

    const response = await apiClient.getCDRAccounts();

    if (response.success) {
      setAccounts(response.data.accounts);
    } else {
      setError(response.error || 'Failed to load accounts');
    }

    setLoading(false);
  };

  const getAccountsByType = (type: string) => {
    if (type === 'all') {
      return accounts;
    }
    return accounts.filter(account => account.accountType.toLowerCase().includes(type.toLowerCase()));
  };

  const getAccountTypeIcon = (accountType: string) => {
    const type = accountType.toLowerCase();
    if (type.includes('savings')) {
      return '💰';
    } else if (type.includes('transaction')) {
      return '💳';
    } else if (type.includes('loan') || type.includes('mortgage')) {
      return '🏠';
    } else if (type.includes('term') || type.includes('deposit')) {
      return '📈';
    } else if (type.includes('credit')) {
      return '💵';
    } else {
      return '🏦';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading your accounts...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative" role="alert">
        <strong className="font-bold">Error!</strong>
        <span className="block sm:inline"> {error}</span>
        <Button 
          variant="outline" 
          className="mt-2" 
          onClick={fetchAccounts}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Your Accounts</h2>
        <div className="flex space-x-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setHideBalances(!hideBalances)}
          >
            {hideBalances ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
            {hideBalances ? 'Show Balances' : 'Hide Balances'}
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchAccounts}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="all" onValueChange={setSelectedTab}>
        <TabsList className="grid grid-cols-5 mb-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="transaction">Transaction</TabsTrigger>
          <TabsTrigger value="savings">Savings</TabsTrigger>
          <TabsTrigger value="credit">Credit</TabsTrigger>
          <TabsTrigger value="loan">Loans</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedTab}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {getAccountsByType(selectedTab).map(account => (
              <Card key={account.accountId} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle>
                        <span className="mr-2">{getAccountTypeIcon(account.accountType)}</span>
                        {account.nickname || account.displayName}
                      </CardTitle>
                      <CardDescription>
                        {account.accountType} {account.accountStatus && `• ${account.accountStatus}`}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div>
                      <div className="text-sm text-muted-foreground">Account Number</div>
                      <div className="font-mono">••••{account.accountId.slice(-4)}</div>
                    </div>
                    
                    <div>
                      <div className="text-sm text-muted-foreground">Balance</div>
                      <div className="text-2xl font-bold">
                        {hideBalances 
                          ? '••••••'
                          : formatCurrency(
                              parseFloat(account.balance.amount),
                              account.balance.currency
                            )
                        }
                      </div>
                    </div>
                    
                    {account.depositRate && (
                      <div>
                        <div className="text-sm text-muted-foreground">Interest Rate</div>
                        <div>{account.depositRate}%</div>
                      </div>
                    )}
                    
                    {account.lendingRate && (
                      <div>
                        <div className="text-sm text-muted-foreground">Interest Rate</div>
                        <div>{account.lendingRate}%</div>
                      </div>
                    )}
                    
                    {account.creditCard && (
                      <div>
                        <div className="text-sm text-muted-foreground">Payment Due</div>
                        <div className="font-semibold text-red-600">
                          {hideBalances 
                            ? '••••••'
                            : formatCurrency(
                                parseFloat(account.creditCard.paymentDueAmount),
                                account.creditCard.paymentCurrency
                              )
                          }
                          <span className="text-sm font-normal ml-2">
                            (Due: {new Date(account.creditCard.paymentDueDate).toLocaleDateString()})
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="border-t bg-muted/50 px-6 py-3">
                  <div className="flex justify-between w-full">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.location.href = `/accounts/${account.accountId}/transactions`}
                    >
                      View Transactions
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.location.href = `/accounts/${account.accountId}/details`}
                    >
                      Account Details
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            ))}
          </div>
          
          {getAccountsByType(selectedTab).length === 0 && (
            <div className="text-center py-10">
              <p className="text-muted-foreground">No {selectedTab !== 'all' ? selectedTab : ''} accounts found.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CDRAccounts;