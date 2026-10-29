package siteverify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Version is the version of this library, sent in the User-Agent header.
const Version = "0.1.0"

const (
	// DefaultEndpoint is the control-plane siteverify endpoint.
	DefaultEndpoint = "https://dash.openwaf.dev/v1/challenge/siteverify"
	// DefaultTimeout bounds a whole Verify call: connection, request and
	// reading the answer.
	DefaultTimeout = 10 * time.Second
	// MaxTokenLength is the largest token, in bytes, siteverify accepts.
	// Verify answers CodeInvalidInputResponse for longer tokens without
	// calling the service.
	MaxTokenLength = 2048
	// MaxIdempotencyKeyLength is the largest Params.IdempotencyKey the
	// service accepts; longer keys get CodeBadRequest.
	MaxIdempotencyKeyLength = 128
	// ResponseFieldName is the default name of the form field in which the
	// widget puts its token.
	ResponseFieldName = "owaf-verify-response"
)

// maxResponseBytes bounds the answer body read from the service.
const maxResponseBytes = 64 << 10

const userAgent = "openwaf-verify-go/" + Version

// EdgeEndpoint returns the siteverify endpoint that the OpenWAF edge serves
// on one of your proxied host names, for example
// EdgeEndpoint("example.com") is
// "https://example.com/__waf/challenge/siteverify". Use it with
// WithEndpoint.
func EdgeEndpoint(host string) string {
	return "https://" + host + "/__waf/challenge/siteverify"
}

// Client checks tokens with the siteverify service. It is safe for
// concurrent use; create one per widget secret and reuse it.
type Client struct {
	// The secret is only reachable through a closure: fmt and other
	// reflection-based printers show a func as an address, so the secret is
	// not printed even when a Client is an unexported field of another
	// struct or is printed with an unusual verb.
	secret     func() string
	endpoint   string
	httpClient *http.Client
	timeout    time.Duration
}

// Option configures a Client in New.
type Option func(*Client) error

// WithEndpoint sets the siteverify endpoint: DefaultEndpoint (the default)
// or EdgeEndpoint(host) for one of your proxied host names. It must be an
// absolute http or https URL; use https outside tests.
func WithEndpoint(endpoint string) Option {
	return func(c *Client) error {
		u, err := url.Parse(endpoint)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			return fmt.Errorf("%w: endpoint must be an absolute http or https URL", ErrInvalidConfig)
		}
		c.endpoint = endpoint
		return nil
	}
}

// WithHTTPClient sets the *http.Client used for the calls, for example to
// use a proxy or custom transport. By default the client uses
// http.DefaultTransport and does not follow redirects, so the secret is
// never posted to another URL.
func WithHTTPClient(hc *http.Client) Option {
	return func(c *Client) error {
		if hc == nil {
			return fmt.Errorf("%w: HTTP client is nil", ErrInvalidConfig)
		}
		c.httpClient = hc
		return nil
	}
}

// WithTimeout sets the time limit of a whole Verify call (DefaultTimeout by
// default). Zero disables it, leaving only the deadline of the context and
// of the HTTP client; a negative value is an error.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) error {
		if d < 0 {
			return fmt.Errorf("%w: timeout is negative", ErrInvalidConfig)
		}
		c.timeout = d
		return nil
	}
}

