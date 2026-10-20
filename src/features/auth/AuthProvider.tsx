import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { fetchProfile } from './api'
import { AuthContext, type AuthState, type Profile } from './AuthContext'

type ProfileResult = { profile: Profile | null; error: Error | null }

async function loadProfile(id: string): Promise<ProfileResult> {
  try {
    return { profile: await fetchProfile(id), error: null }
  } catch (e) {
    console.error('Failed to load profile', e)
    return { profile: null, error: new Error("We couldn't load your account. Check your connection and try again.") }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileError, setProfileError] = useState<Error | null>(null)
  const [profileUserId, setProfileUserId] = useState<string | null>(null)

  const userId = session?.user.id ?? null

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoading(false)
    })

    // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setSessionLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    loadProfile(userId).then((result) => {
      if (cancelled) return
      setProfile(result.profile)
      setProfileError(result.error)
      setProfileUserId(userId)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const refreshProfile = useCallback(async () => {
    if (!userId) return
    const result = await loadProfile(userId)
    setProfile(result.profile)
    setProfileError(result.error)
    setProfileUserId(userId)
  }, [userId])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) console.error('Sign out failed', error)
  }, [])

  const value = useMemo<AuthState>(() => {
    // Ignore a profile left over from a previous user until the new one loads.
    const current = userId !== null && profileUserId === userId
    const currentProfile = current ? profile : null
    return {
      session,
      user: session?.user ?? null,
      profile: currentProfile,
      isAdmin: currentProfile?.role === 'admin',
      loading: sessionLoading || (userId !== null && profileUserId !== userId),
      profileError: current ? profileError : null,
      signOut,
      refreshProfile,
    }
  }, [session, sessionLoading, userId, profile, profileError, profileUserId, signOut, refreshProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
