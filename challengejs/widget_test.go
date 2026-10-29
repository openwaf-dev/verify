package challengejs

import (
	"encoding/json"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
)

type widgetRun struct {
	Class      string            `json:"class"`
	States     []string          `json:"states"`
	Texts      []string          `json:"texts"`
	Live       string            `json:"live"`
	StatusRole string            `json:"statusRole"`
	Props      map[string]string `json:"props"`
	Button     struct {
		Hidden bool   `json:"hidden"`
		Label  string `json:"label"`
		Aria   string `json:"aria"`
	} `json:"button"`
	Box struct {
		Label string `json:"label"`
		Type  string `json:"type"`
	} `json:"box"`
	Clicked *struct {
		Focused   bool `json:"focused"`
		Untrusted struct {
			Prevented      bool   `json:"prevented"`
			Checked        bool   `json:"checked"`
			Posts          int    `json:"posts"`
			State          string `json:"state"`
			EnterPrevented bool   `json:"enterPrevented"`
		} `json:"untrusted"`
		RetryFocused bool `json:"retryFocused"`
	} `json:"clicked"`
	Posts []json.RawMessage `json:"posts"`
	Links []struct {
		Href, Target, Rel, Text, Aria string
	} `json:"links"`
	Region     string `json:"region"`
	BrandClass string `json:"brandClass"`
	Images     []struct {
		Src, Alt, Class string
	} `json:"images"`
	Name  string `json:"name"`
	Marks int    `json:"marks"`
	Legal int    `json:"legal"`
	Seps  []struct {
		Text, Aria string
		Links      int
	} `json:"seps"`
	Strings []string `json:"strings"`
}

// runWidget runs the embedded widget.min.js in testdata/widget.mjs (a Node DOM sandbox with a fake /start and
// /solve; scenario there) and returns what each widget rendered, by site key.
func runWidget(t *testing.T) map[string]widgetRun {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not installed")
	}
	script := filepath.Join(t.TempDir(), "widget.min.js")
	if err := os.WriteFile(script, Widget, 0o600); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command(node, "testdata/widget.mjs", script).Output()
	if err != nil {
		t.Fatalf("node: %v", err)
	}
	var runs map[string]widgetRun
	if err := json.Unmarshal(out, &runs); err != nil {
		t.Fatalf("widgets %q: %v", out, err)
	}
	return runs
}

// TestWidget runs the widget once and checks its accent, its states and its brand.
func TestWidget(t *testing.T) {
	runs := runWidget(t)
	t.Run("accent", func(t *testing.T) { accentCases(t, runs) })
	t.Run("states", func(t *testing.T) { stateCases(t, runs) })
	t.Run("brand", func(t *testing.T) { brandCases(t, runs) })
	t.Run("site brand", func(t *testing.T) { siteBrandCases(t, runs) })
}

func luminance(hex string) float64 {
	v, err := strconv.ParseUint(hex[1:], 16, 32)
	if len(hex) != 7 || err != nil {
		return math.NaN()
	}
	lin := func(c uint64) float64 {
		s := float64(c) / 255
		if s <= 0.04045 {
			return s / 12.92
		}
		return math.Pow((s+0.055)/1.055, 2.4)
	}
	return 0.2126*lin(v>>16) + 0.7152*lin(v>>8&0xff) + 0.0722*lin(v&0xff)
}

func contrast(a, b string) float64 {
	x, y := luminance(a), luminance(b)
	return (math.Max(x, y) + 0.05) / (math.Min(x, y) + 0.05)
}

// The accent: data-accent when it is #rgb/#rrggbb (anything else falls back to the zone colour of /start),
// kept as given when readable, otherwise adjusted to 3:1 for the rings of each theme and 4.5:1 for the button
// label.
func accentCases(t *testing.T, runs map[string]widgetRun) {
	zone := runs["owk_zone"].Props
	if zone["--owaf-v-acc-l"] != "#3b82f6" || zone["--owaf-v-acc-d"] != "#3b82f6" {
		t.Errorf("without data-accent: %v, want the zone colour #3b82f6 in both themes", zone)
	}
	for _, key := range []string{"owk_bad_name", "owk_bad_len", "owk_bad_css"} {
		if got := runs[key].Props; !reflect.DeepEqual(got, zone) {
			t.Errorf("%s: invalid data-accent gave %v, want the zone palette %v", key, got, zone)
		}
	}
	if p := runs["owk_accent"].Props; p["--owaf-v-acc-l"] != "#e63946" || p["--owaf-v-acc-d"] != "#e63946" {
		t.Errorf("data-accent=#e63946: %v, want it unchanged (readable in both themes)", p)
	}
	if p := runs["owk_light"].Props; p["--owaf-v-acc-l"] == "#c9ff02" || p["--owaf-v-btn-fg"] != "#18181b" {
		t.Errorf("data-accent=#c9ff02: %v, want a darker ring on light and a dark label", p)
	}
	for _, key := range []string{"owk_zone", "owk_accent", "owk_short", "owk_light"} {
		p := runs[key].Props
		if c := contrast(p["--owaf-v-acc-l"], "#fafafa"); !(c >= 3) {
			t.Errorf("%s: light ring %s has %.2f:1, want >= 3", key, p["--owaf-v-acc-l"], c)
		}
		if c := contrast(p["--owaf-v-acc-d"], "#18181b"); !(c >= 3) {
			t.Errorf("%s: dark ring %s has %.2f:1, want >= 3", key, p["--owaf-v-acc-d"], c)
		}
		if c := contrast(p["--owaf-v-btn-fg"], p["--owaf-v-btn-bg"]); !(c >= 4.5) {
			t.Errorf("%s: button label %s on %s has %.2f:1, want >= 4.5", key, p["--owaf-v-btn-fg"], p["--owaf-v-btn-bg"], c)
		}
	}
}

