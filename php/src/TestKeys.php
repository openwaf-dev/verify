<?php

declare(strict_types=1);

namespace OpenWAF\Verify;

/**
 * Public test keys. They work on every host, never spend anything and never
 * reach real traffic decisions. Use them in development and CI only.
 */
final class TestKeys
{
    /** Widget always passes without interaction and yields {@see self::TOKEN}. */
    public const SITEKEY_PASS = 'owk_test_pass';
    /** Widget always fails with the error code `test-fail`. */
    public const SITEKEY_FAIL = 'owk_test_fail';
    /** Widget shows a checkbox, then yields {@see self::TOKEN}. */
    public const SITEKEY_INTERACTIVE = 'owk_test_interactive';

    /** Any non-empty response succeeds (hostname `example.com`, `metadata.result_with_testing_key` true). */
    public const SECRET_PASS = 'ows_test_pass';
    /** Always answers `invalid-input-response`. */
    public const SECRET_FAIL = 'ows_test_fail';
    /** Always answers `timeout-or-duplicate`. */
    public const SECRET_SPENT = 'ows_test_spent';

    /** Token produced by the pass and interactive test sitekeys. */
    public const TOKEN = 'v1.TEST.TOKEN';

    private function __construct()
    {
    }
}
