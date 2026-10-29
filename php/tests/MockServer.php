<?php

declare(strict_types=1);

namespace OpenWAF\Verify\Tests;

/** Starts `php -S` with the fixture router on a free loopback port, once per process. */
final class MockServer
{
    /** @var resource|null */
    private static $process = null;
    private static string $base = '';

    public static function url(string $path): string
    {
        if (self::$process === null) {
            self::start();
        }

        return self::$base . $path;
    }

    private static function start(): void
    {
        $probe = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
        if ($probe === false) {
            throw new \RuntimeException('cannot find a free port: ' . $errstr);
        }
        $name = (string) stream_socket_get_name($probe, false);
        fclose($probe);
        $port = (int) substr($name, strrpos($name, ':') + 1);

        $process = proc_open(
            [PHP_BINARY, '-S', '127.0.0.1:' . $port, __DIR__ . '/Fixtures/router.php'],
            [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
            $pipes,
        );
        if (!is_resource($process)) {
            throw new \RuntimeException('cannot start php -S');
        }
        self::$process = $process;
        self::$base = 'http://127.0.0.1:' . $port;
        register_shutdown_function(static function (): void {
            if (self::$process !== null) {
                proc_terminate(self::$process, 9);
                proc_close(self::$process);
                self::$process = null;
            }
        });

        $deadline = microtime(true) + 5;
        while (microtime(true) < $deadline) {
            $s = @fsockopen('127.0.0.1', $port, $e, $es, 0.2);
            if ($s !== false) {
                fclose($s);

                return;
            }
            usleep(50_000);
        }
        throw new \RuntimeException('php -S did not start');
    }
}
