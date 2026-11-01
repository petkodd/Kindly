'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/apiClient';
import { MEMORY_KEY_MAX, MEMORY_VALUE_MAX } from '@/lib/types';
import { fieldErrorCls, helpCls, inputCls, labelCls } from '@/lib/formStyles';
import { FormStatus } from '@/components/FormStatus';
import { StatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/Card';
import { ParentPicker } from '@/components/ParentPicker';
import { EmptyParentState } from '@/components/EmptyParentState';
import { ParentGate } from '@/components/ParentGate';

interface Memory {
  id: string;
  layer: 'profile' | 'core' | 'interest' | 'episodic' | 'sensitive';
  mem_key: string;
  mem_value: string;
  status: 'proposed' | 'confirmed' | 'retired';
  // The API never returns restricted rows (decision D6).
  sensitivity: 'normal' | 'sensitive';
}

export default function MemoriesPage() {
  return (
    <ParentGate>
      {({ parents, selected, setSelected }) => (
        <div className="mx-auto max-w-2xl space-y-8">
          <div>
            <p className="eyebrow">What Dearly remembers</p>
            <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Memories</h1>
            <p className="mt-2 text-base text-muted">
              Review what Dearly has learned. Confirm the things it picked up from conversations, add
              things you want it to know, and fix or remove anything that isn&rsquo;t right.
            </p>
          </div>

          {parents.length === 0 ? (
            <EmptyParentState />
          ) : (
            <>
              <ParentPicker parents={parents} selected={selected} onSelect={setSelected} />
              {selected && <MemoriesPanel key={selected} parentId={selected} />}
            </>
          )}
        </div>
      )}
    </ParentGate>
  );
}

function MemoriesPanel({ parentId }: { parentId: string }) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState('');

  // Mutations refetch (rather than apply locally like family-summary does) on
  // purpose: confirm/dismiss move a row between the proposed and confirmed
  // sections, so a full reload is simpler and less error-prone than re-grouping.
  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api.get<{ memories: Memory[] }>(`/api/parents/${parentId}/memories`);
      setMemories(r.memories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load memories.');
    }
  }, [parentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <FormStatus kind="error" message={error} />;
  if (!memories) return <p className="text-base text-muted">Loading memories…</p>;

  const proposed = memories.filter((m) => m.status === 'proposed');
  const confirmed = memories.filter((m) => m.status === 'confirmed');

  return (
    <div className="space-y-8">
      <AddMemoryForm parentId={parentId} onAdded={load} />

      <section>
        <h2 className="text-lg font-semibold text-ink">Suggested from conversations</h2>
        <p className="mt-1 text-base text-muted">
          Dearly noticed these. Confirm the ones that are right.
        </p>
        {proposed.length === 0 ? (
          <p className="mt-4 text-base text-muted">Nothing waiting for review.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {proposed.map((m) => (
              <MemoryRow key={m.id} memory={m} onChanged={load} kind="proposed" />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ink">Confirmed memories</h2>
        {confirmed.length === 0 ? (
          <p className="mt-4 text-base text-muted">No confirmed memories yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {confirmed.map((m) => (
              <MemoryRow key={m.id} memory={m} onChanged={load} kind="confirmed" />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Seeded and extracted topics are snake_case ("favorite_music"); show them as words. */
function topicLabel(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const LAYER_LABEL: Record<Memory['layer'], string> = {
  profile: 'Profile',
  core: 'Core',
  interest: 'Interest',
  episodic: 'Moment',
  sensitive: 'Sensitive',
};

/** Categories a family member can add. "Sensitive" is handled gently (never raised first; D11). */
const ADD_LAYERS: { value: Memory['layer']; label: string }[] = [
  { value: 'core', label: 'Core: people, places, life story' },
  { value: 'interest', label: 'Interest: hobbies, music, things they love' },
  { value: 'profile', label: 'Profile: name they like, where they live' },
  { value: 'episodic', label: 'Moment: something that happened recently' },
  { value: 'sensitive', label: 'Sensitive: Dearly never brings it up first' },
];

/** Client-side mirror of the server caps (memoryRepo cleanMemoryText). */
function memoryFieldErrors(key: string, value: string): { key?: string; value?: string } {
  const errors: { key?: string; value?: string } = {};
  if (!key.trim()) errors.key = 'Add a short topic.';
  else if (key.trim().length > MEMORY_KEY_MAX) errors.key = `Topic must be ${MEMORY_KEY_MAX} characters or fewer.`;
  if (!value.trim()) errors.value = 'Write what Dearly should remember.';
  else if (value.trim().length > MEMORY_VALUE_MAX) errors.value = `Memory must be ${MEMORY_VALUE_MAX} characters or fewer.`;
  return errors;
}

/**
 * The topic + memory text pair, shared by "Add a memory" and inline edit.
 * Caps are shown as live counters and enforced with maxLength; errors are
 * linked to their field with aria-describedby + aria-invalid.
 */
function MemoryFields({
  idPrefix,
  keyText,
  valueText,
  setKey,
  setValue,
  errors,
}: {
  idPrefix: string;
  keyText: string;
  valueText: string;
  setKey: (v: string) => void;
  setValue: (v: string) => void;
  errors: { key?: string; value?: string };
}) {
  const kId = `${idPrefix}-key`;
  const vId = `${idPrefix}-value`;
  return (
    <>
      <div>
        <label htmlFor={kId} className={labelCls}>
          Topic
        </label>
        <input
          id={kId}
          value={keyText}
          maxLength={MEMORY_KEY_MAX}
          onChange={(e) => setKey(e.target.value)}
          placeholder="e.g. Favourite music"
          aria-invalid={errors.key ? true : undefined}
          aria-describedby={`${kId}-help${errors.key ? ` ${kId}-error` : ''}`}
          className={`mt-2 ${inputCls}`}
        />
        <p id={`${kId}-help`} className={helpCls}>
          {keyText.length}/{MEMORY_KEY_MAX} characters
        </p>
        {errors.key && (
          <p id={`${kId}-error`} className={fieldErrorCls}>
            {errors.key}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={vId} className={labelCls}>
          What Dearly should remember
        </label>
        <textarea
          id={vId}
          value={valueText}
          maxLength={MEMORY_VALUE_MAX}
          rows={3}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Ella Fitzgerald and big-band records on Sunday mornings"
          aria-invalid={errors.value ? true : undefined}
          aria-describedby={`${vId}-help${errors.value ? ` ${vId}-error` : ''}`}
          className={`mt-2 ${inputCls}`}
        />
        <p id={`${vId}-help`} className={helpCls}>
          {valueText.length}/{MEMORY_VALUE_MAX} characters
        </p>
        {errors.value && (
          <p id={`${vId}-error`} className={fieldErrorCls}>
            {errors.value}
          </p>
        )}
      </div>
    </>
  );
}

function AddMemoryForm({ parentId, onAdded }: { parentId: string; onAdded: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [layer, setLayer] = useState<Memory['layer']>('core');
  const [keyText, setKey] = useState('');
  const [valueText, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const errors = submitted ? memoryFieldErrors(keyText, valueText) : {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setError('');
    setSuccess('');
    if (Object.keys(memoryFieldErrors(keyText, valueText)).length > 0) return;
    setBusy(true);
    try {
      await api.post(`/api/parents/${parentId}/memories`, {
        layer,
        key: keyText.trim(),
        value: valueText.trim(),
        sensitivity: layer === 'sensitive' ? 'sensitive' : 'normal',
      });
      setKey('');
      setValue('');
      setSubmitted(false);
      setSuccess('Memory added.');
      await onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this memory. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSuccess('');
          }}
          className="btn-secondary"
        >
          Add a memory
        </button>
        <FormStatus kind="success" message={success} />
      </div>
    );
  }

  return (
    <Card as="form" onSubmit={submit} noValidate aria-labelledby="add-memory-heading" className="space-y-5">
      <h2 id="add-memory-heading" className="text-lg font-semibold text-ink">
        Add a memory
      </h2>
      <p className="text-base text-muted">
        Things you add are confirmed right away. Please don&rsquo;t add health details, passwords or account numbers.
      </p>
      <div>
        <label htmlFor="add-mem-layer" className={labelCls}>
          Kind of memory
        </label>
        <select
          id="add-mem-layer"
          value={layer}
          onChange={(e) => setLayer(e.target.value as Memory['layer'])}
          className={`mt-2 ${inputCls}`}
        >
          {ADD_LAYERS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <MemoryFields
        idPrefix="add-mem"
        keyText={keyText}
        valueText={valueText}
        setKey={setKey}
        setValue={setValue}
        errors={errors}
      />
      <FormStatus kind="error" message={error} />
      <FormStatus kind="success" message={success} />
      <div className="flex flex-wrap gap-4">
        <button type="submit" disabled={busy} className="btn-primary disabled:opacity-60">
          {busy ? 'Saving…' : 'Save memory'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError('');
            setSubmitted(false);
          }}
          className="btn-secondary"
        >
          Close
        </button>
      </div>
    </Card>
  );
}

function MemoryRow({
  memory,
  onChanged,
  kind,
}: {
  memory: Memory;
  onChanged: () => void | Promise<void>;
  kind: 'proposed' | 'confirmed';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [keyText, setKey] = useState(memory.mem_key);
  const [valueText, setValue] = useState(memory.mem_value);
  const [submitted, setSubmitted] = useState(false);

  async function act(run: () => Promise<unknown>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError('');
    setBusy(true);
    try {
      await run();
      // On success the row leaves this list (confirm → confirmed section,
      // dismiss → retired, remove → gone), so onChanged() refetches and this
      // row unmounts — that's why busy is intentionally not reset here.
      onChanged();
    } catch (err) {
      // Surface the server's reason (e.g. a 409 "not in a proposed state" from a
      // concurrent tab) rather than a generic, misleading "try again".
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  const confirm = () => act(() => api.patch(`/api/memories/${memory.id}`, { action: 'confirm' }));
  const dismiss = () =>
    act(
      () => api.patch(`/api/memories/${memory.id}`, { action: 'retire' }),
      'Dismiss this suggestion?',
    );
  const remove = () =>
    act(() => api.del(`/api/memories/${memory.id}`), 'Remove this memory? This cannot be undone.');

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setError('');
    if (Object.keys(memoryFieldErrors(keyText, valueText)).length > 0) return;
    setBusy(true);
    try {
      await api.patch(`/api/memories/${memory.id}`, { action: 'edit', key: keyText.trim(), value: valueText.trim() });
      setEditing(false);
      setSubmitted(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this memory. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const smallBtn =
    'inline-flex min-h-[2.75rem] items-center rounded-xl px-3 text-base font-semibold underline underline-offset-4 disabled:opacity-60';

  if (editing) {
    const errors = submitted ? memoryFieldErrors(keyText, valueText) : {};
    return (
      <li className="rounded-xl border-2 border-sageDeep bg-cloud p-4">
        <form onSubmit={saveEdit} noValidate aria-label={`Edit memory: ${topicLabel(memory.mem_key)}`} className="space-y-4">
          <MemoryFields
            idPrefix={`edit-${memory.id}`}
            keyText={keyText}
            valueText={valueText}
            setKey={setKey}
            setValue={setValue}
            errors={errors}
          />
          <FormStatus kind="error" message={error} />
          <div className="flex flex-wrap gap-4">
            <button type="submit" disabled={busy} className="btn-primary disabled:opacity-60">
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setKey(memory.mem_key);
                setValue(memory.mem_value);
                setSubmitted(false);
                setError('');
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-line bg-cloud p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-base font-semibold text-ink">{topicLabel(memory.mem_key)}</p>
          <p className="text-base text-ink">{memory.mem_value}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-base text-muted">{LAYER_LABEL[memory.layer]}</span>
            {memory.sensitivity === 'sensitive' && <StatusBadge tone="warning">Sensitive</StatusBadge>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {kind === 'proposed' ? (
            <>
              <button type="button" onClick={confirm} disabled={busy} className="btn-primary disabled:opacity-60">
                Confirm
              </button>
              <button type="button" onClick={dismiss} disabled={busy} className={`${smallBtn} text-muted`}>
                Dismiss
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy}
                className={`${smallBtn} text-sageDeep`}
                aria-label={`Edit ${topicLabel(memory.mem_key)}`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className={`${smallBtn} text-error`}
                aria-label={`Remove ${topicLabel(memory.mem_key)}`}
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>
      <FormStatus kind="error" message={error} className="mt-2" />
    </li>
  );
}
