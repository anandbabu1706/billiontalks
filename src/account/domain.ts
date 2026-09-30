export type AccountId = `acct_${string}`;

export type AccountStatus =
  | "PENDING_EMAIL_VERIFICATION"
  | "ACTIVE"
  | "SUSPENDED"
  | "CLOSED";

export type Account = {
  id: AccountId;
  fullName: string;
  email: string;
  countryCode: string;
  mobileNumber: string;
  status: AccountStatus;
  emailVerifiedAt: string | null;
  mobileVerifiedAt: string | null;
  termsAcceptedAt: string;
  termsVersion: string;
  marketingConsent: boolean;
  marketingConsentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateAccountInput = {
  fullName: string;
  email: string;
  countryCode: string;
  mobileNumber: string;
  password: string;
  acceptedTerms: boolean;
  termsVersion: string;
  marketingConsent?: boolean;
};

export type AccountProfileUpdate = {
  fullName: string;
  countryCode: string;
  mobileNumber: string;
  mobileVerifiedAt: string | null;
  marketingConsent: boolean;
  marketingConsentAt: string | null;
  updatedAt: string;
};