<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Tests;

use OpenWAF\Verify\Siteverify\Client;
use OpenWAF\Verify\Siteverify\CurlTransport;
use OpenWAF\Verify\Siteverify\StreamTransport;
use PHPUnit\Framework\TestCase;

/** Construction, helpers and secret hygiene (no network). */
final class ClientTest extends TestCase
{
    private const SECRET = 'ows_AnotherSecretThatMustNotShowUpAnywhere000000';

    public function testEmptySecretIsRejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new Client('');
    }

    public function testInvalidEndpointAndTimeoutAreRejected(): void
    {
        foreach ([['ftp://example.com', 1.0], ['example.com', 1.0], [Client::DEFAULT_ENDPOINT, 0.0]] as [$endpoint, $timeout]) {
            try {
                new Client(self::SECRET, $endpoint, $timeout);
                self::fail('expected InvalidArgumentException');
            } catch (\InvalidArgumentException $e) {
                self::assertStringNotContainsString(self::SECRET, (string) $e);
            }
        }
    }

    public function testDefaults(): void
    {
        $c = new Client(self::SECRET);
        self::assertSame('https://dash.openwaf.dev/v1/challenge/siteverify', $c->endpoint);
        self::assertSame(10.0, $c->timeout);
        self::assertSame('openwaf-verify-php/' . Client::VERSION, $c->userAgent);
        $transport = (new \ReflectionProperty(Client::class, 'transport'))->getValue($c);
        self::assertInstanceOf(\extension_loaded('curl') ? CurlTransport::class : StreamTransport::class, $transport);
    }

    public function testInvalidIdempotencyKeyIsRejectedBeforeSending(): void
    {
        $c = new Client(self::SECRET, 'http://127.0.0.1:9/', 1.0);
        foreach (['', str_repeat('k', 129)] as $key) {
            try {
                $c->verify('v1.abc', idempotencyKey: $key);
                self::fail('expected InvalidArgumentException');
            } catch (\InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
    }

    public function testIdempotencyKeyIsUuidV4(): void
    {
        $a = Client::idempotencyKey();
        self::assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $a);
        self::assertNotSame($a, Client::idempotencyKey());
    }

    public function testSecretIsNotDumped(): void
    {
        $c = new Client(self::SECRET);
        ob_start();
        var_dump($c);
        $dump = (string) ob_get_clean();
        self::assertStringNotContainsString(self::SECRET, $dump);
        self::assertStringContainsString('[redacted]', $dump);
        self::assertStringNotContainsString(self::SECRET, print_r($c, true));
    }

    public function testClientCannotBeSerialized(): void
    {
        $this->expectException(\LogicException::class);
        serialize(new Client(self::SECRET));
    }

    public function testSecretNotInConstructorTrace(): void
    {
        if (\PHP_VERSION_ID < 80200) {
            self::markTestSkipped('#[\SensitiveParameter] needs PHP 8.2');
        }
        try {
            new Client(self::SECRET, 'nope');
            self::fail('expected InvalidArgumentException');
        } catch (\InvalidArgumentException $e) {
            self::assertStringNotContainsString(self::SECRET, print_r($e->getTrace(), true));
        }
    }
}
