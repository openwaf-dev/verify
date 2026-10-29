<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Siteverify;

/** Transport based on ext-curl. TLS is always verified. */
final class CurlTransport implements Transport
{
    public function __construct()
    {
        if (!\extension_loaded('curl')) {
            throw new \LogicException('ext-curl is not loaded; use StreamTransport');
        }
    }

    public function post(string $url, #[\SensitiveParameter] string $body, array $headers, float $timeout): array
    {
        $lines = [];
        foreach ($headers as $name => $value) {
            $lines[] = $name . ': ' . $value;
        }
        $received = [];
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT_MS => max(1, (int) round($timeout * 1000)),
            CURLOPT_CONNECTTIMEOUT_MS => max(1, (int) round($timeout * 1000)),
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$received): int {
                $pos = strpos($line, ':');
                if ($pos !== false) {
                    $received[strtolower(trim(substr($line, 0, $pos)))] = trim(substr($line, $pos + 1));
                } elseif (str_starts_with($line, 'HTTP/')) {
                    $received = []; // new response block (e.g. after 100 Continue)
                }

                return strlen($line);
            },
        ]);
        $result = curl_exec($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if (\PHP_VERSION_ID < 80000) {
            curl_close($ch); // @codeCoverageIgnore
        }
        unset($ch);

        if ($errno === CURLE_OPERATION_TIMEDOUT) {
            throw new SiteverifyException(SiteverifyException::TIMEOUT, sprintf('siteverify request timed out after %.1f s', $timeout));
        }
        if ($errno !== 0 || !is_string($result)) {
            throw new SiteverifyException(SiteverifyException::NETWORK, 'siteverify request failed: ' . ($error !== '' ? $error : 'curl error ' . $errno));
        }

        return ['status' => $status, 'headers' => $received, 'body' => $result];
    }
}
