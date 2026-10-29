<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Siteverify;

/**
 * Server-side client for the OpenWAF Verify siteverify API.
 *
 * The secret is kept private: it is excluded from var_dump/print_r
 * (__debugInfo), cannot be serialized and never appears in exception
 * messages or (PHP >= 8.2) stack-trace arguments.
 */
final class Client
{
    public const VERSION = '0.1.0';
    public const DEFAULT_ENDPOINT = 'https://dash.openwaf.dev/v1/challenge/siteverify';
    public const DEFAULT_TIMEOUT = 10.0;
    public const MAX_TOKEN_BYTES = 2048;
    public const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

    private readonly string $secret;
    public readonly string $endpoint;
    public readonly float $timeout;
    public readonly string $userAgent;
    private readonly Transport $transport;

    /**
     * @param string         $secret    siteverify secret (`ows_…`)
     * @param string         $endpoint  control plane (default) or `https://<your-host>/__waf/challenge/siteverify`
     * @param float          $timeout   seconds for the whole request
     * @param Transport|null $transport defaults to CurlTransport when ext-curl is loaded, else StreamTransport
     */
    public function __construct(
        #[\SensitiveParameter] string $secret,
        string $endpoint = self::DEFAULT_ENDPOINT,
        float $timeout = self::DEFAULT_TIMEOUT,
        ?Transport $transport = null,
        ?string $userAgent = null,
    ) {
        if ($secret === '') {
            throw new \InvalidArgumentException('siteverify secret must not be empty');
        }
        $scheme = strtolower((string) parse_url($endpoint, PHP_URL_SCHEME));
        if ($scheme !== 'https' && $scheme !== 'http') {
            throw new \InvalidArgumentException('siteverify endpoint must be an http(s) URL');
        }
        if (!($timeout > 0)) {
            throw new \InvalidArgumentException('siteverify timeout must be greater than 0');
        }
        $this->secret = $secret;
        $this->endpoint = $endpoint;
        $this->timeout = $timeout;
        $this->userAgent = $userAgent ?? 'openwaf-verify-php/' . self::VERSION;
        $this->transport = $transport ?? (\extension_loaded('curl') ? new CurlTransport() : new StreamTransport());
    }

    /**
     * Verify a widget token. Decisions are returned as a {@see Response}
     * (including `rate-limited`, with {@see Response::$retryAfter}); only
     * transport failures throw.
     *
     * Not retried automatically. To retry after a timeout, pass the SAME
     * $idempotencyKey (see {@see self::idempotencyKey()}): within 300 s the
     * server returns the first answer without spending the token again.
     *
     * @param string|null $expectedHostname when set, a success for another hostname becomes `hostname-mismatch`
     * @param string|null $expectedAction   when set, a success for another action becomes `action-mismatch`
     *
     * @throws SiteverifyException
     */
    public function verify(
        string $token,
        ?string $remoteIp = null,
        ?string $idempotencyKey = null,
        ?string $expectedHostname = null,
        ?string $expectedAction = null,
    ): Response {
        if ($token === '') {
            return Response::localError('missing-input-response');
        }
        if (strlen($token) > self::MAX_TOKEN_BYTES) {
            return Response::localError('invalid-input-response');
        }
        if ($idempotencyKey !== null && ($idempotencyKey === '' || strlen($idempotencyKey) > self::MAX_IDEMPOTENCY_KEY_LENGTH)) {
            throw new \InvalidArgumentException('idempotency key must be 1-128 characters');
        }

        $fields = ['secret' => $this->secret, 'response' => $token];
        if ($remoteIp !== null && $remoteIp !== '') {
            $fields['remoteip'] = $remoteIp;
        }
        if ($idempotencyKey !== null) {
            $fields['idempotency_key'] = $idempotencyKey;
        }

        $result = $this->transport->post(
            $this->endpoint,
            http_build_query($fields, '', '&', PHP_QUERY_RFC3986),
            [
                'Content-Type' => 'application/x-www-form-urlencoded',
                'Accept' => 'application/json',
                'User-Agent' => $this->userAgent,
            ],
            $this->timeout,
        );
        unset($fields);

        $response = $this->parse($result['status'], $result['headers'], $result['body']);

        if ($response->success && $expectedHostname !== null && strcasecmp((string) $response->hostname, $expectedHostname) !== 0) {
            $response = $response->withFailure(Response::HOSTNAME_MISMATCH);
        }
        if ($response->success && $expectedAction !== null && $response->action !== $expectedAction) {
            $response = $response->withFailure(Response::ACTION_MISMATCH);
        }

        return $response;
    }

    /** Random UUID v4, suitable as an idempotency key. */
    public static function idempotencyKey(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        $h = bin2hex($b);

        return sprintf('%s-%s-%s-%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 12, 4), substr($h, 16, 4), substr($h, 20));
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return [
            'secret' => '[redacted]',
            'endpoint' => $this->endpoint,
            'timeout' => $this->timeout,
            'userAgent' => $this->userAgent,
            'transport' => $this->transport::class,
        ];
    }

    public function __serialize(): array
    {
        throw new \LogicException('siteverify client cannot be serialized');
    }

    /** @param array<mixed> $data */
    public function __unserialize(array $data): void
    {
        throw new \LogicException('siteverify client cannot be unserialized');
    }

    /** @param array<string, string> $headers */
    private function parse(int $status, array $headers, string $body): Response
    {
        $data = json_decode($body, true);
        $usable = is_array($data) && !array_is_list($data) && is_array($data['error-codes'] ?? null);

        if ($usable && in_array($status, [200, 400, 405, 429], true)) {
            $retryAfter = null;
            if ($status === 429) {
                $value = $headers['retry-after'] ?? '';
                $retryAfter = ctype_digit($value) ? (int) $value : null;
            }

            return Response::fromArray($data, $status, $retryAfter);
        }
        if ($status !== 200) {
            throw new SiteverifyException(SiteverifyException::HTTP, sprintf('siteverify returned HTTP %d', $status), $status);
        }

        throw new SiteverifyException(SiteverifyException::BAD_RESPONSE, 'siteverify returned a body that is not a siteverify JSON object', $status);
    }
}
