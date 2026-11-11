# Chat 21a: build guard and canonical-host checks

## SEO-1: production builds with a bad site URL (`.env.local` moved aside)

```
### VERCEL_ENV=production NEXT_PUBLIC_SITE_URL='' npm run build
exit=1
 ⨯ Failed to load next.config.mjs, see more info here https://nextjs.org/docs/messages/next-config-error
> Build error occurred
Error: 
[SEO-1] Refusing to build: NEXT_PUBLIC_SITE_URL is not set.
Every canonical URL, Open Graph tag, JSON-LD block, the sitemap, robots.txt and the Stripe return URLs are built from it. Set NEXT_PUBLIC_SITE_URL to the real https:// domain (e.g. https://www.yourdomain.com) in the Vercel production environment and build again.
### VERCEL_ENV=production NEXT_PUBLIC_SITE_URL='http://www.dearlyhere.com' npm run build
exit=1
 ⨯ Failed to load next.config.mjs, see more info here https://nextjs.org/docs/messages/next-config-error
> Build error occurred
Error: 
[SEO-1] Refusing to build: NEXT_PUBLIC_SITE_URL is "http://www.dearlyhere.com", but a production site URL must start with https://.
Every canonical URL, Open Graph tag, JSON-LD block, the sitemap, robots.txt and the Stripe return URLs are built from it. Set NEXT_PUBLIC_SITE_URL to the real https:// domain (e.g. https://www.yourdomain.com) in the Vercel production environment and build again.
### VERCEL_ENV=production NEXT_PUBLIC_SITE_URL='https://dearly.example.com' npm run build
exit=1
 ⨯ Failed to load next.config.mjs, see more info here https://nextjs.org/docs/messages/next-config-error
> Build error occurred
Error: 
[SEO-1] Refusing to build: NEXT_PUBLIC_SITE_URL is "https://dearly.example.com", which is the placeholder domain, not the real one.
Every canonical URL, Open Graph tag, JSON-LD block, the sitemap, robots.txt and the Stripe return URLs are built from it. Set NEXT_PUBLIC_SITE_URL to the real https:// domain (e.g. https://www.yourdomain.com) in the Vercel production environment and build again.
### VERCEL_ENV=production NEXT_PUBLIC_SITE_URL=https://www.dearlyhere.com npm run build
exit=0
### CI-like build (no VERCEL_ENV, no NEXT_PUBLIC_SITE_URL)
exit=0
```

## SEO-2: `VERCEL_ENV=production next start` (canonical https://www.dearlyhere.com), requests with mocked Host headers

```
www.dearlyhere.com         GET   /pricing?utm_source=x          HTTP/1.1 200 OK 
www.dearlyhere.com         GET   /app/account                   HTTP/1.1 307 Temporary Redirect X-Robots-Tag: noindex, nofollow location: /signup?next=%2Fapp%2Faccount 
www.dearlyhere.com         GET   /api/me                        HTTP/1.1 401 Unauthorized x-robots-tag: noindex 
www.dearlyhere.com         GET   /api/jobs/purge-hard-deletes   HTTP/1.1 401 Unauthorized x-robots-tag: noindex 
www.dearlyhere.com         POST  /api/billing/webhook           HTTP/1.1 400 Bad Request x-robots-tag: noindex 
www.dearlyhere.com         GET   /robots.txt                    HTTP/1.1 200 OK 
dearlyhere.com             GET   /pricing?utm_source=x          HTTP/1.1 308 Permanent Redirect location: https://www.dearlyhere.com/pricing?utm_source=x 
dearlyhere.com             GET   /app/account                   HTTP/1.1 308 Permanent Redirect X-Robots-Tag: noindex, nofollow location: https://www.dearlyhere.com/app/account 
dearlyhere.com             GET   /api/me                        HTTP/1.1 401 Unauthorized x-robots-tag: noindex 
dearlyhere.com             GET   /api/jobs/purge-hard-deletes   HTTP/1.1 401 Unauthorized x-robots-tag: noindex 
dearlyhere.com             POST  /api/billing/webhook           HTTP/1.1 400 Bad Request x-robots-tag: noindex 
dearlyhere.com             GET   /robots.txt                    HTTP/1.1 308 Permanent Redirect location: https://www.dearlyhere.com/robots.txt 
kindly-abc123.vercel.app   GET   /pricing?utm_source=x          HTTP/1.1 308 Permanent Redirect location: https://www.dearlyhere.com/pricing?utm_source=x 
kindly-abc123.vercel.app   GET   /app/account                   HTTP/1.1 308 Permanent Redirect X-Robots-Tag: noindex, nofollow location: https://www.dearlyhere.com/app/account 
kindly-abc123.vercel.app   GET   /api/me                        HTTP/1.1 401 Unauthorized x-robots-tag: noindex 
kindly-abc123.vercel.app   GET   /api/jobs/purge-hard-deletes   HTTP/1.1 401 Unauthorized x-robots-tag: noindex 
kindly-abc123.vercel.app   POST  /api/billing/webhook           HTTP/1.1 400 Bad Request x-robots-tag: noindex 
kindly-abc123.vercel.app   GET   /robots.txt                    HTTP/1.1 308 Permanent Redirect location: https://www.dearlyhere.com/robots.txt 
```
