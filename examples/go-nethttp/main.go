// Command go-nethttp is a small net/http server that protects a signup form
// with OpenWAF Verify.
//
// GET / serves the form with the widget; POST /signup checks the widget
// token with siteverify before accepting the form. The widget script is
// served by the OpenWAF edge under /__waf/ on your own host, so the widget
// only renders when this server runs behind a name proxied by OpenWAF.
// Without the edge you can still exercise the server side with the test
// keys:
//
//	go run ./examples/go-nethttp
//	curl -i http://127.0.0.1:8080/signup -d email=ana@example.com -d owaf-verify-response=v1.TEST.TOKEN
//
// Configuration (environment):
//
//	OWAF_VERIFY_SECRET    widget secret (default: the test secret ows_test_pass)
//	OWAF_VERIFY_SITEKEY   widget site key (default: the test site key owk_test_pass)
//	OWAF_VERIFY_HOSTNAME  host name the token must have been made on (optional)
//	OWAF_VERIFY_ENDPOINT  siteverify endpoint (default: the control plane)
//	ADDR                  listen address (default: 127.0.0.1:8080)
package main

import (
	"context"
	"errors"
	"html/template"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/openwaf-dev/verify/siteverify"
)

// action is the data-action of the widget on the signup form; siteverify
// returns it and the server checks it, so a token made for another form
// cannot be used here.
const action = "signup"

// verifier is the part of *siteverify.Client the server uses.
type verifier interface {
	Verify(ctx context.Context, token string, p siteverify.Params) (*siteverify.Response, error)
}

type server struct {
	verifier verifier
	sitekey  string
	hostname string // expected hostname; empty: not checked
	// checkAction makes siteverify answers for another form fail. It is
	// off only with the test secrets, whose answers carry no action.
	checkAction bool
	logger      *log.Logger
}

var page = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign up</title>
<script src="/__waf/challenge/v1/widget.js" async defer></script>
</head>
<body>
<main>
<h1>Sign up</h1>
{{if .Message}}<p role="status">{{.Message}}</p>{{end}}
<form action="/signup" method="post">
<label>Email <input name="email" type="email" autocomplete="email" required></label>
<div class="owaf-verify" data-sitekey="{{.Sitekey}}" data-action="{{.Action}}"></div>
<button type="submit">Sign up</button>
</form>
</main>
</body>
</html>
`))

type pageData struct {
	Sitekey string
	Action  string
	Message string
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.form)
	mux.HandleFunc("POST /signup", s.signup)
	return securityHeaders(mux)
}

// securityHeaders sets a strict Content-Security-Policy: the widget needs
// nothing else, because the edge serves it from this same origin.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

func (s *server) render(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := page.Execute(w, pageData{Sitekey: s.sitekey, Action: action, Message: message}); err != nil {
		s.logger.Printf("render: %v", err)
	}
}

func (s *server) form(w http.ResponseWriter, _ *http.Request) {
	s.render(w, http.StatusOK, "")
}

func (s *server) signup(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := r.ParseForm(); err != nil {
		s.render(w, http.StatusBadRequest, "The form could not be read.")
		return
	}
	email := r.PostFormValue("email")
	token := r.PostFormValue(siteverify.ResponseFieldName)

	p := siteverify.Params{
		// Behind the OpenWAF edge, r.RemoteAddr is the edge's address, not
		// the visitor's, so RemoteIP is left out. Set it only from a header
		// your server trusts.
		IdempotencyKey:   siteverify.NewIdempotencyKey(),
		ExpectedHostname: s.hostname,
	}
	if s.checkAction {
		p.ExpectedAction = action
	}
	res, err := s.verify(r.Context(), token, p)
	if err != nil {
		// siteverify could not be reached: never accept the form then.
		s.logger.Printf("siteverify: %v", err)
		s.render(w, http.StatusServiceUnavailable, "We could not check the verification right now. Please try again.")
		return
	}
	if !res.Success {
		s.logger.Printf("verification failed: %v", res.ErrorCodes)
		if res.HasErrorCode(siteverify.CodeRateLimited) {
			// Our server called siteverify too often; the visitor did
			// nothing wrong.
			if res.RetryAfter > 0 {
				w.Header().Set("Retry-After", retryAfterSeconds(res.RetryAfter))
			}
			s.render(w, http.StatusServiceUnavailable, "We are busy right now. Please try again in a moment.")
			return
		}
		s.render(w, http.StatusForbidden, "The verification failed. Please try again.")
		return
	}

	// The token was valid, unspent, made on the expected host for this
	// form: create the account here.
	s.logger.Printf("signup accepted for a visitor (test key: %v)", res.Metadata.ResultWithTestingKey)
	s.render(w, http.StatusOK, "Thanks! We sent a confirmation to "+email+".")
}

// verify calls siteverify and retries once after a timeout or a network
// error. The retry reuses p.IdempotencyKey, so it gets the first answer
// back instead of finding the token already spent.
func (s *server) verify(ctx context.Context, token string, p siteverify.Params) (*siteverify.Response, error) {
	res, err := s.verifier.Verify(ctx, token, p)
	if (errors.Is(err, siteverify.ErrTimeout) || errors.Is(err, siteverify.ErrNetwork)) && ctx.Err() == nil {
		res, err = s.verifier.Verify(ctx, token, p)
	}
	return res, err
}

// retryAfterSeconds formats d as a Retry-After value, rounding up.
func retryAfterSeconds(d time.Duration) string {
	return strconv.FormatInt(int64((d+time.Second-1)/time.Second), 10)
}

func isTestSecret(secret string) bool {
	switch secret {
	case siteverify.TestSecretPass, siteverify.TestSecretFail, siteverify.TestSecretSpent:
		return true
	}
	return false
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	logger := log.New(os.Stderr, "", log.LstdFlags)

	secret := os.Getenv("OWAF_VERIFY_SECRET")
	if secret == "" {
		secret = siteverify.TestSecretPass
		logger.Print("OWAF_VERIFY_SECRET is not set: using the test secret, which accepts any token")
	}
	opts := []siteverify.Option{}
	if endpoint := os.Getenv("OWAF_VERIFY_ENDPOINT"); endpoint != "" {
		opts = append(opts, siteverify.WithEndpoint(endpoint))
	}
	client, err := siteverify.New(secret, opts...)
	if err != nil {
		logger.Fatal(err)
	}

	s := &server{
		verifier: client,
		sitekey:  getenv("OWAF_VERIFY_SITEKEY", siteverify.TestSitekeyPass),
		hostname: os.Getenv("OWAF_VERIFY_HOSTNAME"),
		// Test answers carry no action, so only real secrets can be checked
		// against the form's action.
		checkAction: !isTestSecret(secret),
		logger:      logger,
	}
	srv := &http.Server{
		Addr:              getenv("ADDR", "127.0.0.1:8080"),
		Handler:           s.routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()

	logger.Printf("listening on http://%s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Fatal(err)
	}
}
