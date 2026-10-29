package siteverify_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openwaf-dev/verify/siteverify"
)

// testSecret has the format of a real secret; it must never show up in any
// error or printed value.
const testSecret = "ows_Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5" // gitleaks:allow (made-up value)

// captured is one request seen by the mock server.
type captured struct {
	method      string
	contentType string
	userAgent   string
	accept      string
	form        url.Values
}

type mock struct {
	*httptest.Server
	mu       sync.Mutex
	requests []captured
}

// newMock starts a siteverify mock that records every request and answers
// with respond.
func newMock(t *testing.T, respond func(w http.ResponseWriter, r *http.Request)) *mock {
	t.Helper()
	m := &mock{}
	m.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		form, _ := url.ParseQuery(string(body))
		m.mu.Lock()
		m.requests = append(m.requests, captured{
			method:      r.Method,
			contentType: r.Header.Get("Content-Type"),
			userAgent:   r.Header.Get("User-Agent"),
			accept:      r.Header.Get("Accept"),
			form:        form,
		})
		m.mu.Unlock()
		respond(w, r)
	}))
	t.Cleanup(m.Close)
	return m
}

func (m *mock) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.requests)
}

func (m *mock) last(t *testing.T) captured {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.requests) == 0 {
		t.Fatal("the mock received no request")
	}
	return m.requests[len(m.requests)-1]
}

func jsonAnswer(status int, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		io.WriteString(w, body)
	}
}

func newClient(t *testing.T, endpoint string, opts ...siteverify.Option) *siteverify.Client {
	t.Helper()
	c, err := siteverify.New(testSecret, append([]siteverify.Option{siteverify.WithEndpoint(endpoint)}, opts...)...)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

// assertNoSecret fails when s contains the secret.
func assertNoSecret(t *testing.T, what, s string) {
	t.Helper()
	if strings.Contains(s, testSecret) || strings.Contains(s, url.QueryEscape(testSecret)) {
		t.Errorf("%s leaks the secret: %q", what, s)
	}
}

const successBody = `{"success":true,"challenge_ts":"2026-10-28T10:15:03Z","hostname":"example.com",` +
	`"action":"signup","cdata":"order-1234","error-codes":[],` +
	`"metadata":{"mode":"managed","interactive":true,"risk":"high"}}`

func TestNewRejectsInvalidConfig(t *testing.T) {
	cases := map[string]struct {
		secret string
		opts   []siteverify.Option
	}{
		"empty secret":          {"", nil},
		"empty endpoint":        {testSecret, []siteverify.Option{siteverify.WithEndpoint("")}},
		"relative endpoint":     {testSecret, []siteverify.Option{siteverify.WithEndpoint("/__waf/challenge/siteverify")}},
		"non-HTTP endpoint":     {testSecret, []siteverify.Option{siteverify.WithEndpoint("ftp://example.com/siteverify")}},
		"unparseable endpoint":  {testSecret, []siteverify.Option{siteverify.WithEndpoint("https://exa mple.com/%zz")}},
		"nil HTTP client":       {testSecret, []siteverify.Option{siteverify.WithHTTPClient(nil)}},
		"negative timeout":      {testSecret, []siteverify.Option{siteverify.WithTimeout(-time.Second)}},
		"later option is wrong": {testSecret, []siteverify.Option{siteverify.WithTimeout(time.Second), siteverify.WithEndpoint("example.com")}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			c, err := siteverify.New(tc.secret, tc.opts...)
			if !errors.Is(err, siteverify.ErrInvalidConfig) {
				t.Fatalf("New error = %v, want ErrInvalidConfig", err)
			}
			if c != nil {
				t.Fatalf("New returned a client with an error")
			}
			assertNoSecret(t, "New error", err.Error())
		})
	}
}

func TestNewDefaults(t *testing.T) {
	c, err := siteverify.New(testSecret, nil)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got := c.Endpoint(); got != siteverify.DefaultEndpoint {
		t.Errorf("Endpoint() = %q, want %q", got, siteverify.DefaultEndpoint)
	}
}

