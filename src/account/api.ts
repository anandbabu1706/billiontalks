import { AccountIdentityConflictError, D1AccountRepository, type D1AccountDatabase } from "./repository";
import { AccountService } from "./service";
import { D1EmailVerificationRepository, EmailVerificationService } from "./email-verification";
import { AccountAuthenticationService, clearAccountSessionCookie, setAccountSessionCookie } from "./authentication";
import { D1PasswordResetRepository, PasswordResetService } from "./password-reset";
import { AccountValidationError } from "./validation";

const CURRENT_TERMS_VERSION = "terms-v1";
const MAX_REGISTRATION_BODY_BYTES = 16_384;

type RegistrationBody = {
  fullName: string;
  email: string;
  country: string;
  mobileNumber: string;
  password: string;
  acceptedTerms: boolean;
  marketingConsent?: boolean;
};

function isRegistrationBody(value: unknown): value is RegistrationBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return (
    typeof body.fullName === "string" &&
    typeof body.email === "string" &&
    typeof body.country === "string" &&
    typeof body.mobileNumber === "string" &&
    typeof body.password === "string" &&
    typeof body.acceptedTerms === "boolean" &&
    (body.marketingConsent === undefined || typeof body.marketingConsent === "boolean")
  );
}

function jsonResponse(data: unknown, status: number): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readBoundedBody(request: Request): Promise<{ body: string; tooLarge: boolean }> {
  const reader = request.body?.getReader();
  if (!reader) return { body: "", tooLarge: false };

  const decoder = new TextDecoder();
  let body = "";
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_REGISTRATION_BODY_BYTES) {
      await reader.cancel();
      return { body: "", tooLarge: true };
    }
    body += decoder.decode(value, { stream: true });
  }
  return { body: body + decoder.decode(), tooLarge: false };
}

export async function handleAccountRegistration(request: Request, database?: D1AccountDatabase): Promise<Response> {
  if (!database) {
    return jsonResponse({ ok: false, error: "Account registration is temporarily unavailable." }, 503);
  }

  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REGISTRATION_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "Registration request is too large." }, 413);
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ ok: false, error: "A JSON registration body is required." }, 415);
  }

  let value: unknown;
  try {
    const { body, tooLarge } = await readBoundedBody(request);
    if (tooLarge) {
      return jsonResponse({ ok: false, error: "Registration request is too large." }, 413);
    }
    value = JSON.parse(body);
  } catch {
    return jsonResponse({ ok: false, error: "Registration request is invalid." }, 400);
  }
  if (!isRegistrationBody(value)) {
    return jsonResponse({ ok: false, error: "Registration request is invalid." }, 400);
  }

  try {
    const accounts = new D1AccountRepository(database);
    const verification = new EmailVerificationService(accounts, new D1EmailVerificationRepository(database));
    const { account } = await new AccountService(accounts).createWithVerification({
      fullName: value.fullName,
      email: value.email,
      countryCode: value.country,
      mobileNumber: value.mobileNumber,
      password: value.password,
      acceptedTerms: value.acceptedTerms,
      termsVersion: CURRENT_TERMS_VERSION,
      marketingConsent: value.marketingConsent,
    }, (accountId, createdAt) => verification.prepareToken(accountId, createdAt));
    return jsonResponse({
      ok: true,
      data: {
        account,
        emailVerificationRequired: true,
      },
    }, 201);
  } catch (error) {
    if (error instanceof AccountValidationError) {
      return jsonResponse({ ok: false, error: error.message }, 400);
    }
    if (error instanceof AccountIdentityConflictError) {
      return jsonResponse({ ok: false, error: "An account with these details could not be registered." }, 409);
    }
    return jsonResponse({ ok: false, error: "Account registration failed." }, 500);
  }
}

const GENERIC_RESEND_RESPONSE = {
  ok: true,
  data: { message: "If an unverified account matches that address, the request has been accepted." },
};

export async function handleEmailVerification(request: Request, database?: D1AccountDatabase): Promise<Response> {
  if (!database) {
    return jsonResponse({ ok: false, error: "Email verification is temporarily unavailable." }, 503);
  }
  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REGISTRATION_BODY_BYTES) {
    return jsonResponse({ ok: false, error: "Request is too large." }, 413);
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return jsonResponse({ ok: false, error: "A JSON request body is required." }, 415);
  }

  let value: unknown;
  try {
    const { body, tooLarge } = await readBoundedBody(request);
    if (tooLarge) return jsonResponse({ ok: false, error: "Request is too large." }, 413);
    value = JSON.parse(body);
  } catch {
    return jsonResponse({ ok: false, error: "Request is invalid." }, 400);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return jsonResponse({ ok: false, error: "Request is invalid." }, 400);
  }

  const body = value as Record<string, unknown>;
  const accounts = new D1AccountRepository(database);
  const verification = new EmailVerificationService(accounts, new D1EmailVerificationRepository(database));
  const path = new URL(request.url).pathname;

  if (request.method === "POST" && path === "/api/accounts/verify-email") {
    if (typeof body.token !== "string") {
      return jsonResponse({ ok: false, error: "Verification token is invalid or expired." }, 400);
    }
    try {
      if (!await verification.verify(body.token)) {
        return jsonResponse({ ok: false, error: "Verification token is invalid or expired." }, 400);
      }
      return jsonResponse({ ok: true, data: { emailVerified: true } }, 200);
    } catch {
      return jsonResponse({ ok: false, error: "Email verification failed." }, 500);
    }
  }

  if (request.method === "POST" && path === "/api/accounts/resend-verification") {
    if (typeof body.email === "string") {
      try {
        await verification.resend(body.email);
      } catch {
        return jsonResponse(GENERIC_RESEND_RESPONSE, 202);
      }
    }
    return jsonResponse(GENERIC_RESEND_RESPONSE, 202);
  }

  return jsonResponse({ ok: false, error: "Not found." }, 404);
}

