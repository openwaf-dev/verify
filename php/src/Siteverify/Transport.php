<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Siteverify;

/**
 * Minimal HTTP POST transport. Implementations must throw
 * {@see SiteverifyException} (TIMEOUT or NETWORK) on transport failures and
 * must never include the request body in messages.
 */
interface Transport
{
    /**
     * @param array<string, string> $headers
     *
     * @return array{status: int, headers: array<string, string>, body: string} header names lower-cased
     */
    public function post(string $url, #[\SensitiveParameter] string $body, array $headers, float $timeout): array;
}