// Every state shows on the root's data-state and is announced in the polite status region; the verification box
// (interactive) and the retry button are localized and run the next step.
func stateCases(t *testing.T, runs map[string]widgetRun) {
	want := map[string]struct{ states, texts []string }{
		"owk_zone": {[]string{"solving", "success"}, []string{"Verifying…", "Verified"}},
		"owk_ask": {[]string{"solving", "interactive", "solving", "success"},
			[]string{"Verifying…", "Verify you are human", "Verifying…", "Success"}},
		"owk_ask_es": {[]string{"solving", "interactive", "solving", "success"},
			[]string{"Verificando…", "Verifica que eres humano", "Verificando…", "Correcto"}},
		"owk_ask_enter": {[]string{"solving", "interactive", "solving", "success"},
			[]string{"Verifying…", "Verify you are human", "Verifying…", "Success"}},
		"owk_ask_fail": {[]string{"solving", "interactive", "solving", "error"},
			[]string{"Verifying…", "Verify you are human", "Verifying…", "We can't verify this browser"}},
		"owk_fail": {[]string{"solving", "error", "solving", "error"},
			[]string{"Verifying…", "Verification failed", "Verifying…", "Verification failed"}},
		"owk_expire": {[]string{"solving", "success", "expired"}, []string{"Verifying…", "Verified", "Verification expired"}},
	}
	for key, w := range want {
		r := runs[key]
		if !reflect.DeepEqual(r.States, w.states) || !reflect.DeepEqual(r.Texts, w.texts) {
			t.Errorf("%s: states %q texts %q, want %q %q", key, r.States, r.Texts, w.states, w.texts)
		}
		if r.StatusRole != "status" || r.Live != "polite" {
			t.Errorf("%s: status role=%q aria-live=%q", key, r.StatusRole, r.Live)
		}
	}
	// The verification box: a real, focused checkbox labelled in the widget's language; a script's click is refused
	// (not ticked, nothing posted, still asking); a person's pointer, Space or Enter posts {kind, ms} once.
	for key, c := range map[string]struct{ label, kind string }{
		"owk_ask": {"Verify you are human", "pointer"}, "owk_ask_es": {"Verifica que eres humano", "keyboard"},
		"owk_ask_enter": {"Verify you are human", "keyboard"}, "owk_ask_fail": {"Verify you are human", "pointer"},
	} {
		r := runs[key]
		if r.Box.Label != c.label || r.Box.Type != "checkbox" || r.Clicked == nil || !r.Clicked.Focused {
			t.Errorf("%s: box %+v clicked %+v, want a focused checkbox «%s»", key, r.Box, r.Clicked, c.label)
			continue
		}
		if u := r.Clicked.Untrusted; !u.Prevented || u.Checked || u.Posts != 1 || u.State != "interactive" {
			t.Errorf("%s: a script's click %+v, want refused while asking", key, u)
		}
		var ia struct {
			Kind string `json:"kind"`
			MS   *int64 `json:"ms"`
		}
		if len(r.Posts) != 2 || string(r.Posts[0]) != "false" || json.Unmarshal(r.Posts[1], &ia) != nil || ia.Kind != c.kind || ia.MS == nil || *ia.MS < 0 {
			t.Errorf("%s: posted interactions %s, want false then {kind:%q, ms ≥ 0}", key, r.Posts, c.kind)
		}
	}
	if !runs["owk_ask_enter"].Clicked.Untrusted.EnterPrevented {
		t.Error("Enter on the box was not kept from submitting the page's form")
	}
	if r := runs["owk_ask_fail"]; r.Button.Hidden || r.Button.Label != "Try again" || !r.Clicked.RetryFocused {
		t.Errorf("failure after the box: retry %+v focused=%v, want a focused «Try again»", r.Button, r.Clicked.RetryFocused)
	}
	if runs["owk_ask"].Clicked.RetryFocused || !runs["owk_ask"].Button.Hidden {
		t.Error("success after the box shows or focuses the retry button")
	}
	for _, key := range []string{"owk_fail", "owk_expire"} {
		if b := runs[key].Button; b.Hidden || b.Label != "Try again" {
			t.Errorf("%s: retry button %+v, want a visible «Try again»", key, b)
		}
	}
	if c := runs["owk_compact"].Class; c != "owaf-v owaf-v-auto owaf-v-compact" {
		t.Errorf("data-size=compact: class %q", c)
	}
	// A failure links to the troubleshooting page once (made again for each failure) with the page's host and the last
	// challenge's support ID, in the widget's language; a white label never does.
	for key, href := range map[string]string{
		"owk_fail":     "https://verify.openwaf.dev/?host=shop.example&id=0123456789abcdef",
		"owk_ask_fail": "https://verify.openwaf.dev/?host=shop.example&id=fedcba9876543210",
	} {
		var help []string
		for _, l := range runs[key].Links {
			if strings.HasPrefix(l.Href, "https://verify.openwaf.dev/") {
				help = append(help, l.Href)
				if l.Text != "Trouble?" || l.Aria != "Trouble? Check your browser (opens in a new tab)" || l.Target != "_blank" || l.Rel != "noopener" {
					t.Errorf("%s: troubleshooting link %+v", key, l)
				}
			}
		}
		if len(help) != 1 || help[0] != href {
			t.Errorf("%s: troubleshooting links %v, want [%s]", key, help, href)
		}
	}
	if r := runs["owk_org_fail"]; len(r.States) == 0 || r.States[len(r.States)-1] != "error" || slices.ContainsFunc(r.Strings, func(s string) bool { return strings.Contains(s, "openwaf") }) {
		t.Errorf("white label failure: states %q strings %q, want an error without OpenWAF", r.States, r.Strings)
	}
}

