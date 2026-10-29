<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Tests;

use OpenWAF\Verify\Siteverify\Client;
use OpenWAF\Verify\Siteverify\Response;
use OpenWAF\Verify\Siteverify\SiteverifyException;
use OpenWAF\Verify\Siteverify\Transport;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/** Behaviour shared by every transport; subclasses pick the transport. */
abstract class ClientTestCase extends TestCase
{
    protected const SECRET = 'ows_UnitTestSecretValueThatMustNeverLeak0000000';

    abstract protected function transport(): Transport;

    private function client(string $path, float $timeout = 5.0): Client
    {
        return new Client(self::SECRET, MockServer::url($path), $timeout, $this->transport());
    }

    public function testSuccessIsParsed(): void
    {
        $r = $this->client('/ok')->verify('v1.abc');
        self::assertTrue($r->success);
        self::assertSame([], $r->errorCodes);
        self::assertSame('2026-10-29T10:00:00Z', $r->challengeTs);
        self::assertSame('example.com', $r->hostname);
        self::assertSame('login', $r->action);
        self::assertNull($r->cdata);
        self::assertSame('managed', $r->mode);
        self::assertFalse($r->interactive);
        self::assertSame('low', $r->risk);
        self::assertNull($r->resultWithTestingKey);
        self::assertSame(200, $r->httpStatus);
    }

    public function testRequestEncoding(): void
    {
        $key = Client::idempotencyKey();
        $r = $this->client('/echo')->verify('v1.tok+en/=&x', remoteIp: '203.0.113.7', idempotencyKey: $key);
        $seen = json_decode((string) $r->cdata, true);
        self::assertSame('POST', $seen['method']);
        self::assertSame('application/x-www-form-urlencoded', $seen['content_type']);
        self::assertSame('openwaf-verify-php/' . Client::VERSION, $seen['user_agent']);
        self::assertSame([
            'secret' => self::SECRET,
            'response' => 'v1.tok+en/=&x',
            'remoteip' => '203.0.113.7',
            'idempotency_key' => $key,
        ], $seen['post']);
    }

    public function testOptionalFieldsAreOmittedAndUserAgentOverridable(): void
    {
        $c = new Client(self::SECRET, MockServer::url('/echo'), 5.0, $this->transport(), 'my-app/1.0');
        $seen = json_decode((string) $c->verify('v1.abc')->cdata, true);
        self::assertSame(['secret' => self::SECRET, 'response' => 'v1.abc'], $seen['post']);
        self::assertSame('my-app/1.0', $seen['user_agent']);
    }

    /** @return iterable<string, array{string}> */
    public static function serverCodes(): iterable
    {
        foreach ([
            'missing-input-secret', 'invalid-input-secret', 'missing-input-response', 'invalid-input-response',
            'timeout-or-duplicate', 'remoteip-mismatch', 'bad-request', 'rate-limited', 'internal-error',
        ] as $code) {
            yield $code => [$code];
        }
    }

    #[DataProvider('serverCodes')]
    public function testServerErrorCodesAreReturned(string $code): void
    {
        $r = $this->client('/code/' . $code)->verify('v1.abc');
        self::assertFalse($r->success);
        self::assertSame([$code], $r->errorCodes);
        self::assertTrue($r->hasError($code));
    }

    public function testBadRequest400And405AreResponses(): void
    {
        foreach (['/400' => 400, '/405' => 405] as $path => $status) {
            $r = $this->client($path)->verify('v1.abc');
            self::assertFalse($r->success);
            self::assertSame(['bad-request'], $r->errorCodes);
            self::assertSame($status, $r->httpStatus);
            self::assertNull($r->retryAfter);
        }
    }

    public function testRateLimitedExposesRetryAfter(): void
    {
        $r = $this->client('/429')->verify('v1.abc');
        self::assertFalse($r->success);
        self::assertSame(['rate-limited'], $r->errorCodes);
        self::assertSame(429, $r->httpStatus);
        self::assertSame(7, $r->retryAfter);
    }

