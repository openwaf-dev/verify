package siteverify_test

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"

	"github.com/openwaf-dev/verify/siteverify"
)

func ExampleClient_Verify() {
	client, err := siteverify.New(os.Getenv("OWAF_VERIFY_SECRET"))
	if err != nil {
		log.Fatal(err)
	}

	http.HandleFunc("POST /signup", func(w http.ResponseWriter, r *http.Request) {
		res, err := client.Verify(r.Context(), r.PostFormValue(siteverify.ResponseFieldName), siteverify.Params{
			IdempotencyKey:   siteverify.NewIdempotencyKey(),
			ExpectedHostname: "example.com",
			ExpectedAction:   "signup",
		})
		if err != nil {
			// No answer from siteverify: never accept the form.
			http.Error(w, "verification unavailable", http.StatusServiceUnavailable)
			return
		}
		if !res.Success {
			http.Error(w, "verification failed", http.StatusForbidden)
			return
		}
		// Create the account.
	})
}

func ExampleClient_Verify_retry() {
	client, err := siteverify.New(os.Getenv("OWAF_VERIFY_SECRET"))
	if err != nil {
		log.Fatal(err)
	}
	token := "v1.…" // from the form

	// One key per token, reused for the retry: the service answers the retry
	// with the first answer instead of timeout-or-duplicate.
	p := siteverify.Params{IdempotencyKey: siteverify.NewIdempotencyKey()}
	res, err := client.Verify(context.Background(), token, p)
	if errors.Is(err, siteverify.ErrTimeout) || errors.Is(err, siteverify.ErrNetwork) {
		res, err = client.Verify(context.Background(), token, p)
	}
	if err != nil {
		log.Printf("siteverify: %v", err)
		return
	}
	log.Printf("success=%v codes=%v", res.Success, res.ErrorCodes)
}

func ExampleWithEndpoint() {
	// Verify through the OpenWAF edge on one of your proxied names instead
	// of the control plane.
	client, err := siteverify.New(os.Getenv("OWAF_VERIFY_SECRET"),
		siteverify.WithEndpoint(siteverify.EdgeEndpoint("www.example.com")))
	if err != nil {
		log.Fatal(err)
	}
	_ = client
}
