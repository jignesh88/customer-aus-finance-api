// frontend/src/services/api.ts
import axios, { AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

// Define API response types
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
}

// Define account types for CDR API
export interface CDRAccount {
  accountId: string;
  displayName: string;
  nickname?: string;
  accountType: string;
  accountStatus: string;
  balanceUType: string;
  depositRate?: string;
  lendingRate?: string;
  depositRates?: Array<{
    depositRateType: string;
    rate: string;
    additionalInfo?: string;
  }>;
  lendingRates?: Array<{
    lendingRateType: string;
    rate: string;
    additionalInfo?: string;
  }>;
  balance: {
    amount: string;
    currency: string;
  };
  features?: Array<{
    featureType: string;
    additionalInfo?: string;
  }>;
  bundleName?: string;
  specificAccountUType?: string;
  termDeposit?: {
    lodgementDate: string;
    maturityDate: string;
    maturityAmount: string;
    maturityCurrency: string;
    maturityInstructions: string;
  };
  creditCard?: {
    minPaymentAmount: string;
    paymentDueAmount: string;
    paymentCurrency: string;
    paymentDueDate: string;
  };
  loan?: {
    originalStartDate: string;
    originalLoanAmount: string;
    originalLoanCurrency: string;
    loanEndDate: string;
    nextInstalmentDate: string;
    minInstalmentAmount: string;
    minInstalmentCurrency: string;
    maxRedraw: string;
    maxRedrawCurrency: string;
    minRedraw: string;
    minRedrawCurrency: string;
    offsetAccountEnabled: boolean;
    offsetAccountIds: string[];
    repaymentFrequency: string;
    repaymentType: string;
  };
}

// Define transaction types for CDR API
export interface CDRTransaction {
  transactionId: string;
  status: string;
  description: string;
  postingDateTime: string;
  valueDateTime: string;
  executionDateTime: string;
  amount: string;
  currency: string;
  reference: string;
  merchantName?: string;
  merchantCategoryCode?: string;
  billerCode?: string;
  billerName?: string;
  crn?: string;
  apcaNumber?: string;
}

// NPP Payment types
export interface NPPPaymentRequest {
  sourceAccount: {
    accountId: string;
  };
  destinationAccount: {
    accountName: string;
    bsb: string;
    accountNumber: string;
  };
  amount: string;
  currency: string;
  description: string;
  endToEndId?: string;
  paymentReference?: string;
  notificationEmail?: string;
}

export interface NPPPaymentResponse {
  paymentId: string;
  status: string;
  createdAt: string;
}

// BSB Lookup types
export interface BSBDetails {
  bsb: string;
  financialInstitution: string;
  branch: string;
  address: string;
  city: string;
  state: string;
  postcode: string;
  status: string;
  isValid: boolean;
}

// Create API client
class ApiClient {
  private api = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  constructor() {
    this.api.interceptors.request.use(this.addAuthToken);
    this.api.interceptors.response.use(
      this.handleSuccess,
      this.handleError
    );
  }

  private addAuthToken = (config: AxiosRequestConfig): AxiosRequestConfig => {
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers = {
        ...config.headers,
        Authorization: `Bearer ${token}`,
      };
    }
    return config;
  };

  private handleSuccess = (response: AxiosResponse): AxiosResponse => {
    return response;
  };

  private handleError = (error: AxiosError): Promise<never> => {
    if (error.response?.status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  };

  // Authentication
  async login(email: string, password: string): Promise<ApiResponse<{ token: string }>> {
    try {
      const response = await this.api.post('/auth/login', { email, password });
      localStorage.setItem('authToken', response.data.token);
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        data: { token: '' },
        error: error.response?.data?.message || 'Login failed',
      };
    }
  }

  async logout(): Promise<void> {
    localStorage.removeItem('authToken');
  }

  // CDR API
  async getCDRAccounts(): Promise<ApiResponse<{ accounts: CDRAccount[] }>> {
    try {
      const response = await this.api.get('/cdr/accounts');
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        data: { accounts: [] },
        error: error.response?.data?.message || 'Failed to get accounts',
      };
    }
  }

  async getCDRTransactions(
    accountId: string,
    params?: {
      oldest_time?: string;
      newest_time?: string;
      min_amount?: string;
      max_amount?: string;
      page?: number;
      page_size?: number;
    }
  ): Promise<ApiResponse<{ transactions: CDRTransaction[] }>> {
    try {
      const response = await this.api.get(`/cdr/accounts/${accountId}/transactions`, {
        params,
      });
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        data: { transactions: [] },
        error: error.response?.data?.message || 'Failed to get transactions',
      };
    }
  }

  // NPP API
  async createNPPPayment(paymentDetails: NPPPaymentRequest): Promise<ApiResponse<NPPPaymentResponse>> {
    try {
      const response = await this.api.post('/npp/payments', paymentDetails);
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        data: { paymentId: '', status: 'FAILED', createdAt: new Date().toISOString() },
        error: error.response?.data?.message || 'Failed to create payment',
      };
    }
  }

  async getNPPPaymentStatus(paymentId: string): Promise<ApiResponse<{ status: string }>> {
    try {
      const response = await this.api.get(`/npp/payments/${paymentId}`);
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        data: { status: 'UNKNOWN' },
        error: error.response?.data?.message || 'Failed to get payment status',
      };
    }
  }

  // BSB Lookup
  async lookupBSB(bsbCode: string): Promise<ApiResponse<BSBDetails>> {
    try {
      const response = await this.api.get(`/bsb/${bsbCode}`);
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        data: {
          bsb: bsbCode,
          financialInstitution: '',
          branch: '',
          address: '',
          city: '',
          state: '',
          postcode: '',
          status: 'invalid',
          isValid: false,
        },
        error: error.response?.data?.message || 'Failed to lookup BSB',
      };
    }
  }

  // Yodlee API
  async initiateYodleeConnection(): Promise<ApiResponse<{ url: string }>> {
    try {
      const response = await this.api.post('/yodlee/connect');
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        data: { url: '' },
        error: error.response?.data?.message || 'Failed to initiate Yodlee connection',
      };
    }
  }

  // Illion BankStatements API
  async initiateBankStatements(userData: {
    name: string;
    email: string;
    mobileNumber: string;
  }): Promise<ApiResponse<{ requestId: string; redirectUrl: string }>> {
    try {
      const response = await this.api.post('/illion/bankstatements', userData);
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        data: { requestId: '', redirectUrl: '' },
        error: error.response?.data?.message || 'Failed to initiate bank statements',
      };
    }
  }

  // Basiq API
  async initiateBasiqConnection(userData: {
    email: string;
    mobile: string;
  }): Promise<ApiResponse<{ connectionId: string; url: string }>> {
    try {
      const response = await this.api.post('/basiq/connect', userData);
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        data: { connectionId: '', url: '' },
        error: error.response?.data?.message || 'Failed to initiate Basiq connection',
      };
    }
  }

  // SWIFT API
  async initiateSwiftTransfer(transferDetails: {
    sourceAccount: string;
    destinationAccount: {
      accountName: string;
      accountNumber: string;
      swiftCode: string;
      bankName: string;
      bankAddress: string;
    };
    amount: string;
    currency: string;
    description: string;
    reference: string;
  }): Promise<ApiResponse<{ transferId: string; status: string }>> {
    try {
      const response = await this.api.post('/swift/transfers', transferDetails);
      return { success: true, data: response.data };
    } catch (error) {
      return {
        success: false,
        data: { transferId: '', status: 'FAILED' },
        error: error.response?.data?.message || 'Failed to initiate SWIFT transfer',
      };
    }
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export default apiClient;