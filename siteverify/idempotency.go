package siteverify

import (
	"crypto/rand"
	"encoding/hex"
)

// NewIdempotencyKey returns a random UUID version 4 to use as
// Params.IdempotencyKey. Generate one per token and reuse it for every retry
// of that token.
func NewIdempotencyKey() string {
	var b [16]byte
	// crypto/rand.Read never fails from Go 1.24 on; it crashes the program
	// instead of returning an error.
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40 // version 4
	b[8] = b[8]&0x3f | 0x80 // RFC 9562 variant

	var out [36]byte
	hex.Encode(out[0:8], b[0:4])
	out[8] = '-'
	hex.Encode(out[9:13], b[4:6])
	out[13] = '-'
	hex.Encode(out[14:18], b[6:8])
	out[18] = '-'
	hex.Encode(out[19:23], b[8:10])
	out[23] = '-'
	hex.Encode(out[24:36], b[10:16])
	return string(out[:])
}
