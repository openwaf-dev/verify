// Package siteverify checks OpenWAF Verify tokens from a Go server.
//
// The OpenWAF Verify widget puts a single-use token in the
// "owaf-verify-response" field of a form. Before accepting the form, the
// server sends that token, together with the widget secret, to the
// siteverify endpoint and accepts the form only when the answer has
// Success set:
//
//	client, err := siteverify.New(os.Getenv("OWAF_VERIFY_SECRET"))
//	if err != nil {
//		log.Fatal(err)
//	}
//	res, err := client.Verify(ctx, r.PostFormValue(siteverify.ResponseFieldName), siteverify.Params{
//		ExpectedHostname: "example.com",
//		ExpectedAction:   "signup",
//	})
//	if err != nil {
//		// siteverify could not be reached or answered something unexpected:
//		// treat it as a failed check.
//	}
//	if !res.Success {
//		// res.ErrorCodes says why.
//	}
//
// Verify returns a *Response for every answer of the service, including
// failed checks (HTTP 200), malformed requests (400), wrong methods (405)
// and rate limits (429, with Response.RetryAfter). Transport problems are
// returned as an *Error that matches one of ErrTimeout, ErrNetwork, ErrHTTP
// or ErrBadResponse with errors.Is.
//
// The client never retries on its own. Tokens are single use, so a retry
// after a timeout must reuse the same Params.IdempotencyKey (see
// NewIdempotencyKey) against the same endpoint: the service then returns the
// first answer instead of spending the token again.
//
// The secret is never included in errors or in the fmt output of a Client.
package siteverify
