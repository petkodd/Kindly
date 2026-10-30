'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface MobileMenuItem {
  label: string;
  href: string;
}

/**
 * Site navigation below the lg breakpoint, where SiteHeader hides its inline
 * nav. A disclosure button (aria-expanded / aria-controls) opens a panel of
 * large, full-width links. While open, focus is trapped between the button
 * and the panel's links; Escape closes it and returns focus to the button.
 * It also closes when a link is chosen or the route changes.
 */
export function MobileMenu({ items, ctaHref, ctaLabel }: { items: MobileMenuItem[]; ctaHref: string; ctaLabel: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Close on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const links = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a[href]') ?? []);
    links()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus cycle: the toggle button, then each link, then back.
      const order = [buttonRef.current, ...links()].filter(Boolean) as HTMLElement[];
      if (order.length === 0) return;
      const idx = order.indexOf(document.activeElement as HTMLElement);
      const nextIdx = e.shiftKey ? (idx <= 0 ? order.length - 1 : idx - 1) : idx === order.length - 1 ? 0 : idx + 1;
      e.preventDefault();
      order[nextIdx].focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  return (
    <div className="lg:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-lg border-2 border-line px-3 text-base font-semibold text-ink hover:border-sage"
      >
        <span aria-hidden="true" className="text-lg leading-none">{open ? '✕' : '☰'}</span>
        {open ? 'Close' : 'Menu'}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          className="absolute inset-x-0 top-full z-50 border-b border-line bg-cloud shadow-lg"
        >
          <nav aria-label="Main" className="container-k py-4">
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => close(false)}
                    aria-current={pathname === item.href ? 'page' : undefined}
                    className="block rounded-lg px-3 py-3 text-lg text-ink hover:bg-mist"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="pt-2">
                <Link href={ctaHref} onClick={() => close(false)} className="btn-primary w-full">
                  {ctaLabel}
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      )}
    </div>
  );
}
