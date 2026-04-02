import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LogOut, Pencil } from "lucide-react";
import { useInsforgeAuth } from "../contexts/InsforgeAuthContext.jsx";
import { useLoginModal } from "../contexts/LoginModalContext.jsx";
import { resolveAuthAccessTokenWithRetry } from "../lib/auth-token";
import { getPublicVisibility, setPublicVisibility } from "../lib/api";
import { runCloudUsageSyncNow } from "../lib/cloud-sync";
import { getCloudSyncEnabled, isLocalDashboardHost, setCloudSyncEnabled } from "../lib/cloud-sync-prefs";
import { copy } from "../lib/copy";
import { cn } from "../lib/cn";

function pickDisplayName(user) {
  if (!user || typeof user !== "object") return "";
  const meta = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const prof = user.profile && typeof user.profile === "object" ? user.profile : {};
  const n = meta.full_name || meta.name || prof.name || meta.user_name || meta.preferred_username;
  if (typeof n === "string" && n.trim()) return n.trim();
  if (typeof user.email === "string" && user.email.includes("@")) {
    return user.email.split("@")[0].trim() || user.email.trim();
  }
  return typeof user.email === "string" ? user.email.trim() : "";
}

function pickEmail(user) {
  if (!user || typeof user !== "object") return "";
  return typeof user.email === "string" ? user.email.trim() : "";
}

function pickAvatarUrl(user) {
  if (!user || typeof user !== "object") return null;
  const meta = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const prof = user.profile && typeof user.profile === "object" ? user.profile : {};
  const u = meta.avatar_url || meta.picture || prof.avatar_url || user.avatar_url;
  return typeof u === "string" && u.trim() ? u.trim() : null;
}

