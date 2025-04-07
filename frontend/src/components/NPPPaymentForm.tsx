// frontend/src/components/NPPPaymentForm.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { CDRAccount, NPPPaymentRequest } from '@/services/api';
import apiClient from '@/services/api';
import { formatCurrency, formatBSB } from '@/utils/formatters';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// Schema for form validation
const paymentFormSchema = z.object({
  sourceAccountId: z.string({
    required_error: 'Please select a source account',
  }),
  destinationAccountName: z.string().min(2, {
    message: 'Account name must be at least 2 characters',
  }),
  destinationBSB: z.string().refine(
    (val) => /^\d{6}$/.test(val.replace(/[^0-9]/g, '')),
    {
      message: 'BSB must be 6 digits',
    }
  ),
  destinationAccountNumber: z.string().refine(
    (val) => /^\d{6,10}$/.test(val.replace(/[^0-9]/g, '')),
    {
      message: 'Account number must be between 6 and 10 digits',
    }
  ),
  amount: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    {
      message: 'Amount must be greater than 0',
    }
  ),
  description: z.string().min(2, {
    message: 'Description must be at least 2 characters',
  }),
  paymentReference: z.string().optional(),
  notificationEmail: z.string().email({
    message: 'Please enter a valid email',
  }).optional().or(z.literal('')),
});

type PaymentFormValues = z.infer<typeof paymentFormSchema>;

interface NPPPaymentFormProps {
  onSuccess?: (paymentId: string) => void;
}

enum PaymentStatus {
  IDLE = 'idle',
  VALIDATING_BSB = 'validating_bsb',
  SUBMITTING = 'submitting',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  ERROR = 'error',
}

