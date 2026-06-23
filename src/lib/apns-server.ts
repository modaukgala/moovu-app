import { connect } from "node:http2";
import { createSign } from "node:crypto";

type ApnsSendParams = {
  token: string;
  appType?: string | null;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, string | number | boolean | null | undefined>;
  sound?: string;
};

type ApnsResult =
  | { ok: true }
  | { ok: false; status?: number; reason: string; removeToken?: boolean };

const DEFAULT_CUSTOMER_BUNDLE_ID = "com.moovu.customer";
const DEFAULT_DRIVER_BUNDLE_ID = "com.moovu.driver";
const DEFAULT_SOUND = "moovu_premium_alert.wav";

let cachedJwt: { token: string; expiresAt: number } | null = null;

function base64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizePrivateKey(raw: string) {
  const trimmed = raw.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("BEGIN PRIVATE KEY")) return trimmed;

  return [
    "-----BEGIN PRIVATE KEY-----",
    trimmed,
    "-----END PRIVATE KEY-----",
  ].join("\n");
}

function getApnsAuthKey() {
  const raw =
    process.env.APNS_AUTH_KEY ||
    process.env.APNS_PRIVATE_KEY ||
    process.env.IOS_APNS_AUTH_KEY ||
    "";
  return raw ? normalizePrivateKey(raw) : "";
}

export function hasApnsConfig() {
  return Boolean(
    process.env.APNS_TEAM_ID &&
      process.env.APNS_KEY_ID &&
      getApnsAuthKey()
  );
}

function createProviderToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresAt > now + 60) return cachedJwt.token;

  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const privateKey = getApnsAuthKey();

  if (!teamId || !keyId || !privateKey) {
    throw new Error("APNs is not configured. Set APNS_TEAM_ID, APNS_KEY_ID, and APNS_AUTH_KEY.");
  }

  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: now }));
  const signingInput = `${header}.${claims}`;
  const signature = createSign("SHA256")
    .update(signingInput)
    .end()
    .sign(privateKey);
  const token = `${signingInput}.${base64url(signature)}`;

  cachedJwt = {
    token,
    expiresAt: now + 50 * 60,
  };

  return token;
}

export function getApnsBundleIdForAppType(appType?: string | null) {
  const normalized = String(appType ?? "").toLowerCase();

  if (normalized.includes("driver")) {
    return process.env.APNS_DRIVER_BUNDLE_ID || DEFAULT_DRIVER_BUNDLE_ID;
  }

  return process.env.APNS_CUSTOMER_BUNDLE_ID || DEFAULT_CUSTOMER_BUNDLE_ID;
}

function apnsHost() {
  const env = String(process.env.APNS_ENV || process.env.NODE_ENV || "production").toLowerCase();
  return env === "sandbox" || env === "development"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

function compactData(data: ApnsSendParams["data"]) {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value === undefined || value === null) continue;
    result[key] = String(value);
  }
  return result;
}

export async function sendApnsToDeviceToken(params: ApnsSendParams): Promise<ApnsResult> {
  if (!hasApnsConfig()) {
    return {
      ok: false,
      reason: "APNs is not configured. Set APNS_TEAM_ID, APNS_KEY_ID, APNS_AUTH_KEY, and upload the APNs key to Apple/Firebase setup notes.",
    };
  }

  const token = params.token.trim().replace(/[<>\s]/g, "");
  if (!token || token.length < 20) {
    return { ok: false, reason: "Invalid APNs device token.", removeToken: true };
  }

  const bundleId = getApnsBundleIdForAppType(params.appType);
  const providerToken = createProviderToken();
  const payload = JSON.stringify({
    aps: {
      alert: {
        title: params.title,
        body: params.body,
      },
      sound: params.sound || DEFAULT_SOUND,
      badge: 1,
    },
    url: params.url || "/",
    data: compactData(params.data),
  });

  return new Promise<ApnsResult>((resolve) => {
    const client = connect(apnsHost());
    let settled = false;

    const finish = (result: ApnsResult) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(result);
    };

    client.on("error", (error) => {
      finish({ ok: false, reason: error.message || "APNs connection failed." });
    });

    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${providerToken}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
    });

    let status = 0;
    let responseBody = "";

    request.setEncoding("utf8");
    request.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    request.on("data", (chunk) => {
      responseBody += chunk;
    });
    request.on("error", (error) => {
      finish({ ok: false, reason: error.message || "APNs request failed." });
    });
    request.on("end", () => {
      if (status >= 200 && status < 300) {
        finish({ ok: true });
        return;
      }

      let reason = responseBody || `APNs failed with status ${status || "unknown"}.`;
      try {
        const parsed = JSON.parse(responseBody) as { reason?: string };
        reason = parsed.reason || reason;
      } catch {}

      finish({
        ok: false,
        status,
        reason,
        removeToken: status === 410 || reason === "BadDeviceToken" || reason === "Unregistered",
      });
    });
    request.end(payload);
  });
}
