package siteverify

// Error codes returned by the siteverify service in Response.ErrorCodes.
const (
	// CodeMissingInputSecret: the secret is empty.
	CodeMissingInputSecret = "missing-input-secret"
	// CodeInvalidInputSecret: the secret is malformed or is not a current
	// secret of the widget that issued the token.
	CodeInvalidInputSecret = "invalid-input-secret"
	// CodeMissingInputResponse: the token is empty.
	CodeMissingInputResponse = "missing-input-response"
	// CodeInvalidInputResponse: the token is malformed, has a bad signature
	// or belongs to an unknown widget.
	CodeInvalidInputResponse = "invalid-input-response"
	// CodeTimeoutOrDuplicate: the token expired (300 seconds) or was
	// already spent.
	CodeTimeoutOrDuplicate = "timeout-or-duplicate"
	// CodeRemoteIPMismatch: Params.RemoteIP is not in the network the token
	// is bound to.
	CodeRemoteIPMismatch = "remoteip-mismatch"
	// CodeBadRequest: the request body is malformed or too large, or the
	// method is not POST.
	CodeBadRequest = "bad-request"
	// CodeRateLimited: too many calls; wait for Response.RetryAfter.
	CodeRateLimited = "rate-limited"
	// CodeInternalError: single use could not be checked right now. The
	// token was not spent; retry.
	CodeInternalError = "internal-error"
)

// Error codes added by this library, never by the service. They are appended
// to Response.ErrorCodes, and Response.Success is set to false, when the
// service accepted the token but it was made for another hostname or action
// than the ones given in Params.
const (
	// CodeHostnameMismatch: Response.Hostname differs from
	// Params.ExpectedHostname.
	CodeHostnameMismatch = "hostname-mismatch"
	// CodeActionMismatch: Response.Action differs from
	// Params.ExpectedAction.
	CodeActionMismatch = "action-mismatch"
)

// Test keys. They work on every host with OpenWAF Verify and on both
// siteverify endpoints, and never spend anything.
const (
	// TestSitekeyPass always succeeds in the widget with TestToken.
	TestSitekeyPass = "owk_test_pass"
	// TestSitekeyFail always fails in the widget with the error "test-fail".
	TestSitekeyFail = "owk_test_fail"
	// TestSitekeyInteractive always shows the "Verify you are human"
	// checkbox and, once ticked, gives TestToken.
	TestSitekeyInteractive = "owk_test_interactive"

	// TestSecretPass accepts any non-empty token, with
	// Metadata.ResultWithTestingKey set, the hostname "example.com" and no
	// action (so Params.ExpectedAction fails with it).
	TestSecretPass = "ows_test_pass"
	// TestSecretFail always answers CodeInvalidInputResponse.
	TestSecretFail = "ows_test_fail"
	// TestSecretSpent always answers CodeTimeoutOrDuplicate.
	TestSecretSpent = "ows_test_spent"

	// TestToken is the token the test site keys produce.
	TestToken = "v1.TEST.TOKEN"
)