func TestEdgeEndpoint(t *testing.T) {
	if got, want := siteverify.EdgeEndpoint("www.example.com"), "https://www.example.com/__waf/challenge/siteverify"; got != want {
		t.Errorf("EdgeEndpoint = %q, want %q", got, want)
	}
}

func TestVerifyRequestEncoding(t *testing.T) {
	m := newMock(t, jsonAnswer(200, successBody))
	c := newClient(t, m.URL)

	res, err := c.Verify(context.Background(), "v1.abc+/=&x", siteverify.Params{
		RemoteIP:       "203.0.113.7",
		IdempotencyKey: "7f1c2a9e-1111-4222-8333-444455556666", // gitleaks:allow (made-up value)
	})
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	req := m.last(t)
	if req.method != http.MethodPost {
		t.Errorf("method = %s, want POST", req.method)
	}
	if req.contentType != "application/x-www-form-urlencoded" {
		t.Errorf("Content-Type = %q", req.contentType)
	}
	if req.accept != "application/json" {
		t.Errorf("Accept = %q", req.accept)
	}
	if want := "openwaf-verify-go/" + siteverify.Version; req.userAgent != want {
		t.Errorf("User-Agent = %q, want %q", req.userAgent, want)
	}
	want := url.Values{
		"secret":          {testSecret},
		"response":        {"v1.abc+/=&x"},
		"remoteip":        {"203.0.113.7"},
		"idempotency_key": {"7f1c2a9e-1111-4222-8333-444455556666"},
	}
	if fmt.Sprint(req.form) != fmt.Sprint(want) {
		t.Errorf("form = %v, want %v", req.form, want)
	}

	wantTS := time.Date(2026, 10, 28, 10, 15, 3, 0, time.UTC)
	if !res.Success || !res.ChallengeTS.Equal(wantTS) || res.Hostname != "example.com" ||
		res.Action != "signup" || res.CData != "order-1234" || res.StatusCode != 200 || res.RetryAfter != 0 {
		t.Errorf("unexpected response %+v", res)
	}
	if res.ErrorCodes == nil || len(res.ErrorCodes) != 0 {
		t.Errorf("ErrorCodes = %#v, want empty", res.ErrorCodes)
	}
	if want := (siteverify.Metadata{Mode: "managed", Interactive: true, Risk: "high"}); res.Metadata != want {
		t.Errorf("Metadata = %+v, want %+v", res.Metadata, want)
	}
}

func TestVerifyOmitsEmptyOptionalFields(t *testing.T) {
	m := newMock(t, jsonAnswer(200, successBody))
	c := newClient(t, m.URL)
	if _, err := c.Verify(context.Background(), siteverify.TestToken, siteverify.Params{}); err != nil {
		t.Fatalf("Verify: %v", err)
	}
	form := m.last(t).form
	for _, field := range []string{"remoteip", "idempotency_key"} {
		if _, ok := form[field]; ok {
			t.Errorf("form has %q although it was not given", field)
		}
	}
	if len(form) != 2 {
		t.Errorf("form = %v, want only secret and response", form)
	}
}

func TestVerifyServerErrorCodes(t *testing.T) {
	cases := []struct {
		status int
		code   string
	}{
		{200, siteverify.CodeMissingInputSecret},
		{200, siteverify.CodeInvalidInputSecret},
		{200, siteverify.CodeMissingInputResponse},
		{200, siteverify.CodeInvalidInputResponse},
		{200, siteverify.CodeTimeoutOrDuplicate},
		{200, siteverify.CodeRemoteIPMismatch},
		{200, siteverify.CodeInternalError},
		{400, siteverify.CodeBadRequest},
		{405, siteverify.CodeBadRequest},
		{429, siteverify.CodeRateLimited},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%d %s", tc.status, tc.code), func(t *testing.T) {
			m := newMock(t, jsonAnswer(tc.status, `{"success":false,"error-codes":["`+tc.code+`"]}`))
			res, err := newClient(t, m.URL).Verify(context.Background(), siteverify.TestToken, siteverify.Params{
				ExpectedHostname: "example.com",
				ExpectedAction:   "signup",
			})
			if err != nil {
				t.Fatalf("Verify: %v", err)
			}
			if res.Success {
				t.Error("Success = true")
			}
			if len(res.ErrorCodes) != 1 || !res.HasErrorCode(tc.code) {
				t.Errorf("ErrorCodes = %v, want only %q", res.ErrorCodes, tc.code)
			}
			if res.StatusCode != tc.status {
				t.Errorf("StatusCode = %d, want %d", res.StatusCode, tc.status)
			}
		})
	}
}

