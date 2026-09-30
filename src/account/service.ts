import type { Account, AccountId, CreateAccountInput } from "./domain";
import type { PreparedEmailVerificationToken } from "./email-verification";
import { hashPassword } from "./password";
import type { AccountRepository } from "./repository";
import {
  normalizeCountryCode,
  normalizeEmail,
  normalizeFullName,
  normalizeMobileNumber,
  validateCreateAccountInput,
  validatePassword,
} from "./validation";

export class AccountService {
  constructor(
    private readonly repository: AccountRepository,
    private readonly passwordHasher: (password: string) => Promise<string> = hashPassword,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => AccountId = () => `acct_${crypto.randomUUID()}`,
  ) {}

  async create(input: CreateAccountInput): Promise<Account> {
    const { account, passwordHash } = await this.prepareAccount(input);
    await this.repository.create(account, passwordHash);
    return account;
  }

  async createWithVerification(
    input: CreateAccountInput,
    prepareToken: (accountId: AccountId, createdAt: string) => Promise<PreparedEmailVerificationToken>,
  ): Promise<{ account: Account; verificationToken: string }> {
    const { account, passwordHash } = await this.prepareAccount(input);
    const preparedToken = await prepareToken(account.id, account.createdAt);
    await this.repository.create(account, passwordHash, preparedToken.record);
    return { account, verificationToken: preparedToken.token };
  }

  private async prepareAccount(input: CreateAccountInput): Promise<{ account: Account; passwordHash: string }> {
    const termsVersion = validateCreateAccountInput(input);
    validatePassword(input.password);

    const now = this.clock().toISOString();
    const marketingConsent = input.marketingConsent === true;
    const account: Account = {
      id: this.createId(),
      fullName: normalizeFullName(input.fullName),
      email: normalizeEmail(input.email),
      countryCode: normalizeCountryCode(input.countryCode),
      mobileNumber: normalizeMobileNumber(input.mobileNumber),
      status: "PENDING_EMAIL_VERIFICATION",
      emailVerifiedAt: null,
      mobileVerifiedAt: null,
      termsAcceptedAt: now,
      termsVersion,
      marketingConsent,
      marketingConsentAt: marketingConsent ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    const passwordHash = await this.passwordHasher(input.password);
    return { account, passwordHash };
  }

  findByEmail(email: string): Promise<Account | null> {
    return this.repository.findByEmail(normalizeEmail(email));
  }

  findByMobileNumber(mobileNumber: string): Promise<Account | null> {
    return this.repository.findByMobileNumber(normalizeMobileNumber(mobileNumber));
  }
}