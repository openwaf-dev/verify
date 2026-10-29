<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Siteverify;

/**
 * Siteverify decision. Immutable.
 */
final class Response
{
    /** Library-side code: the server accepted the token but its hostname differs from the expected one. */
    public const HOSTNAME_MISMATCH = 'hostname-mismatch';
    /** Library-side code: the server accepted the token but its action differs from the expected one. */
    public const ACTION_MISMATCH = 'action-mismatch';

    /**
     * @param list<string>         $errorCodes
     * @param array<string, mixed> $raw        decoded JSON body (empty for local short-circuits)
     */
    public function __construct(
        public readonly bool $success,
        public readonly array $errorCodes,
        public readonly ?string $challengeTs = null,
        public readonly ?string $hostname = null,
        public readonly ?string $action = null,
        public readonly ?string $cdata = null,
        public readonly ?string $mode = null,
        public readonly ?bool $interactive = null,
        public readonly ?string $risk = null,
        public readonly ?bool $resultWithTestingKey = null,
        public readonly ?int $httpStatus = null,
        public readonly ?int $retryAfter = null,
        public readonly array $raw = [],
    ) {
    }

    /**
     * @param array<string, mixed> $data
     */
    public static function fromArray(array $data, ?int $httpStatus = null, ?int $retryAfter = null): self
    {
        $codes = [];
        foreach ((array) ($data['error-codes'] ?? []) as $code) {
            if (is_string($code)) {
                $codes[] = $code;
            }
        }
        $meta = is_array($data['metadata'] ?? null) ? $data['metadata'] : [];

        return new self(
            success: ($data['success'] ?? false) === true,
            errorCodes: $codes,
            challengeTs: self::str($data, 'challenge_ts'),
            hostname: self::str($data, 'hostname'),
            action: self::str($data, 'action'),
            cdata: self::str($data, 'cdata'),
            mode: self::str($meta, 'mode'),
            interactive: self::bool($meta, 'interactive'),
            risk: self::str($meta, 'risk'),
            resultWithTestingKey: self::bool($meta, 'result_with_testing_key'),
            httpStatus: $httpStatus,
            retryAfter: $retryAfter,
            raw: $data,
        );
    }

    /** Local decision made without contacting the server. */
    public static function localError(string $code): self
    {
        return new self(success: false, errorCodes: [$code]);
    }

    /** Copy marked as failed with an extra (library-side) error code. */
    public function withFailure(string $code): self
    {
        return new self(
            success: false,
            errorCodes: [...$this->errorCodes, $code],
            challengeTs: $this->challengeTs,
            hostname: $this->hostname,
            action: $this->action,
            cdata: $this->cdata,
            mode: $this->mode,
            interactive: $this->interactive,
            risk: $this->risk,
            resultWithTestingKey: $this->resultWithTestingKey,
            httpStatus: $this->httpStatus,
            retryAfter: $this->retryAfter,
            raw: $this->raw,
        );
    }

    public function hasError(string $code): bool
    {
        return in_array($code, $this->errorCodes, true);
    }

    /** @param array<mixed> $a */
    private static function str(array $a, string $k): ?string
    {
        return isset($a[$k]) && is_string($a[$k]) ? $a[$k] : null;
    }

    /** @param array<mixed> $a */
    private static function bool(array $a, string $k): ?bool
    {
        return isset($a[$k]) && is_bool($a[$k]) ? $a[$k] : null;
    }
}
