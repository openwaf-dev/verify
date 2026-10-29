package siteverify

import (
	"errors"
	"strconv"
)

// ErrInvalidConfig is returned by New for an empty secret, an invalid
// endpoint or a negative timeout.
var ErrInvalidConfig = errors.New("siteverify: invalid configuration")

// Transport error kinds. Every error returned by Client.Verify is an *Error
// that matches exactly one of them with errors.Is.
var (
	// ErrTimeout: the call did not finish within the client timeout or the
	// deadline of the context. Retry with the same Params.IdempotencyKey.
	ErrTimeout = errors.New("siteverify: timeout")
	// ErrNetwork: the request could not be sent or the answer could not be
	// read (DNS, connection, TLS, cancelled context...).
	ErrNetwork = errors.New("siteverify: network error")
	// ErrHTTP: the service answered with an HTTP status it never uses for
	// an answer (anything other than 200, 400, 405 and 429; for example a
	// 5xx from a proxy or a redirect).
	ErrHTTP = errors.New("siteverify: unexpected HTTP status")
	// ErrBadResponse: the service answered with 200, 400, 405 or 429, but
	// the body is not a siteverify answer (not JSON, no "error-codes", too
	// large).
	ErrBadResponse = errors.New("siteverify: bad response")
)

// Error codes of an *Error. They are the same in the Go, Node and PHP
// clients.
const (
	ErrorCodeTimeout     = "timeout"
	ErrorCodeNetwork     = "network"
	ErrorCodeHTTP        = "http"
	ErrorCodeBadResponse = "bad-response"
)

// Error is a transport failure of Client.Verify: no siteverify answer was
// received, so the token must be treated as not verified. It never contains
// the secret or the token.
type Error struct {
	// Code is one of ErrorCodeTimeout, ErrorCodeNetwork, ErrorCodeHTTP or
	// ErrorCodeBadResponse.
	Code string
	// StatusCode is the HTTP status of the answer, or 0 when none was
	// received.
	StatusCode int
	// Err is the underlying error, if any (for example a *url.Error or
	// context.DeadlineExceeded).
	Err error
}

func (e *Error) kind() error {
	switch e.Code {
	case ErrorCodeTimeout:
		return ErrTimeout
	case ErrorCodeNetwork:
		return ErrNetwork
	case ErrorCodeHTTP:
		return ErrHTTP
	default:
		return ErrBadResponse
	}
}

// Error implements the error interface.
func (e *Error) Error() string {
	msg := e.kind().Error()
	if e.StatusCode != 0 {
		msg += " (HTTP " + strconv.Itoa(e.StatusCode) + ")"
	}
	if e.Err != nil {
		msg += ": " + e.Err.Error()
	}
	return msg
}

// Unwrap returns the error kind (ErrTimeout, ErrNetwork, ErrHTTP or
// ErrBadResponse) and the underlying error, for errors.Is and errors.As.
func (e *Error) Unwrap() []error {
	if e.Err == nil {
		return []error{e.kind()}
	}
	return []error{e.kind(), e.Err}
}
