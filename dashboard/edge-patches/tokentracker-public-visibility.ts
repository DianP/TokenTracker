/**
 * InsForge Edge：公开资料开关。
 * Deno 内优先用 fetch 调 /api/auth/sessions/current 解析 user id（与浏览器 curl 一致）；
 * SDK 的 getCurrentUser() 在部分 Edge 运行时上对出站请求处理不稳定。
 */
import { createClient } from "npm:@insforge/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function extractUserIdFromSessionBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const u =
    (o.user as Record<string, unknown> | undefined) ??
    ((o.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined);
  if (!u || typeof u !== "object") return null;
  const id = u.id ?? u.user_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** JWT payload 中的 sub（网关已校验 token 时与 sessions/current 一致；避免 Edge 内 fetch 解析与浏览器不一致） */
function userIdFromAccessTokenJwt(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payloadPart = parts[1];
    const padded = payloadPart
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(payloadPart.length + ((4 - (payloadPart.length % 4)) % 4), "=");
    const json = atob(padded);
    const payload = JSON.parse(json) as Record<string, unknown>;
    const sub = payload.sub;
    if (typeof sub === "string" && sub.length > 0) return sub;
    const uid = payload.user_id;
    if (typeof uid === "string" && uid.length > 0) return uid;
  } catch {
    /* ignore */
  }
  return null;
}

/** 与前端直连 API 相同：Authorization + 可选 apikey（InsForge 网关推荐同时带） */
async function getUserIdFromSession(
  baseUrl: string,
  token: string,
  anonKey: string | undefined,
): Promise<string | null> {
  const root = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (anonKey) headers.apikey = anonKey;
  const res = await fetch(`${root}/api/auth/sessions/current`, { headers });
  if (res.ok) {
    const body = await res.json().catch(() => null);
    const fromApi = extractUserIdFromSessionBody(body);
    if (fromApi) return fromApi;
  }
  return userIdFromAccessTokenJwt(token);
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  /** 与浏览器请求一致：优先环境变量，否则沿用调用方传入的 apikey（Edge 运行时未必注入 INSFORGE_ANON_KEY） */
  const incomingApiKey =
    req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? undefined;
  const anonKey =
    Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? undefined;
  const authH = req.headers.get("Authorization");
  const token = authH?.startsWith("Bearer ") ? authH.slice(7) : undefined;
  if (!token) return json({ error: "Unauthorized" }, 401);

  const userId = userIdFromAccessTokenJwt(token) || await getUserIdFromSession(baseUrl, token, anonKey);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  // 优先用 service role key 操作 DB，避免用户短期 JWT 过期导致 401
  const dbToken = serviceRoleKey || token;
  const client = createClient({
    baseUrl,
    edgeFunctionToken: dbToken,
    anonKey,
    ...(anonKey ? { headers: { apikey: anonKey } } : {}),
  });

  if (req.method === "GET") {
    const { data } = await client.database
      .from("tokentracker_user_settings")
      .select("leaderboard_public, leaderboard_anonymous, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    const { data: pv } = await client.database
      .from("tokentracker_public_views")
      .select("token_hash, updated_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle();
    const { data: profile } = await client.database
      .from("tokentracker_user_profiles")
      .select("display_name")
      .eq("user_id", userId)
      .maybeSingle();
    return json({
      enabled: data?.leaderboard_public || false,
      anonymous: data?.leaderboard_anonymous || false,
      share_token: pv?.token_hash || null,
      updated_at: data?.updated_at || null,
      display_name: profile?.display_name || null,
    });
  }
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as {
      enabled?: boolean;
      anonymous?: boolean;
      display_name?: string;
    };
    const now = new Date().toISOString();

    // Update settings (enabled / anonymous)
    if (body.enabled !== undefined || body.anonymous !== undefined) {
      const upsertRow: Record<string, unknown> = {
        user_id: userId,
        updated_at: now,
      };
      if (body.enabled !== undefined) upsertRow.leaderboard_public = Boolean(body.enabled);
      if (body.anonymous !== undefined) upsertRow.leaderboard_anonymous = Boolean(body.anonymous);
      await client.database.from("tokentracker_user_settings").upsert(
        upsertRow,
        { onConflict: "user_id" },
      );
    }

    // Update display_name in user_profiles
    if (typeof body.display_name === "string") {
      const trimmed = body.display_name.trim().slice(0, 50);
      await client.database.from("tokentracker_user_profiles").upsert(
        {
          user_id: userId,
          display_name: trimmed || null,
          updated_at: now,
        },
        { onConflict: "user_id" },
      );
    }

    const result: Record<string, unknown> = { updated_at: now };
    if (body.enabled !== undefined) result.enabled = Boolean(body.enabled);
    if (body.anonymous !== undefined) result.anonymous = Boolean(body.anonymous);
    if (typeof body.display_name === "string") result.display_name = body.display_name.trim().slice(0, 50) || null;
    return json(result);
  }
  return json({ error: "Method not allowed" }, 405);
}