function initialsFromName(name) {
  const s = String(name || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function ToggleSwitch({ checked, onChange, disabled, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500 disabled:opacity-50 disabled:cursor-not-allowed",
        checked ? "bg-oai-brand-500" : "bg-oai-gray-300 dark:bg-oai-gray-700",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

function SettingsRow({ label, checked, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-oai-gray-700 dark:text-oai-gray-300">{label}</span>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={label} />
    </div>
  );
}

export function InsforgeUserHeaderControls({ className }) {
  const { enabled, loading, signedIn, user, signOut, getAccessToken } = useInsforgeAuth();
  const { openLoginModal } = useLoginModal();
  const [panelOpen, setPanelOpen] = useState(false);
  const [cloudSyncOn, setCloudSyncOn] = useState(() => getCloudSyncEnabled());
  const [publicProfileOn, setPublicProfileOn] = useState(false);
  const [anonymousOn, setAnonymousOn] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [customDisplayName, setCustomDisplayName] = useState(null);
  const [nameInput, setNameInput] = useState("");
  const nameInputRef = useRef(null);
  const wrapRef = useRef(null);
  const showLocalCloudSync = enabled && signedIn && isLocalDashboardHost();

  const displayName = useMemo(() => pickDisplayName(user), [user]);
  const email = useMemo(() => pickEmail(user), [user]);
  const avatarUrl = useMemo(() => pickAvatarUrl(user), [user]);

  // Click outside to close
  useEffect(() => {
    if (!panelOpen) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setPanelOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [panelOpen]);

  // Load profile settings when panel opens
  useEffect(() => {
    if (!panelOpen || !signedIn) return;
    let active = true;
    setProfileLoading(true);
    (async () => {
      try {
        const token = await resolveAuthAccessTokenWithRetry({ getAccessToken });
        if (!active || !token) return;
        const data = await getPublicVisibility({ accessToken: token });
        if (!active) return;
        setPublicProfileOn(Boolean(data?.enabled));
        setAnonymousOn(Boolean(data?.anonymous));
        if (data?.display_name) setCustomDisplayName(data.display_name);
      } catch {
        /* ignore */
      } finally {
        if (active) setProfileLoading(false);
      }
    })();
    return () => { active = false; };
  }, [panelOpen, signedIn, getAccessToken]);

  const handleSignOut = useCallback(async () => {
    setPanelOpen(false);
    await signOut();
  }, [signOut]);

  const handleCloudSyncToggle = useCallback(async () => {
    const next = !cloudSyncOn;
    setCloudSyncEnabled(next);
    setCloudSyncOn(next);
    if (next) {
      try {
        await runCloudUsageSyncNow(() => getAccessToken());
      } catch (err) {
        console.warn("[tokentracker] cloud sync:", err);
      }
    }
  }, [cloudSyncOn, getAccessToken]);

  const handlePublicProfileToggle = useCallback(async () => {
    if (profileSaving) return;
    setProfileSaving(true);
    try {
      const token = await resolveAuthAccessTokenWithRetry({ getAccessToken });
      if (!token) return;
      const next = !publicProfileOn;
      await setPublicVisibility({ accessToken: token, enabled: next });
      setPublicProfileOn(next);
    } catch {
      /* ignore */
    } finally {
      setProfileSaving(false);
    }
  }, [publicProfileOn, profileSaving, getAccessToken]);

  const handleStartEditName = useCallback(() => {
    setPanelOpen(false);
    setNameInput(customDisplayName || displayName);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  }, [customDisplayName, displayName]);

  const handleCancelEditName = useCallback(() => {
    setEditingName(false);
    setNameInput("");
  }, []);

  const handleSaveDisplayName = useCallback(async () => {
    if (profileSaving) return;
    const trimmed = nameInput.trim().slice(0, 50);
    if (!trimmed) return;
    setProfileSaving(true);
    try {
      const token = await resolveAuthAccessTokenWithRetry({ getAccessToken });
      if (!token) return;
      await setPublicVisibility({ accessToken: token, display_name: trimmed });
      setCustomDisplayName(trimmed);
      setEditingName(false);
    } catch {
      /* ignore */
    } finally {
      setProfileSaving(false);
    }
  }, [nameInput, profileSaving, getAccessToken]);

  const handleAnonymousToggle = useCallback(async () => {
    if (profileSaving) return;
    setProfileSaving(true);
    try {
      const token = await resolveAuthAccessTokenWithRetry({ getAccessToken });
      if (!token) return;
      const next = !anonymousOn;
      await setPublicVisibility({ accessToken: token, anonymous: next });
      setAnonymousOn(next);
    } catch {
      /* ignore */
    } finally {
      setProfileSaving(false);
    }
  }, [anonymousOn, profileSaving, getAccessToken]);

  if (!enabled) return null;

  if (loading) {
    return (
      <div
        className={cn("h-9 w-9 shrink-0 rounded-full bg-oai-gray-200 dark:bg-oai-gray-800 animate-pulse", className)}
        aria-hidden
      />
    );
  }

  if (!signedIn) {
    return (
      <button
        type="button"
        onClick={openLoginModal}
        className={cn(
          "shrink-0 inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-5 text-sm font-medium transition-colors duration-200 ease-out shadow-sm ring-1 ring-oai-gray-200 dark:ring-white/10 bg-oai-gray-900 text-white hover:bg-oai-gray-800 active:bg-oai-gray-950 dark:bg-white dark:text-oai-gray-900 dark:hover:bg-oai-gray-100 dark:active:bg-oai-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-oai-gray-950",
          className,
        )}
        aria-label={copy("header.auth.sign_in_aria")}
      >
        Sign In
      </button>
    );
  }

  return (
    <div ref={wrapRef} className={cn("relative flex shrink-0 items-center", className)}>
      <button
        type="button"
        onClick={() => setPanelOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 border border-transparent hover:bg-oai-gray-100 dark:hover:bg-oai-gray-900/80 hover:border-oai-gray-200 dark:hover:border-oai-gray-800 transition-colors"
        aria-expanded={panelOpen}
        aria-haspopup="menu"
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-full object-cover ring-1 ring-oai-gray-300 dark:ring-oai-gray-700"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-oai-brand-600 text-xs font-semibold text-white ring-1 ring-oai-brand-500/50">
            {initialsFromName(displayName)}
          </span>
        )}
        <span className="hidden sm:inline truncate text-sm font-medium text-oai-gray-900 dark:text-oai-gray-200 max-w-[120px]">
          {customDisplayName || displayName}
        </span>
      </button>

      {/* Edit Name Modal */}
      <AnimatePresence>
        {editingName && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={handleCancelEditName}
          >
            <motion.div
              className="w-[340px] rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 shadow-2xl p-5"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold text-oai-black dark:text-white mb-3">Edit Display Name</h3>
              <input
                ref={nameInputRef}
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveDisplayName();
                  if (e.key === "Escape") handleCancelEditName();
                }}
                maxLength={50}
                className="w-full rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-transparent px-3 py-2 text-sm text-oai-black dark:text-white outline-none focus:border-oai-brand-500 focus:ring-1 focus:ring-oai-brand-500"
                placeholder="Display name"
              />
              <p className="mt-1.5 text-xs text-oai-gray-400">This name will be shown on the leaderboard.</p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCancelEditName}
                  className="rounded-md px-3 py-1.5 text-sm text-oai-gray-500 hover:text-oai-gray-700 dark:hover:text-oai-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveDisplayName}
                  disabled={profileSaving || !nameInput.trim()}
                  className="rounded-md bg-oai-brand-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-oai-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {profileSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panelOpen && (
          <motion.div
            className="absolute right-0 top-full z-[60] mt-2 w-[280px] rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 shadow-2xl overflow-hidden"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {/* User info */}
            <div className="px-4 py-3 border-b border-oai-gray-200 dark:border-oai-gray-800 flex items-center gap-3">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 rounded-full object-cover ring-1 ring-oai-gray-200 dark:ring-oai-gray-700"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-oai-brand-600 text-xs font-semibold text-white">
                  {initialsFromName(customDisplayName || displayName)}
                </span>
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium text-oai-black dark:text-white truncate">{customDisplayName || displayName}</div>
                {email && <div className="text-xs text-oai-gray-500 truncate">{email}</div>}
              </div>
            </div>

            {/* Settings */}
            <div className="px-4 py-2 border-b border-oai-gray-200 dark:border-oai-gray-800">
              {showLocalCloudSync && (
                <SettingsRow
                  label="Cloud Sync"
                  checked={cloudSyncOn}
                  onChange={handleCloudSyncToggle}
                />
              )}
              <SettingsRow
                label="Public Profile"
                checked={publicProfileOn}
                onChange={handlePublicProfileToggle}
                disabled={profileLoading || profileSaving}
              />
              <SettingsRow
                label="Anonymous"
                checked={anonymousOn}
                onChange={handleAnonymousToggle}
                disabled={profileLoading || profileSaving}
              />
            </div>

            {/* Actions */}
            <div>
              <button
                type="button"
                onClick={handleStartEditName}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-oai-gray-500 dark:text-oai-gray-400 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 hover:text-oai-black dark:hover:text-white transition-colors"
              >
                <Pencil className="h-4 w-4 shrink-0" aria-hidden />
                Edit Name
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-oai-gray-500 dark:text-oai-gray-400 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 hover:text-oai-black dark:hover:text-white transition-colors"
              >
                <LogOut className="h-4 w-4 shrink-0" aria-hidden />
                Sign Out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