    /** @return iterable<string, array{string, string, int}> */
    public static function transportFailures(): iterable
    {
        yield '5xx with JSON' => ['/500', SiteverifyException::HTTP, 500];
        yield '5xx with HTML' => ['/502-html', SiteverifyException::HTTP, 502];
        yield 'unexpected status' => ['/404', SiteverifyException::HTTP, 404];
        yield '200 non-JSON' => ['/nonjson', SiteverifyException::BAD_RESPONSE, 200];
        yield '200 JSON without error-codes' => ['/no-codes', SiteverifyException::BAD_RESPONSE, 200];
    }

    #[DataProvider('transportFailures')]
    public function testTransportFailuresThrow(string $path, string $code, int $status): void
    {
        try {
            $this->client($path)->verify('v1.abc');
            self::fail('expected SiteverifyException');
        } catch (SiteverifyException $e) {
            self::assertSame($code, $e->errorCode);
            self::assertSame($status, $e->httpStatus);
            $this->assertNoSecret($e);
        }
    }

    public function testTimeout(): void
    {
        $started = microtime(true);
        try {
            $this->client('/sleep', 1.0)->verify('v1.abc');
            self::fail('expected timeout');
        } catch (SiteverifyException $e) {
            self::assertSame(SiteverifyException::TIMEOUT, $e->errorCode);
            self::assertLessThan(1.9, microtime(true) - $started);
            $this->assertNoSecret($e);
        }
    }

    public function testNetworkError(): void
    {
        // Port 9 (discard) on loopback is closed in test environments: connection refused.
        $c = new Client(self::SECRET, 'http://127.0.0.1:9/siteverify', 2.0, $this->transport());
        try {
            $c->verify('v1.abc');
            self::fail('expected network error');
        } catch (SiteverifyException $e) {
            self::assertSame(SiteverifyException::NETWORK, $e->errorCode);
            $this->assertNoSecret($e);
        }
    }

    public function testLocalShortCircuitsSendNothing(): void
    {
        // Unroutable endpoint: any request would throw.
        $c = new Client(self::SECRET, 'http://127.0.0.1:9/siteverify', 1.0, $this->transport());
        self::assertSame(['missing-input-response'], $c->verify('')->errorCodes);
        self::assertNull($c->verify('')->httpStatus);
        self::assertSame(['invalid-input-response'], $c->verify(str_repeat('a', 2049))->errorCodes);
    }

    public function testMaxLengthTokenIsSent(): void
    {
        self::assertTrue($this->client('/ok')->verify(str_repeat('a', 2048))->success);
    }

    public function testExpectedHostnameAndAction(): void
    {
        $c = $this->client('/ok');
        self::assertTrue($c->verify('v1.abc', expectedHostname: 'EXAMPLE.com', expectedAction: 'login')->success);

        $r = $c->verify('v1.abc', expectedHostname: 'other.example');
        self::assertFalse($r->success);
        self::assertSame([Response::HOSTNAME_MISMATCH], $r->errorCodes);
        self::assertSame('example.com', $r->hostname);

        $r = $c->verify('v1.abc', expectedAction: 'signup');
        self::assertFalse($r->success);
        self::assertSame([Response::ACTION_MISMATCH], $r->errorCodes);

        $r = $c->verify('v1.abc', expectedHostname: 'other.example', expectedAction: 'signup');
        self::assertSame([Response::HOSTNAME_MISMATCH], $r->errorCodes);
    }

    public function testExpectationsDoNotTouchFailures(): void
    {
        $r = $this->client('/code/invalid-input-response')->verify('v1.abc', expectedHostname: 'x.example', expectedAction: 'y');
        self::assertSame(['invalid-input-response'], $r->errorCodes);
    }

    protected function assertNoSecret(\Throwable $e): void
    {
        for ($t = $e; $t !== null; $t = $t->getPrevious()) {
            self::assertStringNotContainsString(self::SECRET, $t->getMessage());
            self::assertStringNotContainsString(self::SECRET, (string) $t);
            if (\PHP_VERSION_ID >= 80200) { // #[\SensitiveParameter] is honoured from 8.2
                self::assertStringNotContainsString(self::SECRET, print_r($t->getTrace(), true));
            }
        }
    }
}
