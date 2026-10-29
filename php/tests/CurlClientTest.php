<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Tests;

use OpenWAF\Verify\Siteverify\CurlTransport;
use OpenWAF\Verify\Siteverify\Transport;
use PHPUnit\Framework\Attributes\RequiresPhpExtension;

#[RequiresPhpExtension('curl')]
final class CurlClientTest extends ClientTestCase
{
    protected function transport(): Transport
    {
        return new CurlTransport();
    }
}
