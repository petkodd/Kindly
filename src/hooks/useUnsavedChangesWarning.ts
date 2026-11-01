'use client';

import { useEffect } from 'react';

export const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Leave this page without saving?';

/**
 * Warns before unsaved form changes are lost (chat 12):
 * - closing the tab / reloading / leaving the site → the browser's own
 *   beforeunload prompt;
 * - in-app navigation (the App Router has no route-change event to cancel) →
 *   a capture-phase click listener on same-origin links asks with confirm()
 *   and stops the navigation if the person chooses to stay.
 */
export function useUnsavedChangesWarning(dirty: boolean, message: string = UNSAVED_CHANGES_MESSAGE): void {
  useEffect(() => {
    if (!dirty) return;

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Legacy browsers need returnValue set to show the prompt.
      e.returnValue = message;
      return message;
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      const link = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(link.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // beforeunload covers leaving the site
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page / #hash
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message]);
}
