const ISO_3166_ALPHA_2_CODES = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "),
);

export class AccountValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountValidationError";
  }
}

export function normalizeFullName(value: string): string {
  const fullName = value.normalize("NFC").trim();
  if (!fullName || Array.from(fullName).length > 200 || /[\u0000-\u001f\u007f]/u.test(fullName)) {
    throw new AccountValidationError("Full name is invalid.");
  }
  return fullName;
}

export function normalizeEmail(value: string): string {
  const email = value.trim().normalize("NFC");
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator !== email.indexOf("@")) {
    throw new AccountValidationError("Email address is invalid.");
  }

  const localPart = email.slice(0, separator);
  const rawDomain = email.slice(separator + 1);
  if (
    localPart.length > 64 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(localPart) ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !rawDomain ||
    /[\s\[\]\/?:#@%\\]/u.test(rawDomain)
  ) {
    throw new AccountValidationError("Email address is invalid.");
  }

  let domain: string;
  try {
    domain = new URL(`http://${rawDomain}`).hostname.toLowerCase();
  } catch {
    throw new AccountValidationError("Email address is invalid.");
  }
  if (
    !domain ||
    domain.length > 253 ||
    !domain.includes(".") ||
    domain.split(".").some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))
  ) {
    throw new AccountValidationError("Email address is invalid.");
  }

  const normalizedEmail = `${localPart.toLowerCase()}@${domain}`;
  if (normalizedEmail.length > 254) {
    throw new AccountValidationError("Email address is invalid.");
  }
  return normalizedEmail;
}

export function normalizeCountryCode(value: string): string {
  const countryCode = value.trim().toUpperCase();
  if (!ISO_3166_ALPHA_2_CODES.has(countryCode)) {
    throw new AccountValidationError("Country must be a valid ISO 3166-1 alpha-2 code.");
  }
  return countryCode;
}

export function normalizeMobileNumber(value: string): string {
  const formatted = value.trim();
  if (!formatted.startsWith("+")) {
    throw new AccountValidationError("Mobile number must include its international country code.");
  }
  const e164 = formatted.replace(/[\s().-]/gu, "");
  if (!/^\+[1-9]\d{1,14}$/u.test(e164)) {
    throw new AccountValidationError("Mobile number must use international E.164 format.");
  }
  return e164;
}

export function validatePassword(password: string): void {
  if (Array.from(password).length < 8) {
    throw new AccountValidationError("Password must be at least 8 characters long.");
  }
  if (new TextEncoder().encode(password).byteLength > 1024) {
    throw new AccountValidationError("Password is too long.");
  }
}

export function validateCreateAccountInput(input: {
  acceptedTerms: boolean;
  termsVersion: string;
}): string {
  if (input.acceptedTerms !== true) {
    throw new AccountValidationError("Terms acceptance is required.");
  }
  const termsVersion = input.termsVersion.trim();
  if (!termsVersion || termsVersion.length > 64) {
    throw new AccountValidationError("Terms version is invalid.");
  }
  return termsVersion;
}