func TestVerifyOnlyStatus200CanSucceed(t *testing.T) {
	m := newMock(t, jsonAnswer(400, `{"success":true,"hostname":"example.com","error-codes":[]}`))
	res, err := newClient(t, m.URL).Verify(context.Background(), siteverify.TestToken, siteverify.Params{})
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if res.Success {
		t.Error("a 400 answer was reported as a success")
	}
}

func TestVerifyRateLimitedRetryAfter(t *testing.T) {
	future := time.Now().Add(90 * time.Second).UTC().Format(http.TimeFormat)
	cases := map[string]struct {
		header   string
		min, max time.Duration
	}{
		"seconds":     {"30", 30 * time.Second, 30 * time.Second},
		"HTTP date":   {future, 80 * time.Second, 91 * time.Second},
		"past date":   {"Wed, 21 Oct 2015 07:28:00 GMT", 0, 0},
		"absent":      {"", 0, 0},
		"garbage":     {"soon", 0, 0},
		"negative":    {"-5", 0, 0},
		"capped huge": {"999999999999", 24 * time.Hour, 24 * time.Hour},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			m := newMock(t, func(w http.ResponseWriter, r *http.Request) {
				if tc.header != "" {
					w.Header().Set("Retry-After", tc.header)
				}
				jsonAnswer(429, `{"success":false,"error-codes":["rate-limited"]}`)(w, r)
			})
			res, err := newClient(t, m.URL).Verify(context.Background(), siteverify.TestToken, siteverify.Params{})
			if err != nil {
				t.Fatalf("Verify: %v", err)
			}
			if !res.HasErrorCode(siteverify.CodeRateLimited) || res.StatusCode != 429 {
				t.Errorf("response = %+v", res)
			}
			if res.RetryAfter < tc.min || res.RetryAfter > tc.max {
				t.Errorf("RetryAfter = %s, want between %s and %s", res.RetryAfter, tc.min, tc.max)
			}
		})
	}
}

func TestVerifyRetryAfterOnlyOn429(t *testing.T) {
	m := newMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "30")
		jsonAnswer(200, `{"success":false,"error-codes":["internal-error"]}`)(w, r)
	})
	res, err := newClient(t, m.URL).Verify(context.Background(), siteverify.TestToken, siteverify.Params{})
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if res.RetryAfter != 0 {
		t.Errorf("RetryAfter = %s on a 200 answer", res.RetryAfter)
	}
}

// assertError checks that err is an *Error of the given kind and code.
func assertError(t *testing.T, err error, kind error, code string, status int) *siteverify.Error {
	t.Helper()
	if err == nil {
		t.Fatalf("Verify returned no error, want %v", kind)
	}
	if !errors.Is(err, kind) {
		t.Fatalf("error %v does not match %v", err, kind)
	}
	for _, other := range []error{siteverify.ErrTimeout, siteverify.ErrNetwork, siteverify.ErrHTTP, siteverify.ErrBadResponse} {
		if other != kind && errors.Is(err, other) {
			t.Errorf("error %v also matches %v", err, other)
		}
	}
	var e *siteverify.Error
	if !errors.As(err, &e) {
		t.Fatalf("error %T is not a *siteverify.Error", err)
	}
	if e.Code != code {
		t.Errorf("Code = %q, want %q", e.Code, code)
	}
	if e.StatusCode != status {
		t.Errorf("StatusCode = %d, want %d", e.StatusCode, status)
	}
	assertNoSecret(t, "error", err.Error())
	assertNoSecret(t, "error %+v", fmt.Sprintf("%+v %#v", err, err))
	return e
}