const NPPPaymentForm: React.FC<NPPPaymentFormProps> = ({ onSuccess }) => {
  const [accounts, setAccounts] = useState<CDRAccount[]>([]);
  const [status, setStatus] = useState<PaymentStatus>(PaymentStatus.IDLE);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bsbDetails, setBsbDetails] = useState<{ 
    financialInstitution: string;
    branch: string;
    isValid: boolean;
  } | null>(null);

  // Initialize form
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      sourceAccountId: '',
      destinationAccountName: '',
      destinationBSB: '',
      destinationAccountNumber: '',
      amount: '',
      description: '',
      paymentReference: '',
      notificationEmail: '',
    },
  });

  // Load accounts on component mount
  useEffect(() => {
    fetchAccounts();
  }, []);

  // Fetch available accounts
  const fetchAccounts = async () => {
    const response = await apiClient.getCDRAccounts();
    if (response.success) {
      // Filter to only show transaction accounts
      const transactionAccounts = response.data.accounts.filter(
        account => account.accountType.toLowerCase().includes('transaction')
      );
      setAccounts(transactionAccounts);
    } else {
      setErrorMessage(response.error || 'Failed to load accounts');
    }
  };

  // Validate BSB when the field changes
  const validateBSB = async (bsb: string) => {
    // Clean BSB format
    const cleanBSB = bsb.replace(/[^0-9]/g, '');
    if (cleanBSB.length !== 6) return;

    setStatus(PaymentStatus.VALIDATING_BSB);
    setBsbDetails(null);

    try {
      const response = await apiClient.lookupBSB(cleanBSB);
      if (response.success && response.data) {
        setBsbDetails({
          financialInstitution: response.data.financialInstitution,
          branch: response.data.branch,
          isValid: response.data.isValid,
        });
      } else {
        setBsbDetails({
          financialInstitution: '',
          branch: '',
          isValid: false,
        });
      }
    } catch (error) {
      setBsbDetails({
        financialInstitution: '',
        branch: '',
        isValid: false,
      });
    } finally {
      setStatus(PaymentStatus.IDLE);
    }
  };

  // Handle form submission
  const onSubmit = async (values: PaymentFormValues) => {
    setStatus(PaymentStatus.SUBMITTING);
    setErrorMessage(null);

    // Clean input values
    const cleanBSB = values.destinationBSB.replace(/[^0-9]/g, '');
    const cleanAccountNumber = values.destinationAccountNumber.replace(/[^0-9]/g, '');
    const amount = parseFloat(values.amount).toFixed(2);

    // Create payment request
    const paymentRequest: NPPPaymentRequest = {
      sourceAccount: {
        accountId: values.sourceAccountId,
      },
      destinationAccount: {
        accountName: values.destinationAccountName,
        bsb: cleanBSB,
        accountNumber: cleanAccountNumber,
      },
      amount,
      currency: 'AUD',
      description: values.description,
      paymentReference: values.paymentReference || undefined,
      notificationEmail: values.notificationEmail || undefined,
    };

    try {
      const response = await apiClient.createNPPPayment(paymentRequest);
      
      if (response.success) {
        setPaymentId(response.data.paymentId);
        setStatus(PaymentStatus.PROCESSING);
        
        // Poll for payment status
        await pollPaymentStatus(response.data.paymentId);
      } else {
        setErrorMessage(response.error || 'Payment creation failed');
        setStatus(PaymentStatus.ERROR);
      }
    } catch (error) {
      setErrorMessage('An unexpected error occurred');
      setStatus(PaymentStatus.ERROR);
    }
  };

  // Poll for payment status
  const pollPaymentStatus = async (id: string) => {
    let attempts = 0;
    const maxAttempts = 10;
    const pollInterval = 2000; // 2 seconds

    const checkStatus = async () => {
      attempts++;
      
      try {
        const response = await apiClient.getNPPPaymentStatus(id);
        
        if (response.success) {
          if (response.data.status === 'COMPLETED') {
            setStatus(PaymentStatus.SUCCESS);
            if (onSuccess) onSuccess(id);
            return;
          } else if (response.data.status === 'FAILED') {
            setErrorMessage('Payment processing failed');
            setStatus(PaymentStatus.ERROR);
            return;
          }
        }
        
        // Continue polling if not completed or failed and not reached max attempts
        if (attempts < maxAttempts) {
          setTimeout(checkStatus, pollInterval);
        } else {
          // Stop polling after max attempts
          setErrorMessage('Payment status check timed out. Please check your payment status later.');
          setStatus(PaymentStatus.ERROR);
        }
      } catch (error) {
        setErrorMessage('Failed to check payment status');
        setStatus(PaymentStatus.ERROR);
      }
    };

    // Start polling
    setTimeout(checkStatus, pollInterval);
  };

  // Reset form
  const resetForm = () => {
    form.reset();
    setStatus(PaymentStatus.IDLE);
    setPaymentId(null);
    setErrorMessage(null);
    setBsbDetails(null);
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Make a Payment</CardTitle>
        <CardDescription>
          Send money instantly using the New Payments Platform (NPP).
        </CardDescription>
      </CardHeader>

      <CardContent>
        {status === PaymentStatus.SUCCESS ? (
          <div className="space-y-4">
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">Payment Successful!</AlertTitle>
              <AlertDescription className="text-green-700">
                Your payment has been processed successfully. Payment ID: {paymentId}
              </AlertDescription>
            </Alert>
            <Button onClick={resetForm} className="w-full mt-4">
              Make Another Payment
            </Button>
          </div>
        ) : status === PaymentStatus.ERROR ? (
          <div className="space-y-4">
            <Alert className="bg-red-50 border-red-200">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertTitle className="text-red-800">Payment Error</AlertTitle>
              <AlertDescription className="text-red-700">
                {errorMessage || 'An error occurred while processing your payment.'}
              </AlertDescription>
            </Alert>
            <Button onClick={resetForm} className="w-full mt-4">
              Try Again
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* From Account */}
              <FormField
                control={form.control}
                name="sourceAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Account</FormLabel>
                    <Select
                      disabled={status !== PaymentStatus.IDLE}
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem key={account.accountId} value={account.accountId}>
                            {account.nickname || account.displayName} ({formatCurrency(parseFloat(account.balance.amount))})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Recipient Details */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Recipient Details</h3>
                
                {/* Account Name */}
                <FormField
                  control={form.control}
                  name="destinationAccountName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={status !== PaymentStatus.IDLE}
                          placeholder="Recipient's account name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {/* BSB */}
                <FormField
                  control={form.control}
                  name="destinationBSB"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>BSB</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={status !== PaymentStatus.IDLE}
                          placeholder="123-456"
                          onChange={(e) => {
                            field.onChange(e);
                            validateBSB(e.target.value);
                          }}
                          value={formatBSB(field.value)}
                        />
                      </FormControl>
                      {status === PaymentStatus.VALIDATING_BSB && (
                        <div className="flex items-center mt-1 text-sm text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          Validating BSB...
                        </div>
                      )}
                      {bsbDetails && (
                        <div className={`mt-1 text-sm ${bsbDetails.isValid ? 'text-green-600' : 'text-red-600'}`}>
                          {bsbDetails.isValid ? (
                            <div className="flex items-center">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              {bsbDetails.financialInstitution}, {bsbDetails.branch}
                            </div>
                          ) : (
                            <div className="flex items-center">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              Invalid BSB code
                            </div>
                          )}
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {/* Account Number */}
                <FormField
                  control={form.control}
                  name="destinationAccountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Number</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={status !== PaymentStatus.IDLE}
                          placeholder="Account number"
                          onChange={(e) => {
                            // Only allow numbers
                            const value = e.target.value.replace(/[^0-9]/g, '');
                            field.onChange(value);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Payment Details */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Payment Details</h3>
                
                {/* Amount */}
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount (AUD)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 transform -translate-y-1/2">$</span>
                          <Input
                            {...field}
                            disabled={status !== PaymentStatus.IDLE}
                            placeholder="0.00"
                            className="pl-7"
                            onChange={(e) => {
                              // Format input to allow only numbers and decimal points
                              const value = e.target.value.replace(/[^0-9.]/g, '');
                              
                              // Ensure only one decimal point
                              const parts = value.split('.');
                              const formattedValue = parts.length > 1 
                                ? `${parts[0]}.${parts.slice(1).join('')}` 
                                : value;
                              
                              field.onChange(formattedValue);
                            }}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {/* Description */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          disabled={status !== PaymentStatus.IDLE}
                          placeholder="What's this payment for?"
                          className="resize-none"
                        />
                      </FormControl>
                      <FormDescription>
                        This will appear on your transaction history.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {/* Payment Reference */}
                <FormField
                  control={form.control}
                  name="paymentReference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Reference (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={status !== PaymentStatus.IDLE}
                          placeholder="Reference for recipient"
                        />
                      </FormControl>
                      <FormDescription>
                        This will be visible to the recipient.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {/* Notification Email */}
                <FormField
                  control={form.control}
                  name="notificationEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notification Email (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={status !== PaymentStatus.IDLE}
                          type="email"
                          placeholder="Email for payment confirmation"
                        />
                      </FormControl>
                      <FormDescription>
                        We'll send a payment receipt to this email.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full"
                disabled={status !== PaymentStatus.IDLE}
              >
                {status === PaymentStatus.SUBMITTING || status === PaymentStatus.PROCESSING ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {status === PaymentStatus.SUBMITTING ? 'Processing...' : 'Confirming...'}
                  </>
                ) : (
                  'Make Payment'
                )}
              </Button>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
};

export default NPPPaymentForm;