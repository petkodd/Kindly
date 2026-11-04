# Lighthouse 12 (mobile, simulated throttling), production build on localhost, 2026-11-02

Run in the autopilot sandbox, where fonts.googleapis.com is blocked (the render-blocking Google Fonts stylesheet fails, which costs ~0.8 s and logs a console error).

| Page | Perf | A11y | Best practices | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| / | 82 | 100 | 96 | 100 | 3.5 s | 210 ms | 0 |
| /blog | 91 | 100 | 96 | 66 | 2.7 s | 210 ms | 0 |
| /gift-for-aging-parent | 92 | 100 | 96 | 100 | 2.9 s | 160 ms | 0 |
| /how-it-works | 91 | 100 | 96 | 100 | 2.9 s | 130 ms | 0 |
| /pricing | 89 | 100 | 96 | 100 | 3.0 s | 180 ms | 0 |
| /privacy | 94 | 100 | 96 | 100 | 2.5 s | 160 ms | 0 |
| /senior-living | 77 | 100 | 96 | 100 | 3.4 s | 450 ms | 0 |
| /terms | 89 | 100 | 96 | 100 | 2.8 s | 260 ms | 0 |
| /trust-and-privacy | 89 | 100 | 96 | 100 | 3.0 s | 220 ms | 0 |
| /waitlist | 84 | 100 | 96 | 100 | 3.1 s | 300 ms | 0 |

/blog SEO 66 is expected: it is deliberately noindex until it has 3 articles.
