// frontend/src/utils/formatters.ts

/**
 * Format a number with commas for thousands
 */
export const formatNumber = (value: number): string => {
  return new Intl.NumberFormat().format(value);
};

/**
 * Format a number to a specified number of decimal places
 */
export const formatToDecimalPlaces = (value: number, decimalPlaces: number = 2): string => {
  return value.toFixed(decimalPlaces);
};

/**
 * Format a number as a percentage
 */
export const formatPercentage = (value: number, decimalPlaces: number = 2): string => {
  return `${(value * 100).toFixed(decimalPlaces)}%`;
};

/**
 * Format a number as currency
 */
export const formatCurrency = (
  value: number, 
  currencyCode: string = 'AUD', 
  locale: string = 'en-AU'
): string => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
  }).format(value);
};

/**
 * Format a date in Australian format (DD/MM/YYYY)
 */
export const formatDate = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-AU');
};

/**
 * Format a date and time in Australian format (DD/MM/YYYY HH:MM)
 */
export const formatDateTime = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${d.toLocaleDateString('en-AU')} ${d.toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

/**
 * Format a BSB number with hyphen (XXX-XXX)
 */
export const formatBSB = (bsb: string): string => {
  // Remove any existing non-numeric characters
  const cleanBSB = bsb.replace(/\D/g, '');
  
  // Format as XXX-XXX if it's a 6-digit number
  if (cleanBSB.length === 6) {
    return `${cleanBSB.substring(0, 3)}-${cleanBSB.substring(3)}`;
  }
  
  // Otherwise return as is
  return cleanBSB;
};

/**
 * Format an account number with masked digits for security
 */
export const formatAccountNumber = (accountNumber: string, visibleDigits: number = 4): string => {
  const cleanAccountNumber = accountNumber.replace(/\s/g, '');
  const masked = '•'.repeat(cleanAccountNumber.length - visibleDigits);
  return masked + cleanAccountNumber.slice(-visibleDigits);
};

/**
 * Format a file size (bytes to KB, MB, GB)
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
};

/**
 * Format a phone number in Australian format
 * (e.g., 0412 345 678 or 02 1234 5678)
 */
export const formatPhoneNumber = (phoneNumber: string): string => {
  // Remove any non-numeric characters
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Format mobile number (starting with 04)
  if (cleaned.startsWith('04') && cleaned.length === 10) {
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
  }
  
  // Format landline with area code
  if (cleaned.length === 10 && (cleaned.startsWith('02') || cleaned.startsWith('03') || 
      cleaned.startsWith('07') || cleaned.startsWith('08'))) {
    return `${cleaned.slice(0, 2)} ${cleaned.slice(2, 6)} ${cleaned.slice(6)}`;
  }
  
  // Return as is if it doesn't match expected formats
  return phoneNumber;
};