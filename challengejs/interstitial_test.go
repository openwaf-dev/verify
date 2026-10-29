package challengejs

import (
	"bytes"
	"html/template"
	"strings"
	"testing"
)

// interstitialData is what the edge passes to interstitial.html (its header documents each field), in English.
func interstitialData(interactive bool) map[string]any {
	t := map[string]string{
		"Title": "Checking your browser…", "Heading": "Checking your browser", "HeadingHost": "Checking your browser before accessing %s",
		"Start": "Checking that this is a real browser.", "Slow": "Still checking.", "Done": "Done.", "Failed": "The check failed.",
		"Retry": "Try again", "NoScript": "Enable JavaScript.", "Footer": "Security check by OpenWAF", "FooterBy": "Security check by %s",
		"ProtectedBy": "Protected by OpenWAF", "Ask": "Verify you are human", "Prompt": "Verify you are human.", "Why": "%s needs to check.",
		"Verifying": "Verifying…", "Success": "Success", "BoxFailed": "Verification failed", "Interaction": "We can't verify this browser",
		"Region": "OpenWAF Verify", "Privacy": "Privacy", "Terms": "Terms", "NewTab": " (opens in a new tab)", "Help": "Trouble?",
		"PrivacyURL": "https://openwaf.dev/legal/privacy/", "TermsURL": "https://openwaf.dev/legal/terms/", "OurURL": "https://openwaf.dev/",
	}
	return map[string]any{"Lang": "en", "T": t, "Brand": nil, "CSS": template.CSS(Interstitial), "AccentCSS": template.CSS("#2456e8"),
		"Host": "www.example.com", "Interactive": interactive, "PAT": false, "Challenge": "c.</script>", "Nonce": "abcdefghijklmnopqrstuv",
		"Q": 4, "D": 10, "Worker": "/__waf/challenge/v1/worker.js?v=0123456789", "Help": "https://verify.openwaf.dev/?host=www.example.com",
		"Script": map[string]string{"start": "Checking"}, "WidgetCSS": template.CSS(Style), "PaletteCSS": template.CSS(""), "ID": "ABCD-EFGH"}
}

func renderInterstitial(t *testing.T, ext string, interactive bool) string {
	t.Helper()
	tmpl := template.Must(template.New("interstitial").Parse(InterstitialPage))
	if ext != "" {
		template.Must(tmpl.New("ext").Parse(ext))
	}
	var b bytes.Buffer
	if err := tmpl.Execute(&b, interstitialData(interactive)); err != nil {
		t.Fatal(err)
	}
	return b.String()
}

// The page renders with and without the verification box; the challenge is escaped inside the script; without an
// extension the solve posts the challenge and the solutions only.
func TestInterstitialPage(t *testing.T) {
	for _, interactive := range []bool{false, true} {
		out := renderInterstitial(t, "", interactive)
		for _, want := range []string{`<script src="/__waf/challenge/v1/worker.js?v=0123456789"></script>`, `fetch("/__waf/verify"`,
			`body:JSON.stringify({challenge:C,solutions:sol`, "window.owafPow.solveInWorker(W,N,Q,D,"} {
			if !strings.Contains(out, want) {
				t.Errorf("interactive=%v: %q missing", interactive, want)
			}
		}
		if strings.Contains(out, "c.</script>") || strings.Contains(out, "{{") {
			t.Errorf("interactive=%v: unescaped challenge or template text left", interactive)
		}
		if got := strings.Contains(out, `id="owaf-cb"`); got != interactive {
			t.Errorf("interactive=%v: verification box present = %v", interactive, got)
		}
	}
}

// A deployment's extension blocks land where the page documents them.
func TestInterstitialExtension(t *testing.T) {
	out := renderInterstitial(t, `{{define "ext-vars"}},X=1{{end}}{{define "ext-fields"}},x:X{{end}}`+
		`{{define "ext-nav"}}use(nav);{{end}}{{define "ext-activation"}}use(e);{{end}}`, true)
	for _, want := range []string{",X=1;", "interaction:ia,x:X})", "function solved(sol,nav){use(nav);", "e.preventDefault();use(e);sent=true;"} {
		if !strings.Contains(out, want) {
			t.Errorf("%q missing", want)
		}
	}
}
