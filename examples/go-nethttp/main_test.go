package main

import (
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/openwaf-dev/verify/siteverify"
)

// fakeSiteverify is a local siteverify that answers with the given status
// and body and records the forms it receives.
type fakeSiteverify struct {
	mu     sync.Mutex
	forms  []url.Values
	status int
	body   string
	header http.Header
}

func (f *fakeSiteverify) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b, _ := io.ReadAll(r.Body)
	form, _ := url.ParseQuery(string(b))
	f.mu.Lock()
	f.forms = append(f.forms, form)
	f.mu.Unlock()
	for k, v := range f.header {
		w.Header()[k] = v
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(f.status)
	io.WriteString(w, f.body)
}

func (f *fakeSiteverify) calls() []url.Values {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]url.Values(nil), f.forms...)
}

func newTestServer(t *testing.T, fake *fakeSiteverify, hostname string) http.Handler {
	t.Helper()
	sv := httptest.NewServer(fake)
	t.Cleanup(sv.Close)
	client, err := siteverify.New(siteverify.TestSecretPass, siteverify.WithEndpoint(sv.URL))
	if err != nil {
		t.Fatal(err)
	}
	s := &server{
		verifier:    client,
		sitekey:     siteverify.TestSitekeyPass,
		hostname:    hostname,
		checkAction: true,
		logger:      log.New(io.Discard, "", 0),
	}
	return s.routes()
}

func post(h http.Handler, form url.Values) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/signup", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

const okBody = `{"success":true,"challenge_ts":"2026-10-28T10:15:03Z","hostname":"example.com","action":"signup",` +
	`"error-codes":[],"metadata":{"mode":"managed","interactive":false,"risk":"low","result_with_testing_key":true}}`

func TestFormPage(t *testing.T) {
	h := newTestServer(t, &fakeSiteverify{status: 200, body: okBody}, "")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET / = %d", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{
		`<script src="/__waf/challenge/v1/widget.js" async defer></script>`,
		`<div class="owaf-verify" data-sitekey="owk_test_pass" data-action="signup"></div>`,
		`<form action="/signup" method="post">`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("page lacks %s", want)
		}
	}
	if got := rec.Header().Get("Content-Security-Policy"); got != "default-src 'self'" {
		t.Errorf("Content-Security-Policy = %q", got)
	}
}

func TestSignup(t *testing.T) {
	cases := map[string]struct {
		status     int
		body       string
		hostname   string
		token      string
		wantStatus int
		wantCalls  int
	}{
		"valid token":              {200, okBody, "example.com", siteverify.TestToken, http.StatusOK, 1},
		"missing token":            {200, okBody, "", "", http.StatusForbidden, 0},
		"rejected token":           {200, `{"success":false,"error-codes":["timeout-or-duplicate"]}`, "", siteverify.TestToken, http.StatusForbidden, 1},
		"token for another host":   {200, okBody, "www.example.org", siteverify.TestToken, http.StatusForbidden, 1},
		"token for another form":   {200, strings.Replace(okBody, `"signup"`, `"login"`, 1), "", siteverify.TestToken, http.StatusForbidden, 1},
		"siteverify rate limit":    {429, `{"success":false,"error-codes":["rate-limited"]}`, "", siteverify.TestToken, http.StatusServiceUnavailable, 1},
		"siteverify unavailable":   {502, `<html>Bad gateway</html>`, "", siteverify.TestToken, http.StatusServiceUnavailable, 1},
		"siteverify bad answer":    {200, `not json`, "", siteverify.TestToken, http.StatusServiceUnavailable, 1},
		"success on a 400 answer":  {400, okBody, "", siteverify.TestToken, http.StatusForbidden, 1},
		"success without metadata": {200, `{"success":true,"action":"signup","error-codes":[]}`, "", siteverify.TestToken, http.StatusOK, 1},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			fake := &fakeSiteverify{status: tc.status, body: tc.body, header: http.Header{"Retry-After": {"7"}}}
			h := newTestServer(t, fake, tc.hostname)
			form := url.Values{"email": {"ana@example.com"}}
			if tc.token != "" {
				form.Set(siteverify.ResponseFieldName, tc.token)
			}
			rec := post(h, form)
			if rec.Code != tc.wantStatus {
				t.Fatalf("POST /signup = %d, want %d: %s", rec.Code, tc.wantStatus, rec.Body)
			}
			calls := fake.calls()
			if len(calls) != tc.wantCalls {
				t.Fatalf("siteverify called %d times, want %d", len(calls), tc.wantCalls)
			}
			if len(calls) > 0 {
				if calls[0].Get("response") != tc.token || calls[0].Get("idempotency_key") == "" || calls[0].Has("remoteip") {
					t.Errorf("siteverify form = %v", calls[0])
				}
			}
			if tc.status == 429 && rec.Header().Get("Retry-After") != "7" {
				t.Errorf("Retry-After = %q, want 7", rec.Header().Get("Retry-After"))
			}
		})
	}
}

func TestSignupRetriesWithTheSameIdempotencyKey(t *testing.T) {
	var (
		mu    sync.Mutex
		keys  []string
		calls int
	)
	sv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		mu.Lock()
		calls++
		n := calls
		keys = append(keys, r.PostForm.Get("idempotency_key"))
		mu.Unlock()
		if n == 1 {
			// Drop the first call without an answer, like a lost
			// connection.
			conn, _, _ := w.(http.Hijacker).Hijack()
			conn.Close()
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, okBody)
	}))
	defer sv.Close()
	client, err := siteverify.New(siteverify.TestSecretPass, siteverify.WithEndpoint(sv.URL))
	if err != nil {
		t.Fatal(err)
	}
	s := &server{verifier: client, sitekey: siteverify.TestSitekeyPass, checkAction: true, logger: log.New(io.Discard, "", 0)}

	rec := post(s.routes(), url.Values{"email": {"ana@example.com"}, siteverify.ResponseFieldName: {siteverify.TestToken}})
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /signup = %d: %s", rec.Code, rec.Body)
	}
	if len(keys) != 2 || keys[0] == "" || keys[0] != keys[1] {
		t.Errorf("idempotency keys = %q, want the same key twice", keys)
	}
}

func TestRetryAfterSeconds(t *testing.T) {
	for d, want := range map[string]string{"1s": "1", "1500ms": "2", "30s": "30"} {
		dur, _ := time.ParseDuration(d)
		if got := retryAfterSeconds(dur); got != want {
			t.Errorf("retryAfterSeconds(%s) = %q, want %q", d, got, want)
		}
	}
}
