<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Tests;

use OpenWAF\Verify\Siteverify\Client;
use OpenWAF\Verify\Siteverify\CurlTransport;
use OpenWAF\Verify\Siteverify\StreamTransport;
use OpenWAF\Verify\Siteverify\Transport;
use OpenWAF\Verify\TestKeys;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Live calls against the public control plane with the public test secrets
 * only. Skip with OPENWAF_VERIFY_LIVE=0.
 */
final class LiveTest extends TestCase
{
    protected function setUp(): void
    {
        if (getenv('OPENWAF_VERIFY_LIVE') === '0') {
            self::markTestSkipped('OPENWAF_VERIFY_LIVE=0');
        }
    }

    /** @return iterable<string, array{\Closure(): Transport}> */
    public static function transports(): iterable
    {
        if (\extension_loaded('curl')) {
            yield 'curl' => [static fn (): Transport => new CurlTransport()];
        }
        yield 'stream' => [static fn (): Transport => new StreamTransport()];
    }

    #[DataProvider('transports')]
    public function testPass(\Closure $transport): void
    {
        $r = (new Client(TestKeys::SECRET_PASS, transport: $transport()))
            ->verify(TestKeys::TOKEN, idempotencyKey: Client::idempotencyKey(), expectedHostname: 'example.com');
        self::assertTrue($r->success, implode(',', $r->errorCodes));
        self::assertSame([], $r->errorCodes);
        self::assertSame('example.com', $r->hostname);
        self::assertTrue($r->resultWithTestingKey);
        self::assertNotNull($r->challengeTs);
        self::assertNotFalse(\DateTimeImmutable::createFromFormat(\DATE_RFC3339, (string) preg_replace('/\.\d+/', '', (string) $r->challengeTs)));
        self::assertContains($r->risk, ['low', 'high']);
        self::assertIsBool($r->interactive);
    }

    #[DataProvider('transports')]
    public function testHostnameMismatchOnLiveAnswer(\Closure $transport): void
    {
        $r = (new Client(TestKeys::SECRET_PASS, transport: $transport()))->verify(TestKeys::TOKEN, expectedHostname: 'www.example.org');
        self::assertFalse($r->success);
        self::assertSame(['hostname-mismatch'], $r->errorCodes);
    }

    /** @return iterable<string, array{\Closure(): Transport, string, string}> */
    public static function failures(): iterable
    {
        foreach (self::transports() as $name => [$t]) {
            yield "$name fail" => [$t, TestKeys::SECRET_FAIL, 'invalid-input-response'];
            yield "$name spent" => [$t, TestKeys::SECRET_SPENT, 'timeout-or-duplicate'];
            yield "$name malformed secret" => [$t, 'ows_not-a-real-secret', 'invalid-input-secret'];
            // A well-formed but unknown secret is rejected; the server does not
            // reveal whether the secret or the token was at fault.
            yield "$name unknown real-format secret" => [$t, 'ows_' . str_repeat('A', 43), 'invalid-input-secret|invalid-input-response'];
        }
    }

    #[DataProvider('failures')]
    public function testFailures(\Closure $transport, string $secret, string $code): void
    {
        $r = (new Client($secret, transport: $transport()))->verify(TestKeys::TOKEN);
        self::assertFalse($r->success);
        self::assertCount(1, $r->errorCodes);
        self::assertContains($r->errorCodes[0], explode('|', $code));
    }
}