func TestVerifyUnexpectedStatus(t *testing.T) {
	for _, status := range []int{201, 302, 401, 403, 404, 500, 502, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			m := newMock(t, func(w http.ResponseWriter, r *http.Request) {
				if status == 302 {
					w.Header().Set("Location", "/elsewhere")
				}
				// Even a siteverify-looking body does not make these statuses
				// an answer.
				jsonAnswer(status, `{"success":true,"error-codes":[]}`)(w, r)
			})
			res, err := newClient(t, m.URL).Verify(context.Background(), siteverify.TestToken, siteverify.Params{})
			if res != nil {
				t.Errorf("response %+v returned with an error", res)
			}
			e := assertError(t, err, siteverify.ErrHTTP, siteverify.ErrorCodeHTTP, status)
			if !strings.Contains(e.Error(), fmt.Sprint(status)) {
				t.Errorf("error %q does not mention the status", e)
			}
			if status == 302 && m.count() != 1 {
				t.Errorf("the redirect was followed: %d requests", m.count())
			}
		})
	}
}

func TestVerifyBadResponse(t *testing.T) {
	cases := map[string]struct {
		status int
		body   string
	}{
		"HTML":                 {200, "<html>Bad gateway</html>"},
		"empty body":           {200, ""},
		"truncated JSON":       {200, `{"success":true,"error-codes":[`},
		"JSON array":           {200, `["success"]`},
		"no error-codes":       {200, `{"success":true,"hostname":"example.com"}`},
		"null error-codes":     {200, `{"success":true,"error-codes":null}`},
		"wrong success type":   {200, `{"success":"yes","error-codes":[]}`},
		"invalid challenge_ts": {200, `{"success":true,"challenge_ts":"yesterday","error-codes":[]}`},
		"too large":            {200, `{"success":true,"error-codes":[],"cdata":"` + strings.Repeat("a", 70<<10) + `"}`},
		"429 from a proxy":     {429, "<html>Too many requests</html>"},
		"400 without codes":    {400, `{"error":"bad"}`},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			m := newMock(t, jsonAnswer(tc.status, tc.body))
			res, err := newClient(t, m.URL).Verify(context.Background(), siteverify.TestToken, siteverify.Params{})
			if res != nil {
				t.Errorf("response %+v returned with an error", res)
			}
			assertError(t, err, siteverify.ErrBadResponse, siteverify.ErrorCodeBadResponse, tc.status)
		})
	}
}

// slowServer answers only after release is closed or the request is
// cancelled, optionally after sending the headers and part of the body.
func slowServer(t *testing.T, sendHeaders bool) *httptest.Server {
	t.Helper()
	release := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sendHeaders {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(200)
			io.WriteString(w, `{"success":true,`)
			w.(http.Flusher).Flush()
		}
		select {
		case <-release:
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	t.Cleanup(func() { close(release); s.Close() })
	return s
}

func TestVerifyTimeout(t *testing.T) {
	t.Run("client timeout before the headers", func(t *testing.T) {
		s := slowServer(t, false)
		c := newClient(t, s.URL, siteverify.WithTimeout(100*time.Millisecond))
		start := time.Now()
		_, err := c.Verify(context.Background(), siteverify.TestToken, siteverify.Params{})
		assertError(t, err, siteverify.ErrTimeout, siteverify.ErrorCodeTimeout, 0)
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Errorf("error %v does not wrap context.DeadlineExceeded", err)
		}
		if elapsed := time.Since(start); elapsed > 2*time.Second {
			t.Errorf("Verify took %s with a 100ms timeout", elapsed)
		}
	})
	t.Run("client timeout while reading the body", func(t *testing.T) {
		s := slowServer(t, true)
		c := newClient(t, s.URL, siteverify.WithTimeout(100*time.Millisecond))
		_, err := c.Verify(context.Background(), siteverify.TestToken, siteverify.Params{})
		assertError(t, err, siteverify.ErrTimeout, siteverify.ErrorCodeTimeout, 200)
	})
	t.Run("context deadline", func(t *testing.T) {
		s := slowServer(t, false)
		c := newClient(t, s.URL)
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		_, err := c.Verify(ctx, siteverify.TestToken, siteverify.Params{})
		assertError(t, err, siteverify.ErrTimeout, siteverify.ErrorCodeTimeout, 0)
	})
	t.Run("HTTP client timeout", func(t *testing.T) {
		s := slowServer(t, false)
		c := newClient(t, s.URL, siteverify.WithTimeout(0), siteverify.WithHTTPClient(&http.Client{Timeout: 100 * time.Millisecond}))
		_, err := c.Verify(context.Background(), siteverify.TestToken, siteverify.Params{})
		assertError(t, err, siteverify.ErrTimeout, siteverify.ErrorCodeTimeout, 0)
	})
}