export async function handleAccountLogin(request: Request, database?: D1AccountDatabase): Promise<Response> {
  const invalidCredentials = () => jsonResponse({ ok: false, error: "Invalid email or password." }, 401);
  if (!database) return jsonResponse({ ok: false, error: "Account login is temporarily unavailable." }, 503);

  let value: unknown;
  try {
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return invalidCredentials();
    const { body, tooLarge } = await readBoundedBody(request);
    if (tooLarge) return invalidCredentials();
    value = JSON.parse(body);
  } catch {
    return invalidCredentials();
  }
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    typeof (value as Record<string, unknown>).email !== "string" ||
    typeof (value as Record<string, unknown>).password !== "string"
  ) {
    return invalidCredentials();
  }

  try {
    const body = value as { email: string; password: string };
    const repository = new D1AccountRepository(database);
    const authentication = new AccountAuthenticationService(repository);
    const result = await authentication.login(body.email, body.password, request.headers.get("CF-Connecting-IP") ?? "unknown");
    if (!result) return invalidCredentials();

    const response = jsonResponse({ ok: true, data: { account: result.account } }, 200);
    return setAccountSessionCookie(response, request, result.sessionToken);
  } catch {
    return jsonResponse({ ok: false, error: "Account login failed." }, 500);
  }
}

export async function handleAccountMe(request: Request, database?: D1AccountDatabase): Promise<Response> {
  if (!database) return jsonResponse({ ok: false, error: "Account service is temporarily unavailable." }, 503);
  try {
    const account = await new AccountAuthenticationService(new D1AccountRepository(database)).resolve(request);
    if (!account) return jsonResponse({ ok: false, error: "Authentication required." }, 401);
    return jsonResponse({ ok: true, data: { account } }, 200);
  } catch {
    return jsonResponse({ ok: false, error: "Account lookup failed." }, 500);
  }
}

export async function handleAccountLogout(request: Request, database?: D1AccountDatabase): Promise<Response> {
  if (!database) {
    return clearAccountSessionCookie(
      jsonResponse({ ok: false, error: "Account logout is temporarily unavailable." }, 503),
      request,
    );
  }
  const response = jsonResponse({ ok: true, data: { loggedOut: true } }, 200);
  try {
    await new AccountAuthenticationService(new D1AccountRepository(database)).revoke(request);
  } catch {
    const failedResponse = jsonResponse({ ok: false, error: "Logout failed." }, 500);
    return clearAccountSessionCookie(failedResponse, request);
  }
  return clearAccountSessionCookie(response, request);
}

const GENERIC_PASSWORD_RESET_RESPONSE = {
  ok: true,
  data: { message: "If an active account matches that address, password reset instructions will be sent." },
};

export async function handleForgotPassword(request: Request, database?: D1AccountDatabase): Promise<Response> {
  if (!database) return jsonResponse(GENERIC_PASSWORD_RESET_RESPONSE, 202);
  try {
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return jsonResponse(GENERIC_PASSWORD_RESET_RESPONSE, 202);
    }
    const { body, tooLarge } = await readBoundedBody(request);
    if (tooLarge) return jsonResponse(GENERIC_PASSWORD_RESET_RESPONSE, 202);
    const value: unknown = JSON.parse(body);
    if (typeof value !== "object" || value === null || Array.isArray(value) || typeof (value as Record<string, unknown>).email !== "string") {
      return jsonResponse(GENERIC_PASSWORD_RESET_RESPONSE, 202);
    }

    const accounts = new D1AccountRepository(database);
    const reset = new PasswordResetService(accounts, new D1PasswordResetRepository(database));
    await reset.requestReset((value as { email: string }).email, request.headers.get("CF-Connecting-IP") ?? "unknown");
  } catch {
    return jsonResponse(GENERIC_PASSWORD_RESET_RESPONSE, 202);
  }
  return jsonResponse(GENERIC_PASSWORD_RESET_RESPONSE, 202);
}

export async function handleResetPassword(request: Request, database?: D1AccountDatabase): Promise<Response> {
  if (!database) return jsonResponse({ ok: false, error: "Password reset is temporarily unavailable." }, 503);
  let value: unknown;
  try {
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return jsonResponse({ ok: false, error: "Reset request is invalid." }, 400);
    }
    const { body, tooLarge } = await readBoundedBody(request);
    if (tooLarge) return jsonResponse({ ok: false, error: "Reset request is invalid." }, 400);
    value = JSON.parse(body);
  } catch {
    return jsonResponse({ ok: false, error: "Reset request is invalid." }, 400);
  }
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    typeof (value as Record<string, unknown>).token !== "string" ||
    typeof (value as Record<string, unknown>).newPassword !== "string"
  ) {
    return jsonResponse({ ok: false, error: "Reset request is invalid." }, 400);
  }

  try {
    const body = value as { token: string; newPassword: string };
    const accounts = new D1AccountRepository(database);
    const reset = new PasswordResetService(accounts, new D1PasswordResetRepository(database));
    if (!await reset.reset(body.token, body.newPassword)) {
      return jsonResponse({ ok: false, error: "Reset token is invalid or expired." }, 400);
    }
    return jsonResponse({ ok: true, data: { passwordReset: true } }, 200);
  } catch (error) {
    if (error instanceof AccountValidationError) {
      return jsonResponse({ ok: false, error: error.message }, 400);
    }
    return jsonResponse({ ok: false, error: "Password reset failed." }, 500);
  }
}