import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BobbinrySDK,
  PanelActions,
  PanelActionButton,
  PanelBody,
  PanelCard,
  PanelEmptyState,
  PanelFrame,
  PanelLoadingState,
  PanelPill,
  PanelSectionTitle,
} from '@bobbinry/sdk'

interface DiscordRolesMembersProps {
  context?: {
    projectId?: string
    currentProject?: string
    apiToken?: string
  }
}

interface MemberSyncStatus {
  userId: string
  displayName: string
  discordHandle: string | null
  tierName: string
  tierLevel: number
  roleName: string | null
  syncStatus: 'synced' | 'pending' | 'no_discord' | 'error'
  lastError: string | null
}

export default function DiscordRolesMembers({ context }: DiscordRolesMembersProps) {
  const [sdk] = useState(() => new BobbinrySDK('discord-roles'))
  const projectId = useMemo(
    () => context?.projectId || context?.currentProject,
    [context?.projectId, context?.currentProject]
  )

  const [members, setMembers] = useState<MemberSyncStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const apiBase = sdk.api.apiBaseUrl
  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      ...(context?.apiToken ? { Authorization: `Bearer ${context.apiToken}` } : {}),
    }),
    [context?.apiToken]
  )

  const loadMembers = useCallback(async () => {
    if (!projectId || !context?.apiToken) return
    try {
      setLoading(true)
      const resp = await fetch(`${apiBase}/discord-roles/members?projectId=${projectId}`, { headers })
      if (resp.ok) {
        const data = await resp.json()
        setMembers(data.members || [])
      }
    } catch {
      setError('Failed to load members')
    } finally {
      setLoading(false)
    }
  }, [apiBase, headers, projectId, context?.apiToken])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  useEffect(() => {
    if (context?.apiToken) sdk.api.setAuthToken(context.apiToken)
  }, [context?.apiToken, sdk])

  async function handleSyncUser(userId: string) {
    try {
      await fetch(`${apiBase}/discord-roles/sync-user`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId, userId }),
      })
      await loadMembers()
    } catch {
      setError('Failed to sync user')
    }
  }

  if (loading) {
    return (
      <PanelFrame>
        <PanelBody>
          <PanelLoadingState label="Loading members..." />
        </PanelBody>
      </PanelFrame>
    )
  }

  return (
    <PanelFrame>
      <PanelActions>
        <PanelPill>Members ({members.length})</PanelPill>
      </PanelActions>

      <PanelBody className="space-y-2">
        {members.length === 0 ? (
          <PanelEmptyState
            title="No subscribers"
            description="Subscribers with Discord handles will appear here."
          />
        ) : (
          <>
            <PanelSectionTitle>Subscriber Sync Status</PanelSectionTitle>
            {members.map((member) => (
              <PanelCard key={member.userId} className="flex items-center justify-between px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{member.displayName}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {member.discordHandle || 'No Discord handle'}
                    {member.roleName && <> &middot; {member.roleName}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <PanelPill>
                    {member.syncStatus === 'synced' && 'Synced'}
                    {member.syncStatus === 'pending' && 'Pending'}
                    {member.syncStatus === 'no_discord' && 'No Discord'}
                    {member.syncStatus === 'error' && 'Error'}
                  </PanelPill>
                  {member.discordHandle && member.syncStatus !== 'synced' && (
                    <PanelActionButton onClick={() => handleSyncUser(member.userId)}>
                      Sync
                    </PanelActionButton>
                  )}
                </div>
              </PanelCard>
            ))}
          </>
        )}

        {error && (
          <div className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>
        )}
      </PanelBody>
    </PanelFrame>
  )
}