func TestVerifyZeroTimeoutDisablesClientTimeout(t *testing.T) {
	m := newMock(t, func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(150 * time.Millisecond)
		jsonAnswer(200, successBody)(w, r)
	})
	// A 1ns timeout would fail; 0 must mean no library timeout at all.
	c := newClient(t, m.URL, siteverify.WithTimeout(time.Nanosecond), siteverify.WithTimeout(0))
	res, err := c.Verify(context.Background(), siteverify.TestToken, siteverify.Params{})
	if err != nil || !res.Success {
		t.Fatalf("Verify = %+v, %v", res, err)
	}
}

func TestVerifyNetworkError(t *testing.T) {
	t.Run("connection refused", func(t *testing.T) {
		s := httptest.NewServer(http.NotFoundHandler())
		endpoint := s.URL
		s.Close()
		_, err := newClient(t, endpoint).Verify(context.Background(), siteverify.TestToken, siteverify.Params{})
		assertError(t, err, siteverify.ErrNetwork, siteverify.ErrorCodeNetwork, 0)
	})
	t.Run("cancelled context", func(t *testing.T) {
		s := slowServer(t, false)
		ctx, cancel := context.WithCancel(context.Background())
		time.AfterFunc(50*time.Millisecond, cancel)
		_, err := newClient(t, s.URL).Verify(ctx, siteverify.TestToken, siteverify.Params{})
		assertError(t, err, siteverify.ErrNetwork, siteverify.ErrorCodeNetwork, 0)
		if !errors.Is(err, context.Canceled) {
			t.Errorf("error %v does not wrap context.Canceled", err)
		}
	})
}

func TestVerifyLocalShortCircuits(t *testing.T) {
	m := newMock(t, jsonAnswer(200, successBody))
	c := newClient(t, m.URL)
	cases := map[string]struct {
		token string
		code  string
	}{
		"empty token":    {"", siteverify.CodeMissingInputResponse},
		"too long token": {"v1." + strings.Repeat("a", siteverify.MaxTokenLength-2), siteverify.CodeInvalidInputResponse},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			res, err := c.Verify(context.Background(), tc.token, siteverify.Params{})
			if err != nil {
				t.Fatalf("Verify: %v", err)
			}
			if res.Success || len(res.ErrorCodes) != 1 || !res.HasErrorCode(tc.code) || res.StatusCode != 0 {
				t.Errorf("response = %+v, want a local %q failure", res, tc.code)
			}
		})
	}
	if n := m.count(); n != 0 {
		t.Fatalf("short-circuited calls sent %d requests", n)
	}

	longest := "v1." + strings.Repeat("a", siteverify.MaxTokenLength-3)
	if _, err := c.Verify(context.Background(), longest, siteverify.Params{}); err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if got := m.last(t).form.Get("response"); got != longest {
		t.Errorf("a %d-byte token was not sent as is", siteverify.MaxTokenLength)
	}
}

