import Image from 'next/image';
import { TESTIMONIALS } from '@/lib/content';

export function Testimonials() {
  return (
    <section className="bg-cloud py-20">
      <div className="container-k grid items-center gap-12 md:grid-cols-2">
        <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-line shadow-sm md:order-2">
          <Image
            src="/images/seniors-bench-laughing.webp"
            alt="A group of senior friends sitting together on a park bench, laughing"
            width={800}
            height={988}
            sizes="(min-width: 768px) 384px, 100vw"
            className="w-full object-cover"
          />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-sage mix-blend-multiply opacity-[0.08]" />
        </div>
        <div className="md:order-1">
          <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{TESTIMONIALS.h2}</h2>
          <p className="mt-5 text-lg text-muted">{TESTIMONIALS.body}</p>
        </div>
      </div>
    </section>
  );
}
