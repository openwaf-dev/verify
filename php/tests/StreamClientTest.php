<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Tests;

use OpenWAF\Verify\Siteverify\StreamTransport;
use OpenWAF\Verify\Siteverify\Transport;

final class StreamClientTest extends ClientTestCase
{
    protected function transport(): Transport
    {
        return new StreamTransport();
    }
}
