import React, { useEffect, useReducer } from 'react';
import { useSystem } from '@ohif/core';
import { Tooltip, TooltipTrigger, TooltipContent } from '@ohif/ui-next';

/**
 * Small "who am I" badge in the header — an avatar initial plus name, with role
 * on hover. Exists so a radiologist glancing at the viewer always knows which
 * account the current session's JWT (sessionService) resolved to, and — for an
 * anonymous/expired session — that they're in read-only mode and why Save is
 * disabled, rather than that only being discoverable by trying to save.
 */
function UserSessionBadge() {
  const { servicesManager } = useSystem();
  const sessionService = servicesManager?.services?.sessionService;
  const [, forceRender] = useReducer(x => x + 1, 0);

  useEffect(() => {
    if (!sessionService?.subscribe || !sessionService?.EVENTS) {
      return;
    }
    const { unsubscribe } = sessionService.subscribe(
      sessionService.EVENTS.SESSION_CHANGED,
      forceRender
    );
    return () => unsubscribe();
  }, [sessionService]);

  if (!sessionService) {
    return null;
  }

  const authenticated = sessionService.isAuthenticated();
  const fullName = authenticated ? sessionService.getFullName() : null;
  const roles = (authenticated && sessionService.getRoles?.()) || [];
  const initial = (fullName || '?').trim().charAt(0).toUpperCase();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex min-w-0 cursor-default select-none items-center gap-1.5"
          data-cy="user-session-badge"
        >
          <div
            className={
              'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ' +
              (authenticated ? 'bg-primary text-black' : 'bg-muted text-muted-foreground')
            }
          >
            {initial}
          </div>
          <div className="hidden min-w-0 flex-col leading-tight sm:flex">
            <span className="text-foreground truncate text-[12px] font-medium">
              {fullName || 'Guest'}
            </span>
            {!authenticated && (
              <span className="text-muted-foreground text-[10px] leading-tight">View only</span>
            )}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {authenticated ? (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{fullName}</span>
            {roles.length > 0 && (
              <span className="text-muted-foreground text-xs">{roles.join(', ')}</span>
            )}
          </div>
        ) : (
          <span>Not signed in — viewing in read-only mode</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export default UserSessionBadge;
