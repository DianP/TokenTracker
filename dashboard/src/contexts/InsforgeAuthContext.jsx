import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getOrCreateInsforgeClient, isCloudInsforgeConfigured } from "../lib/insforge-config";
import { clearCloudDeviceSession } from "../lib/cloud-sync-prefs";
import { isLikelyExpiredAccessToken } from "../lib/auth-token";

const InsforgeAuthContext = createContext(null);

/** 从 refresh 响应体取 token（SDK 可能只写 http 头、或字段名/嵌套与 saveSession 不一致） */
function accessTokenFromRefreshPayload(data) {
  if (!data || typeof data !== "object") return null;
  const d = /** @type {Record<string, unknown>} */ (data);
  const session = d.session && typeof d.session === "object" ? /** @type {Record<string, unknown>} */ (d.session) : null;
  const raw =
    (typeof d.accessToken === "string" && d.accessToken) ||
    (typeof d.access_token === "string" && d.access_token) ||
    (session && typeof session.accessToken === "string" && session.accessToken) ||
    (session && typeof session.access_token === "string" && session.access_token) ||
    null;
  return raw && raw.length > 0 ? raw : null;
}

export async function resolveInsforgeClientAccessToken(client, options = {}) {
  if (!client) return null;
  const skewMs = Math.max(0, Math.floor(Number(options.skewMs) || 60_000));
  const tm = /** @type {any} */ (client).tokenManager;
  const readToken = () => tm?.getAccessToken?.() ?? tm?.getSession?.()?.accessToken ?? null;

  let token = readToken();
  if (!token || isLikelyExpiredAccessToken(token, skewMs)) {
    const { data } = await client.auth.refreshSession();
    token = readToken() ?? accessTokenFromRefreshPayload(data) ?? null;
    if (!token && typeof client.auth.getCurrentUser === "function") {
      try {
        await client.auth.getCurrentUser();
        token = readToken() ?? accessTokenFromRefreshPayload(data) ?? null;
      } catch {
        /* ignore */
      }
    }
  }

  return token || null;
}

export function InsforgeAuthProvider({ children }) {
  const [client, setClient] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isCloudInsforgeConfigured()) {
      setClient(null);
      setUser(null);
      setLoading(false);
      return;
    }
    setClient(getOrCreateInsforgeClient());
  }, []);

  useEffect(() => {
    if (!client) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        let { data, error } = await client.auth.getCurrentUser();
        if (!active) return;
        // OAuth 回调与首次 getCurrentUser 偶发竞态：无 error 但 user 仍为空时再试一次
        if (!error && !data?.user) {
          await new Promise((r) => setTimeout(r, 150));
          if (!active) return;
          const again = await client.auth.getCurrentUser();
          data = again.data;
          error = again.error;
        }
        if (error) {
          setUser(null);
          return;
        }
        setUser(data?.user ?? null);
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client]);

  const refreshUser = useCallback(async () => {
    if (!client) return;
    try {
      let { data, error } = await client.auth.getCurrentUser();
      if (!error && !data?.user) {
        await new Promise((r) => setTimeout(r, 150));
        const again = await client.auth.getCurrentUser();
        data = again.data;
        error = again.error;
      }
      if (error) {
        setUser(null);
        return;
      }
      setUser(data?.user ?? null);
    } catch {
      setUser(null);
    }
  }, [client]);

  const signInWithOAuth = useCallback(
    async (provider, redirectToOverride) => {
      if (!client) return { error: new Error("InsForge client not configured") };
      const nativeBridge =
        typeof window !== "undefined" && window.webkit?.messageHandlers?.nativeOAuth;
      if (nativeBridge) {
        // Native macOS App: open system browser for OAuth.
        // PKCE must be initialized in the same context that handles the callback.
        // We pass native=1 in the redirectTo URL so callback page knows to redirect back to app.
        const redirectTo =
          typeof redirectToOverride === "string" && redirectToOverride.trim()
            ? redirectToOverride.trim()
            : `${window.location.origin}/auth/callback`;
        const result = await client.auth.signInWithOAuth({
          provider,
          redirectTo,
          // @ts-ignore - skipBrowserRedirect is supported but not in types
          skipBrowserRedirect: true,
        });
        if (result.data?.url) {
          // Tell the local server that the next /auth/callback is a native app flow.
          // The callback page (in system browser) checks this flag to relay code back to app.
          try {
            await fetch("/api/auth-bridge/verifier", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ native: true }),
            });
          } catch {}
          nativeBridge.postMessage(result.data.url);
        }
        return result;
      }
      const redirectTo =
        typeof redirectToOverride === "string" && redirectToOverride.trim()
          ? redirectToOverride.trim()
          : typeof window !== "undefined"
            ? `${window.location.origin}/dashboard`
            : undefined;
      const result = await client.auth.signInWithOAuth({
        provider,
        redirectTo,
      });
      return result;
    },
    [client],
  );

  const signInWithPassword = useCallback(
    async (request) => {
      if (!client) return { data: null, error: new Error("InsForge client not configured") };
      const { data, error } = await client.auth.signInWithPassword(request);
      if (data?.user) setUser(data.user);
      return { data, error };
    },
    [client],
  );

  const signUp = useCallback(
    async (request) => {
      if (!client) return { data: null, error: new Error("InsForge client not configured") };
      const { data, error } = await client.auth.signUp(request);
      if (data?.user && data?.accessToken) setUser(data.user);
      return { data, error };
    },
    [client],
  );

  const getPublicAuthConfig = useCallback(async () => {
    if (!client) return { data: null, error: new Error("InsForge client not configured") };
    return client.auth.getPublicAuthConfig();
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    await client.auth.signOut();
    clearCloudDeviceSession();
    setUser(null);
  }, [client]);

  const getAccessToken = useCallback(async () => {
    return resolveInsforgeClientAccessToken(client);
  }, [client]);

  const value = useMemo(() => {
    if (!isCloudInsforgeConfigured() || !client) {
      return {
        enabled: false,
        client: null,
        user: null,
        signedIn: false,
        loading: false,
        refreshUser: async () => {},
        signInWithOAuth: async () => ({ error: new Error("InsForge not configured") }),
        signInWithPassword: async () => ({ data: null, error: new Error("InsForge not configured") }),
        signUp: async () => ({ data: null, error: new Error("InsForge not configured") }),
        getPublicAuthConfig: async () => ({ data: null, error: new Error("InsForge not configured") }),
        signOut: async () => {},
        getAccessToken: async () => null,
      };
    }
    return {
      enabled: true,
      client,
      user,
      signedIn: Boolean(user),
      loading,
      refreshUser,
      signInWithOAuth,
      signInWithPassword,
      signUp,
      getPublicAuthConfig,
      signOut,
      getAccessToken,
    };
  }, [
    client,
    user,
    loading,
    refreshUser,
    signInWithOAuth,
    signInWithPassword,
    signUp,
    getPublicAuthConfig,
    signOut,
    getAccessToken,
  ]);

  return <InsforgeAuthContext.Provider value={value}>{children}</InsforgeAuthContext.Provider>;
}

export function useInsforgeAuth() {
  return useContext(InsforgeAuthContext);
}
