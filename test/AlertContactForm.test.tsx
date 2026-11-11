import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AlertContactForm } from '../src/components/AlertContactForm';

/**
 * Reviewer fix (chat 10): SMS consent is per number. A buyer who already
 * consented for one number and types a different one must tick the box again —
 * the stale tick must not carry consent over to the new number.
 */
function stubPut() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        alert_contact: { alert_phone: body.phone, sms_alert_consent_at: body.sms_consent ? '2026-10-30T00:00:00Z' : null },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const consented = { alert_phone: '+13125550142', sms_alert_consent_at: '2026-10-01T00:00:00Z' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AlertContactForm consent per number', () => {
  it('starts unticked when there is no consent yet', () => {
    render(<AlertContactForm initial={{ alert_phone: null, sms_alert_consent_at: null }} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('keeps the tick while the same number is reformatted or half-typed', () => {
    render(<AlertContactForm initial={consented} />);
    const input = screen.getByLabelText(/Your mobile number/);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    fireEvent.change(input, { target: { value: '312-555-0142' } });
    fireEvent.change(input, { target: { value: '(312) 555-01' } });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('unticks when a different complete number is typed, so consent is not carried over', async () => {
    const fetchMock = stubPut();
    render(<AlertContactForm initial={consented} />);
    fireEvent.change(screen.getByLabelText(/Your mobile number/), { target: { value: '(415) 555-0199' } });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      phone: '+14155550199',
      sms_consent: false,
    });
    expect(await screen.findByText(/Saved. Emergency alerts will come by email only/)).toBeTruthy();
  });

  it('unticks when the number is cleared', () => {
    render(<AlertContactForm initial={consented} />);
    fireEvent.change(screen.getByLabelText(/Your mobile number/), { target: { value: '' } });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('a re-ticked box for the new number is sent as consent', async () => {
    const fetchMock = stubPut();
    render(<AlertContactForm initial={consented} />);
    fireEvent.change(screen.getByLabelText(/Your mobile number/), { target: { value: '(415) 555-0199' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      phone: '+14155550199',
      sms_consent: true,
    });
  });
});
