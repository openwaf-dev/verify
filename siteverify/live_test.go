package siteverify_test

import (
	"context"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/openwaf-dev/verify/siteverify"
)

// Live tests call the real control-plane endpoint with the public test
// secrets, which never spend anything. Set OPENWAF_VERIFY_LIVE=0 to skip
// them (for example without network access).

func liveClient(t *testing.T, secret string) *siteverify.Client {
	t.Helper()
	if os.Getenv("OPENWAF_VERIFY_LIVE") == "0" {
		t.Skip("OPENWAF_VERIFY_LIVE=0")
	}
	c, err := siteverify.New(secret, siteverify.WithTimeout(20*time.Second))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

func TestLivePass(t *testing.T) {
	c := liveClient(t, siteverify.TestSecretPass)
	res, err := c.Verify(context.Background(), siteverify.TestToken, siteverify.Params{
		IdempotencyKey:   siteverify.NewIdempotencyKey(),
		ExpectedHostname: "example.com",
	})
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !res.Success || len(res.ErrorCodes) != 0 {
		t.Fatalf("response = %+v, want a success", res)
	}
	if res.Hostname != "example.com" || !res.Metadata.ResultWithTestingKey || res.StatusCode != 200 {
		t.Errorf("response = %+v", res)
	}
	if res.ChallengeTS.IsZero() || time.Since(res.ChallengeTS).Abs() > time.Hour {
		t.Errorf("ChallengeTS = %s", res.ChallengeTS)
	}
}

func TestLivePassHostnameMismatch(t *testing.T) {
	c := liveClient(t, siteverify.TestSecretPass)
	res, err := c.Verify(context.Background(), siteverify.TestToken, siteverify.Params{ExpectedHostname: "www.example.org"})
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if res.Success || !res.HasErrorCode(siteverify.CodeHostnameMismatch) {
		t.Errorf("response = %+v, want %s", res, siteverify.CodeHostnameMismatch)
	}
}

func TestLiveFailures(t *testing.T) {
	cases := map[string]struct {
		secret string
		codes  []string // any of them
	}{
		"fail secret":  {siteverify.TestSecretFail, []string{siteverify.CodeInvalidInputResponse}},
		"spent secret": {siteverify.TestSecretSpent, []string{siteverify.CodeTimeoutOrDuplicate}},
		// A well-formed secret can only be judged against the widget that
		// issued the token; the test token belongs to no widget, so the
		// service may reject the token first.
		"unknown real-format secret": {"ows_" + strings.Repeat("A", 43),
			[]string{siteverify.CodeInvalidInputSecret, siteverify.CodeInvalidInputResponse}},
		"malformed secret": {"ows_short", []string{siteverify.CodeInvalidInputSecret}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			c := liveClient(t, tc.secret)
			res, err := c.Verify(context.Background(), siteverify.TestToken, siteverify.Params{})
			if err != nil {
				t.Fatalf("Verify: %v", err)
			}
			if res.Success || len(res.ErrorCodes) != 1 || !slices.Contains(tc.codes, res.ErrorCodes[0]) {
				t.Errorf("response = %+v, want one of %v", res, tc.codes)
			}
		})
	}
}

func TestLiveBadRequest(t *testing.T) {
	c := liveClient(t, siteverify.TestSecretPass)
	res, err := c.Verify(context.Background(), siteverify.TestToken, siteverify.Params{
		IdempotencyKey: strings.Repeat("k", siteverify.MaxIdempotencyKeyLength+1),
	})
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if res.Success || res.StatusCode != 400 || !res.HasErrorCode(siteverify.CodeBadRequest) {
		t.Errorf("response = %+v, want a 400 %s", res, siteverify.CodeBadRequest)
	}
}

func TestLiveIdempotentRetry(t *testing.T) {
	c := liveClient(t, siteverify.TestSecretPass)
	p := siteverify.Params{IdempotencyKey: siteverify.NewIdempotencyKey()}
	first, err := c.Verify(context.Background(), siteverify.TestToken, p)
	if err != nil {
		t.Fatalf("first Verify: %v", err)
	}
	second, err := c.Verify(context.Background(), siteverify.TestToken, p)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if !first.Success || !second.Success || !first.ChallengeTS.Equal(second.ChallengeTS) {
		t.Errorf("retry answered %+v after %+v", second, first)
	}
}
