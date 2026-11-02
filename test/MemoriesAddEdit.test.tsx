import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import MemoriesPage from '../src/app/(app)/app/memories/page';
import { MEMORY_KEY_MAX, MEMORY_VALUE_MAX } from '../src/lib/types';

// Chat 12: "Add a memory" and inline edit on the Memories page.
const router = { replace: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Handler = (init?: RequestInit) => Response;
function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const PARENT = { id: 'p1', first_name: 'Robert' };
const confirmed = {
  id: 'm2',
  layer: 'core',
  mem_key: 'hometown',
  mem_value: 'Grew up in Detroit',
  status: 'confirmed',
  sensitivity: 'normal',
};
const sensitive = {
  id: 'm3',
  layer: 'sensitive',
  mem_key: 'late_spouse',
  mem_value: 'Frank, who passed in 2019',
  status: 'confirmed',
  sensitivity: 'sensitive',
};

beforeEach(() => vi.stubGlobal('confirm', vi.fn(() => true)));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body ?? '{}'));

describe('Memories: add a memory (chat 12)', () => {
  it('adds a memory with topic, value and category, then reloads the list', async () => {
    let memories = [confirmed];
    const fetchMock = stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/memories': () => json({ memories }),
      'POST /api/parents/p1/memories': (init) => {
        const b = bodyOf(init);
        memories = [...memories, { ...confirmed, id: 'm9', layer: b.layer, mem_key: b.key, mem_value: b.value }];
        return json({ memory: memories[1] }, 201);
      },
    });
    render(<MemoriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a memory' }));
    fireEvent.change(screen.getByLabelText('Kind of memory'), { target: { value: 'interest' } });
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: '  Favourite music ' } });
    fireEvent.change(screen.getByLabelText('What Dearly should remember'), { target: { value: 'Ella Fitzgerald' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save memory' }));

    expect(await screen.findByText('Ella Fitzgerald')).toBeTruthy();
    expect(screen.getByText('Memory added.')).toBeTruthy();
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(bodyOf(post?.[1] as RequestInit)).toEqual({
      layer: 'interest',
      key: 'Favourite music',
      value: 'Ella Fitzgerald',
      sensitivity: 'normal',
    });
  });

  it('a "Sensitive" memory is sent with sensitivity=sensitive (never brought up first, D11)', async () => {
    const fetchMock = stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/memories': () => json({ memories: [] }),
      'POST /api/parents/p1/memories': () => json({ memory: sensitive }, 201),
    });
    render(<MemoriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a memory' }));
    fireEvent.change(screen.getByLabelText('Kind of memory'), { target: { value: 'sensitive' } });
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Late husband' } });
    fireEvent.change(screen.getByLabelText('What Dearly should remember'), { target: { value: 'Frank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save memory' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(bodyOf(post?.[1] as RequestInit)).toMatchObject({ layer: 'sensitive', sensitivity: 'sensitive' });
  });

  it('validates inline: empty fields are marked aria-invalid with a linked message, and nothing is sent', async () => {
    const fetchMock = stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/memories': () => json({ memories: [] }),
    });
    render(<MemoriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a memory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save memory' }));
    const topic = screen.getByLabelText('Topic');
    expect(topic.getAttribute('aria-invalid')).toBe('true');
    const describedBy = topic.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ').map((id) => document.getElementById(id)?.textContent).join(' ')).toMatch(/Add a short topic/);
    expect(screen.getByLabelText('What Dearly should remember').getAttribute('aria-invalid')).toBe('true');
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit | undefined)?.method !== 'POST')).toBe(true);
  });

  it('shows the server caps as maxLength and live counters', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/memories': () => json({ memories: [] }),
    });
    render(<MemoriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a memory' }));
    const topic = screen.getByLabelText('Topic') as HTMLInputElement;
    const value = screen.getByLabelText('What Dearly should remember') as HTMLTextAreaElement;
    expect(topic.maxLength).toBe(MEMORY_KEY_MAX);
    expect(value.maxLength).toBe(MEMORY_VALUE_MAX);
    fireEvent.change(value, { target: { value: 'abc' } });
    expect(screen.getByText(`3/${MEMORY_VALUE_MAX} characters`)).toBeTruthy();
    expect(screen.getByText(`0/${MEMORY_KEY_MAX} characters`)).toBeTruthy();
  });

  it('shows a server error in an alert', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/memories': () => json({ memories: [] }),
      'POST /api/parents/p1/memories': () =>
        json({ error: { code: 'invalid_input', message: 'memory value must be 300 characters or fewer' } }, 400),
    });
    render(<MemoriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a memory' }));
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('What Dearly should remember'), { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save memory' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/300 characters or fewer/);
  });
});

describe('Memories: inline edit (chat 12)', () => {
  it('edits a confirmed memory in place with PATCH action=edit', async () => {
    let memories = [confirmed];
    const fetchMock = stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/memories': () => json({ memories }),
      'PATCH /api/memories/m2': (init) => {
        const b = bodyOf(init);
        memories = [{ ...confirmed, mem_key: b.key, mem_value: b.value }];
        return json({ memory: memories[0] });
      },
    });
    render(<MemoriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Hometown' }));
    const value = screen.getByLabelText('What Dearly should remember') as HTMLTextAreaElement;
    expect(value.value).toBe('Grew up in Detroit');
    fireEvent.change(value, { target: { value: 'Grew up in Dayton, Ohio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Grew up in Dayton, Ohio')).toBeTruthy();
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH');
    expect(bodyOf(patch?.[1] as RequestInit)).toEqual({ action: 'edit', key: 'hometown', value: 'Grew up in Dayton, Ohio' });
  });

  it('Cancel restores the original text without calling the API', async () => {
    const fetchMock = stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/memories': () => json({ memories: [confirmed] }),
    });
    render(<MemoriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Hometown' }));
    fireEvent.change(screen.getByLabelText('What Dearly should remember'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Grew up in Detroit')).toBeTruthy();
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit | undefined)?.method !== 'PATCH')).toBe(true);
  });

  it('labels the sensitive badge in words (not colour alone) and names Remove by topic', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/memories': () => json({ memories: [sensitive] }),
    });
    render(<MemoriesPage />);
    expect(await screen.findByText('Sensitive', { selector: 'span.rounded-full' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Late spouse' })).toBeTruthy();
  });
});