// New returns a Client for one widget secret (ows_…). An empty secret or an
// invalid option returns an error matching ErrInvalidConfig.
func New(widgetSecret string, opts ...Option) (*Client, error) {
	if widgetSecret == "" {
		return nil, fmt.Errorf("%w: secret is empty", ErrInvalidConfig)
	}
	c := &Client{
		secret:   func() string { return widgetSecret },
		endpoint: DefaultEndpoint,
		httpClient: &http.Client{
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		timeout: DefaultTimeout,
	}
	for _, opt := range opts {
		if opt == nil {
			continue
		}
		if err := opt(c); err != nil {
			return nil, err
		}
	}
	return c, nil
}

// Endpoint returns the siteverify endpoint the client calls.
func (c *Client) Endpoint() string { return c.endpoint }

// String describes the client without its secret.
func (c *Client) String() string {
	return fmt.Sprintf("siteverify.Client{endpoint: %q, timeout: %s, secret: [redacted]}", c.endpoint, c.timeout)
}

// GoString describes the client without its secret, for %#v.
func (c *Client) GoString() string { return c.String() }

// Format prints the client without its secret, whatever the verb and flags.
func (c *Client) Format(f fmt.State, _ rune) { io.WriteString(f, c.String()) }

// Params are the optional fields of a Verify call.
type Params struct {
	// RemoteIP is the visitor's IP address. When given, the service checks
	// that it is in the same IPv4 /24 or IPv6 /64 as the browser that
	// solved the challenge (CodeRemoteIPMismatch otherwise). Behind the
	// OpenWAF edge, the address of the connection is the edge's, not the
	// visitor's: take it from a header your server trusts, or leave it
	// empty.
	RemoteIP string
	// IdempotencyKey (at most MaxIdempotencyKeyLength characters) makes
	// retries safe: the same secret, token and key within 300 seconds get
	// the first answer back without spending the token again. Generate one
	// per token with NewIdempotencyKey and reuse it for every retry.
	IdempotencyKey string
	// ExpectedHostname, when not empty, is compared (case-insensitively)
	// with the hostname of a successful answer; a different one turns it
	// into a failure with CodeHostnameMismatch.
	ExpectedHostname string
	// ExpectedAction, when not empty, is compared with the action of a
	// successful answer; a different one turns it into a failure with
	// CodeActionMismatch.
	ExpectedAction string
}

// Response is an answer of the siteverify service, or a failure decided
// locally (empty or too long token, hostname or action mismatch).
type Response struct {
	// Success is true only for a valid, unspent token of this widget whose
	// hostname and action match Params.
	Success bool `json:"success"`
	// ChallengeTS is when the token was issued (zero when absent).
	ChallengeTS time.Time `json:"challenge_ts,omitzero"`
	// Hostname is the host name the widget was rendered on.
	Hostname string `json:"hostname,omitempty"`
	// Action is the widget's data-action.
	Action string `json:"action,omitempty"`
	// CData is the widget's data-cdata.
	CData string `json:"cdata,omitempty"`
	// ErrorCodes is empty on success; otherwise it holds Code* values.
	ErrorCodes []string `json:"error-codes"`
	// Metadata describes how the token was obtained.
	Metadata Metadata `json:"metadata"`
	// StatusCode is the HTTP status of the answer: 200, 400, 405 or 429,
	// or 0 when the failure was decided without calling the service.
	StatusCode int `json:"-"`
	// RetryAfter is how long to wait before calling again, from the
	// Retry-After header of a 429 answer; 0 otherwise.
	RetryAfter time.Duration `json:"-"`
}

// Metadata is the metadata object of an answer.
type Metadata struct {
	// Mode is the widget mode: "managed", "non_interactive" or "invisible".
	Mode string `json:"mode,omitempty"`
	// Interactive is true when the visitor ticked the checkbox.
	Interactive bool `json:"interactive"`
	// Risk is "low", or "high" when interaction was required.
	Risk string `json:"risk,omitempty"`
	// ResultWithTestingKey is true when a test secret answered.
	ResultWithTestingKey bool `json:"result_with_testing_key,omitempty"`
}

// HasErrorCode reports whether the answer carries the given error code.
func (r *Response) HasErrorCode(code string) bool {
	return slices.Contains(r.ErrorCodes, code)
}

// wireResponse is the JSON answer of the service as received.
type wireResponse struct {
	Success     bool      `json:"success"`
	ChallengeTS string    `json:"challenge_ts"`
	Hostname    string    `json:"hostname"`
	Action      string    `json:"action"`
	CData       string    `json:"cdata"`
	ErrorCodes  *[]string `json:"error-codes"`
	Metadata    Metadata  `json:"metadata"`
}

func localFailure(code string) *Response {
	return &Response{ErrorCodes: []string{code}}
}

// Verify checks a token with the siteverify service.
//
// An empty token answers CodeMissingInputResponse and a token longer than
// MaxTokenLength answers CodeInvalidInputResponse, both without calling the
// service. Every answer of the service (HTTP 200, 400, 405 or 429) is
// returned as a *Response with a nil error; accept the token only when
// Response.Success is true.
//
// A non-nil error is an *Error (ErrTimeout, ErrNetwork, ErrHTTP or
// ErrBadResponse): the token was not verified. Verify never retries; to
// retry, call it again with the same Params.IdempotencyKey.
func (c *Client) Verify(ctx context.Context, token string, p Params) (*Response, error) {
	if token == "" {
		return localFailure(CodeMissingInputResponse), nil
	}
	if len(token) > MaxTokenLength {
		return localFailure(CodeInvalidInputResponse), nil
	}

	form := url.Values{}
	form.Set("secret", c.secret())
	form.Set("response", token)
	if p.RemoteIP != "" {
		form.Set("remoteip", p.RemoteIP)
	}
	if p.IdempotencyKey != "" {
		form.Set("idempotency_key", p.IdempotencyKey)
	}

	if c.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.timeout)
		defer cancel()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, &Error{Code: ErrorCodeNetwork, Err: err}
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, transportError(err, 0)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK, http.StatusBadRequest, http.StatusMethodNotAllowed, http.StatusTooManyRequests:
	default:
		return nil, &Error{Code: ErrorCodeHTTP, StatusCode: resp.StatusCode}
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, transportError(err, resp.StatusCode)
	}
	if len(body) > maxResponseBytes {
		return nil, &Error{Code: ErrorCodeBadResponse, StatusCode: resp.StatusCode, Err: errors.New("answer too large")}
	}
	var w wireResponse
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, &Error{Code: ErrorCodeBadResponse, StatusCode: resp.StatusCode, Err: err}
	}
	if w.ErrorCodes == nil {
		return nil, &Error{Code: ErrorCodeBadResponse, StatusCode: resp.StatusCode, Err: errors.New(`answer has no "error-codes"`)}
	}

	r := &Response{
		Success:    w.Success,
		Hostname:   w.Hostname,
		Action:     w.Action,
		CData:      w.CData,
		ErrorCodes: *w.ErrorCodes,
		Metadata:   w.Metadata,
		StatusCode: resp.StatusCode,
	}
	if w.ChallengeTS != "" {
		ts, err := time.Parse(time.RFC3339, w.ChallengeTS)
		if err != nil {
			return nil, &Error{Code: ErrorCodeBadResponse, StatusCode: resp.StatusCode, Err: errors.New(`invalid "challenge_ts"`)}
		}
		r.ChallengeTS = ts
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		r.RetryAfter = parseRetryAfter(resp.Header.Get("Retry-After"), time.Now())
	}
	if resp.StatusCode != http.StatusOK {
		// Only a 200 can carry a successful check.
		r.Success = false
	}

	if r.Success {
		if p.ExpectedHostname != "" && !strings.EqualFold(r.Hostname, p.ExpectedHostname) {
			r.Success = false
			r.ErrorCodes = append(r.ErrorCodes, CodeHostnameMismatch)
		}
		if p.ExpectedAction != "" && r.Action != p.ExpectedAction {
			r.Success = false
			r.ErrorCodes = append(r.ErrorCodes, CodeActionMismatch)
		}
	}
	return r, nil
}

// transportError classifies an error of the HTTP client or of reading the
// body.
func transportError(err error, status int) *Error {
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()) {
		return &Error{Code: ErrorCodeTimeout, StatusCode: status, Err: err}
	}
	return &Error{Code: ErrorCodeNetwork, StatusCode: status, Err: err}
}

// parseRetryAfter reads a Retry-After header in seconds or as an HTTP date.
func parseRetryAfter(v string, now time.Time) time.Duration {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	if s, err := strconv.ParseInt(v, 10, 64); err == nil {
		if s <= 0 {
			return 0
		}
		if s > int64(24*time.Hour/time.Second) {
			s = int64(24 * time.Hour / time.Second)
		}
		return time.Duration(s) * time.Second
	}
	if t, err := http.ParseTime(v); err == nil {
		if d := t.Sub(now); d > 0 {
			return d
		}
	}
	return 0
}