// The OpenWAF brand and legal links, in the widget's language, open in a new tab without an opener.
func brandCases(t *testing.T, runs map[string]widgetRun) {
	for key, hrefs := range map[string][]string{
		"owk_zone":    {"https://openwaf.dev/?utm_source=verify-widget", "https://openwaf.dev/legal/privacy/", "https://openwaf.dev/legal/terms/"},
		"owk_compact": {"https://openwaf.dev/es/?utm_source=verify-widget", "https://openwaf.dev/es/legal/privacidad/", "https://openwaf.dev/es/legal/condiciones/"},
	} {
		checkLinks(t, key, runs[key], hrefs)
	}
	// OpenWAF's own brand is the hexagon alone (its link keeps the name), no wordmark.
	if r := runs["owk_zone"]; r.BrandClass != "owaf-v-brand" || r.Region != "OpenWAF Verify" || len(r.Images) != 0 || r.Marks != 1 || slices.Contains(r.Strings, "OPENWAF") {
		t.Errorf("no site brand: %q %q %v %d marks, want OpenWAF's hexagon alone", r.BrandClass, r.Region, r.Images, r.Marks)
	}
	// A brand icon takes the logo's place (alt = the brand's name); a foreign icon URL is dropped.
	const icon = "/__waf/challenge/v1/brand/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.svg"
	for key, name := range map[string]string{"owk_client_icon": "Acme Shop", "owk_org_icon": "Agencia Norte"} {
		if r := runs[key]; len(r.Images) != 1 || r.Images[0].Src != icon || r.Images[0].Alt != name || r.Images[0].Class != "owaf-v-brand-icon" {
			t.Errorf("%s: images %+v, want the icon with alt «%s»", key, r.Images, name)
		}
	}
	if r := runs["owk_client_icon"]; r.Marks != 1 || !slices.Contains(r.Strings, "Protected by OpenWAF") {
		t.Errorf("client icon: %d marks, want «Protected by OpenWAF» kept", r.Marks)
	}
	if r := runs["owk_org_bad"]; len(r.Images) != 0 {
		t.Errorf("foreign icon kept: %+v", r.Images)
	}
}

