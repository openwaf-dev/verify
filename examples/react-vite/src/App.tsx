import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Verify } from '@openwaf/verify-react';
import type { VerifyHandle } from '@openwaf/verify-react';

// owk_test_pass always solves with the token v1.TEST.TOKEN; set VITE_OPENWAF_SITEKEY for a real sitekey.
const siteKey = import.meta.env.VITE_OPENWAF_SITEKEY ?? 'owk_test_pass';

interface Verdict {
  ok: boolean;
  siteverify: unknown;
}

export function App() {
  const verify = useRef<VerifyHandle>(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new URLSearchParams();
    for (const [name, value] of new FormData(event.currentTarget)) body.append(name, String(value));
    const res = await fetch('/api/signup', { method: 'POST', body });
    setVerdict((await res.json()) as Verdict);
    // Tokens are single use: get a fresh one for the next submit.
    setToken('');
    verify.current?.reset();
  }

  return (
    <main>
      <h1>Sign up</h1>
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" name="email" required autoComplete="email" />
        </label>
        <Verify
          ref={verify}
          siteKey={siteKey}
          action="signup"
          onSuccess={(t) => {
            setToken(t);
            setError('');
          }}
          onError={setError}
          onExpired={() => setToken('')}
        />
        <button type="submit" disabled={!token}>
          Create account
        </button>
      </form>
      <dl>
        <dt>Token</dt>
        <dd data-testid="token">{token || '—'}</dd>
        {error && (
          <>
            <dt>Widget error</dt>
            <dd data-testid="error">{error}</dd>
          </>
        )}
        {verdict && (
          <>
            <dt>Server check</dt>
            <dd data-testid="verdict">{verdict.ok ? 'passed' : 'failed'}</dd>
          </>
        )}
      </dl>
      {verdict && <pre>{JSON.stringify(verdict.siteverify, null, 2)}</pre>}
    </main>
  );
}
