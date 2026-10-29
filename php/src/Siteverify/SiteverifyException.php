<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Siteverify;

/**
 * Transport-level failure: the siteverify endpoint could not give a decision.
 * Decisions (including errors such as `invalid-input-response` or
 * `rate-limited`) are returned as a {@see Response}, never thrown.
 *
 * The message never contains the secret.
 */
final class SiteverifyException extends \RuntimeException
{
    /** The request did not complete within the configured timeout. */
    public const TIMEOUT = 'timeout';
    /** DNS, connection or TLS failure. */
    public const NETWORK = 'network';
    /** Unexpected HTTP status (e.g. 5xx) without a usable siteverify body. */
    public const HTTP = 'http';
    /** The body was not a siteverify JSON object. */
    public const BAD_RESPONSE = 'bad-response';

    /**
     * @param self::TIMEOUT|self::NETWORK|self::HTTP|self::BAD_RESPONSE $errorCode
     */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly ?int $httpStatus = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }
}