func checkLinks(t *testing.T, key string, r widgetRun, hrefs []string) {
	t.Helper()
	if len(r.Links) != len(hrefs) {
		t.Errorf("%s: links %+v, want %v", key, r.Links, hrefs)
		return
	}
	for i, l := range r.Links {
		if l.Href != hrefs[i] || l.Target != "_blank" || l.Rel != "noopener" || l.Aria == "" {
			t.Errorf("%s: link %d %+v, want %s in a new tab, rel=noopener, labelled", key, i, l, hrefs[i])
		}
		if strings.Contains(l.Text, "|") || strings.Contains(l.Aria, "|") {
			t.Errorf("%s: link %d %+v carries the separator", key, i, l)
		}
	}
	// Legal links are separated by a decorative «|», hidden from assistive technology and outside the links.
	if want := max(r.Legal-1, 0); len(r.Seps) != want {
		t.Errorf("%s: %d separators for %d legal links, want %d", key, len(r.Seps), r.Legal, want)
	}
	for _, sep := range r.Seps {
		if sep.Text != "|" || sep.Aria != "true" || sep.Links != 0 {
			t.Errorf("%s: separator %+v, want a bare aria-hidden «|»", key, sep)
		}
	}
}

// The site's brand (/start brand). Kind client: its logo (alt = its name) or its name, then "Protected by OpenWAF"
// with our mark and our legal links. Kind org: its logo or name and only its own legal pages; nothing says OpenWAF.
func siteBrandCases(t *testing.T, runs map[string]widgetRun) {
	const svg = "/__waf/challenge/v1/brand/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg"
	const png = "/__waf/challenge/v1/brand/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png"
	ours := func(lang string) []string {
		if lang == "es" {
			return []string{"https://openwaf.dev/es/?utm_source=verify-widget", "https://openwaf.dev/es/legal/privacidad/", "https://openwaf.dev/es/legal/condiciones/"}
		}
		return []string{"https://openwaf.dev/?utm_source=verify-widget", "https://openwaf.dev/legal/privacy/", "https://openwaf.dev/legal/terms/"}
	}
	for key, c := range map[string]struct {
		img, name, by, lang string
	}{
		"owk_client":         {svg, "", "Protected by OpenWAF", "en"},
		"owk_client_text":    {"", "Acme Shop", "Protegido por OpenWAF", "es"},
		"owk_client_compact": {svg, "", "Protegido por OpenWAF", "es"},
		"owk_client_urls":    {"", "Acme Shop", "Protected by OpenWAF", "en"}, // a client brand never takes legal pages
	} {
		r := runs[key]
		if c.img != "" && (len(r.Images) != 1 || r.Images[0].Src != c.img || r.Images[0].Alt != "Acme Shop" || r.Images[0].Class != "owaf-v-brand-logo") {
			t.Errorf("%s: images %+v, want the logo with alt «Acme Shop»", key, r.Images)
		}
		if c.img == "" && (len(r.Images) != 0 || r.Name != "Acme Shop") {
			t.Errorf("%s: images %+v name %q, want the name as text", key, r.Images, r.Name)
		}
		if r.BrandClass != "owaf-v-brand owaf-v-brand-client" || r.Marks != 1 || r.Region != "OpenWAF Verify" || !slices.Contains(r.Strings, c.by) {
			t.Errorf("%s: %q, %d marks, region %q, want the client column with «%s» and our mark", key, r.BrandClass, r.Marks, r.Region, c.by)
		}
		checkLinks(t, key, r, ours(c.lang))
		if r.Links[0].Aria != c.by+map[string]string{"en": " (opens in a new tab)", "es": " (se abre en una pestaña nueva)"}[c.lang] {
			t.Errorf("%s: provider link labelled %q", key, r.Links[0].Aria)
		}
	}
	for key, c := range map[string]struct {
		img, name, region string
		hrefs             []string
	}{
		"owk_org":         {png, "", "Comprobación de seguridad de Agencia Norte", []string{"https://norte.example/privacidad"}},
		"owk_org_compact": {png, "", "Security check by Agencia Norte", []string{"https://norte.example/p", "https://norte.example/t"}},
		"owk_org_bad":     {"", "Agencia Norte", "Security check by Agencia Norte", nil},
	} {
		r := runs[key]
		if c.img != "" && (len(r.Images) != 1 || r.Images[0].Src != c.img || r.Images[0].Alt != "Agencia Norte") {
			t.Errorf("%s: images %+v, want the logo with alt «Agencia Norte»", key, r.Images)
		}
		if c.img == "" && (len(r.Images) != 0 || r.Name != "Agencia Norte") {
			t.Errorf("%s: images %+v name %q, want the name as text", key, r.Images, r.Name)
		}
		if r.BrandClass != "owaf-v-brand owaf-v-brand-org" || r.Marks != 0 || r.Region != c.region {
			t.Errorf("%s: %q, %d marks, region %q, want the org column (%q) without our mark", key, r.BrandClass, r.Marks, r.Region, c.region)
		}
		checkLinks(t, key, r, c.hrefs)
		for _, s := range r.Strings {
			if strings.Contains(strings.ToLower(s), "openwaf") {
				t.Errorf("%s: white label shows %q", key, s)
			}
		}
	}
}