func TestVerifyExpectedHostnameAndAction(t *testing.T) {
	cases := map[string]struct {
		body      string
		params    siteverify.Params
		success   bool
		wantCodes []string
	}{
		"both match": {
			successBody, siteverify.Params{ExpectedHostname: "example.com", ExpectedAction: "signup"}, true, []string{},
		},
		"hostname is case-insensitive": {
			successBody, siteverify.Params{ExpectedHostname: "EXAMPLE.com"}, true, []string{},
		},
		"nothing expected": {
			successBody, siteverify.Params{}, true, []string{},
		},
		"hostname mismatch": {
			successBody, siteverify.Params{ExpectedHostname: "www.example.com", ExpectedAction: "signup"},
			false, []string{siteverify.CodeHostnameMismatch},
		},
		"action mismatch": {
			successBody, siteverify.Params{ExpectedHostname: "example.com", ExpectedAction: "login"},
			false, []string{siteverify.CodeActionMismatch},
		},
		"action is case-sensitive": {
			successBody, siteverify.Params{ExpectedAction: "Signup"},
			false, []string{siteverify.CodeActionMismatch},
		},
		"both mismatch": {
			successBody, siteverify.Params{ExpectedHostname: "example.org", ExpectedAction: "login"},
			false, []string{siteverify.CodeHostnameMismatch, siteverify.CodeActionMismatch},
		},
		"expected action but token has none": {
			`{"success":true,"hostname":"example.com","error-codes":[]}`, siteverify.Params{ExpectedAction: "signup"},
			false, []string{siteverify.CodeActionMismatch},
		},
		"failed answer is left alone": {
			`{"success":false,"error-codes":["timeout-or-duplicate"]}`,
			siteverify.Params{ExpectedHostname: "example.org", ExpectedAction: "login"},
			false, []string{siteverify.CodeTimeoutOrDuplicate},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			m := newMock(t, jsonAnswer(200, tc.body))
			res, err := newClient(t, m.URL).Verify(context.Background(), siteverify.TestToken, tc.params)
			if err != nil {
				t.Fatalf("Verify: %v", err)
			}
			if res.Success != tc.success || fmt.Sprint(res.ErrorCodes) != fmt.Sprint(tc.wantCodes) {
				t.Errorf("Success=%v ErrorCodes=%v, want %v %v", res.Success, res.ErrorCodes, tc.success, tc.wantCodes)
			}
		})
	}
}

func TestWithHTTPClientIsUsed(t *testing.T) {
	m := newMock(t, jsonAnswer(200, successBody))
	var calls atomic.Int32
	hc := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return http.DefaultTransport.RoundTrip(r)
	})}
	if _, err := newClient(t, m.URL, siteverify.WithHTTPClient(hc)).Verify(context.Background(), siteverify.TestToken, siteverify.Params{}); err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if calls.Load() != 1 {
		t.Errorf("custom transport used %d times, want 1", calls.Load())
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestClientNeverPrintsSecret(t *testing.T) {
	c, err := siteverify.New(testSecret)
	if err != nil {
		t.Fatal(err)
	}
	type holder struct {
		client  siteverify.Client // unexported field: fmt cannot call its methods
		pointer *siteverify.Client
	}
	type exported struct {
		Client siteverify.Client
	}
	values := []any{c, *c, holder{*c, c}, &holder{*c, c}, exported{*c}, []any{*c}, map[string]siteverify.Client{"c": *c}}
	for _, verb := range []string{"%v", "%+v", "%#v", "%s", "%q", "%x", "%T"} {
		for i, v := range values {
			assertNoSecret(t, fmt.Sprintf("%s of value %d", verb, i), fmt.Sprintf(verb, v))
		}
	}
	assertNoSecret(t, "String()", c.String())
	assertNoSecret(t, "GoString()", c.GoString())
	b, _ := json.Marshal(c)
	assertNoSecret(t, "json.Marshal", string(b))
}

func TestNewIdempotencyKey(t *testing.T) {
	uuidV4 := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	seen := make(map[string]bool)
	for range 1000 {
		k := siteverify.NewIdempotencyKey()
		if !uuidV4.MatchString(k) {
			t.Fatalf("key %q is not a UUID v4", k)
		}
		if len(k) > siteverify.MaxIdempotencyKeyLength {
			t.Fatalf("key %q is too long", k)
		}
		if seen[k] {
			t.Fatalf("duplicate key %q", k)
		}
		seen[k] = true
	}
}

func TestVerifyIsSafeForConcurrentUse(t *testing.T) {
	m := newMock(t, jsonAnswer(200, successBody))
	c := newClient(t, m.URL)
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := c.Verify(context.Background(), siteverify.TestToken, siteverify.Params{ExpectedAction: "signup"})
			if err != nil || !res.Success {
				t.Errorf("Verify = %+v, %v", res, err)
			}
		}()
	}
	wg.Wait()
	if m.count() != 20 {
		t.Errorf("mock saw %d requests, want 20", m.count())
	}
}
