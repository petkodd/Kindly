import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { AnalyticsPageView } from '@/components/AnalyticsPageView';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AnalyticsPageView />
      <SiteHeader />
      <main id="main" tabIndex={-1}>{children}</main>
      <SiteFooter />
    </>
  );
}
