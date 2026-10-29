<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Siteverify;

/**
 * Transport based on PHP streams, for hosts without ext-curl. Needs
 * allow_url_fopen and, for https, ext-openssl. TLS is always verified.
 */
final class StreamTransport implements Transport
{
    public function post(string $url, #[\SensitiveParameter] string $body, array $headers, float $timeout): array
    {
        $lines = [];
        foreach ($headers as $name => $value) {
            $lines[] = $name . ': ' . $value;
        }
        $lines[] = 'Content-Length: ' . strlen($body);
        $lines[] = 'Connection: close';
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => implode("\r\n", $lines),
                'content' => $body,
                'timeout' => $timeout,
                'ignore_errors' => true,
                'follow_location' => 0,
                'max_redirects' => 0,
                'protocol_version' => 1.1,
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ],
        ]);

        $started = microtime(true);
        $lastError = null;
        set_error_handler(static function (int $no, string $msg) use (&$lastError): bool {
            $lastError = $msg;

            return true;
        });
        try {
            $stream = fopen($url, 'rb', false, $context);
            if ($stream === false) {
                if (microtime(true) - $started >= $timeout * 0.95 || ($lastError !== null && stripos($lastError, 'timed out') !== false)) {
                    throw new SiteverifyException(SiteverifyException::TIMEOUT, sprintf('siteverify request timed out after %.1f s', $timeout));
                }
                throw new SiteverifyException(SiteverifyException::NETWORK, 'siteverify request failed: ' . self::clean($lastError));
            }
            $responseBody = stream_get_contents($stream);
            $meta = stream_get_meta_data($stream);
            fclose($stream);
        } finally {
            restore_error_handler();
        }
        if (($meta['timed_out'] ?? false) === true) {
            throw new SiteverifyException(SiteverifyException::TIMEOUT, sprintf('siteverify request timed out after %.1f s', $timeout));
        }
        if ($responseBody === false) {
            throw new SiteverifyException(SiteverifyException::NETWORK, 'siteverify response could not be read');
        }

        $status = 0;
        $received = [];
        foreach ((array) ($meta['wrapper_data'] ?? []) as $line) {
            if (!is_string($line)) {
                continue;
            }
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
                $status = (int) $m[1];
                $received = [];
            } elseif (($pos = strpos($line, ':')) !== false) {
                $received[strtolower(trim(substr($line, 0, $pos)))] = trim(substr($line, $pos + 1));
            }
        }

        return ['status' => $status, 'headers' => $received, 'body' => $responseBody];
    }

    private static function clean(?string $warning): string
    {
        if ($warning === null || $warning === '') {
            return 'connection failed';
        }
        // "fopen(https://...): Failed to open stream: reason" -> "reason"
        $pos = strrpos($warning, ': ');

        return $pos === false ? $warning : substr($warning, $pos + 2);
    }
}
