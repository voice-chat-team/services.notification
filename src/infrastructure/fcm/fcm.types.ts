import type { AndroidConfig, ApnsConfig } from 'firebase-admin/messaging';

/** Visible push notification. All data values must be strings. */
export interface FcmNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
  android?: AndroidConfig;
  apns?: ApnsConfig;
}

export interface FcmDeliveryResult {
  token: string;
  success: boolean;
  messageId?: string;
  errorCode?: string;
}

export interface FcmMulticastResult {
  successCount: number;
  failureCount: number;
  results: FcmDeliveryResult[];
  /** Only permanently invalid/unregistered tokens, never transient failures. */
  invalidTokens: string[];
}
